import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

export interface LeadConversionResult {
  success: boolean;
  enquiry?: any;
  lead?: any;
  domainResults?: any;
  alreadyConverted?: boolean;
  message?: string;
}

const CANONICAL_ERP_TENANT_ID = 'd40f62e1-7b9f-40ad-9d79-1bc057d9be65';

function mapMobilityToClinicalStatus(mobility?: string | null): string {
  if (!mobility) return 'AMBULATORY';
  const m = String(mobility).toLowerCase();
  if (m.includes('bedridden') || m.includes('bed')) return 'BEDRIDDEN';
  if (m.includes('wheelchair')) return 'WHEELCHAIR';
  if (m.includes('partial') || m.includes('assisted') || m.includes('cane') || m.includes('walker') || m.includes('assistance')) return 'ASSISTED';
  return 'AMBULATORY';
}

function mapPriorityToAdmissionPriority(priority?: string | null, isAmbulanceEmergency?: boolean): string {
  if (isAmbulanceEmergency) return 'CRITICAL';
  if (!priority) return 'NORMAL';
  const p = String(priority).toUpperCase();
  if (p.includes('EMERGENCY') || p.includes('CRITICAL')) return 'CRITICAL';
  if (p.includes('HIGH') || p.includes('URGENT')) return 'HIGH';
  return 'NORMAL';
}

