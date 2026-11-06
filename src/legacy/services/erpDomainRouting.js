/**
 * Service to dynamically route converted CRM Leads to their relevant ERP domain
 * and provision / update the exact ERP-structured records so they immediately surface in the ERP workspaces.
 *
 * Implements authoritative field mapping from CRM Lead intake to ERP Patient and Admission records.
 */

const crypto = require('crypto');

// Canonical Root Tenant ID used across ERP Operations Workspaces
const CANONICAL_ERP_TENANT_ID = 'd40f62e1-7b9f-40ad-9d79-1bc057d9be65';

/**
 * Maps CRM patient mobility strings to ERP Admission clinicalStatus enum values:
 * 'AMBULATORY' | 'ASSISTED' | 'WHEELCHAIR' | 'BEDRIDDEN'
 */
function mapMobilityToClinicalStatus(mobility) {
  if (!mobility) return 'AMBULATORY';
  const m = String(mobility).toLowerCase();
  if (m.includes('bedridden') || m.includes('bed')) return 'BEDRIDDEN';
  if (m.includes('wheelchair')) return 'WHEELCHAIR';
  if (m.includes('partial') || m.includes('assisted') || m.includes('cane') || m.includes('walker') || m.includes('assistance')) return 'ASSISTED';
  return 'AMBULATORY';
}

/**
 * Maps CRM priority to ERP Admission priority enum values:
 * 'NORMAL' | 'HIGH' | 'CRITICAL'
 */
function mapPriorityToAdmissionPriority(priority, isAmbulanceEmergency) {
  if (isAmbulanceEmergency) return 'CRITICAL';
  if (!priority) return 'NORMAL';
  const p = String(priority).toUpperCase();
  if (p.includes('EMERGENCY') || p.includes('CRITICAL')) return 'CRITICAL';
  if (p.includes('HIGH') || p.includes('URGENT')) return 'HIGH';
  return 'NORMAL';
}

/**
 * Resolves a health condition string for ERP Admission from lead clinical fields
 */
function resolveHealthCondition(lead) {
  if (lead.patientConditions && lead.patientConditions.trim()) {
    return lead.patientConditions.trim();
  }
  if (lead.serviceRequirement && lead.serviceRequirement.trim()) {
    return lead.serviceRequirement.trim();
  }
  if (lead.primaryService) {
    return lead.primaryService;
  }
  return 'STABLE';
}

