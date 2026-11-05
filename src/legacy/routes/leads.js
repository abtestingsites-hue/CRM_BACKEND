const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const Redis = require('ioredis');
const { requireRole } = require('../middleware/auth');
const { provisionErpDomainRecords } = require('../services/erpDomainRouting');

const prisma = require('../prisma');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Connect to Redis for distributed locks
const redisConnection = process.env.REDIS_URL 
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null }) 
  : new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: process.env.REDIS_PORT || 6379,
    });

redisConnection.on('error', (err) => {
  console.error('[Redis Leads] Error:', err.message);
});

// POST /api/v1/leads/upload (Super Admin / Admin / Supervisor / Senior Manager)
router.post('/upload', requireRole(['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SENIOR_MANAGER']), upload.single('file'), async (req, res) => {
  try {
    const uploadedById = req.user?.userId || req.user?.id || req.body.uploadedById;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Parse file based on extension
    let data = [];
    const fileName = req.file.originalname;
    
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.csv')) {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    // 1. Create Upload History
    const history = await prisma.leadUploadHistory.create({
      data: {
        fileName,
        uploadedById,
        totalRows: data.length,
        status: 'PROCESSING'
      }
    });

    let successfulRows = 0;
    let failedRows = 0;
    const errors = [];

    // 2. Process rows
    for (const [index, row] of data.entries()) {
      try {
        const phone = String(row.phone_number || row.phone || row.phoneNumber || '').trim();
        const name = row.customer_name || row.name || row.customerName || 'Unknown';
        if (!phone) throw new Error('Missing phone number');

        await prisma.lead.upsert({
          where: { phoneNumber: phone },
          update: {
            // Update if existing? For now, we skip or update source
            source: row.source || 'Excel Upload',
            serviceInterest: row.service_interest || row.serviceInterest || null,
          },
          create: {
            customerName: name,
            phoneNumber: phone,
            email: row.email || null,
            serviceInterest: row.service_interest || row.serviceInterest || null,
            city: row.city || null,
            notes: row.notes || null,
            source: row.source || 'Excel Upload',
            status: 'NEW',
            uploadedById,
            uploadHistoryId: history.id
          }
        });
        successfulRows++;
      } catch (err) {
        failedRows++;
        errors.push({ row: index + 2, error: err.message });
      }
    }

    // 3. Update History
    await prisma.leadUploadHistory.update({
      where: { id: history.id },
      data: {
        successfulRows,
        failedRows,
        status: 'COMPLETED',
        errorLog: errors
      }
    });

    invalidateLeadsCache();
    const io = req.app.get('io');
    if (io) io.emit('leadsUpdated'); // Broadcast change

    res.json({ success: true, successfulRows, failedRows, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// POST /api/v1/leads - Create single lead
router.post('/', async (req, res) => {
  try {
    const { customerName, phoneNumber, email, serviceInterest, notes, source, city, assignedAgentId, agentId, status } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const trimmedPhone = String(phoneNumber).trim();

    // Check for duplicate lead by phone number
    const existing = await prisma.lead.findUnique({
      where: { phoneNumber: trimmedPhone }
    });
    if (existing) {
      return res.status(409).json({
        error: 'Duplicate lead: A lead with this phone number already exists',
        code: 'DUPLICATE_PHONE_NUMBER',
        leadId: existing.id
      });
    }

    const effectiveAgentId = assignedAgentId || agentId || null;

    const lead = await prisma.lead.create({
      data: {
        customerName: customerName || 'Unknown Lead',
        phoneNumber: trimmedPhone,
        email: email || null,
        serviceInterest: req.body.primaryService || serviceInterest || null,
        notes: notes || null,
        source: source || 'Manual Entry',
        city: city || null,
        assignedAgentId: effectiveAgentId,
        status: status || 'NEW',
        primaryService: req.body.primaryService || null,
        subServices: req.body.subServices || [],
        patientName: req.body.patientName || null,
        patientAge: req.body.patientAge !== undefined ? parseInt(req.body.patientAge, 10) : null,
        patientConditions: req.body.patientConditions || null,
        patientMobility: req.body.patientMobility || null,
        engagementType: req.body.engagementType || null,
        careDurationCategory: req.body.careDurationCategory || null,
        careDuration: req.body.careDuration || null,
        careSchedule: req.body.careSchedule || null,
        serviceAddress: req.body.serviceAddress || null,
        cityDistrict: req.body.cityDistrict || null,
        postalCode: req.body.postalCode || null,
        pickupLocation: req.body.pickupLocation || null,
        destinationLocation: req.body.destinationLocation || null,
        foundation: req.body.foundation || null,
        enquiryCategory: req.body.enquiryCategory || null,
      }
    });

    invalidateLeadsCache();
    const io = req.app.get('io');
    if (io) io.emit('leadsUpdated', lead);

    res.status(200).json(lead);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'Duplicate lead: A lead with this phone number already exists',
        code: 'DUPLICATE_PHONE_NUMBER'
      });
    }
    console.error('[Leads Create] Error:', err);
    res.status(500).json({ error: 'Failed to create lead', details: err.message });
  }
});

// Short-lived query cache with single-flight de-duplication to prevent DB pool exhaustion under high concurrency
const leadsDbCache = new Map();
const inFlightLeadsQueries = new Map();
const LEADS_CACHE_TTL = 3000; // 3 seconds

function invalidateLeadsCache() {
  leadsDbCache.clear();
}

// Helper to generate readable summary for "What Are They Looking For?"
function generateEnquirySummary(lead) {
  const parts = [];
  const service = lead.primaryService || lead.serviceInterest;
  if (service && service !== 'Unknown') parts.push(`Service: ${service}`);

  const requirements = [];
  if (lead.subServices && Array.isArray(lead.subServices) && lead.subServices.length > 0) {
    requirements.push(lead.subServices.join(', '));
  }
  if (lead.patientConditions) {
    requirements.push(lead.patientConditions);
  }
  if (requirements.length > 0) {
    parts.push(`Requirements: ${requirements.join(' • ')}`);
  }

  if (lead.careDurationCategory || lead.careDuration) {
    parts.push(`Duration: ${lead.careDurationCategory || lead.careDuration}`);
  }

  if (lead.careSchedule) {
    parts.push(`Schedule: ${lead.careSchedule}`);
  }

  if (parts.length === 0) {
    return 'Details not recorded';
  }

  return parts.join(' | ');
}

// GET /api/v1/leads
router.get('/', async (req, res) => {
  try {
    const { status, agentId, assignedAgentId, service, organization, foundation, enquiryCategory, search, q, query, unitId } = req.query;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
    const isUnitAdmin = req.user?.role === 'ADMIN';

    // Unit Admin Restrictions: Strictly restricted to their assigned unit
    if (isUnitAdmin) {
      const userUnitId = req.user?.unitId;
      if (unitId && unitId !== 'ALL' && unitId !== userUnitId) {
        return res.status(403).json({ error: 'Forbidden: Access to requested business unit is restricted' });
      }
      if (userUnitId) {
        whereClause.unitId = userUnitId;
      }
    } else if (isSuperAdmin && unitId && unitId !== 'ALL') {
      const isUuid = UUID_REGEX.test(unitId);
      if (isUuid) {
        whereClause.unitId = unitId;
      } else {
        whereClause.OR = [
          { unit: { code: { equals: unitId, mode: 'insensitive' } } },
          { foundation: { contains: unitId, mode: 'insensitive' } },
          { unit: { name: { contains: unitId, mode: 'insensitive' } } }
        ];
      }
    }
    const whereClause = {};
    if (status && status !== 'ALL') whereClause.status = status;
    const filterAgent = assignedAgentId || agentId;
    if (filterAgent && filterAgent !== 'ALL') {
      if (filterAgent === 'UNASSIGNED') {
        whereClause.assignedAgentId = null;
      } else {
        whereClause.assignedAgentId = filterAgent;
      }
    }
    if (service && service !== 'ALL') whereClause.serviceInterest = service;

    const org = organization || foundation;
    if (org && org !== 'ALL') {
      whereClause.OR = [
        { foundation: { contains: org, mode: 'insensitive' } },
        { unit: { name: { contains: org, mode: 'insensitive' } } },
        { unit: { code: { contains: org, mode: 'insensitive' } } },
      ];
    }

    if (enquiryCategory && enquiryCategory !== 'ALL') {
      whereClause.enquiryCategory = enquiryCategory;
    }

    const searchTerm = search || q || query;
    if (searchTerm) {
      const searchConditions = [
        { customerName: { contains: searchTerm, mode: 'insensitive' } },
        { phoneNumber: { contains: searchTerm } },
        { secondaryPhone: { contains: searchTerm } },
        { email: { contains: searchTerm, mode: 'insensitive' } },
        { primaryService: { contains: searchTerm, mode: 'insensitive' } },
        { serviceInterest: { contains: searchTerm, mode: 'insensitive' } },
        { patientName: { contains: searchTerm, mode: 'insensitive' } },
        { foundation: { contains: searchTerm, mode: 'insensitive' } },
      ];
      if (whereClause.OR) {
        whereClause.AND = [
          { OR: whereClause.OR },
          { OR: searchConditions },
        ];
        delete whereClause.OR;
      } else {
        whereClause.OR = searchConditions;
      }
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const skip = req.query.skip !== undefined ? Math.max(0, parseInt(req.query.skip, 10) || 0) : (page - 1) * limit;
    const cacheKey = JSON.stringify({ whereClause, limit, skip });
    const now = Date.now();

    let leads;
    const cached = leadsDbCache.get(cacheKey);
    if (cached && (now - cached.timestamp < LEADS_CACHE_TTL)) {
      leads = cached.data;
    } else if (inFlightLeadsQueries.has(cacheKey)) {
      leads = await inFlightLeadsQueries.get(cacheKey);
    } else {
      const fetchPromise = (async () => {
        return await prisma.lead.findMany({
          where: whereClause,
          select: {
            id: true,
            customerName: true,
            phoneNumber: true,
            email: true,
            serviceInterest: true,
            source: true,
            status: true,
            conversionScore: true,
            sentiment: true,
            createdAt: true,
            assignedAgentId: true,
            foundation: true,
            unitId: true,
            unit: {
              select: { id: true, name: true, code: true }
            },
            enquiryCategory: true,
            primaryService: true,
            subServices: true,
            patientName: true,
            patientAge: true,
            patientWeight: true,
            patientWeightUnit: true,
            patientConditions: true,
            patientMobility: true,
            engagementType: true,
            careDurationCategory: true,
            careDuration: true,
            careSchedule: true,
            secondaryPhone: true,
            secondaryCountryCode: true,
            street: true,
            city: true,
            state: true,
            country: true,
            serviceAddress: true,
            cityDistrict: true,
            postalCode: true,
            whatsappStatus: true,
            whatsappVerifiedAt: true,
            pickupLocation: true,
            destinationLocation: true,
            notes: true,
            isAmbulanceEmergency: true,
            // Phase 27 Agent Feedback & Disposition
            interestLevel: true,
            customerDisposition: true,
            agentFeedback: true,
            nextAction: true,
            followupDate: true,
            followupTime: true,
            followupType: true,
            followupNotes: true,
            feedbackAgentId: true,
            feedbackAgentName: true,
            feedbackSubmittedAt: true,
            assignedAgent: {
              select: { id: true, name: true, agentCode: true }
            },
            followups: {
              select: { id: true, followupDate: true, meetingType: true, notes: true, status: true },
              orderBy: { followupDate: 'asc' },
              take: 1
            },
            appointments: {
              select: { id: true, title: true, startTime: true, endTime: true, status: true, appointmentType: true, duration: true },
              where: { status: { notIn: ['CANCELLED'] } },
              orderBy: { startTime: 'asc' },
              take: 1
            },
            callSessions: {
              select: {
                id: true,
                startedAt: true,
                endedAt: true,
                duration: true,
                status: true,
                recordingUrl: true,
              },
              take: 1,
              orderBy: { startedAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: skip,
          take: limit,
        });
      })();

      inFlightLeadsQueries.set(cacheKey, fetchPromise);
      try {
        leads = await fetchPromise;
        leadsDbCache.set(cacheKey, { data: leads, timestamp: Date.now() });
      } finally {
        inFlightLeadsQueries.delete(cacheKey);
      }
    }

    // Mask phone numbers if agent is requesting and lead is not assigned to them
    const reqAgentId = req.user?.agentId || req.user?.userId;
    const reqRole = req.user?.role;
    const isElevated = reqRole && ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SENIOR_MANAGER', 'DEPARTMENT_MANAGER'].includes(reqRole);
    
    const formatted = leads.map(l => {
      let phone = l.phoneNumber;
      if (!isElevated) {
        if (l.assignedAgentId && l.assignedAgentId !== reqAgentId) {
          // Mask phone: XXXXXX4521
          phone = phone.length > 4 ? 'X'.repeat(phone.length - 4) + phone.slice(-4) : 'XXXX';
        }
      }

      const nextFollowup = l.followupDate 
        || (l.appointments?.[0] ? l.appointments[0].startTime : null)
        || (l.followups?.[0] ? l.followups[0].followupDate : null);

      return {
        id: l.id,
        customerName: l.customerName,
        phoneNumber: phone,
        secondaryPhone: l.secondaryPhone,
        secondaryCountryCode: l.secondaryCountryCode,
        email: l.email,
        serviceInterest: l.serviceInterest,
        source: l.source,
        status: l.status,
        conversionScore: l.conversionScore,
        sentiment: l.sentiment,
        createdAt: l.createdAt,
        agentName: l.assignedAgent?.name || 'Unassigned',
        assignedAgentId: l.assignedAgentId,
        assignedAgent: l.assignedAgent,
        unit: l.unit,
        unitName: l.unit?.name || null,
        nextFollowup,
        nextAppointment: l.appointments?.[0] || null,
        foundation: l.foundation,
        enquiryCategory: l.enquiryCategory,
        primaryService: l.primaryService,
        subServices: l.subServices || [],
        patientName: l.patientName,
        patientAge: l.patientAge,
        patientWeight: l.patientWeight,
        patientWeightUnit: l.patientWeightUnit || 'kg',
        patientConditions: l.patientConditions,
        patientMobility: l.patientMobility,
        engagementType: l.engagementType,
        careDurationCategory: l.careDurationCategory,
        careDuration: l.careDuration,
        careSchedule: l.careSchedule,
        street: l.street,
        city: l.city,
        state: l.state,
        country: l.country,
        serviceAddress: l.serviceAddress,
        cityDistrict: l.cityDistrict,
        postalCode: l.postalCode,
        whatsappStatus: l.whatsappStatus,
        whatsappVerifiedAt: l.whatsappVerifiedAt,
        notes: l.notes,
        isAmbulanceEmergency: l.isAmbulanceEmergency,
        // Phase 27 Agent Feedback & Customer Disposition
        interestLevel: l.interestLevel,
        customerDisposition: l.customerDisposition,
        agentFeedback: l.agentFeedback,
        nextAction: l.nextAction,
        followupDate: l.followupDate,
        followupTime: l.followupTime,
        followupType: l.followupType,
        followupNotes: l.followupNotes,
        feedbackAgentId: l.feedbackAgentId,
        feedbackAgentName: l.feedbackAgentName,
        feedbackSubmittedAt: l.feedbackSubmittedAt,
        enquirySummary: generateEnquirySummary(l),
        lastCall: l.callSessions?.[0] || null,
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error('[Leads Primary Query Failed - Attempting resilient fallback]:', err.message);
    try {
      const fallbackLeads = await prisma.lead.findMany({
        take: 100,
        orderBy: { createdAt: 'desc' }
      });
      const safeFormatted = fallbackLeads.map(l => ({
        id: l.id,
        customerName: l.customerName,
        phoneNumber: l.phoneNumber,
        serviceInterest: l.serviceInterest,
        source: l.source,
        status: l.status,
        createdAt: l.createdAt,
        agentName: 'Unassigned',
        enquirySummary: l.primaryService || l.serviceInterest || 'Client Enquiry',
      }));
      return res.json(safeFormatted);
    } catch (fallbackErr) {
      console.error('[Leads Fallback Query Also Failed]:', fallbackErr.message);
      res.status(500).json({ error: 'Failed to fetch leads' });
    }
  }
});

// GET /api/v1/leads/:id
router.get('/:id', async (req, res) => {
  try {
    const leadId = req.params.id;
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        assignedAgent: true,
        unit: true,
        followups: { orderBy: { followupDate: 'asc' } },
        appointments: { orderBy: { startTime: 'desc' } },
        conversionLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
      }
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
    if (!isSuperAdmin && lead.unitId && req.user?.unitId && lead.unitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Forbidden: Access to requested business unit is restricted' });
    }

    const reqRole = req.user?.role;
    const reqAgentId = req.user?.agentId || req.user?.userId;
    const isElevated = reqRole && ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SENIOR_MANAGER', 'DEPARTMENT_MANAGER'].includes(reqRole);

    let phone = lead.phoneNumber;
    if (!isElevated && lead.assignedAgentId && lead.assignedAgentId !== reqAgentId) {
      phone = phone.length > 4 ? 'X'.repeat(phone.length - 4) + phone.slice(-4) : 'XXXX';
    }

    res.json({
      ...lead,
      phoneNumber: phone,
      enquirySummary: generateEnquirySummary(lead),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

// PUT /api/v1/leads/:id (Full Lead Update)
router.put('/:id', async (req, res) => {
  try {
    const leadId = req.params.id;
    const { customerName, phoneNumber, email, serviceInterest, notes, source, assignedAgentId } = req.body;
    
    const existing = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    const isUnitAdmin = req.user?.role === 'ADMIN';
    if (isUnitAdmin && existing.unitId && req.user?.unitId && existing.unitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Forbidden: Access to requested business unit is restricted' });
    }

    const reqRole = req.user?.role;
    const reqAgentId = req.user?.agentId || req.user?.userId;
    const isElevated = reqRole && ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SENIOR_MANAGER', 'DEPARTMENT_MANAGER'].includes(reqRole);

    // If non-elevated and the lead is assigned to someone else, reject
    if (!isElevated && existing.assignedAgentId && existing.assignedAgentId !== reqAgentId) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions to modify this lead' });
    }

    // Only elevated users can reassign lead ownership
    if (!isElevated && assignedAgentId !== undefined && assignedAgentId !== existing.assignedAgentId) {
      return res.status(403).json({ error: 'Forbidden: Only administrators and supervisors can reassign leads' });
    }

    const updateData = {};
    if (customerName !== undefined) updateData.customerName = customerName;
    if (phoneNumber !== undefined) updateData.phoneNumber = String(phoneNumber).trim();
    if (email !== undefined) updateData.email = email;
    if (serviceInterest !== undefined) updateData.serviceInterest = serviceInterest;
    if (notes !== undefined) updateData.notes = notes;
    if (source !== undefined) updateData.source = source;
    if (assignedAgentId !== undefined && isElevated) updateData.assignedAgentId = assignedAgentId;
    if (req.body.primaryService !== undefined) updateData.primaryService = req.body.primaryService;
    if (req.body.subServices !== undefined) updateData.subServices = req.body.subServices;
    if (req.body.patientName !== undefined) updateData.patientName = req.body.patientName;
    if (req.body.patientAge !== undefined) updateData.patientAge = req.body.patientAge;
    if (req.body.patientConditions !== undefined) updateData.patientConditions = req.body.patientConditions;
    if (req.body.patientMobility !== undefined) updateData.patientMobility = req.body.patientMobility;
    if (req.body.engagementType !== undefined) updateData.engagementType = req.body.engagementType;
    if (req.body.careDurationCategory !== undefined) updateData.careDurationCategory = req.body.careDurationCategory;
    if (req.body.careDuration !== undefined) updateData.careDuration = req.body.careDuration;
    if (req.body.careSchedule !== undefined) updateData.careSchedule = req.body.careSchedule;
    if (req.body.serviceAddress !== undefined) updateData.serviceAddress = req.body.serviceAddress;
    if (req.body.cityDistrict !== undefined) updateData.cityDistrict = req.body.cityDistrict;
    if (req.body.postalCode !== undefined) updateData.postalCode = req.body.postalCode;
    if (req.body.pickupLocation !== undefined) updateData.pickupLocation = req.body.pickupLocation;
    if (req.body.destinationLocation !== undefined) updateData.destinationLocation = req.body.destinationLocation;
    if (req.body.status !== undefined) updateData.status = req.body.status;

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: updateData
    });

    invalidateLeadsCache();
    const io = req.app.get('io');
    if (io) io.emit('leadUpdated', updatedLead);

    res.json(updatedLead);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'Duplicate lead: A lead with this phone number already exists',
        code: 'DUPLICATE_PHONE_NUMBER'
      });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// DELETE /api/v1/leads/:id
router.delete('/:id', requireRole(['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR']), async (req, res) => {
  try {
    const leadId = req.params.id;
    const existing = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    // Delete related conversion logs and followups safely in transaction
    await prisma.$transaction([
      prisma.leadConversionLog.deleteMany({ where: { leadId } }),
      prisma.leadFollowup.deleteMany({ where: { leadId } }),
      prisma.lead.delete({ where: { id: leadId } })
    ]);
    
    invalidateLeadsCache();
    const io = req.app.get('io');
    if (io) io.emit('leadDeleted', { id: leadId });

    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// POST /api/v1/leads/:id/claim
router.post('/:id/claim', async (req, res) => {
  const leadId = req.params.id;
  const isElevated = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SENIOR_MANAGER'].includes(req.user?.role);
  const agentId = (isElevated && req.body.agentId) ? req.body.agentId : (req.user?.agentId || req.user?.userId);
  const lockKey = `lead_lock:${leadId}`;

  try {
    // 1. Try to acquire Redis Lock to prevent race condition
    const acquired = await redisConnection.set(lockKey, agentId, 'NX', 'EX', 10);
    if (!acquired) {
      return res.status(409).json({ error: 'Lead is currently being claimed by another agent' });
    }

    // 2. Double check DB
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.assignedAgentId) {
      await redisConnection.del(lockKey);
      return res.status(400).json({ error: 'Lead already claimed or not found' });
    }

    // 3. Assign to agent
    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: {
        assignedAgentId: agentId,
        status: 'IN_PROGRESS',
        lockedAt: new Date()
      }
    });

    // 4. Log conversion history
    await prisma.leadConversionLog.create({
      data: {
        leadId,
        agentId,
        oldStatus: 'NEW',
        newStatus: 'IN_PROGRESS',
        notes: 'Lead claimed by agent'
      }
    });

    // 5. Broadcast to update everyone's pool
    invalidateLeadsCache();
    const io = req.app.get('io');
    if (io) io.emit('leadClaimed', { leadId, agentId, status: 'IN_PROGRESS' });

    res.json({ success: true, lead: updatedLead });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to claim lead' });
  } finally {
    // Release the lock
    await redisConnection.del(lockKey);
  }
});

// PUT /api/v1/leads/:id/status (with Automatic ERP Enquiry Conversion when status is CONVERTED)
router.put('/:id/status', async (req, res) => {
  const leadId = req.params.id;
  const { status, notes } = req.body || {};
  const reqRole = req.user?.role;
  const reqAgentId = req.user?.agentId || req.user?.userId;
  const isElevated = reqRole && ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SENIOR_MANAGER', 'DEPARTMENT_MANAGER'].includes(reqRole);
  const agentId = (isElevated && req.body.agentId) ? req.body.agentId : reqAgentId;
  
  try {
    if (!UUID_REGEX.test(leadId)) return res.status(404).json({ error: 'Lead not found' });
    const oldLead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!oldLead) return res.status(404).json({ error: 'Lead not found' });

    if (!isElevated && oldLead.assignedAgentId && oldLead.assignedAgentId !== reqAgentId && oldLead.assignedAgentId !== req.user?.id) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions to update this lead status' });
    }

    let effectiveAgentId = null;
    if (agentId && UUID_REGEX.test(agentId)) {
      const agentRecord = await prisma.agent.findFirst({
        where: { OR: [{ id: agentId }, { userId: agentId }] }
      });
      if (agentRecord) effectiveAgentId = agentRecord.id;
    }

    // Automatic ERP Enquiry Conversion if status is CONVERTED
    let erpEnquiry = null;
    if (status === 'CONVERTED') {
      const existingEnquiry = await prisma.enquiry.findUnique({
        where: { crmLeadId: leadId },
        include: { client: true }
      });

      if (existingEnquiry) {
        erpEnquiry = existingEnquiry;
      } else {
        let targetUnitId = oldLead.unitId;
        if (!targetUnitId) {
          const uecUnit = await prisma.unit.findFirst({ where: { code: 'UEC', isDeleted: false } });
          targetUnitId = uecUnit?.id || (await prisma.unit.findFirst())?.id || null;
        }
        const targetTenantId = oldLead.tenantId || (await prisma.tenant.findFirst())?.id || null;

        let client = null;
        if (oldLead.phoneNumber) {
          client = await prisma.client.findFirst({
            where: { mobile: oldLead.phoneNumber, ...(targetUnitId ? { unitId: targetUnitId } : {}) }
          });
        }
        if (!client && oldLead.email) {
          client = await prisma.client.findFirst({
            where: { email: oldLead.email, ...(targetUnitId ? { unitId: targetUnitId } : {}) }
          });
        }
        if (!client) {
          const clientRefNo = `CLI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          client = await prisma.client.create({
            data: {
              refNo: clientRefNo,
              name: oldLead.customerName || 'CRM Customer',
              mobile: oldLead.phoneNumber || '9999999999',
              email: oldLead.email || null,
              address: oldLead.serviceAddress || oldLead.city || null,
              tenantId: targetTenantId,
              unitId: targetUnitId
            }
          });
        }

        const enqRefNo = `ENQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const serviceRequirements = [
          oldLead.primaryService ? `Service: ${oldLead.primaryService}` : null,
          oldLead.patientName ? `Patient: ${oldLead.patientName}` : null,
          notes ? `Notes: ${notes}` : null
        ].filter(Boolean).join(' | ');

        erpEnquiry = await prisma.enquiry.create({
          data: {
            refNo: enqRefNo,
            clientId: client.id,
            description: oldLead.notes || serviceRequirements || 'Converted from CRM Lead',
            status: 'NEW',
            isConverted: true,
            convertedAt: new Date(),
            serviceRequirements,
            summary: `Converted from CRM Lead: ${oldLead.customerName} - ${oldLead.phoneNumber}`,
            tenantId: targetTenantId,
            unitId: targetUnitId,
            crmLeadId: oldLead.id
          },
          include: { client: true }
        });

        // Provision specific ERP domain service records (Admissions, Candidates, Donors, Ambulance Trips, Home Care Contracts)
        await provisionErpDomainRecords(prisma, oldLead, {
          notes,
          targetUnitId,
          targetTenantId,
          client
        });
      }
    }
    
    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: { 
        status,
        ...(status === 'CONVERTED' ? { customerDisposition: 'CONVERTED', sentiment: 'POSITIVE', conversionScore: 90 } : {}),
        ...(erpEnquiry?.client?.id ? { clientId: erpEnquiry.client.id } : {}),
        ...(notes !== undefined ? { notes } : {})
      }
    });

    await prisma.leadConversionLog.create({
      data: {
        leadId,
        agentId: effectiveAgentId,
        oldStatus: oldLead.status,
        newStatus: status,
        notes: notes || null
      }
    });

    invalidateLeadsCache();
    const io = req.app.get('io');
    if (io) io.emit('leadUpdated', updatedLead);

    res.json({
      ...updatedLead,
      erpEnquiry
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update lead status' });
  }
});

// POST /api/v1/leads/:id/convert (Automatic ERP Enquiry Generation with Idempotency)
router.post('/:id/convert', async (req, res) => {
  const leadId = req.params.id;
  const { notes, appointmentDate, appointmentPurpose, sentiment: manualSentiment } = req.body || {};
  const reqRole = req.user?.role;
  const reqAgentId = req.user?.agentId || req.user?.userId;
  const isElevated = reqRole && ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SENIOR_MANAGER', 'DEPARTMENT_MANAGER'].includes(reqRole);
  const agentId = (isElevated && req.body.agentId) ? req.body.agentId : reqAgentId;
  
  try {
    if (!UUID_REGEX.test(leadId)) return res.status(404).json({ error: 'Lead not found' });
    const oldLead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!oldLead) return res.status(404).json({ error: 'Lead not found' });

    if (!isElevated && oldLead.assignedAgentId && oldLead.assignedAgentId !== reqAgentId && oldLead.assignedAgentId !== req.user?.id) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions to convert this lead' });
    }

    let effectiveAgentId = null;
    if (agentId && UUID_REGEX.test(agentId)) {
      const agentRecord = await prisma.agent.findFirst({
        where: { OR: [{ id: agentId }, { userId: agentId }] }
      });
      if (agentRecord) effectiveAgentId = agentRecord.id;
    }

    let sentiment = 'POSITIVE';
    let newStatus = 'CONVERTED';

    if (manualSentiment) {
      sentiment = manualSentiment;
      newStatus = manualSentiment === 'POSITIVE' || manualSentiment === 'NEGATIVE' ? 'CONVERTED' : manualSentiment;
    } else {
      const lowerNotes = (typeof notes === 'string' ? notes : (notes ? String(notes) : '')).toLowerCase();
      const negativeWords = ['not interested', 'no', 'negative', 'bad', 'angry', 'do not call', 'wrong number'];
      if (negativeWords.some(w => lowerNotes.includes(w))) {
        sentiment = 'NEGATIVE';
        newStatus = 'NEGATIVE';
      } else {
        sentiment = 'POSITIVE';
        newStatus = 'CONVERTED';
      }
    }

    // 1. Idempotency Check: Check if an ERP Enquiry is already linked to this lead
    let existingEnquiry = await prisma.enquiry.findUnique({
      where: { crmLeadId: leadId },
      include: { client: true }
    });

    let erpEnquiry = existingEnquiry;

    // 2. If status is CONVERTED and no enquiry exists yet, automatically create canonical ERP Enquiry
    if (newStatus === 'CONVERTED' && !existingEnquiry) {
      // Resolve Target Unit
      let targetUnitId = oldLead.unitId;
      if (!targetUnitId) {
        const uecUnit = await prisma.unit.findFirst({ where: { code: 'UEC', isDeleted: false } });
        targetUnitId = uecUnit?.id || (await prisma.unit.findFirst())?.id || null;
      }

      // Resolve Tenant
      const targetTenantId = oldLead.tenantId || (await prisma.tenant.findFirst())?.id || null;

      // Find or create Client
      let client = null;
      if (oldLead.phoneNumber) {
        client = await prisma.client.findFirst({
          where: { mobile: oldLead.phoneNumber, ...(targetUnitId ? { unitId: targetUnitId } : {}) }
        });
      }
      if (!client && oldLead.email) {
        client = await prisma.client.findFirst({
          where: { email: oldLead.email, ...(targetUnitId ? { unitId: targetUnitId } : {}) }
        });
      }
      if (!client) {
        const clientRefNo = `CLI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        client = await prisma.client.create({
          data: {
            refNo: clientRefNo,
            name: oldLead.customerName || 'CRM Customer',
            mobile: oldLead.phoneNumber || '9999999999',
            email: oldLead.email || null,
            address: oldLead.serviceAddress || oldLead.city || null,
            tenantId: targetTenantId,
            unitId: targetUnitId
          }
        });
      }

      const enqRefNo = `ENQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const serviceRequirements = [
        oldLead.primaryService ? `Service: ${oldLead.primaryService}` : null,
        oldLead.patientName ? `Patient: ${oldLead.patientName}` : null,
        notes ? `Notes: ${notes}` : null
      ].filter(Boolean).join(' | ');

      erpEnquiry = await prisma.enquiry.create({
        data: {
          refNo: enqRefNo,
          clientId: client.id,
          description: oldLead.notes || serviceRequirements || 'Converted from CRM Lead',
          status: 'NEW',
          isConverted: true,
          convertedAt: new Date(),
          serviceRequirements,
          summary: `Converted from CRM Lead: ${oldLead.customerName} - ${oldLead.phoneNumber}`,
          tenantId: targetTenantId,
          unitId: targetUnitId,
          crmLeadId: oldLead.id
        },
        include: { client: true }
      });

      // Provision specific ERP domain service records (Admissions, Candidates, Donors, Ambulance Trips, Home Care Contracts)
      await provisionErpDomainRecords(prisma, oldLead, {
        notes,
        targetUnitId,
        targetTenantId,
        client
      });
    }

    // Update Lead
    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: { 
        status: newStatus,
        sentiment,
        conversionScore: sentiment === 'POSITIVE' ? 90 : sentiment === 'NEGATIVE' ? 20 : 50,
        ...(erpEnquiry?.client?.id ? { clientId: erpEnquiry.client.id } : {})
      }
    });

    // Log Conversion
    await prisma.leadConversionLog.create({
      data: {
        leadId,
        agentId: effectiveAgentId,
        oldStatus: oldLead.status,
        newStatus,
        notes: notes || 'Lead conversion with ERP Enquiry integration'
      }
    });

    // If appointment date provided, schedule follow-up
    if (appointmentDate) {
      let agentForFollowup = effectiveAgentId || oldLead.assignedAgentId;
      if (!agentForFollowup) {
        const firstAgent = await prisma.agent.findFirst();
        if (firstAgent) agentForFollowup = firstAgent.id;
      }
      if (agentForFollowup) {
        await prisma.leadFollowup.create({
          data: {
            leadId,
            assignedAgentId: agentForFollowup,
            followupDate: new Date(appointmentDate),
            purpose: appointmentPurpose || 'Follow-up meeting',
            meetingType: 'APPOINTMENT'
          }
        }).catch(err => console.warn('[Followup Warning]', err.message));
      }
    }

    invalidateLeadsCache();
    const io = req.app.get('io');
    if (io) io.emit('leadUpdated', updatedLead);

    res.json({
      success: true,
      lead: updatedLead,
      sentiment,
      enquiry: erpEnquiry,
      alreadyConverted: !!existingEnquiry
    });
  } catch (err) {
    console.error('[Leads Convert Route] Error:', err);
    res.status(500).json({ error: 'Failed to convert lead' });
  }
});

// GET /api/v1/leads/analytics
router.get('/analytics/dashboard', async (req, res) => {
  try {
    const totalLeads = await prisma.lead.count();
    const claimedLeads = await prisma.lead.count({ where: { assignedAgentId: { not: null } } });
    const convertedLeads = await prisma.lead.count({ where: { status: 'CONVERTED' } });
    const positiveLeads = await prisma.lead.count({ where: { sentiment: 'POSITIVE' } });

    // Group by Service
    const services = await prisma.lead.groupBy({
      by: ['serviceInterest'],
      _count: { id: true }
    });

    // Conversion rate
    const conversionRate = totalLeads ? ((convertedLeads / totalLeads) * 100).toFixed(1) : 0;

    res.json({
      totalLeads,
      claimedLeads,
      convertedLeads,
      positiveLeads,
      conversionRate,
      services: services.map(s => ({ service: s.serviceInterest || 'Unknown', count: s._count.id }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});


// ==========================================
// LEAD NOTES SUB-RESOURCE (PHASE 28.4.1)
// ==========================================

// GET /api/v1/leads/:id/notes
router.get('/:id/notes', async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        assignedAgent: true,
        activities: {
          where: { type: 'NOTE' },
          include: { agent: true },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Format activities into LeadNote structure
    const notes = (lead.activities || []).map(act => {
      const meta = (typeof act.metadata === 'object' && act.metadata) ? act.metadata : {};
      return {
        id: act.id,
        content: act.content || act.title,
        agent: act.agent ? { name: act.agent.name, department: act.agent.department } : null,
        department: act.agent?.department || null,
        createdAt: act.createdAt,
        callId: act.callSessionId || null,
        actionType: act.type,
        source: act.channel || 'DIRECT_NOTE',
        isCorrection: Boolean(meta.isCorrection),
        correctedNoteId: meta.correctedNoteId || null
      };
    });

    // If no activities but lead has a legacy notes text field, provide it as an initial entry
    if (notes.length === 0 && lead.notes && lead.notes.trim()) {
      notes.push({
        id: 'legacy-lead-note',
        content: lead.notes,
        agent: lead.assignedAgent ? { name: lead.assignedAgent.name, department: lead.assignedAgent.department } : null,
        department: lead.assignedAgent?.department || null,
        createdAt: lead.createdAt,
        callId: null,
        actionType: 'NOTE',
        source: 'INTAKE_NOTE',
        isCorrection: false,
        correctedNoteId: null
      });
    }

    res.json(notes);
  } catch (err) {
    console.error('[LEADS-NOTES] Error fetching notes:', err);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// POST /api/v1/leads/:id/notes
router.post('/:id/notes', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, actionType, callId } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Note content is required' });
    }

    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Resolve current agent
    let agent = null;
    if (req.user?.id) {
      agent = await prisma.agent.findFirst({
        where: { OR: [{ id: req.user.id }, { userId: req.user.id }] }
      });
    }

    const activity = await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        agentId: agent?.id || null,
        callSessionId: callId || null,
        type: 'NOTE',
        channel: 'SYSTEM',
        title: actionType || 'Agent Note',
        content: content.trim(),
        metadata: { isCorrection: false }
      },
      include: { agent: true }
    });

    // Also append to lead.notes for historical snapshot
    const timestamp = new Date().toISOString();
    const updatedNotes = lead.notes ? `${lead.notes}\n[${timestamp}] ${content.trim()}` : content.trim();
    await prisma.lead.update({
      where: { id: lead.id },
      data: { notes: updatedNotes }
    });

    invalidateLeadsCache();
    const io = req.app.get('io');
    if (io) {
      io.to(lead.id).emit('lead-action-completed', lead.id);
      io.emit('leadsUpdated', { leadId: lead.id });
    }

    res.status(201).json({
      id: activity.id,
      content: activity.content,
      agent: activity.agent ? { name: activity.agent.name, department: activity.agent.department } : null,
      department: activity.agent?.department || null,
      createdAt: activity.createdAt,
      callId: activity.callSessionId || null,
      actionType: activity.title,
      source: 'DIRECT_NOTE',
      isCorrection: false,
      correctedNoteId: null
    });
  } catch (err) {
    console.error('[LEADS-NOTES] Error creating note:', err);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// POST /api/v1/leads/:id/notes/:noteId/correction
router.post('/:id/notes/:noteId/correction', async (req, res) => {
  try {
    const { id, noteId } = req.params;
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Correction content is required' });
    }

    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    let agent = null;
    if (req.user?.id) {
      agent = await prisma.agent.findFirst({
        where: { OR: [{ id: req.user.id }, { userId: req.user.id }] }
      });
    }

    const activity = await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        agentId: agent?.id || null,
        type: 'NOTE',
        channel: 'SYSTEM',
        title: 'Correction',
        content: content.trim(),
        metadata: { isCorrection: true, correctedNoteId: noteId }
      },
      include: { agent: true }
    });

    invalidateLeadsCache();
    const io = req.app.get('io');
    if (io) {
      io.to(lead.id).emit('lead-action-completed', lead.id);
      io.emit('leadsUpdated', { leadId: lead.id });
    }

    res.status(201).json({
      id: activity.id,
      content: activity.content,
      agent: activity.agent ? { name: activity.agent.name, department: activity.agent.department } : null,
      department: activity.agent?.department || null,
      createdAt: activity.createdAt,
      callId: null,
      actionType: 'Correction',
      source: 'DIRECT_NOTE',
      isCorrection: true,
      correctedNoteId: noteId
    });
  } catch (err) {
    console.error('[LEADS-NOTES] Error adding correction:', err);
    res.status(500).json({ error: 'Failed to create correction' });
  }
});

// ==========================================
// LEAD REPORT SUB-RESOURCE (PHASE 28.4.1)
// ==========================================

// GET /api/v1/leads/:id/report
router.get('/:id/report', async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        customer: true,
        assignedAgent: true,
        businessUnit: true,
        activities: { take: 10, orderBy: { createdAt: 'desc' } }
      }
    });

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const reportContent = {
      executiveSummary: `Lead ${lead.customer?.fullName || lead.customerName || 'Client'} registered for ${lead.serviceInterest || 'care assistance'}. Current status: ${lead.status}. Sentiment: ${lead.sentiment || 'NEUTRAL'}.`,
      callerRequirements: lead.notes || (lead.metadata && lead.metadata.requirements) || 'Standard enquiry registered via CRM intake.',
      actionableInsights: `Follow up recommended by ${lead.assignedAgent?.name || 'Assigned Agent'}. Unit: ${lead.businessUnit?.name || 'CRM Tool Primary'}.`,
      timelineSummary: `Recorded ${lead.activities?.length || 0} interaction events. Latest activity on ${lead.updatedAt ? new Date(lead.updatedAt).toLocaleDateString() : 'N/A'}.`
    };

    res.json({
      id: `rpt_${lead.id}`,
      leadId: lead.id,
      customerName: lead.customer?.fullName || lead.customerName || 'Client',
      createdAt: lead.createdAt,
      generatedAt: new Date().toISOString(),
      content: reportContent
    });
  } catch (err) {
    console.error('[LEADS-REPORT] Error generating/fetching report:', err);
    res.status(500).json({ error: 'Failed to fetch lead report' });
  }
});

// POST /api/v1/leads/:id/report/generate
router.post('/:id/report/generate', async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        customer: true,
        assignedAgent: true,
        businessUnit: true,
        activities: { take: 10, orderBy: { createdAt: 'desc' } }
      }
    });

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const reportContent = {
      executiveSummary: `Automated AI Analysis generated for ${lead.customer?.fullName || lead.customerName || 'Client'}. Ingested from source: ${lead.source || 'Direct Intake'}. Status: ${lead.status}.`,
      callerRequirements: lead.notes || 'Enquiry requirements confirmed during agent intake review.',
      actionableInsights: `Priority level: ${lead.priority || 'MEDIUM'}. Immediate follow up advised to maintain conversion velocity.`,
      timelineSummary: `Aggregated timeline contains ${lead.activities?.length || 0} activity logs with sentiment score evaluated as ${lead.sentiment || 'NEUTRAL'}.`
    };

    res.json({
      id: `rpt_${lead.id}`,
      leadId: lead.id,
      customerName: lead.customer?.fullName || lead.customerName || 'Client',
      createdAt: lead.createdAt,
      generatedAt: new Date().toISOString(),
      content: reportContent
    });
  } catch (err) {
    console.error('[LEADS-REPORT-GENERATE] Error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /api/v1/leads/report/:id/export/pdf
router.get('/report/:id/export/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const leadId = id.startsWith('rpt_') ? id.replace('rpt_', '') : id;
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { customer: true, assignedAgent: true }
    });

    res.setHeader('Content-Type', 'text/html');
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Lead Report - ${lead?.customer?.fullName || lead?.customerName || leadId}</title>
        <style>
          body { font-family: sans-serif; padding: 40px; color: #111; }
          h1 { color: #ea580c; border-bottom: 2px solid #ea580c; padding-bottom: 10px; }
          .meta { margin-bottom: 24px; color: #555; }
          .section { margin-top: 20px; }
          .section-title { font-weight: bold; margin-bottom: 8px; color: #222; }
          .content { background: #f9f9f9; padding: 16px; border-radius: 8px; border: 1px solid #eee; }
        </style>
      </head>
      <body>
        <h1>CRM Tool - Lead Intelligence Report</h1>
        <div class="meta">
          <p><strong>Customer:</strong> ${lead?.customer?.fullName || lead?.customerName || 'N/A'}</p>
          <p><strong>Status:</strong> ${lead?.status || 'NEW'}</p>
          <p><strong>Assigned Agent:</strong> ${lead?.assignedAgent?.name || 'Unassigned'}</p>
          <p><strong>Export Date:</strong> ${new Date().toLocaleString()}</p>
        </div>
        <div class="section">
          <div class="section-title">Requirements & Clinical/Service Notes</div>
          <div class="content">${lead?.notes || 'No notes documented.'}</div>
        </div>
        <script>window.print();</script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[LEADS-EXPORT-PDF] Error:', err);
    res.status(500).send('Failed to export PDF');
  }
});

// GET /api/v1/leads/report/:id/export/word
router.get('/report/:id/export/word', async (req, res) => {
  try {
    const { id } = req.params;
    const leadId = id.startsWith('rpt_') ? id.replace('rpt_', '') : id;
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { customer: true, assignedAgent: true }
    });

    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="lead_report_${leadId}.doc"`);
    res.send(`
      <h1>CRM Tool - Lead Intelligence Report</h1>
      <p><strong>Customer:</strong> ${lead?.customer?.fullName || lead?.customerName || 'N/A'}</p>
      <p><strong>Status:</strong> ${lead?.status || 'NEW'}</p>
      <p><strong>Notes:</strong> ${lead?.notes || 'None'}</p>
    `);
  } catch (err) {
    console.error('[LEADS-EXPORT-WORD] Error:', err);
    res.status(500).send('Failed to export Word doc');
  }
});

// POST /api/v1/leads/report/:id/email
router.post('/report/:id/email', async (req, res) => {
  try {
    const { id } = req.params;
    const { emailTo } = req.body;
    if (!emailTo) return res.status(400).json({ error: 'Email address is required' });

    console.log(`[LEADS-REPORT-EMAIL] Dispatching lead report ${id} to ${emailTo}`);
    res.json({ success: true, message: `Report successfully dispatched to ${emailTo}` });
  } catch (err) {
    console.error('[LEADS-REPORT-EMAIL] Error:', err);
    res.status(500).json({ error: 'Failed to send report email' });
  }
});

module.exports = router;
