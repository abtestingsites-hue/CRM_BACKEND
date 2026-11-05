import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Priority, LeadPriority, EnquiryCategory, LeadStatus, AppointmentStatus, BookingSource, MeetingType } from '@prisma/client';
import { INITIAL_FOUNDATIONS, CARE_CONFIG, PRIMARY_ORGANIZATIONS } from './enquiry-catalog.data';
import {
  UpdateEnquiryClassificationDto,
  CreateLeadFromEnquiryDto,
  SaveCallIntakeDto,
  SaveLiveNotesDto,
  OverrideEmergencyPriorityDto,
  CreateCatalogItemDto,
} from './dto/enquiry.dto';

@Injectable()
export class EnquiryService {
  private readonly logger = new Logger(EnquiryService.name);

  constructor(private readonly prisma: PrismaService) { }

  // ==========================================
  // SERVICE CATALOG MANAGEMENT
  // ==========================================
  async getCatalog(foundationKey?: string) {
    let items = await this.prisma.serviceCatalogItem.findMany({
      where: {
        isActive: true,
        ...(foundationKey ? { foundationKey } : {}),
      },
      orderBy: [{ foundationKey: 'asc' }, { sortOrder: 'asc' }],
    });

    if (items.length === 0) {
      this.logger.log('Service catalog empty. Seeding canonical catalog...');
      await this.seedDefaultCatalog();
      items = await this.prisma.serviceCatalogItem.findMany({
        where: {
          isActive: true,
          ...(foundationKey ? { foundationKey } : {}),
        },
        orderBy: [{ foundationKey: 'asc' }, { sortOrder: 'asc' }],
      });
    }

    // Group items by foundation
    const foundationsMap = new Map<string, { key: string; name: string; category: string; enquiryCategories?: any[]; services: any[] }>();
    for (const f of INITIAL_FOUNDATIONS) {
      foundationsMap.set(f.key, {
        key: f.key,
        name: f.name,
        category: f.category,
        enquiryCategories: f.enquiryCategories || [],
        services: [],
      });
    }

    for (const item of items) {
      if (!foundationsMap.has(item.foundationKey)) {
        foundationsMap.set(item.foundationKey, {
          key: item.foundationKey,
          name: item.foundationName,
          category: item.category,
          enquiryCategories: [],
          services: [],
        });
      }
      foundationsMap.get(item.foundationKey)!.services.push({
        ...item,
        subcategory: (item.intakeFields as any)?.subcategory || item.category,
      });
    }

    return {
      organizations: PRIMARY_ORGANIZATIONS,
      foundations: Array.from(foundationsMap.values()),
      items: items.map(item => ({
        ...item,
        subcategory: (item.intakeFields as any)?.subcategory || item.category,
      })),
      config: CARE_CONFIG,
    };
  }

  async seedDefaultCatalog() {
    // 1. Deactivate old UEC_HOME_CARE in new options while preserving historical database records
    await this.prisma.serviceCatalogItem.updateMany({
      where: {
        foundationKey: 'UEC',
        code: 'UEC_HOME_CARE',
      },
      data: { isActive: false },
    });

    for (const f of INITIAL_FOUNDATIONS) {
      let sort = 10;
      for (const s of f.services) {
        const existing = await this.prisma.serviceCatalogItem.findFirst({
          where: {
            foundationKey: f.key,
            code: s.code,
          },
        });
        if (!existing) {
          await this.prisma.serviceCatalogItem.create({
            data: {
              foundationKey: f.key,
              foundationName: f.name,
              category: f.category,
              name: s.name,
              code: s.code,
              description: s.description || null,
              subServices: s.subServices || [],
              intakeFields: { subcategory: s.subcategory || f.category },
              isEmergency: !!s.isEmergency,
              sortOrder: sort,
              isActive: true,
            },
          });
        } else {
          await this.prisma.serviceCatalogItem.update({
            where: { id: existing.id },
            data: {
              name: s.name,
              description: s.description || existing.description,
              subServices: s.subServices || existing.subServices,
              intakeFields: { subcategory: s.subcategory || f.category },
              isActive: true,
            },
          });
        }
        sort += 10;
      }
    }
    this.logger.log('Successfully validated and seeded default service catalog');
  }

  async createCatalogItem(dto: CreateCatalogItemDto, user: any) {
    return await this.prisma.serviceCatalogItem.create({
      data: {
        foundationKey: dto.foundationKey,
        foundationName: dto.foundationName,
        category: dto.category,
        name: dto.name,
        code: dto.code || null,
        description: dto.description || null,
        subServices: dto.subServices || [],
        isEmergency: !!dto.isEmergency,
        sortOrder: dto.sortOrder || 0,
        isActive: true,
      },
    });
  }