async function provisionErpDomainRecords(prisma, lead, options = {}) {
  const { notes, targetUnitId, client } = options;
  // Always anchor to the authoritative Canonical ERP Tenant
  const targetTenantId = CANONICAL_ERP_TENANT_ID;

  const category = (lead.enquiryCategory || '').toUpperCase();
  const service = (lead.primaryService || '').toLowerCase();
  const leadName = lead.customerName || client?.name || 'Customer';
  const leadPhone = lead.phoneNumber || client?.mobile || '9999999999';
  const leadEmail = lead.email || client?.email || null;
  const leadAddress = lead.serviceAddress || lead.city || client?.address || null;

  const patientName = lead.patientName || leadName;
  const patientAge = lead.patientAge ? parseInt(lead.patientAge, 10) : 70;
  const clinicalStatus = mapMobilityToClinicalStatus(lead.patientMobility);
  const healthCondition = resolveHealthCondition(lead);
  const admissionPriority = mapPriorityToAdmissionPriority(lead.priority || lead.callbackPriority, lead.isAmbulanceEmergency);

  const domainResults = {
    domain: 'ENQUIRY_ONLY',
    recordsCreated: [],
    recordsUpdated: []
  };

  try {
    // --------------------------------------------------------------------------
    // 1. HUMAN RESOURCES & CAREERS (Candidate Recruitment)
    // --------------------------------------------------------------------------
    if (category === 'JOB_ENQUIRY' || service.includes('job') || service.includes('career') || (service.includes('nurse') && service.includes('job'))) {
      domainResults.domain = 'HR_RECRUITMENT';
      const serialNo = `CAN-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const candidate = await prisma.candidate.create({
        data: {
          id: crypto.randomUUID(),
          serialNo,
          name: leadName,
          mobileNo: leadPhone,
          preferredRole: lead.primaryService || 'Staff / Care Worker',
          stage: 'LEAD',
          details: {
            email: leadEmail,
            notes: notes || lead.notes,
            source: lead.source || 'CRM Lead Conversion',
            convertedFromLeadId: lead.id
          },
          tenantId: targetTenantId,
          unitId: targetUnitId,
          updatedAt: new Date()
        }
      });
      domainResults.recordsCreated.push({ type: 'Candidate', id: candidate.id, ref: candidate.serialNo });
    }

    // --------------------------------------------------------------------------
    // 2. DONORS & PHILANTHROPIC GIVING (UNCF Foundation)
    // --------------------------------------------------------------------------
    else if (category === 'DONOR_ENQUIRY' || service.includes('donor') || service.includes('donation') || service.includes('csr') || service.includes('sponsorship')) {
      domainResults.domain = 'DONORS_VOLUNTEERS';
      let donor = await prisma.donor.findFirst({
        where: { mobile: leadPhone, tenantId: targetTenantId }
      });
      if (!donor) {
        const donorNo = `DNR-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
        donor = await prisma.donor.create({
          data: {
            donorNo,
            name: leadName,
            mobile: leadPhone,
            email: leadEmail,
            residentialAddress: leadAddress,
            isCorporate: service.includes('csr') || service.includes('corporate'),
            tenantId: targetTenantId,
            unitId: targetUnitId
          }
        });
        domainResults.recordsCreated.push({ type: 'Donor', id: donor.id, ref: donor.donorNo });
      } else {
        domainResults.recordsUpdated.push({ type: 'Donor', id: donor.id, ref: donor.donorNo });
      }
    }

    // --------------------------------------------------------------------------
    // 3. AMBULANCE & EMERGENCY DISPATCH
    // --------------------------------------------------------------------------
    else if (lead.isAmbulanceEmergency || service.includes('ambulance') || service.includes('emergency')) {
      domainResults.domain = 'AMBULANCE';
      let ambUnitId = targetUnitId;
      if (!ambUnitId) {
        const ambUnit = await prisma.unit.findFirst({ where: { code: 'ACARE' } });
        ambUnitId = ambUnit?.id || (await prisma.unit.findFirst())?.id;
      }
      const refNo = `AMB-TRIP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const trip = await prisma.ambulanceTrip.create({
        data: {
          refNo,
          clientName: leadName,
          mobile: leadPhone,
          pickupLocation: leadAddress || lead.pickupLocation || 'Dispatch Pickup Address',
          destination: lead.destinationLocation || 'UEC Health Campus / Hospital',
          priority: lead.isAmbulanceEmergency ? 'EMERGENCY' : 'URGENT',
          status: 'REQUESTED',
          tripNotes: `Converted from CRM Lead ${lead.id}. ${notes || lead.notes || ''}`.trim(),
          tenant: { connect: { id: targetTenantId } },
          unit: { connect: { id: ambUnitId } }
        }
      });
      domainResults.recordsCreated.push({ type: 'AmbulanceTrip', id: trip.id, ref: trip.refNo });
    }

    // --------------------------------------------------------------------------
    // 4. HOME CARE & IN-HOME SERVICES (Service Contracts / Home Visits)
    // --------------------------------------------------------------------------
    else if (service.includes('in-home') || service.includes('home care') || service.includes('visiting') || category === 'HOME_CARE') {
      domainResults.domain = 'HOME_CARE';
      let patient = await prisma.patient.findFirst({
        where: {
          OR: [
            { phone: leadPhone },
            { emergencyContact: leadPhone }
          ],
          tenantId: targetTenantId
        }
      });

      if (!patient) {
        const elderId = `HC-ELD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
        patient = await prisma.patient.create({
          data: {
            elderId,
            name: patientName,
            age: patientAge,
            gender: 'Other',
            phone: leadPhone,
            emergencyContact: leadPhone,
            primaryContact: `${leadName} (Primary Contact)`,
            email: leadEmail,
            address: leadAddress,
            tenantId: targetTenantId,
            unitId: targetUnitId
          }
        });
        domainResults.recordsCreated.push({ type: 'Patient', id: patient.id, elderId: patient.elderId });
      } else {
        patient = await prisma.patient.update({
          where: { id: patient.id },
          data: {
            name: patientName,
            age: patientAge,
            primaryContact: `${leadName} (Primary Contact)`,
            email: leadEmail || patient.email,
            address: leadAddress || patient.address,
            unitId: targetUnitId || patient.unitId
          }
        });
        domainResults.recordsUpdated.push({ type: 'Patient', id: patient.id, elderId: patient.elderId });
      }

      let admission = await prisma.admission.findFirst({
        where: { patientId: patient.id, tenantId: targetTenantId }
      });

      if (!admission) {
        admission = await prisma.admission.create({
          data: {
            patientId: patient.id,
            tenantId: targetTenantId,
            unitId: targetUnitId,
            status: 'ACTIVE',
            admissionPriority,
            healthCondition,
            clinicalStatus,
            floor: 'Home Care',
            room: 'Home Residence',
            bed: 'Residence Bed',
            admittedAt: new Date()
          }
        });
        domainResults.recordsCreated.push({ type: 'Admission', id: admission.id, patient: patient.name });
      } else {
        admission = await prisma.admission.update({
          where: { id: admission.id },
          data: {
            healthCondition,
            clinicalStatus,
            admissionPriority,
            status: 'ACTIVE',
            unitId: targetUnitId || admission.unitId,
            updatedAt: new Date()
          }
        });
        domainResults.recordsUpdated.push({ type: 'Admission', id: admission.id, patient: patient.name });
      }

      // Provision or update Service Contract for Home Care
      const existingContract = await prisma.serviceContract.findFirst({
        where: { admissionId: admission.id }
      });
      if (!existingContract) {
        const contractNumber = `HC-CON-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
        const contract = await prisma.serviceContract.create({
          data: {
            contractNumber,
            admissionId: admission.id,
            tenantId: targetTenantId,
            unitId: targetUnitId,
            startDate: new Date(),
            status: 'ACTIVE',
            specialInstructions: notes || lead.notes || `Schedule: ${lead.careSchedule || 'Daily'}. Duration: ${lead.careDuration || 'Ongoing'}. Conditions: ${lead.patientConditions || 'Standard Care'}`,
            servicePrice: 15000.0,
            billingCycle: 'MONTHLY'
          }
        });
        domainResults.recordsCreated.push({ type: 'ServiceContract', id: contract.id, ref: contract.contractNumber });
      } else {
        await prisma.serviceContract.update({
          where: { id: existingContract.id },
          data: {
            specialInstructions: notes || lead.notes || existingContract.specialInstructions,
            status: 'ACTIVE'
          }
        });
        domainResults.recordsUpdated.push({ type: 'ServiceContract', id: existingContract.id, ref: existingContract.contractNumber });
      }
    }

    // --------------------------------------------------------------------------
    // 5. RESIDENTIAL & INPATIENT CARE (Assisted Living, Memory Care, UEC Nursing)
    // --------------------------------------------------------------------------
    else if (
      category === 'SERVICE_ENQUIRY' ||
      service.includes('assisted') ||
      service.includes('nursing') ||
      service.includes('dementia') ||
      service.includes('alzheimer') ||
      service.includes('palliative') ||
      service.includes('geriatric') ||
      service.includes('residential') ||
      service.includes('bedridden') ||
      service.includes('post-op') ||
      service.includes('elderly')
    ) {
      domainResults.domain = 'ADMISSIONS_REGISTER';
      let patient = await prisma.patient.findFirst({
        where: {
          OR: [
            { phone: leadPhone },
            { emergencyContact: leadPhone }
          ],
          tenantId: targetTenantId
        }
      });

      if (!patient) {
        const elderId = `UEC-ELD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
        patient = await prisma.patient.create({
          data: {
            elderId,
            name: patientName,
            age: patientAge,
            gender: 'Male',
            bloodGroup: 'O+',
            primaryContact: `${leadName} (Primary Contact)`,
            emergencyContact: leadPhone,
            phone: leadPhone,
            email: leadEmail,
            address: leadAddress,
            tenantId: targetTenantId,
            unitId: targetUnitId
          }
        });
        domainResults.recordsCreated.push({ type: 'Patient', id: patient.id, elderId: patient.elderId });
      } else {
        patient = await prisma.patient.update({
          where: { id: patient.id },
          data: {
            name: patientName,
            age: patientAge,
            primaryContact: `${leadName} (Primary Contact)`,
            email: leadEmail || patient.email,
            address: leadAddress || patient.address,
            unitId: targetUnitId || patient.unitId
          }
        });
        domainResults.recordsUpdated.push({ type: 'Patient', id: patient.id, elderId: patient.elderId });
      }

      // Check if admission exists for patient or enquiry
      let admission = await prisma.admission.findFirst({
        where: {
          OR: [
            { patientId: patient.id },
            ...(lead.canonicalEnquiry?.id ? [{ enquiryId: lead.canonicalEnquiry.id }] : [])
          ],
          tenantId: targetTenantId
        }
      });

      if (!admission) {
        admission = await prisma.admission.create({
          data: {
            patientId: patient.id,
            tenantId: targetTenantId,
            unitId: targetUnitId,
            status: 'ACTIVE',
            admissionPriority,
            healthCondition,
            clinicalStatus,
            floor: 'Floor 1',
            room: 'Assisted Care Suite',
            bed: 'Bed 1',
            admittedAt: new Date()
          }
        });
        domainResults.recordsCreated.push({ type: 'Admission', id: admission.id, patient: patient.name });
      } else {
        admission = await prisma.admission.update({
          where: { id: admission.id },
          data: {
            patientId: patient.id,
            healthCondition,
            clinicalStatus,
            admissionPriority,
            status: 'ACTIVE',
            unitId: targetUnitId || admission.unitId,
            updatedAt: new Date()
          }
        });
        domainResults.recordsUpdated.push({ type: 'Admission', id: admission.id, patient: patient.name });
      }
    }

    // --------------------------------------------------------------------------
    // 6. COMPLAINTS & FEEDBACK (Customer Care Operations)
    // --------------------------------------------------------------------------
    else if (category === 'COMPLAINT_OR_SUPPORT' || service.includes('complaint') || service.includes('support')) {
      domainResults.domain = 'CUSTOMER_CARE_COMPLAINTS';
      const refNo = `CMP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const complaint = await prisma.complaint.create({
        data: {
          refNo,
          title: `CRM Support Intake: ${leadName}`,
          description: notes || lead.notes || 'Customer care complaint / grievance intake from CRM.',
          status: 'OPEN',
          priority: 'HIGH',
          channel: 'CRM_CONVERSION',
          tenantId: targetTenantId,
          unitId: targetUnitId
        }
      });
      domainResults.recordsCreated.push({ type: 'Complaint', id: complaint.id, ref: complaint.refNo });
    }

    return domainResults;
  } catch (err) {
    console.error('[DOMAIN-PROVISION-ERROR]', err);
    return { domain: 'ERROR', error: err.message, recordsCreated: [], recordsUpdated: [] };
  }
}

module.exports = {
  provisionErpDomainRecords,
  mapMobilityToClinicalStatus,
  mapPriorityToAdmissionPriority,
  resolveHealthCondition,
  CANONICAL_ERP_TENANT_ID
};