function resolveHealthCondition(lead: any): string {
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

@Injectable()
export class CrmErpConversionService {
  private readonly logger = new Logger(CrmErpConversionService.name);

  private readonly categoryDepartmentMap: Record<string, string> = {
    ELDERLY_CARE: 'Care Operations',
    SERVICE_ENQUIRY: 'Care Operations',
    JOB_ENQUIRY: 'Human Resources',
    CAREERS: 'Human Resources',
    DONOR_ENQUIRY: 'Philanthropy & Outreach',
    DONATIONS: 'Philanthropy & Outreach',
    VOLUNTEER_ENQUIRY: 'Philanthropy & Outreach',
    AMBULANCE_EMERGENCY: 'Ambulance Dispatch',
    AMBULANCE: 'Ambulance Dispatch',
    IN_HOME: 'Home Care Services',
    HOME_CARE: 'Home Care Services',
    COMPLAINT_OR_SUPPORT: 'Customer Support',
  };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotently converts a CRM Lead into an ERP Enquiry linked 1-to-1 via Enquiry.crmLeadId.
   */
  async convertLeadToErpEnquiry(
    leadId: string,
    notes?: string,
    agentId?: string,
    sentiment = 'POSITIVE',
  ): Promise<LeadConversionResult> {
    this.logger.log(`[CONVERSION] Processing CRM Lead -> ERP Enquiry conversion for leadId=${leadId}`);

    // 1. Fetch Lead
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        unit: true,
        canonicalEnquiry: true,
      },
    });

    if (!lead) {
      throw new NotFoundException(`CRM Lead with id=${leadId} not found.`);
    }

    // 2. Check Idempotency: Has this lead already been converted to an ERP Enquiry?
    const existingEnquiry = await this.prisma.enquiry.findUnique({
      where: { crmLeadId: leadId },
      include: {
        client: true,
        crmLead: true,
      },
    });

    if (existingEnquiry) {
      this.logger.log(
        `[CONVERSION-IDEMPOTENT] Lead ${leadId} is already converted to ERP Enquiry ${existingEnquiry.refNo} (id=${existingEnquiry.id}). Syncing domain records.`,
      );

      if (lead.status !== 'CONVERTED') {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { status: 'CONVERTED' },
        });
      }

      const domainResults = await this.provisionDepartmentRecord(lead, {
        notes,
        targetUnitId: lead.unitId || existingEnquiry.unitId || '',
        targetTenantId: CANONICAL_ERP_TENANT_ID,
        client: existingEnquiry.client,
      });

      return {
        success: true,
        enquiry: existingEnquiry,
        lead,
        domainResults,
        alreadyConverted: true,
        message: `Lead was already converted into Enquiry ${existingEnquiry.refNo}. Domain records refreshed.`,
      };
    }

    // 3. Resolve Business Unit
    let targetUnitId = lead.unitId;
    if (!targetUnitId && lead.foundation) {
      const unit = await this.prisma.unit.findFirst({
        where: {
          code: {
            equals: lead.foundation.toUpperCase(),
            mode: 'insensitive',
          },
        },
      });
      if (unit) targetUnitId = unit.id;
    }

    if (!targetUnitId) {
      const defaultUnit = await this.prisma.unit.findFirst();
      targetUnitId = defaultUnit?.id || null;
    }

    // 4. Resolve Canonical Tenant
    const targetTenantId = CANONICAL_ERP_TENANT_ID;

    // 5. Create or Find ERP Client record
    let clientRecord: any = null;
    if (lead.phoneNumber) {
      clientRecord = await this.prisma.client.findFirst({
        where: {
          mobile: lead.phoneNumber,
          tenantId: targetTenantId,
        },
      });
    }

    if (!clientRecord && lead.email) {
      clientRecord = await this.prisma.client.findFirst({
        where: {
          email: lead.email,
          tenantId: targetTenantId,
        },
      });
    }

    if (!clientRecord) {
      const clientRefNo = `CLI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      clientRecord = await this.prisma.client.create({
        data: {
          refNo: clientRefNo,
          name: lead.customerName || 'CRM Customer',
          mobile: lead.phoneNumber || '9999999999',
          email: lead.email || null,
          address: lead.serviceAddress || lead.city || null,
          tenantId: targetTenantId,
          unitId: targetUnitId as any,
        },
      });
      this.logger.log(`[CONVERSION] Created new ERP Client ${clientRecord.refNo} (id=${clientRecord.id})`);
    }

    // 6. Generate Canonical ERP Enquiry RefNo
    const enqRefNo = `ENQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // 7. Resolve Requirements & Category Description
    const serviceRequirements = [
      lead.primaryService ? `Service: ${lead.primaryService}` : null,
      lead.patientName ? `Patient: ${lead.patientName} (Age: ${lead.patientAge || 'N/A'})` : null,
      lead.careDurationCategory ? `Duration: ${lead.careDurationCategory}` : null,
      notes ? `Conversion Notes: ${notes}` : null,
    ].filter(Boolean).join(' | ');

    // 8. Atomic Database Transaction: Create Enquiry + Update Lead status + Log Activity
    const result = await this.prisma.$transaction(async (tx) => {
      const enquiry = await tx.enquiry.create({
        data: {
          refNo: enqRefNo,
          clientId: clientRecord.id,
          description: lead.notes || serviceRequirements || 'Converted from CRM Lead',
          status: 'NEW',
          isConverted: true,
          convertedAt: new Date(),
          serviceRequirements,
          summary: `Converted by CRM Agent: ${lead.customerName} - ${lead.phoneNumber}`,
          tenantId: targetTenantId,
          unitId: targetUnitId as any,
          crmLeadId: lead.id,
        },
        include: {
          client: true,
          crmLead: true,
        },
      });

      const updatedLead = await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: 'CONVERTED',
          sentiment: sentiment || 'POSITIVE',
          conversionScore: 90,
          clientId: clientRecord.id,
          tenantId: targetTenantId,
        },
      });

      await tx.leadConversionLog.create({
        data: {
          leadId: lead.id,
          agentId: agentId || null,
          oldStatus: lead.status,
          newStatus: 'CONVERTED',
          notes: notes || 'Automated ERP Enquiry Conversion',
        },
      });

      return { enquiry, updatedLead };
    });

    // 9. Department-Specific ERP Provisioning
    let domainResults: any = null;
    try {
      domainResults = await this.provisionDepartmentRecord(lead, {
        notes,
        targetUnitId: targetUnitId || '',
        targetTenantId,
        client: clientRecord,
      });
    } catch (deptErr: any) {
      this.logger.error(`[DEPT-PROVISION-ERROR] Failed to provision ERP department domain record: ${deptErr.message}`);
    }

    this.logger.log(
      `[CONVERSION-SUCCESS] CRM Lead ${leadId} successfully converted into canonical ERP Enquiry ${result.enquiry.refNo} (id=${result.enquiry.id})`,
    );

    return {
      success: true,
      enquiry: result.enquiry,
      lead: result.updatedLead,
      domainResults,
      alreadyConverted: false,
      message: `Enquiry ${result.enquiry.refNo} generated successfully.`,
    };
  }

  /**
   * Automatically provisions or updates domain-specific ERP records (Admissions, Candidates, Donors, Ambulance Trips, Home Care Contracts)
   * so they appear directly in the relevant ERP workspace registers.
   */
  async provisionDepartmentRecord(lead: any, options: { notes?: string; targetUnitId: string; targetTenantId: string; client: any }): Promise<any> {
    const { notes, targetUnitId, client } = options;
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
      recordsCreated: [] as any[],
      recordsUpdated: [] as any[],
    };

    // 1. HR & RECRUITMENT
    if (category === 'JOB_ENQUIRY' || service.includes('job') || service.includes('career') || (service.includes('nurse') && service.includes('job'))) {
      domainResults.domain = 'HR_RECRUITMENT';
      const serialNo = `CAN-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const candidate = await (this.prisma as any).candidate.create({
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
            convertedFromLeadId: lead.id,
          },
          tenantId: targetTenantId,
          unitId: targetUnitId,
          updatedAt: new Date(),
        },
      });
      domainResults.recordsCreated.push({ type: 'Candidate', id: candidate.id, ref: candidate.serialNo });
      this.logger.log(`[DEPT-PROVISION] Created ERP Candidate ${serialNo} for ${leadName}`);
    }

    // 2. DONORS & VOLUNTEERS
    else if (category === 'DONOR_ENQUIRY' || service.includes('donor') || service.includes('donation') || service.includes('csr') || service.includes('sponsorship')) {
      domainResults.domain = 'DONORS_VOLUNTEERS';
      let donor = await (this.prisma as any).donor.findFirst({
        where: { mobile: leadPhone, tenantId: targetTenantId },
      });
      if (!donor) {
        const donorNo = `DNR-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
        donor = await (this.prisma as any).donor.create({
          data: {
            donorNo,
            name: leadName,
            mobile: leadPhone,
            email: leadEmail,
            residentialAddress: leadAddress,
            isCorporate: service.includes('csr') || service.includes('corporate'),
            tenantId: targetTenantId,
            unitId: targetUnitId,
          },
        });
        domainResults.recordsCreated.push({ type: 'Donor', id: donor.id, ref: donor.donorNo });
        this.logger.log(`[DEPT-PROVISION] Created ERP Donor ${donorNo} for ${leadName}`);
      } else {
        domainResults.recordsUpdated.push({ type: 'Donor', id: donor.id, ref: donor.donorNo });
      }
    }

    // 3. AMBULANCE & EMERGENCY
    else if (lead.isAmbulanceEmergency || service.includes('ambulance') || service.includes('emergency')) {
      domainResults.domain = 'AMBULANCE';
      const refNo = `AMB-TRIP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const trip = await (this.prisma as any).ambulanceTrip.create({
        data: {
          refNo,
          clientName: leadName,
          mobile: leadPhone,
          pickupLocation: leadAddress || lead.pickupLocation || 'Dispatch Pickup Address',
          destination: lead.destinationLocation || 'UEC Health Campus / Hospital',
          priority: lead.isAmbulanceEmergency ? 'EMERGENCY' : 'URGENT',
          status: 'REQUESTED',
          tripNotes: `Converted from CRM Lead ${lead.id}. ${notes || lead.notes || ''}`.trim(),
          tenantId: targetTenantId,
          unitId: targetUnitId,
        },
      });
      domainResults.recordsCreated.push({ type: 'AmbulanceTrip', id: trip.id, ref: trip.refNo });
      this.logger.log(`[DEPT-PROVISION] Created ERP Ambulance Trip ${refNo} for ${leadName}`);
    }

    // 4. HOME CARE
    else if (service.includes('in-home') || service.includes('home care') || service.includes('visiting') || category === 'HOME_CARE') {
      domainResults.domain = 'HOME_CARE';
      let patient = await (this.prisma as any).patient.findFirst({
        where: {
          OR: [{ phone: leadPhone }, { emergencyContact: leadPhone }],
          tenantId: targetTenantId,
        },
      });

      if (!patient) {
        const elderId = `HC-ELD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
        patient = await (this.prisma as any).patient.create({
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
            unitId: targetUnitId,
          },
        });
        domainResults.recordsCreated.push({ type: 'Patient', id: patient.id, elderId: patient.elderId });
      } else {
        patient = await (this.prisma as any).patient.update({
          where: { id: patient.id },
          data: {
            name: patientName,
            age: patientAge,
            primaryContact: `${leadName} (Primary Contact)`,
            email: leadEmail || patient.email,
            address: leadAddress || patient.address,
            unitId: targetUnitId || patient.unitId,
          },
        });
        domainResults.recordsUpdated.push({ type: 'Patient', id: patient.id, elderId: patient.elderId });
      }

      let admission = await (this.prisma as any).admission.findFirst({
        where: { patientId: patient.id, tenantId: targetTenantId },
      });

      if (!admission) {
        admission = await (this.prisma as any).admission.create({
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
            admittedAt: new Date(),
          },
        });
        domainResults.recordsCreated.push({ type: 'Admission', id: admission.id, patient: patient.name });
      } else {
        admission = await (this.prisma as any).admission.update({
          where: { id: admission.id },
          data: {
            healthCondition,
            clinicalStatus,
            admissionPriority,
            status: 'ACTIVE',
            unitId: targetUnitId || admission.unitId,
            updatedAt: new Date(),
          },
        });
        domainResults.recordsUpdated.push({ type: 'Admission', id: admission.id, patient: patient.name });
      }

      const existingContract = await (this.prisma as any).serviceContract.findFirst({
        where: { admissionId: admission.id },
      });
      if (!existingContract) {
        const contractNumber = `HC-CON-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
        await (this.prisma as any).serviceContract.create({
          data: {
            contractNumber,
            admissionId: admission.id,
            tenantId: targetTenantId,
            unitId: targetUnitId,
            startDate: new Date(),
            status: 'ACTIVE',
            specialInstructions: notes || lead.notes || `Schedule: ${lead.careSchedule || 'Daily'}. Duration: ${lead.careDuration || 'Ongoing'}. Conditions: ${lead.patientConditions || 'Standard Care'}`,
            servicePrice: 15000.0,
            billingCycle: 'MONTHLY',
          },
        });
        this.logger.log(`[DEPT-PROVISION] Created Home Care Admission & Contract ${contractNumber} for ${leadName}`);
      }
    }

    // 5. RESIDENTIAL & INPATIENT CARE
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
      let patient = await (this.prisma as any).patient.findFirst({
        where: {
          OR: [{ phone: leadPhone }, { emergencyContact: leadPhone }],
          tenantId: targetTenantId,
        },
      });

      if (!patient) {
        const elderId = `UEC-ELD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
        patient = await (this.prisma as any).patient.create({
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
            unitId: targetUnitId,
          },
        });
        domainResults.recordsCreated.push({ type: 'Patient', id: patient.id, elderId: patient.elderId });
      } else {
        patient = await (this.prisma as any).patient.update({
          where: { id: patient.id },
          data: {
            name: patientName,
            age: patientAge,
            primaryContact: `${leadName} (Primary Contact)`,
            email: leadEmail || patient.email,
            address: leadAddress || patient.address,
            unitId: targetUnitId || patient.unitId,
          },
        });
        domainResults.recordsUpdated.push({ type: 'Patient', id: patient.id, elderId: patient.elderId });
      }

      let admission = await (this.prisma as any).admission.findFirst({
        where: {
          OR: [
            { patientId: patient.id },
            ...(lead.canonicalEnquiry?.id ? [{ enquiryId: lead.canonicalEnquiry.id }] : []),
          ],
          tenantId: targetTenantId,
        },
      });

      if (!admission) {
        admission = await (this.prisma as any).admission.create({
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
            admittedAt: new Date(),
          },
        });
        domainResults.recordsCreated.push({ type: 'Admission', id: admission.id, patient: patient.name });
        this.logger.log(`[DEPT-PROVISION] Created Inpatient Admission for ${leadName} (Elder ID: ${patient.elderId})`);
      } else {
        admission = await (this.prisma as any).admission.update({
          where: { id: admission.id },
          data: {
            patientId: patient.id,
            healthCondition,
            clinicalStatus,
            admissionPriority,
            status: 'ACTIVE',
            unitId: targetUnitId || admission.unitId,
            updatedAt: new Date(),
          },
        });
        domainResults.recordsUpdated.push({ type: 'Admission', id: admission.id, patient: patient.name });
        this.logger.log(`[DEPT-PROVISION] Updated Inpatient Admission for ${leadName} (Elder ID: ${patient.elderId})`);
      }
    }

    // 6. COMPLAINTS & FEEDBACK
    else if (category === 'COMPLAINT_OR_SUPPORT' || service.includes('complaint') || service.includes('support')) {
      domainResults.domain = 'CUSTOMER_CARE_COMPLAINTS';
      const refNo = `CMP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const complaint = await (this.prisma as any).complaint.create({
        data: {
          refNo,
          title: `CRM Support Intake: ${leadName}`,
          description: notes || lead.notes || 'Customer care complaint / grievance intake from CRM.',
          status: 'OPEN',
          priority: 'HIGH',
          channel: 'CRM_CONVERSION',
          tenantId: targetTenantId,
          unitId: targetUnitId,
        },
      });
      domainResults.recordsCreated.push({ type: 'Complaint', id: complaint.id, ref: complaint.refNo });
      this.logger.log(`[DEPT-PROVISION] Created ERP Complaint ${refNo} for ${leadName}`);
    }

    return domainResults;
  }
}
