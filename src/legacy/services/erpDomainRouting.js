/**
 * Service to dynamically route converted CRM Leads to their relevant ERP domain
 * and provision the exact ERP-structured records so they immediately surface in the ERP workspaces.
 */

const crypto = require('crypto');

async function provisionErpDomainRecords(prisma, lead, options = {}) {
  const { notes, targetUnitId, targetTenantId, client } = options;
  const category = (lead.enquiryCategory || '').toUpperCase();
  const service = (lead.primaryService || '').toLowerCase();
  const leadName = lead.customerName || client?.name || 'Customer';
  const leadPhone = lead.phoneNumber || client?.mobile || '9999999999';
  const leadEmail = lead.email || client?.email || null;
  const leadAddress = lead.serviceAddress || lead.city || client?.address || null;

  const domainResults = {
    domain: 'ENQUIRY_ONLY',
    recordsCreated: []
  };

  try {
    // --------------------------------------------------------------------------
    // 1. HUMAN RESOURCES & CAREERS (Candidate Recruitment)
    // --------------------------------------------------------------------------
    if (category === 'JOB_ENQUIRY' || service.includes('job') || service.includes('career') || service.includes('nurse') && service.includes('job')) {
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
      }
      domainResults.recordsCreated.push({ type: 'Donor', id: donor.id, ref: donor.donorNo });
    }

    // --------------------------------------------------------------------------
    // 3. AMBULANCE & EMERGENCY DISPATCH
    // --------------------------------------------------------------------------
    else if (lead.isAmbulanceEmergency || service.includes('ambulance') || service.includes('emergency')) {
      domainResults.domain = 'AMBULANCE';
      const refNo = `AMB-TRIP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const trip = await prisma.ambulanceTrip.create({
        data: {
          refNo,
          clientName: leadName,
          mobile: leadPhone,
          pickupLocation: leadAddress || 'Dispatch Pickup Address',
          destination: 'UEC Health Campus / Hospital',
          priority: lead.isAmbulanceEmergency ? 'EMERGENCY' : 'URGENT',
          status: 'REQUESTED',
          tripNotes: `Converted from CRM Lead ${lead.id}. ${notes || lead.notes || ''}`.trim(),
          tenantId: targetTenantId,
          unitId: targetUnitId
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
        where: { phone: leadPhone, tenantId: targetTenantId }
      });
      if (!patient) {
        const elderId = `HC-ELD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
        patient = await prisma.patient.create({
          data: {
            elderId,
            name: lead.patientName || leadName,
            age: lead.patientAge ? parseInt(lead.patientAge, 10) : 65,
            gender: 'Other',
            phone: leadPhone,
            address: leadAddress,
            tenantId: targetTenantId,
            unitId: targetUnitId
          }
        });
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
            admissionPriority: 'NORMAL',
            healthCondition: 'STABLE',
            clinicalStatus: 'AMBULATORY',
            floor: 'Home Care',
            room: 'Home Residence',
            bed: 'Residence Bed',
            admittedAt: new Date()
          }
        });
      }

      // Provision Service Contract for Home Care
      const contractNumber = `HC-CON-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const existingContract = await prisma.serviceContract.findFirst({
        where: { admissionId: admission.id }
      });
      if (!existingContract) {
        const contract = await prisma.serviceContract.create({
          data: {
            contractNumber,
            admissionId: admission.id,
            tenantId: targetTenantId,
            unitId: targetUnitId,
            startDate: new Date(),
            status: 'ACTIVE',
            specialInstructions: notes || lead.notes || 'Home Care Service Contract provisioned via CRM Lead Conversion',
            servicePrice: 15000.0,
            billingCycle: 'MONTHLY'
          }
        });
        domainResults.recordsCreated.push({ type: 'ServiceContract', id: contract.id, ref: contract.contractNumber });
      }
      domainResults.recordsCreated.push({ type: 'Admission', id: admission.id, patient: patient.name });
    }

    // --------------------------------------------------------------------------
    // 5. RESIDENTIAL & INPATIENT CARE (Assisted Living, Memory Care, etc.)
    // --------------------------------------------------------------------------
    else if (
      category === 'SERVICE_ENQUIRY' ||
      service.includes('assisted') ||
      service.includes('dementia') ||
      service.includes('alzheimer') ||
      service.includes('palliative') ||
      service.includes('geriatric') ||
      service.includes('residential') ||
      service.includes('bedridden') ||
      service.includes('post-op')
    ) {
      domainResults.domain = 'ADMISSIONS_REGISTER';
      let patient = await prisma.patient.findFirst({
        where: { phone: leadPhone, tenantId: targetTenantId }
      });
      if (!patient) {
        const elderId = `UEC-ELD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
        patient = await prisma.patient.create({
          data: {
            elderId,
            name: lead.patientName || leadName,
            age: lead.patientAge ? parseInt(lead.patientAge, 10) : 70,
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
            admissionPriority: 'NORMAL',
            healthCondition: 'STABLE',
            clinicalStatus: 'AMBULATORY',
            floor: 'Floor 1',
            room: 'Assisted Care Suite',
            bed: 'Bed 1',
            admittedAt: new Date()
          }
        });
      }
      domainResults.recordsCreated.push({ type: 'Admission', id: admission.id, patient: patient.name });
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
    return { domain: 'ERROR', error: err.message, recordsCreated: [] };
  }
}

module.exports = { provisionErpDomainRecords };