  async updateCatalogItem(id: string, dto: Partial<CreateCatalogItemDto>, user: any) {
    const item = await this.prisma.serviceCatalogItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog item not found');

    return await this.prisma.serviceCatalogItem.update({
      where: { id },
      data: {
        ...(dto.foundationKey ? { foundationKey: dto.foundationKey } : {}),
        ...(dto.foundationName ? { foundationName: dto.foundationName } : {}),
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.subServices !== undefined ? { subServices: dto.subServices } : {}),
        ...(dto.isEmergency !== undefined ? { isEmergency: dto.isEmergency } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  async deleteCatalogItem(id: string, user: any) {
    const item = await this.prisma.serviceCatalogItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog item not found');

    await this.prisma.serviceCatalogItem.update({
      where: { id },
      data: { isActive: false },
    });
    return { success: true };
  }

  // ==========================================
  // INTELLIGENT OMNICHANNEL CONVERSATION CLASSIFICATION
  // ==========================================
  async classifyConversation(conversationId: string, customText?: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        customer: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');

    // Aggregate text
    let textToAnalyze = customText || '';
    if (!textToAnalyze && conversation.messages.length > 0) {
      textToAnalyze = conversation.messages.map(m => m.content).join(' ');
    }
    const lower = textToAnalyze.toLowerCase();

    // 1. Foundation detection
    let foundation = conversation.foundation || 'UEC';
    let foundationConfidence = 0.5;
    if (lower.includes('ambulance') || lower.includes('108') || lower.includes('icu on wheels') || lower.includes('emergency cardiac')) {
      foundation = 'AMBULANCE';
      foundationConfidence = 0.95;
    } else if (lower.includes('a care') || lower.includes('anbu sri') || lower.includes('doctor at home') || lower.includes('baby care') || lower.includes('wound care')) {
      foundation = 'A_CARE';
      foundationConfidence = 0.9;
    } else if (lower.includes('thatha patti') || lower.includes('thathapatti')) {
      foundation = 'THATHA_PATTI';
      foundationConfidence = 0.95;
    } else if (lower.includes('zencura')) {
      foundation = 'ZENCURA';
      foundationConfidence = 0.95;
    } else if (lower.includes('uhc') || lower.includes('universal home care')) {
      foundation = 'UHC';
      foundationConfidence = 0.9;
    } else if (lower.includes('elder care') || lower.includes('assisted living') || lower.includes('dementia') || lower.includes('bedridden')) {
      foundation = 'UEC';
      foundationConfidence = 0.85;
    }

    // 2. Enquiry Category detection
    let enquiryCategory: EnquiryCategory = EnquiryCategory.SERVICE_ENQUIRY;
    if (lower.includes('job') || lower.includes('vacancy') || lower.includes('hiring') || lower.includes('career') || lower.includes('resume') || lower.includes('apply for')) {
      enquiryCategory = EnquiryCategory.JOB_ENQUIRY;
    } else if (lower.includes('volunteer') || lower.includes('ngo') || lower.includes('social work') || lower.includes('spend time with elders')) {
      enquiryCategory = EnquiryCategory.VOLUNTEER_ENQUIRY;
    } else if (lower.includes('donate') || lower.includes('donation') || lower.includes('sponsor') || lower.includes('contribute funds')) {
      enquiryCategory = EnquiryCategory.DONOR_ENQUIRY;
    } else if (lower.includes('complaint') || lower.includes('bad service') || lower.includes('unsatisfied') || lower.includes('issue with staff')) {
      enquiryCategory = EnquiryCategory.COMPLAINT_OR_SUPPORT;
    } else if (lower.includes('timing') || lower.includes('location') || lower.includes('address') || lower.includes('general info')) {
      enquiryCategory = EnquiryCategory.GENERAL_ENQUIRY;
    }

    // 3. Primary & Subservices detection
    let primaryService = conversation.primaryService || '';
    let subServices: string[] = conversation.subServices || [];
    let isEmergency = false;

    if (foundation === 'AMBULANCE' || lower.includes('ambulance') || lower.includes('emergency')) {
      primaryService = 'Ambulance Services';
      isEmergency = true;
      if (lower.includes('icu') || lower.includes('ventilator')) {
        primaryService = 'Critical Care Ambulance (ICU on Wheels)';
        subServices = ['Ventilator Transport'];
      } else {
        primaryService = 'Emergency Ambulance Service';
        subServices = ['Emergency ALS Dispatch'];
      }
    } else if (foundation === 'A_CARE') {
      if (lower.includes('doctor')) {
        primaryService = 'Doctor at Home';
        subServices = ['General Physician Visit'];
      } else if (lower.includes('physio')) {
        primaryService = 'Physiotherapy at Home';
        subServices = ['Geriatric Mobility'];
      } else if (lower.includes('icu') || lower.includes('ryle')) {
        primaryService = 'ICU Setup & Ryle\'s Tube Feeding at Home';
        subServices = ['Ryle\'s Tube Insertion & Feeding'];
      } else if (lower.includes('wound') || lower.includes('bed sore')) {
        primaryService = 'Wound Care at Home';
        subServices = ['Diabetic Foot Ulcer Care'];
      } else if (lower.includes('nurse') || lower.includes('nursing')) {
        primaryService = 'Nursing Care at Home';
        subServices = ['Vitals Check & Injections'];
      } else {
        primaryService = 'Care at Home';
        subServices = ['Bedside Attendant'];
      }
    } else if (foundation === 'UEC') {
      if (lower.includes('dementia') || lower.includes('alzheimer')) {
        primaryService = 'Dementia / Alzheimer\'s Care';
        subServices = ['Memory Care Unit'];
      } else if (lower.includes('palliative') || lower.includes('cancer') || lower.includes('terminal')) {
        primaryService = 'Palliative Care';
        subServices = ['Pain & Symptom Relief'];
      } else if (lower.includes('bedridden') || lower.includes('paralysis')) {
        primaryService = 'Bedridden Patient Care';
        subServices = ['Position Changing / Q2H Turning', 'Bed Bath & Grooming'];
      } else if (lower.includes('bed sore') || lower.includes('pressure injury')) {
        primaryService = 'Bed Sore / Pressure Injury Care';
        subServices = ['Debridement & Advanced Dressing'];
      } else if (lower.includes('post op') || lower.includes('surgery') || lower.includes('fracture')) {
        primaryService = 'Post-operative Care';
        subServices = ['Post-Op Monitoring'];
      } else {
        primaryService = 'Assisted Living';
        subServices = ['Daily Living Assistance'];
      }
    }

    // 4. Care Duration & Schedule
    let careDurationCategory = 'SHORT_TERM';
    let careDuration = '1 month';
    let careSchedule = '12-hour care (Day shift: 8 AM - 8 PM)';
    let engagementType = 'Regular Daily Care';

    if (lower.includes('day care') || lower.includes('day scholar')) {
      careDurationCategory = 'DAY_CARE';
      careDuration = '1 day';
      careSchedule = 'Daytime schedule';
      engagementType = 'Day Care / Day Scholar';
    } else if (lower.includes('residential') || lower.includes('permanent stay') || lower.includes('living in')) {
      careDurationCategory = 'LONG_TERM';
      careDuration = '6 months';
      careSchedule = '24-hour care (Full-day live-in)';
      engagementType = 'Residential Care';
    } else if (lower.includes('24 hour') || lower.includes('24 hr') || lower.includes('full day')) {
      careSchedule = '24-hour care (Full-day live-in)';
    }

    // 5. Patient info extraction
    let patientName: string | undefined = undefined;
    let patientAge: number | undefined = undefined;
    const nameMatch = textToAnalyze.match(/(?:patient|elder|father|mother|name is|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (nameMatch && nameMatch[1]) {
      patientName = nameMatch[1].trim();
    }
    const ageMatch = textToAnalyze.match(/(\d{2})\s*(?:years?|yrs?|age|old)/i);
    if (ageMatch && ageMatch[1]) {
      const ageNum = parseInt(ageMatch[1], 10);
      if (ageNum >= 1 && ageNum <= 120) patientAge = ageNum;
    }

    // 6. Missing Info checklist
    const missingInfo: string[] = [];
    if (!patientName) missingInfo.push('Patient / Client Name');
    if (!patientAge) missingInfo.push('Patient Age');
    if (!conversation.customer?.phone) missingInfo.push('Contact Phone Number');
    if (primaryService.includes('Home') || foundation === 'UHC' || foundation === 'A_CARE') {
      missingInfo.push('Home Service Address & City');
    }
    if (isEmergency) {
      missingInfo.push('Ambulance Pickup Location & Destination');
    }

    // Confidence
    const confidence = isEmergency ? 0.98 : (textToAnalyze.length > 50 && primaryService ? 0.88 : 0.65);
    const suggestedPriority: Priority = isEmergency ? Priority.EMERGENCY : (primaryService.includes('Palliative') ? Priority.HIGH : Priority.NORMAL);

    return {
      conversationId,
      foundation,
      enquiryCategory,
      primaryService,
      subServices,
      engagementType,
      careDurationCategory,
      careDuration,
      careSchedule,
      patientName,
      patientAge,
      priority: suggestedPriority,
      isEmergency,
      confidence,
      needsReview: confidence < 0.8,
      missingInfo,
    };
  }

  // ==========================================
  // UPDATE CONVERSATION ENQUIRY CLASSIFICATION
  // ==========================================
  async updateConversationClassification(conversationId: string, dto: UpdateEnquiryClassificationDto, user: any) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    // Rule: Ambulance Services MUST enforce EMERGENCY priority
    let finalPriority: Priority = dto.priority || conversation.priority || Priority.NORMAL;
    const isAmbulance =
      dto.foundation === 'AMBULANCE' ||
      dto.primaryService?.toLowerCase().includes('ambulance') ||
      dto.subServices?.some(s => s.toLowerCase().includes('ambulance'));

    if (isAmbulance) {
      finalPriority = Priority.EMERGENCY;
    }

    // If downgrading from EMERGENCY, require override reason & authorized role
    if (conversation.priority === Priority.EMERGENCY && finalPriority !== Priority.EMERGENCY && !isAmbulance) {
      const isElevated = user && ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SENIOR_MANAGER'].includes(user.role);
      if (!isElevated) {
        throw new ForbiddenException('Only Supervisors and Administrators can downgrade an EMERGENCY enquiry priority.');
      }
      if (!dto.emergencyOverrideReason) {
        throw new BadRequestException('A mandatory reason is required to downgrade an EMERGENCY enquiry.');
      }

      await this.prisma.emergencyOverrideAudit.create({
        data: {
          conversationId,
          leadId: conversation.leadId || null,
          previousPriority: Priority.EMERGENCY,
          newPriority: finalPriority,
          overrideReason: dto.emergencyOverrideReason,
          overriddenById: user?.id || user?.userId || 'unknown-user',
          overriddenByRole: user?.role || 'AGENT',
        },
      });
    }

    // Update conversation record
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(dto.foundation ? { foundation: dto.foundation } : {}),
        ...(dto.enquiryCategory ? { enquiryCategory: dto.enquiryCategory } : {}),
        ...(dto.primaryService ? { primaryService: dto.primaryService } : {}),
        ...(dto.subServices ? { subServices: dto.subServices } : {}),
        priority: finalPriority,
        classificationConfidence: dto.classificationConfidence ?? 1.0,
        isClassificationConfirmed: dto.isClassificationConfirmed ?? true,
        ...(dto.missingInfo ? { missingInfo: dto.missingInfo } : {}),
        intakeMetadata: {
          ...((conversation.intakeMetadata as any) || {}),
          patientName: dto.patientName,
          patientAge: dto.patientAge,
          patientConditions: dto.patientConditions,
          patientMobility: dto.patientMobility,
          engagementType: dto.engagementType,
          careDurationCategory: dto.careDurationCategory,
          careDuration: dto.careDuration,
          careSchedule: dto.careSchedule,
          serviceAddress: dto.serviceAddress,
          cityDistrict: dto.cityDistrict,
          postalCode: dto.postalCode,
          pickupLocation: dto.pickupLocation,
          destinationLocation: dto.destinationLocation,
          notes: dto.notes,
          updatedAt: new Date().toISOString(),
          updatedBy: user?.name || user?.email || 'Agent',
        },
      },
    });

    // If linked to a lead, propagate classification to the Lead
    if (conversation.leadId) {
      await this.prisma.lead.update({
        where: { id: conversation.leadId },
        data: {
          ...(dto.foundation ? { foundation: dto.foundation } : {}),
          ...(dto.enquiryCategory ? { enquiryCategory: dto.enquiryCategory } : {}),
          ...(dto.primaryService ? { primaryService: dto.primaryService } : {}),
          ...(dto.subServices ? { subServices: dto.subServices } : {}),
          ...(dto.patientName ? { patientName: dto.patientName } : {}),
          ...(dto.patientAge !== undefined ? { patientAge: dto.patientAge } : {}),
          ...(dto.patientConditions ? { patientConditions: dto.patientConditions } : {}),
          ...(dto.patientMobility ? { patientMobility: dto.patientMobility } : {}),
          ...(dto.engagementType ? { engagementType: dto.engagementType } : {}),
          ...(dto.careDurationCategory ? { careDurationCategory: dto.careDurationCategory } : {}),
          ...(dto.careDuration ? { careDuration: dto.careDuration } : {}),
          ...(dto.careSchedule ? { careSchedule: dto.careSchedule } : {}),
          ...(dto.secondaryPhone ? { secondaryPhone: dto.secondaryPhone } : {}),
          ...(dto.secondaryCountryCode ? { secondaryCountryCode: dto.secondaryCountryCode } : {}),
          ...(dto.street ? { street: dto.street } : {}),
          ...(dto.city ? { city: dto.city } : {}),
          ...(dto.state ? { state: dto.state } : {}),
          ...(dto.country ? { country: dto.country } : {}),
          ...(dto.serviceAddress ? { serviceAddress: dto.serviceAddress } : {}),
          ...(dto.cityDistrict ? { cityDistrict: dto.cityDistrict } : {}),
          ...(dto.postalCode ? { postalCode: dto.postalCode } : {}),
          ...(dto.pickupLocation ? { pickupLocation: dto.pickupLocation } : {}),
          ...(dto.destinationLocation ? { destinationLocation: dto.destinationLocation } : {}),
          isAmbulanceEmergency: isAmbulance,
          priority: isAmbulance ? LeadPriority.EMERGENCY : (finalPriority === Priority.EMERGENCY ? LeadPriority.EMERGENCY : (finalPriority === Priority.HIGH ? LeadPriority.HIGH : LeadPriority.NORMAL)),
        },
      });
    }

    return updated;
  }

  // ==========================================
  // CREATE / SYNC LEAD FROM OMNICHANNEL CONVERSATION
  // ==========================================
  async createOrSyncLead(conversationId: string, dto: CreateLeadFromEnquiryDto, user: any) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { customer: true, lead: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const phone = dto.phone || conversation.customer?.phone || null;
    const name = dto.name || conversation.customer?.name || 'Omnichannel Contact';
    const email = dto.email || conversation.customer?.email || null;

    // Check if Lead already exists for this conversation
    let lead = conversation.lead;

    // If not, check if a lead with same phone already exists in the system to prevent duplicates
    if (!lead && phone) {
      lead = await this.prisma.lead.findFirst({
        where: { phoneNumber: { contains: phone.slice(-10) } },
        orderBy: { createdAt: 'desc' },
      });
    }

    const isAmbulance =
      dto.foundation === 'AMBULANCE' ||
      dto.primaryService?.toLowerCase().includes('ambulance') ||
      dto.subServices?.some(s => s.toLowerCase().includes('ambulance'));

    const leadPriority: LeadPriority = isAmbulance
      ? LeadPriority.EMERGENCY
      : dto.priority === Priority.EMERGENCY
        ? LeadPriority.EMERGENCY
        : dto.priority === Priority.HIGH
          ? LeadPriority.HIGH
          : LeadPriority.NORMAL;

    if (lead) {
      // Update existing lead
      lead = await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          customerName: name || lead.customerName,
          phoneNumber: phone || lead.phoneNumber,
          email: email || lead.email,
          serviceInterest: dto.primaryService || lead.serviceInterest || conversation.primaryService,
          foundation: dto.foundation || lead.foundation || conversation.foundation,
          enquiryCategory: dto.enquiryCategory || lead.enquiryCategory || conversation.enquiryCategory,
          primaryService: dto.primaryService || lead.primaryService || conversation.primaryService,
          subServices: dto.subServices && dto.subServices.length > 0 ? dto.subServices : lead.subServices,
          patientName: dto.patientName || lead.patientName,
          patientAge: dto.patientAge ?? lead.patientAge,
          patientConditions: dto.patientConditions || lead.patientConditions,
          patientMobility: dto.patientMobility || lead.patientMobility,
          engagementType: dto.engagementType || lead.engagementType,
          careDurationCategory: dto.careDurationCategory || lead.careDurationCategory,
          careDuration: dto.careDuration || lead.careDuration,
          careSchedule: dto.careSchedule || lead.careSchedule,
          serviceAddress: dto.serviceAddress || lead.serviceAddress,
          cityDistrict: dto.cityDistrict || lead.cityDistrict,
          postalCode: dto.postalCode || lead.postalCode,
          pickupLocation: dto.pickupLocation || lead.pickupLocation,
          destinationLocation: dto.destinationLocation || lead.destinationLocation,
          isAmbulanceEmergency: isAmbulance,
          priority: leadPriority,
          omnichannelConversationId: conversationId,
        },
      });
    } else {
      // Create fresh lead
      lead = await this.prisma.lead.create({
        data: {
          customerName: name || 'Omnichannel Contact',
          phoneNumber: phone || `+910000000000_${Date.now()}`,
          email: email,
          serviceInterest: dto.primaryService || conversation.primaryService || null,
          source: (conversation.channel || 'OMNICHANNEL').toUpperCase(),
          status: 'NEW',
          priority: leadPriority,
          foundation: dto.foundation || conversation.foundation || 'UEC',
          enquiryCategory: dto.enquiryCategory || conversation.enquiryCategory || EnquiryCategory.SERVICE_ENQUIRY,
          primaryService: dto.primaryService || conversation.primaryService || null,
          subServices: dto.subServices || conversation.subServices || [],
          patientName: dto.patientName || null,
          patientAge: dto.patientAge ?? null,
          patientConditions: dto.patientConditions || null,
          patientMobility: dto.patientMobility || null,
          engagementType: dto.engagementType || null,
          careDurationCategory: dto.careDurationCategory || null,
          careDuration: dto.careDuration || null,
          careSchedule: dto.careSchedule || null,
          serviceAddress: dto.serviceAddress || null,
          cityDistrict: dto.cityDistrict || null,
          postalCode: dto.postalCode || null,
          pickupLocation: dto.pickupLocation || null,
          destinationLocation: dto.destinationLocation || null,
          isAmbulanceEmergency: isAmbulance,
          omnichannelConversationId: conversationId,
          assignedAgentId: dto.assignedAgentId || user?.agentId || null,
          notes: dto.notes || null,
        },
      });
    }

    // Link Lead to Conversation
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        leadId: lead.id,
        foundation: lead.foundation,
        enquiryCategory: lead.enquiryCategory,
        primaryService: lead.primaryService,
        subServices: lead.subServices,
        priority: isAmbulance ? Priority.EMERGENCY : conversation.priority,
      },
    });

    return lead;
  }

  // ==========================================
  // INBOUND & OUTBOUND CALL INTAKE FORM PERSISTENCE
  // ==========================================
  private normalizePhone(raw?: string | null): string {
    if (!raw) return '';
    let clean = String(raw).trim();
    try { clean = decodeURIComponent(clean); } catch (_) { }
    const lower = clean.toLowerCase();
    if (['unknown', 'anonymous', 'withheld', 'internal', 'private', 'none'].includes(lower)) {
      return '';
    }
    let digits = clean.replace(/[^\d+]/g, '');
    if (digits.startsWith('00')) digits = '+' + digits.substring(2);
    else if (digits.startsWith('0') && digits.length === 11) digits = '+91' + digits.substring(1);
    else if (!digits.startsWith('+') && digits.length === 10) digits = '+91' + digits;
    else if (!digits.startsWith('+') && digits.startsWith('91') && digits.length === 12) digits = '+' + digits;
    return digits;
  }

  async resolveUnitForFoundationAndCategory(foundation?: string, category?: string, isAmbulance?: boolean) {
    let targetUnitCode = 'UEC';
    if (isAmbulance || (category && String(category).toLowerCase().includes('ambulance'))) {
      targetUnitCode = 'AMBULANCE';
    } else if (foundation) {
      const fUpper = foundation.toUpperCase();
      if (fUpper.includes('AMBULANCE')) targetUnitCode = 'AMBULANCE';
      else if (fUpper.includes('UNCF')) targetUnitCode = 'UNCF';
      else if (fUpper.includes('HOME_CARE') || fUpper.includes('IN_HOME') || fUpper.includes('A_CARE')) targetUnitCode = 'HOME_CARE';
      else targetUnitCode = 'UEC';
    }
    return await this.prisma.unit.findFirst({
      where: { code: targetUnitCode },
    });
  }

  private isValidUuid(val?: string | null): boolean {
    return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  private getCallSessionLookupFilter(callSidOrId: string) {
    const isUuid = this.isValidUuid(callSidOrId);
    const orConditions: any[] = [
      { reason: callSidOrId },
      { livekitRoom: callSidOrId },
      { providerCallId: callSidOrId },
    ];
    if (isUuid) {
      orConditions.push({ id: callSidOrId });
    }
    return orConditions;
  }

  // ==========================================
  // PHASE 27 — STATUS & CALENDAR HELPERS
  // ==========================================
  mapDispositionToLeadStatus(disposition?: string): LeadStatus {
    if (!disposition) return LeadStatus.NEW;
    const upper = disposition.toUpperCase().replace(/[\s\/-]/g, '_');
    if (upper.includes('CONVERT') || upper === 'WON') return LeadStatus.CONVERTED;
    if (upper.includes('CLOSED') || upper.includes('LOST') || upper === 'CLOSED_LOST') return LeadStatus.CLOSED;
    if (upper.includes('NOT_INTERESTED') || upper.includes('UNREACHABLE') || upper.includes('NEGATIVE')) return LeadStatus.NEGATIVE;
    if (upper.includes('FOLLOWUP') || upper.includes('FOLLOW_UP') || upper.includes('CALLBACK')) return LeadStatus.FOLLOWUP_REQUIRED;
    if (upper.includes('INTERESTED') || upper.includes('APPOINTMENT') || upper.includes('QUALIFIED') || upper.includes('POSITIVE')) return LeadStatus.POSITIVE;
    if (upper.includes('CONTACTED') || upper.includes('IN_PROGRESS') || upper.includes('PROPOSAL') || upper.includes('QUOTATION')) return LeadStatus.IN_PROGRESS;
    return LeadStatus.NEW;
  }

  private async syncCalendarFollowup(
    leadId: string,
    customerId: string | undefined,
    assignedAgentId: string | undefined,
    customerName: string,
    primaryService: string,
    followupDateStr: string,
    followupTimeStr: string | undefined,
    followupType: string | undefined,
    notes: string | undefined,
    callSessionId: string | undefined,
  ) {
    try {
      const timePart = followupTimeStr || '10:00';
      const [hours, minutes] = timePart.split(':').map(Number);
      const startDateTime = new Date(followupDateStr);
      if (isNaN(startDateTime.getTime())) return null;

      startDateTime.setHours(isNaN(hours) ? 10 : hours, isNaN(minutes) ? 0 : minutes, 0, 0);
      const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000); // 30 mins
      const dateOnly = new Date(startDateTime.toISOString().split('T')[0]);

      let effectiveAgentId = this.isValidUuid(assignedAgentId) ? assignedAgentId : undefined;
      if (!effectiveAgentId) {
        const fallback = await this.prisma.agent.findFirst();
        effectiveAgentId = fallback?.id;
      }

      // 1. Update/Create LeadFollowup
      const existingFollowup = await this.prisma.leadFollowup.findFirst({
        where: { leadId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });

      if (existingFollowup) {
        await this.prisma.leadFollowup.update({
          where: { id: existingFollowup.id },
          data: {
            followupDate: startDateTime,
            meetingType: (followupType === 'APPOINTMENT' || followupType === 'VISIT') ? MeetingType.APPOINTMENT : MeetingType.CALLBACK,
            notes: notes || `Follow-up updated for ${customerName}`,
            assignedAgentId: effectiveAgentId || existingFollowup.assignedAgentId,
          },
        });
      } else if (effectiveAgentId) {
        await this.prisma.leadFollowup.create({
          data: {
            leadId,
            assignedAgentId: effectiveAgentId,
            followupDate: startDateTime,
            meetingType: (followupType === 'APPOINTMENT' || followupType === 'VISIT') ? MeetingType.APPOINTMENT : MeetingType.CALLBACK,
            notes: notes || `Follow-up scheduled for ${customerName}`,
            status: 'PENDING',
          },
        });
      }

      // 2. Update/Create Appointment (CRM Calendar Event)
      const existingAppt = await this.prisma.appointment.findFirst({
        where: { leadId, status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED] } },
        orderBy: { createdAt: 'desc' },
      });

      const title = `Follow-up — ${customerName} — ${primaryService || 'Care Services'}`;

      if (existingAppt) {
        return await this.prisma.appointment.update({
          where: { id: existingAppt.id },
          data: {
            title,
            treatment: primaryService || existingAppt.treatment,
            date: dateOnly,
            startTime: startDateTime,
            endTime: endDateTime,
            duration: 30,
            appointmentType: followupType || 'CALLBACK',
            notes: notes || existingAppt.notes,
            assignedAgentId: effectiveAgentId || existingAppt.assignedAgentId,
          },
        });
      } else {
        return await this.prisma.appointment.create({
          data: {
            leadId,
            customerId: this.isValidUuid(customerId) ? customerId : undefined,
            assignedAgentId: effectiveAgentId,
            title,
            treatment: primaryService || 'Care Services',
            date: dateOnly,
            startTime: startDateTime,
            endTime: endDateTime,
            duration: 30,
            timezone: 'Asia/Kolkata',
            status: AppointmentStatus.CONFIRMED,
            bookingSource: BookingSource.CRM,
            appointmentType: followupType || 'CALLBACK',
            notes: notes || `Follow-up scheduled from Intake Form`,
            callSessionId: this.isValidUuid(callSessionId) ? callSessionId : undefined,
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(`[CALENDAR-SYNC] Failed to synchronize calendar follow-up for lead ${leadId}: ${err.message}`);
      return null;
    }
  }

  async saveCallIntake(callSidOrId: string, dto: SaveCallIntakeDto, user: any) {
    const fullAddress = [dto.street, dto.city, dto.state, dto.postalCode, dto.country].filter(Boolean).join(', ');
    // Locate call session by ID or reason or providerCallId
    let session = await this.prisma.callSession.findFirst({
      where: {
        OR: this.getCallSessionLookupFilter(callSidOrId),
      },
      include: { lead: true, customer: true },
    });

    if (!session) {
      this.logger.log(`CallSession [${callSidOrId}] not found during saveCallIntake. Auto-provisioning session.`);
      const rawUserId = user?.id || user?.userId;
      const validUserId = this.isValidUuid(rawUserId) ? rawUserId : undefined;
      session = await this.prisma.callSession.create({
        data: {
          reason: callSidOrId,
          providerCallId: callSidOrId,
          livekitRoom: callSidOrId,
          status: 'ENDED',
          callerUserId: validUserId,
        },
        include: { lead: true, customer: true },
      });
    }

    const isAmbulance =
      dto.foundation === 'AMBULANCE' ||
      dto.primaryService?.toLowerCase().includes('ambulance') ||
      dto.subServices?.some(s => s.toLowerCase().includes('ambulance'));

    const resolvedUnit = await this.resolveUnitForFoundationAndCategory(dto.foundation, dto.enquiryCategory as string, isAmbulance);

    // Sanitize enquiryCategory to ensure only valid Prisma enum values are stored in database enum columns
    const validEnquiryCategories = ['SERVICE_ENQUIRY', 'JOB_ENQUIRY'];
    const safeEnquiryCategory = validEnquiryCategories.includes(dto.enquiryCategory as string)
      ? (dto.enquiryCategory as any)
      : (dto.enquiryCategory ? 'SERVICE_ENQUIRY' : undefined);

    const intakePayload = {
      ...dto,
      isAmbulance,
      unitId: resolvedUnit?.id,
      unitCode: resolvedUnit?.code,
      savedAt: new Date().toISOString(),
      savedBy: user?.name || user?.email || 'Agent',
      authorId: user?.id || user?.userId,
    };

    // Update call session
    const updatedSession = await this.prisma.callSession.update({
      where: { id: session.id },
      data: {
        intakeForm: intakePayload,
        unitId: resolvedUnit?.id,
        disposition: dto.callOutcome || undefined,
        enquiryCategory: safeEnquiryCategory,
        whatsappStatus: dto.whatsappStatus || undefined,
        ...(dto.liveNotes ? { liveNotes: { text: dto.liveNotes, updatedAt: new Date().toISOString(), agentId: user?.id || user?.userId, agentName: user?.name || user?.email } } : {}),
      },
    });

    // Update or link lead
    let targetLeadId = dto.leadId || session.leadId;
    const cleanPhone = this.normalizePhone(dto.phone || session.customer?.phone);
    let existingLead: any = null;

    // Customer Persistence from call intake form
    if (cleanPhone) {
      try {
        const custName = dto.enquirerName || (dto.patientName ? `${dto.patientName} (Contact: ${dto.enquirerName || 'Caller'})` : undefined);
        const custData: any = {
          ...(custName ? { name: custName } : {}),
          ...(dto.email ? { email: dto.email } : {}),
          ...(dto.secondaryPhone ? { secondaryPhone: dto.secondaryPhone } : {}),
          ...(dto.street ? { street: dto.street } : {}),
          ...(dto.city ? { city: dto.city } : {}),
          ...(dto.state ? { state: dto.state } : {}),
          ...(dto.country ? { country: dto.country } : {}),
          ...(dto.postalCode ? { postalCode: dto.postalCode } : {}),
          ...(dto.patientName ? { patientName: dto.patientName } : {}),
          ...(dto.patientAge !== undefined ? { patientAge: dto.patientAge } : {}),
          ...(dto.patientWeight !== undefined ? { patientWeight: dto.patientWeight } : {}),
          ...(dto.patientWeightUnit ? { patientWeightUnit: dto.patientWeightUnit } : {}),
          ...(dto.whatsappStatus ? { whatsappStatus: dto.whatsappStatus } : {}),
          ...(dto.whatsappStatus === 'VERIFIED' ? { whatsappVerifiedAt: new Date() } : {}),
          profileEnriched: true,
        };
        const upsertedCustomer = await this.prisma.customer.upsert({
          where: { phone: cleanPhone },
          update: custData,
          create: {
            name: custName || 'Inbound Enquirer',
            phone: cleanPhone,
            email: dto.email || null,
            secondaryPhone: dto.secondaryPhone || null,
            street: dto.street || null,
            city: dto.city || null,
            state: dto.state || null,
            country: dto.country || null,
            postalCode: dto.postalCode || null,
            patientName: dto.patientName || null,
            patientAge: dto.patientAge ?? null,
            patientWeight: dto.patientWeight ?? null,
            patientWeightUnit: dto.patientWeightUnit || 'kg',
            whatsappStatus: dto.whatsappStatus || 'UNKNOWN',
            whatsappVerifiedAt: dto.whatsappStatus === 'VERIFIED' ? new Date() : null,
            profileEnriched: true,
          },
        });
        if (!session.customerId) {
          await this.prisma.callSession.update({
            where: { id: session.id },
            data: { customerId: upsertedCustomer.id },
          });
        }
      } catch (custErr: any) {
        this.logger.warn(`Failed to upsert customer on saveCallIntake: ${custErr.message}`);
      }
    }

    // Determine correct lead source from call session attribution
    const callDirection = (session as any).direction;
    const resolvedLeadSource = (session as any).campaign
      ? `Campaign: ${(session as any).campaign}`
      : (session as any).source
        ? (session as any).source
        : (session as any).trackingNumber
          ? `DID: ${(session as any).trackingNumber}`
          : (callDirection === 'OUTBOUND' || (session.reason && session.reason.includes('outbound')) ? 'Outbound Call' : 'Inbound Call');

    // Handle Job vs Service Enquiry routing
    const isJob = dto.enquiryCategory === 'JOB_ENQUIRY';
    const resolvedServiceInterest = isJob
      ? (dto.primaryService ? `Job Enquiry: ${dto.primaryService}` : (dto.serviceCategory || 'Job Enquiry / Careers'))
      : (dto.primaryService || dto.serviceCategory || 'Care Services');

    const effectiveStatus = this.mapDispositionToLeadStatus(
      dto.customerDisposition || dto.callOutcome || dto.status || (existingLead ? existingLead.status : 'NEW')
    );

    if (targetLeadId) {
      existingLead = await this.prisma.lead.findUnique({ where: { id: targetLeadId } });
    }

    if (!targetLeadId && cleanPhone) {
      // Find existing lead by phone to prevent duplicates
      const existing = await this.prisma.lead.findFirst({
        where: { phoneNumber: { contains: cleanPhone.slice(-10) } },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        targetLeadId = existing.id;
        existingLead = existing;
      } else {
        // Create brand new Lead
        const createdLead = await this.prisma.lead.create({
          data: {
            customerName: dto.enquirerName || session.customer?.name || 'Inbound Enquirer',
            phoneNumber: cleanPhone,
            email: dto.email || session.customer?.email || null,
            serviceInterest: resolvedServiceInterest,
            source: resolvedLeadSource,
            status: effectiveStatus,
            priority: isAmbulance ? LeadPriority.EMERGENCY : LeadPriority.NORMAL,
            foundation: dto.foundation || 'UEC',
            unitId: resolvedUnit?.id,
            enquiryCategory: safeEnquiryCategory,
            primaryService: dto.primaryService || null,
            subServices: dto.subServices || [],
            patientName: dto.patientName || null,
            patientAge: dto.patientAge ?? null,
            patientWeight: dto.patientWeight ?? null,
            patientWeightUnit: dto.patientWeightUnit || 'kg',
            patientConditions: dto.patientConditions || null,
            patientMobility: dto.patientMobility || null,
            engagementType: dto.engagementType || null,
            careDurationCategory: dto.careDurationCategory || null,
            careDuration: dto.careDuration || null,
            careSchedule: dto.careSchedule || null,
            secondaryPhone: dto.secondaryPhone || null,
            secondaryCountryCode: dto.secondaryCountryCode || null,
            street: dto.street || null,
            city: dto.city || dto.cityDistrict || null,
            state: dto.state || null,
            country: dto.country || null,
            serviceAddress: fullAddress || dto.serviceAddress || null,
            cityDistrict: dto.city || dto.cityDistrict || null,
            postalCode: dto.postalCode || null,
            whatsappStatus: dto.whatsappStatus || 'UNKNOWN',
            whatsappVerifiedAt: dto.whatsappStatus === 'VERIFIED' ? new Date() : null,
            pickupLocation: dto.pickupLocation || null,
            destinationLocation: dto.destinationLocation || null,
            isAmbulanceEmergency: isAmbulance,
            notes: dto.liveNotes || null,
            assignedAgentId: user?.agentId || null,
            // Phase 27 Agent Feedback & Disposition
            interestLevel: dto.interestLevel || null,
            customerDisposition: dto.customerDisposition || dto.callOutcome || null,
            agentFeedback: dto.agentFeedback || null,
            nextAction: dto.nextAction || null,
            followupDate: dto.followupDate ? new Date(dto.followupDate) : null,
            followupTime: dto.followupTime || null,
            followupType: dto.followupType || null,
            followupNotes: dto.followupNotes || null,
            feedbackAgentId: user?.agentId || (this.isValidUuid(user?.id) ? user.id : null),
            feedbackAgentName: user?.name || user?.username || 'Agent',
            feedbackSubmittedAt: (dto.customerDisposition || dto.agentFeedback) ? new Date() : null,
          },
        });
        targetLeadId = createdLead.id;
        existingLead = createdLead;
      }
      // Link session to the lead
      await this.prisma.callSession.update({
        where: { id: session.id },
        data: { leadId: targetLeadId },
      });
    }

    // Check if unit reclassification occurred and audit it
    if (existingLead && resolvedUnit && existingLead.unitId && existingLead.unitId !== resolvedUnit.id && targetLeadId) {
      try {
        const actorUserId = this.isValidUuid(user?.id) ? user.id : this.isValidUuid(user?.userId) ? user.userId : undefined;
        const assignedAgentId = this.isValidUuid(user?.agentId) ? user.agentId : undefined;
        await this.prisma.leadTransferAudit.create({
          data: {
            leadId: targetLeadId,
            sourceUnitId: existingLead.unitId,
            destUnitId: resolvedUnit.id,
            transferredById: actorUserId,
            assignedAgentId: assignedAgentId,
            reason: `Reclassified during call intake: ${dto.enquiryCategory || dto.primaryService || 'Intent change'}`,
            status: 'COMPLETED',
            preserveHistory: true,
            metadata: {
              previousFoundation: existingLead.foundation,
              newFoundation: dto.foundation,
              callSid: session.reason || session.id,
              actorEmail: user?.email,
              actorUsername: user?.username || user?.name,
            },
          },
        });
      } catch (auditErr: any) {
        this.logger.warn(`Failed to create reclassification audit: ${auditErr.message}`);
      }
    }

    let updatedLead: any = null;
    if (targetLeadId) {
      // Record LeadConversionLog if disposition/status changed
      const actorUserId = this.isValidUuid(user?.id) ? user.id : this.isValidUuid(user?.userId) ? user.userId : undefined;
      if (existingLead && existingLead.status !== effectiveStatus) {
        try {
          await this.prisma.leadConversionLog.create({
            data: {
              leadId: targetLeadId,
              oldStatus: existingLead.status as any,
              newStatus: effectiveStatus,
              notes: dto.agentFeedback || `Status transitioned to ${effectiveStatus} via call intake disposition (${dto.customerDisposition || dto.callOutcome || 'Updated'})`,
              agentId: this.isValidUuid(user?.agentId) ? user.agentId : undefined,
            },
          });
        } catch (convErr: any) {
          this.logger.warn(`Failed to record LeadConversionLog: ${convErr.message}`);
        }
      }

      updatedLead = await this.prisma.lead.update({
        where: { id: targetLeadId },
        data: {
          ...(dto.enquirerName ? { customerName: dto.enquirerName } : {}),
          ...(dto.email ? { email: dto.email } : {}),
          ...(dto.foundation ? { foundation: dto.foundation } : {}),
          serviceInterest: resolvedServiceInterest,
          ...(resolvedUnit?.id ? { unitId: resolvedUnit.id } : {}),
          ...((!existingLead?.source || existingLead?.source === 'Manual Entry' || existingLead?.source === 'Unknown') ? { source: resolvedLeadSource } : {}),
          ...(safeEnquiryCategory ? { enquiryCategory: safeEnquiryCategory } : {}),
          ...(dto.primaryService ? { primaryService: dto.primaryService } : {}),
          ...(dto.subServices ? { subServices: dto.subServices } : {}),
          ...(dto.patientName ? { patientName: dto.patientName } : {}),
          ...(dto.patientAge !== undefined ? { patientAge: dto.patientAge } : {}),
          ...(dto.patientWeight !== undefined ? { patientWeight: dto.patientWeight } : {}),
          ...(dto.patientWeightUnit ? { patientWeightUnit: dto.patientWeightUnit } : {}),
          ...(dto.patientConditions ? { patientConditions: dto.patientConditions } : {}),
          ...(dto.patientMobility ? { patientMobility: dto.patientMobility } : {}),
          ...(dto.engagementType ? { engagementType: dto.engagementType } : {}),
          ...(dto.careDurationCategory ? { careDurationCategory: dto.careDurationCategory } : {}),
          ...(dto.careDuration ? { careDuration: dto.careDuration } : {}),
          ...(dto.careSchedule ? { careSchedule: dto.careSchedule } : {}),
          ...(dto.secondaryPhone ? { secondaryPhone: dto.secondaryPhone } : {}),
          ...(dto.secondaryCountryCode ? { secondaryCountryCode: dto.secondaryCountryCode } : {}),
          ...(dto.street ? { street: dto.street } : {}),
          ...(dto.city ? { city: dto.city } : {}),
          ...(dto.state ? { state: dto.state } : {}),
          ...(dto.country ? { country: dto.country } : {}),
          ...(dto.serviceAddress || fullAddress ? { serviceAddress: fullAddress || dto.serviceAddress } : {}),
          ...(dto.cityDistrict || dto.city ? { cityDistrict: dto.city || dto.cityDistrict } : {}),
          ...(dto.postalCode ? { postalCode: dto.postalCode } : {}),
          ...(dto.whatsappStatus ? { whatsappStatus: dto.whatsappStatus } : {}),
          ...(dto.whatsappStatus === 'VERIFIED' ? { whatsappVerifiedAt: new Date() } : {}),
          ...(dto.pickupLocation ? { pickupLocation: dto.pickupLocation } : {}),
          ...(dto.destinationLocation ? { destinationLocation: dto.destinationLocation } : {}),
          isAmbulanceEmergency: isAmbulance,
          priority: isAmbulance ? LeadPriority.EMERGENCY : undefined,
          ...(dto.liveNotes ? { notes: dto.liveNotes } : {}),
          // Phase 27 Agent Feedback & Customer Disposition
          status: effectiveStatus,
          ...(dto.interestLevel ? { interestLevel: dto.interestLevel } : {}),
          ...(dto.customerDisposition ? { customerDisposition: dto.customerDisposition } : {}),
          ...(dto.agentFeedback ? { agentFeedback: dto.agentFeedback } : {}),
          ...(dto.nextAction ? { nextAction: dto.nextAction } : {}),
          ...(dto.followupDate ? { followupDate: new Date(dto.followupDate) } : {}),
          ...(dto.followupTime ? { followupTime: dto.followupTime } : {}),
          ...(dto.followupType ? { followupType: dto.followupType } : {}),
          ...(dto.followupNotes ? { followupNotes: dto.followupNotes } : {}),
          ...(dto.customerDisposition || dto.agentFeedback ? {
            feedbackAgentId: user?.agentId || (this.isValidUuid(user?.id) ? user.id : null),
            feedbackAgentName: user?.name || user?.username || 'Agent',
            feedbackSubmittedAt: new Date(),
          } : {}),
        },
      });

      // Schedule or update CRM Calendar & Followup if requested
      if (dto.followupDate) {
        await this.syncCalendarFollowup(
          targetLeadId,
          session?.customerId || undefined,
          user?.agentId,
          dto.enquirerName || existingLead?.customerName || 'Customer',
          dto.primaryService || resolvedServiceInterest || 'Care Services',
          dto.followupDate,
          dto.followupTime,
          dto.followupType,
          dto.followupNotes || dto.agentFeedback || dto.liveNotes,
          session?.id,
        );
      }

      // Terminal state check: if converted or closed, cancel pending appointments and followups
      if (effectiveStatus === LeadStatus.CONVERTED || effectiveStatus === LeadStatus.CLOSED || effectiveStatus === LeadStatus.NEGATIVE) {
        try {
          await this.prisma.appointment.updateMany({
            where: { leadId: targetLeadId, status: AppointmentStatus.CONFIRMED },
            data: { status: AppointmentStatus.CANCELLED, notes: `Cancelled due to lead transition to ${effectiveStatus}` },
          });
          await this.prisma.leadFollowup.updateMany({
            where: { leadId: targetLeadId, status: 'PENDING' },
            data: { status: 'CANCELLED', notes: `Follow-up cancelled due to lead transition to ${effectiveStatus}` },
          });
        } catch (cancelErr: any) {
          this.logger.warn(`Failed to cancel follow-ups for terminal lead: ${cancelErr.message}`);
        }
      }
    }

    return { success: true, session: updatedSession, lead: updatedLead };
  }

  /**
   * Save or update structured enquiry directly (manual entry, website, or editing an existing lead)
   */
  async saveStructuredEnquiryLead(dto: SaveCallIntakeDto, user: any, leadId?: string) {
    const isAmbulance =
      dto.foundation === 'AMBULANCE' ||
      dto.primaryService?.toLowerCase().includes('ambulance') ||
      dto.subServices?.some(s => s.toLowerCase().includes('ambulance'));

    const cleanPhone = this.normalizePhone(dto.phone);
    if (!cleanPhone && !leadId) {
      throw new BadRequestException('Valid phone number is required for lead enquiry');
    }

    let targetLead = null;
    if (leadId) {
      targetLead = await this.prisma.lead.findUnique({ where: { id: leadId } });
      if (!targetLead) throw new NotFoundException('Lead not found');
    } else if (cleanPhone) {
      targetLead = await this.prisma.lead.findFirst({
        where: { phoneNumber: { contains: cleanPhone.slice(-10) } },
        orderBy: { createdAt: 'desc' },
      });
    }

    const leadPriority: LeadPriority = isAmbulance
      ? LeadPriority.EMERGENCY
      : dto.callbackPriority === 'HIGH'
        ? LeadPriority.HIGH
        : LeadPriority.NORMAL;

    const resolvedUnit = await this.resolveUnitForFoundationAndCategory(dto.foundation, dto.enquiryCategory as string, isAmbulance);

    const effectiveStatus = this.mapDispositionToLeadStatus(
      dto.customerDisposition || dto.callOutcome || dto.status || (targetLead ? targetLead.status : 'NEW')
    );

    let savedLead;
    if (targetLead) {
      const actorUserId = this.isValidUuid(user?.id) ? user.id : this.isValidUuid(user?.userId) ? user.userId : undefined;

      // Record LeadConversionLog if disposition/status changed
      if (targetLead.status !== effectiveStatus) {
        try {
          await this.prisma.leadConversionLog.create({
            data: {
              leadId: targetLead.id,
              oldStatus: targetLead.status as any,
              newStatus: effectiveStatus,
              notes: dto.agentFeedback || `Status transitioned to ${effectiveStatus} via structured enquiry disposition (${dto.customerDisposition || dto.callOutcome || 'Updated'})`,
              agentId: this.isValidUuid(user?.agentId) ? user.agentId : undefined,
            },
          });
        } catch (convErr: any) {
          this.logger.warn(`Failed to record LeadConversionLog: ${convErr.message}`);
        }
      }

      if (resolvedUnit && targetLead.unitId && targetLead.unitId !== resolvedUnit.id) {
        const assignedAgentId = this.isValidUuid(user?.agentId) ? user.agentId : undefined;
        await this.prisma.leadTransferAudit.create({
          data: {
            leadId: targetLead.id,
            sourceUnitId: targetLead.unitId,
            destUnitId: resolvedUnit.id,
            transferredById: actorUserId,
            assignedAgentId: assignedAgentId,
            reason: `Reclassified in structured enquiry: ${dto.enquiryCategory || dto.primaryService || 'Intent change'}`,
            status: 'COMPLETED',
            preserveHistory: true,
            metadata: {
              previousFoundation: targetLead.foundation,
              newFoundation: dto.foundation,
              actorEmail: user?.email,
              actorUsername: user?.username || user?.name,
            },
          },
        });
      }

      // Update existing lead transactionally
      savedLead = await this.prisma.lead.update({
        where: { id: targetLead.id },
        data: {
          customerName: dto.enquirerName || targetLead.customerName,
          phoneNumber: cleanPhone || targetLead.phoneNumber,
          email: dto.email !== undefined ? dto.email : targetLead.email,
          serviceInterest: dto.primaryService || dto.serviceCategory || targetLead.serviceInterest,
          foundation: dto.foundation || targetLead.foundation || 'UEC',
          unitId: resolvedUnit?.id || targetLead.unitId,
          enquiryCategory: (dto.enquiryCategory as any) || targetLead.enquiryCategory,
          primaryService: dto.primaryService || targetLead.primaryService,
          subServices: dto.subServices && dto.subServices.length > 0 ? dto.subServices : targetLead.subServices,
          patientName: dto.patientName !== undefined ? dto.patientName : targetLead.patientName,
          patientAge: dto.patientAge !== undefined ? dto.patientAge : targetLead.patientAge,
          patientWeight: dto.patientWeight !== undefined ? dto.patientWeight : targetLead.patientWeight,
          patientWeightUnit: dto.patientWeightUnit || targetLead.patientWeightUnit || 'kg',
          patientConditions: dto.patientConditions !== undefined ? dto.patientConditions : targetLead.patientConditions,
          patientMobility: dto.patientMobility || targetLead.patientMobility,
          engagementType: dto.engagementType || targetLead.engagementType,
          careDurationCategory: dto.careDurationCategory || targetLead.careDurationCategory,
          careDuration: dto.careDuration || targetLead.careDuration,
          careSchedule: dto.careSchedule || targetLead.careSchedule,
          secondaryPhone: dto.secondaryPhone !== undefined ? dto.secondaryPhone : targetLead.secondaryPhone,
          secondaryCountryCode: dto.secondaryCountryCode !== undefined ? dto.secondaryCountryCode : targetLead.secondaryCountryCode,
          street: dto.street !== undefined ? dto.street : targetLead.street,
          city: dto.city !== undefined ? dto.city : (dto.cityDistrict !== undefined ? dto.cityDistrict : targetLead.city),
          state: dto.state !== undefined ? dto.state : targetLead.state,
          country: dto.country !== undefined ? dto.country : targetLead.country,
          serviceAddress: dto.serviceAddress !== undefined ? dto.serviceAddress : targetLead.serviceAddress,
          cityDistrict: dto.cityDistrict !== undefined ? dto.cityDistrict : (dto.city !== undefined ? dto.city : targetLead.cityDistrict),
          postalCode: dto.postalCode !== undefined ? dto.postalCode : targetLead.postalCode,
          whatsappStatus: dto.whatsappStatus || targetLead.whatsappStatus,
          whatsappVerifiedAt: dto.whatsappStatus === 'VERIFIED' ? new Date() : targetLead.whatsappVerifiedAt,
          pickupLocation: dto.pickupLocation !== undefined ? dto.pickupLocation : targetLead.pickupLocation,
          destinationLocation: dto.destinationLocation !== undefined ? dto.destinationLocation : targetLead.destinationLocation,
          isAmbulanceEmergency: isAmbulance,
          priority: leadPriority,
          notes: dto.liveNotes !== undefined ? dto.liveNotes : targetLead.notes,
          // Phase 27 Fields
          status: effectiveStatus,
          ...(dto.interestLevel ? { interestLevel: dto.interestLevel } : {}),
          ...(dto.customerDisposition ? { customerDisposition: dto.customerDisposition } : {}),
          ...(dto.agentFeedback ? { agentFeedback: dto.agentFeedback } : {}),
          ...(dto.nextAction ? { nextAction: dto.nextAction } : {}),
          ...(dto.followupDate ? { followupDate: new Date(dto.followupDate) } : {}),
          ...(dto.followupTime ? { followupTime: dto.followupTime } : {}),
          ...(dto.followupType ? { followupType: dto.followupType } : {}),
          ...(dto.followupNotes ? { followupNotes: dto.followupNotes } : {}),
          ...(dto.customerDisposition || dto.agentFeedback ? {
            feedbackAgentId: user?.agentId || (this.isValidUuid(user?.id) ? user.id : targetLead.feedbackAgentId),
            feedbackAgentName: user?.name || user?.username || targetLead.feedbackAgentName,
            feedbackSubmittedAt: new Date(),
          } : {}),
        },
      });
    } else {
      // Create new lead
      savedLead = await this.prisma.lead.create({
        data: {
          customerName: dto.enquirerName || 'Enquirer',
          phoneNumber: cleanPhone,
          email: dto.email || null,
          serviceInterest: dto.primaryService || dto.serviceCategory || 'Care Services',
          source: dto.source || 'Manual Entry',
          status: effectiveStatus,
          priority: leadPriority,
          foundation: dto.foundation || 'UEC',
          unitId: resolvedUnit?.id,
          enquiryCategory: (dto.enquiryCategory as any) || EnquiryCategory.SERVICE_ENQUIRY,
          primaryService: dto.primaryService || null,
          subServices: dto.subServices || [],
          patientName: dto.patientName || null,
          patientAge: dto.patientAge ?? null,
          patientWeight: dto.patientWeight ?? null,
          patientWeightUnit: dto.patientWeightUnit || 'kg',
          patientConditions: dto.patientConditions || null,
          patientMobility: dto.patientMobility || null,
          engagementType: dto.engagementType || null,
          careDurationCategory: dto.careDurationCategory || null,
          careDuration: dto.careDuration || null,
          careSchedule: dto.careSchedule || null,
          secondaryPhone: dto.secondaryPhone || null,
          secondaryCountryCode: dto.secondaryCountryCode || null,
          street: dto.street || null,
          city: dto.city || dto.cityDistrict || null,
          state: dto.state || null,
          country: dto.country || null,
          serviceAddress: dto.serviceAddress || null,
          cityDistrict: dto.cityDistrict || dto.city || null,
          postalCode: dto.postalCode || null,
          whatsappStatus: dto.whatsappStatus || 'UNKNOWN',
          whatsappVerifiedAt: dto.whatsappStatus === 'VERIFIED' ? new Date() : null,
          pickupLocation: dto.pickupLocation || null,
          destinationLocation: dto.destinationLocation || null,
          isAmbulanceEmergency: isAmbulance,
          notes: dto.liveNotes || null,
          assignedAgentId: user?.agentId || null,
          // Phase 27 Agent Feedback & Disposition
          interestLevel: dto.interestLevel || null,
          customerDisposition: dto.customerDisposition || dto.callOutcome || null,
          agentFeedback: dto.agentFeedback || null,
          nextAction: dto.nextAction || null,
          followupDate: dto.followupDate ? new Date(dto.followupDate) : null,
          followupTime: dto.followupTime || null,
          followupType: dto.followupType || null,
          followupNotes: dto.followupNotes || null,
          feedbackAgentId: user?.agentId || (this.isValidUuid(user?.id) ? user.id : null),
          feedbackAgentName: user?.name || user?.username || 'Agent',
          feedbackSubmittedAt: (dto.customerDisposition || dto.agentFeedback) ? new Date() : null,
        },
      });
    }

    // Schedule follow-up & sync CRM Calendar
    if (dto.followupDate) {
      await this.syncCalendarFollowup(
        savedLead.id,
        undefined,
        user?.agentId,
        dto.enquirerName || savedLead.customerName || 'Customer',
        dto.primaryService || savedLead.serviceInterest || 'Care Services',
        dto.followupDate,
        dto.followupTime,
        dto.followupType,
        dto.followupNotes || dto.agentFeedback || dto.liveNotes,
        undefined,
      );
    }

    // Terminal state handling & Automatic ERP Domain Record Provisioning
    if (effectiveStatus === LeadStatus.CONVERTED) {
      try {
        let targetUnitId = savedLead.unitId || resolvedUnit?.id;
        const targetTenantId = savedLead.tenantId || (await this.prisma.tenant.findFirst())?.id || 'd40f62e1-7b9f-40ad-9d79-1bc057d9be65';
        let client = null;
        if (cleanPhone) {
          client = await this.prisma.client.findFirst({
            where: { mobile: cleanPhone, ...(targetUnitId ? { unitId: targetUnitId } : {}) },
          });
        }
        if (!client && dto.email) {
          client = await this.prisma.client.findFirst({
            where: { email: dto.email, ...(targetUnitId ? { unitId: targetUnitId } : {}) },
          });
        }
        if (!client) {
          client = await this.prisma.client.create({
            data: {
              refNo: `CLI-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              name: savedLead.customerName || 'CRM Customer',
              mobile: savedLead.phoneNumber || '9999999999',
              email: savedLead.email || null,
              address: savedLead.serviceAddress || savedLead.city || null,
              tenantId: targetTenantId,
              unitId: targetUnitId,
            },
          });
        }

        const existingEnq = await this.prisma.enquiry.findUnique({
          where: { crmLeadId: savedLead.id },
        });
        if (!existingEnq) {
          await this.prisma.enquiry.create({
            data: {
              refNo: `ENQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              clientId: client.id,
              description: savedLead.notes || savedLead.primaryService || 'Converted from CRM Lead',
              status: 'NEW',
              isConverted: true,
              convertedAt: new Date(),
              serviceRequirements: `Service: ${savedLead.primaryService || 'General Care'} | Category: ${savedLead.enquiryCategory}`,
              summary: `Converted from CRM Lead: ${savedLead.customerName} - ${savedLead.phoneNumber}`,
              tenantId: targetTenantId,
              unitId: targetUnitId,
              crmLeadId: savedLead.id,
            },
          });
        }

        await provisionErpDomainRecords(this.prisma, savedLead, {
          notes: savedLead.notes,
          targetUnitId,
          targetTenantId,
          client,
        });

        await this.prisma.lead.update({
          where: { id: savedLead.id },
          data: { clientId: client.id, tenantId: targetTenantId },
        });
      } catch (erpErr: any) {
        this.logger.error(`Failed to automatically provision ERP records for converted lead: ${erpErr.message}`, erpErr.stack);
      }
    }

    if (effectiveStatus === LeadStatus.CONVERTED || effectiveStatus === LeadStatus.CLOSED || effectiveStatus === LeadStatus.NEGATIVE) {
      try {
        await this.prisma.appointment.updateMany({
          where: { leadId: savedLead.id, status: AppointmentStatus.CONFIRMED },
          data: { status: AppointmentStatus.CANCELLED, notes: `Cancelled due to lead transition to ${effectiveStatus}` },
        });
        await this.prisma.leadFollowup.updateMany({
          where: { leadId: savedLead.id, status: 'PENDING' },
          data: { status: 'CANCELLED', notes: `Follow-up cancelled due to lead transition to ${effectiveStatus}` },
        });
      } catch (cancelErr: any) {
        this.logger.warn(`Failed to cancel follow-ups for terminal lead: ${cancelErr.message}`);
      }
    }

    return {
      success: true,
      lead: savedLead,
      message: targetLead ? 'Enquiry updated successfully' : 'Enquiry created successfully',
    };
  }

  // ==========================================
  // INCREMENTAL LIVE NOTES AUTO-SAVE
  // ==========================================
  async saveLiveNotes(targetType: 'call' | 'lead' | 'conversation', id: string, dto: SaveLiveNotesDto, user: any) {
    const timestamp = new Date().toISOString();
    const author = user?.name || dto.authorName || 'Agent';

    if (targetType === 'call') {
      const session = await this.prisma.callSession.findFirst({
        where: {
          OR: this.getCallSessionLookupFilter(id),
        },
      });
      if (!session) throw new NotFoundException('CallSession not found');

      const existingNotes = (session.liveNotes as any) || {};
      const history = Array.isArray(existingNotes.history) ? existingNotes.history : [];
      history.push({ text: dto.text, timestamp, author });

      await this.prisma.callSession.update({
        where: { id: session.id },
        data: {
          liveNotes: {
            current: dto.text,
            lastUpdated: timestamp,
            lastAuthor: author,
            history: history.slice(-20), // Keep last 20 revisions
          },
        },
      });
    } else if (targetType === 'lead') {
      const lead = await this.prisma.lead.findUnique({ where: { id } });
      if (!lead) throw new NotFoundException('Lead not found');

      const existingNotes = (lead.liveNotes as any) || {};
      const history = Array.isArray(existingNotes.history) ? existingNotes.history : [];
      history.push({ text: dto.text, timestamp, author });

      await this.prisma.lead.update({
        where: { id },
        data: {
          liveNotes: {
            current: dto.text,
            lastUpdated: timestamp,
            lastAuthor: author,
            history: history.slice(-20),
          },
        },
      });
    } else if (targetType === 'conversation') {
      const conv = await this.prisma.conversation.findUnique({ where: { id } });
      if (!conv) throw new NotFoundException('Conversation not found');

      const meta = (conv.intakeMetadata as any) || {};
      meta.liveNotes = {
        current: dto.text,
        lastUpdated: timestamp,
        lastAuthor: author,
      };

      await this.prisma.conversation.update({
        where: { id },
        data: { intakeMetadata: meta },
      });
    }

    return {
      success: true,
      savedAt: timestamp,
      author,
    };
  }

  // ==========================================
  // AMBULANCE EMERGENCY OVERRIDE
  // ==========================================
  async overrideEmergencyPriority(dto: OverrideEmergencyPriorityDto, user: any) {
    const isElevated = user && ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SENIOR_MANAGER'].includes(user.role);
    if (!isElevated) {
      throw new ForbiddenException('Only Administrators and Supervisors are authorized to override emergency priority.');
    }

    if (!dto.overrideReason || dto.overrideReason.trim().length < 5) {
      throw new BadRequestException('A descriptive override reason is required.');
    }

    let previousPriority: Priority = Priority.EMERGENCY;
    if (dto.conversationId) {
      const conv = await this.prisma.conversation.findUnique({ where: { id: dto.conversationId } });
      if (conv) previousPriority = conv.priority || Priority.NORMAL;
    } else if (dto.leadId) {
      const lead = await this.prisma.lead.findUnique({ where: { id: dto.leadId } });
      if (lead) previousPriority = lead.priority as any;
    }

    const audit = await this.prisma.emergencyOverrideAudit.create({
      data: {
        leadId: dto.leadId || null,
        conversationId: dto.conversationId || null,
        previousPriority,
        newPriority: dto.newPriority,
        overrideReason: dto.overrideReason,
        overriddenById: user?.id || user?.userId || 'admin',
        overriddenByRole: user?.role || 'SUPER_ADMIN',
      },
    });

    if (dto.conversationId) {
      await this.prisma.conversation.update({
        where: { id: dto.conversationId },
        data: { priority: dto.newPriority },
      });
    }

    if (dto.leadId) {
      const leadPriority: LeadPriority =
        dto.newPriority === Priority.EMERGENCY
          ? LeadPriority.EMERGENCY
          : dto.newPriority === Priority.HIGH
            ? LeadPriority.HIGH
            : LeadPriority.NORMAL;

      await this.prisma.lead.update({
        where: { id: dto.leadId },
        data: {
          priority: leadPriority,
          isAmbulanceEmergency: dto.newPriority === Priority.EMERGENCY,
          emergencyOverrideReason: dto.overrideReason,
        },
      });
    }

    return { success: true, audit };
  }

  // ==========================================
  // POSTAL CODE LOOKUP & DRAFT PERSISTENCE (PHASE 26)
  // ==========================================
  async lookupPostalCode(postalCode: string, country: string = 'IN') {
    if (!postalCode || postalCode.trim().length < 3) {
      return { success: false, message: 'Please enter a valid postal code' };
    }
    const cleanCode = postalCode.trim();
    const cleanCountry = (country || 'IN').toUpperCase();

    // 1. India Pincode lookup via India Post API
    if (cleanCountry === 'IN' || /^\d{6}$/.test(cleanCode)) {
      try {
        const response = await fetch(`https://api.postalpincode.in/pincode/${cleanCode}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && data[0]?.Status === 'Success' && data[0]?.PostOffice?.length > 0) {
            const po = data[0].PostOffice[0];
            return {
              success: true,
              postalCode: cleanCode,
              city: po.District || po.Division || po.Block || po.Name,
              state: po.State,
              country: 'India',
              countryCode: 'IN',
              postOffices: data[0].PostOffice.map((p: any) => p.Name),
            };
          }
        }
      } catch (err: any) {
        this.logger.warn(`Postal lookup error for ${cleanCode}: ${err.message}`);
      }
    }

    // 2. International lookup via Zippopotam
    try {
      const zippoCountry = cleanCountry.toLowerCase();
      const zippoRes = await fetch(`https://api.zippopotam.us/${zippoCountry}/${cleanCode}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (zippoRes.ok) {
        const zData = await zippoRes.json();
        const place = zData.places?.[0];
        if (place) {
          return {
            success: true,
            postalCode: cleanCode,
            city: place['place name'],
            state: place['state'] || place['state abbreviation'],
            country: zData.country || cleanCountry,
            countryCode: cleanCountry,
          };
        }
      }
    } catch (_) { }

    return {
      success: false,
      message: `No location match found for postal code ${cleanCode}. Please enter city and state manually.`,
    };
  }

  // ==========================================
  // WHATSAPP NUMBER REGISTRATION VERIFICATION (PHASE 26.1)
  // ==========================================
  async checkWhatsAppStatus(phoneNumber: string): Promise<{
    phone: string;
    normalizedPhone: string;
    status: 'VERIFIED' | 'NOT_REGISTERED' | 'PENDING' | 'UNKNOWN';
    provider?: string;
    verifiedAt?: Date | null;
    reason?: string;
  }> {
    const cleanPhone = this.normalizePhone(phoneNumber);
    if (!cleanPhone || cleanPhone.length < 8) {
      return {
        phone: phoneNumber,
        normalizedPhone: cleanPhone,
        status: 'UNKNOWN',
        reason: 'Invalid phone number format for WhatsApp check',
      };
    }

    const metaToken = process.env.WHATSAPP_TOKEN;
    const metaPhoneId = process.env.WHATSAPP_PHONE_ID;
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;

    // 1. Check with Meta WhatsApp Cloud API Contacts verification if configured
    if (metaToken && metaPhoneId) {
      try {
        const rawDigits = cleanPhone.replace(/[^0-9]/g, '');
        const res = await fetch(`https://graph.facebook.com/v21.0/${metaPhoneId}/contacts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${metaToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            blocking: 'wait',
            contacts: [rawDigits],
            force_check: true,
          }),
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = await res.json();
          const contact = data.contacts?.[0];
          if (contact?.status === 'valid') {
            return {
              phone: phoneNumber,
              normalizedPhone: cleanPhone,
              status: 'VERIFIED',
              provider: 'META_WHATSAPP_CLOUD',
              verifiedAt: new Date(),
            };
          } else if (contact?.status === 'invalid') {
            return {
              phone: phoneNumber,
              normalizedPhone: cleanPhone,
              status: 'NOT_REGISTERED',
              provider: 'META_WHATSAPP_CLOUD',
              verifiedAt: new Date(),
            };
          }
        }
      } catch (err: any) {
        this.logger.warn(`[WhatsApp Verification] Meta contacts API check failed: ${err.message}`);
      }
    }

    // 2. Check Twilio Lookup v2 if configured
    if (twilioSid && twilioAuth) {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64');
        const res = await fetch(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(cleanPhone)}?Fields=line_type_intelligence`, {
          headers: { 'Authorization': authHeader },
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.valid === false) {
            return {
              phone: phoneNumber,
              normalizedPhone: cleanPhone,
              status: 'NOT_REGISTERED',
              provider: 'TWILIO_LOOKUP',
              verifiedAt: new Date(),
            };
          } else if (data.valid === true) {
            // Number format is valid but WhatsApp existence requires provider confirmation
            return {
              phone: phoneNumber,
              normalizedPhone: cleanPhone,
              status: 'UNKNOWN',
              provider: 'TWILIO_LOOKUP',
              reason: 'Valid line but WhatsApp account existence requires Meta Cloud API confirmation',
            };
          }
        }
      } catch (err: any) {
        this.logger.warn(`[WhatsApp Verification] Twilio lookup failed: ${err.message}`);
      }
    }

    // Default when no provider is configured or provider call fails:
    // Strictly return UNKNOWN - never infer registration from number format alone
    return {
      phone: phoneNumber,
      normalizedPhone: cleanPhone,
      status: 'UNKNOWN',
      reason: 'No authorized WhatsApp provider capability configured or provider unavailable',
      verifiedAt: null,
    };
  }

  async saveCallDraft(callSidOrId: string, draftData: any, user?: any) {
    let session = await this.prisma.callSession.findFirst({
      where: {
        OR: this.getCallSessionLookupFilter(callSidOrId),
      },
    });
    const timestamp = new Date().toISOString();
    const draftPayload = {
      ...draftData,
      updatedAt: timestamp,
      savedBy: user?.name || user?.email || 'Agent',
      authorId: user?.id || user?.userId,
    };

    if (!session) {
      this.logger.log(`CallSession [${callSidOrId}] not found for draft. Provisioning pending draft session.`);
      const rawUserId = user?.id || user?.userId;
      const validUserId = this.isValidUuid(rawUserId) ? rawUserId : undefined;
      session = await this.prisma.callSession.create({
        data: {
          reason: callSidOrId,
          providerCallId: callSidOrId,
          livekitRoom: callSidOrId,
          status: 'IN_PROGRESS',
          callerUserId: validUserId,
          draftNotes: draftPayload,
        },
      });
      return { success: true, savedAt: timestamp, draft: draftPayload, draftData: draftPayload, provisioned: true };
    }

    await this.prisma.callSession.update({
      where: { id: session.id },
      data: { draftNotes: draftPayload },
    });
    return { success: true, savedAt: timestamp, draft: draftPayload, draftData: draftPayload };
  }

  async getCallDraft(callSidOrId: string) {
    const session = await this.prisma.callSession.findFirst({
      where: {
        OR: this.getCallSessionLookupFilter(callSidOrId),
      },
      select: {
        id: true,
        draftNotes: true,
        intakeForm: true,
        leadId: true,
        lead: true,
        customer: true,
      },
    });
    if (!session) {
      return {
        success: true,
        draft: null,
        draftData: null,
        lead: null,
        customer: null,
      };
    }
    const draftContent = session.draftNotes || session.intakeForm || null;
    return {
      success: true,
      draft: draftContent,
      draftData: draftContent,
      lead: session.lead,
      customer: session.customer,
    };
  }
}
