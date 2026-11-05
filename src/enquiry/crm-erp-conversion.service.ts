import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LeadConversionResult {
  success: boolean;
  enquiry?: any;
  lead?: any;
  alreadyConverted?: boolean;
  message?: string;
}

@Injectable()
export class CrmErpConversionService {
  private readonly logger = new Logger(CrmErpConversionService.name);

  // Mapping from CRM Category & Service to ERP Department Code / Name
  private readonly categoryDepartmentMap: Record<string, string> = {
    ELDERLY_CARE: 'Care Operations',
    SERVICE_ENQUIRY: 'Care Operations',
    CARE_SERVICES: 'Care Operations',
    MEDICAL_CARE: 'Medical Services',
    HEALTHCARE: 'Medical Services',
    NURSING: 'Nursing Services',
    IN_HOME_CARE: 'In-Home Care',
    HOME_CARE: 'In-Home Care',
    AMBULANCE: 'Emergency Dispatch',
    JOB_ENQUIRY: 'Human Resources',
    CAREERS: 'Human Resources',
    DONOR_ENQUIRY: 'Donor Relations',
    VOLUNTEER_ENQUIRY: 'Community Engagement',
    GENERAL_ADMIN: 'General Administration',
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
    });

    if (!lead) {
      throw new Error(`Lead with ID ${leadId} not found.`);
    }

    // 2. Strict Idempotency Check: Query existing Enquiry linked by crmLeadId
    const existingEnquiry = await this.prisma.enquiry.findUnique({
      where: { crmLeadId: leadId },
      include: { client: true },
    });

    if (existingEnquiry) {
      this.logger.log(
        `[CONVERSION-IDEMPOTENT] Lead ${leadId} is already converted to ERP Enquiry ${existingEnquiry.refNo} (id=${existingEnquiry.id}). Returning existing record.`,
      );

      // Ensure lead status is also aligned
      if (lead.status !== 'CONVERTED') {
        await this.prisma.lead.update({
          where: { id: leadId },
          data: { status: 'CONVERTED' },
        });
      }

      return {
        success: true,
        enquiry: existingEnquiry,
        lead,
        alreadyConverted: true,
        message: 'Lead was previously converted to ERP Enquiry.',
      };
    }

    // 3. Resolve Destination Business Unit (mandatory string in schema)
    let targetUnitId = lead.unitId;
    if (!targetUnitId) {
      const defaultUnit = await this.prisma.unit.findFirst({
        where: { code: 'UEC', isDeleted: false },
      });
      const fallbackUnit = defaultUnit || (await this.prisma.unit.findFirst());
      targetUnitId = fallbackUnit?.id || '8497e089-ecd8-4b94-8f76-4ce8cd386a1e';
    }

    // 4. Resolve Tenant (mandatory string in schema)
    let targetTenantId = lead.tenantId;
    if (!targetTenantId) {
      const defaultTenant = await this.prisma.tenant.findFirst();
      targetTenantId = defaultTenant?.id || 'd40f62e1-7b9f-40ad-9d79-1bc057d9be65';
    }

    // 5. Resolve Client (find existing or create)
    let clientRecord = null;
    if (lead.phoneNumber) {
      clientRecord = await this.prisma.client.findFirst({
        where: {
          mobile: lead.phoneNumber,
          unitId: targetUnitId,
        },
      });
    }

    if (!clientRecord && lead.email) {
      clientRecord = await this.prisma.client.findFirst({
        where: {
          email: lead.email,
          unitId: targetUnitId,
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
          unitId: targetUnitId,
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
      // Create Enquiry with crmLeadId
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
          unitId: targetUnitId,
          crmLeadId: lead.id,
        },
        include: {
          client: true,
          crmLead: true,
        },
      });

      // Update Lead to CONVERTED
      const updatedLead = await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: 'CONVERTED',
          sentiment: sentiment || 'POSITIVE',
          conversionScore: 90,
          clientId: clientRecord.id,
        },
      });

      // Log Conversion in LeadConversionLog
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
    try {
      await this.provisionDepartmentRecord(lead, {
        notes,
        targetUnitId,
        targetTenantId,
        client: clientRecord
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
      alreadyConverted: false,
      message: `Enquiry ${result.enquiry.refNo} generated successfully.`,
    };
  }

  /**
   * Automatically provisions domain-specific ERP records (Admissions, Candidates, Donors, Ambulance Trips, Home Care Contracts)
   * so they appear directly in the relevant ERP workspace registers.
   */
  private async provisionDepartmentRecord(lead: any, options: { notes?: string; targetUnitId: string; targetTenantId: string; client: any }): Promise<void> {
    const { notes, targetUnitId, targetTenantId, client } = options;
    const category = (lead.enquiryCategory || '').toUpperCase();
    const service = (lead.primaryService || '').toLowerCase();
    const leadName = lead.customerName || client?.name || 'Customer';
    const leadPhone = lead.phoneNumber || client?.mobile || '9999999999';
    const leadEmail = lead.email || client?.email || null;
    const leadAddress = lead.serviceAddress || lead.city || client?.address || null;

    // 1. HR & RECRUITMENT
    if (category === 'JOB_ENQUIRY' || service.includes('job') || service.includes('career') || (service.includes('nurse') && service.includes('job'))) {
      const serialNo = `CAN-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      await (this.prisma as any).candidate.create({
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
      this.logger.log(`[DEPT-PROVISION] Created ERP Candidate ${serialNo} for ${leadName}`);
    }

    // 2. DONORS & VOLUNTEERS
    else if (category === 'DONOR_ENQUIRY' || service.includes('donor') || service.includes('donation') || service.includes('csr') || service.includes('sponsorship')) {
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
        this.logger.log(`[DEPT-PROVISION] Created ERP Donor ${donorNo} for ${leadName}`);
      }
    }

    // 3. AMBULANCE & EMERGENCY
    else if (lead.isAmbulanceEmergency || service.includes('ambulance') || service.includes('emergency')) {
      const refNo = `AMB-TRIP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      await (this.prisma as any).ambulanceTrip.create({
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
          unitId: targetUnitId,
        },
      });
      this.logger.log(`[DEPT-PROVISION] Created ERP Ambulance Trip ${refNo} for ${leadName}`);
    }

    // 4. HOME CARE
    else if (service.includes('in-home') || service.includes('home care') || service.includes('visiting') || category === 'HOME_CARE') {
      let patient = await (this.prisma as any).patient.findFirst({
        where: { phone: leadPhone, tenantId: targetTenantId },
      });
      if (!patient) {
        const elderId = `HC-ELD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
        patient = await (this.prisma as any).patient.create({
          data: {
            elderId,
            name: lead.patientName || leadName,
            age: lead.patientAge ? parseInt(lead.patientAge, 10) : 65,
            gender: 'Other',
            phone: leadPhone,
            address: leadAddress,
            tenantId: targetTenantId,
            unitId: targetUnitId,
          },
        });
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
            admissionPriority: 'NORMAL',
            healthCondition: 'STABLE',
            clinicalStatus: 'AMBULATORY',
            floor: 'Home Care',
            room: 'Home Residence',
            bed: 'Residence Bed',
            admittedAt: new Date(),
          },
        });
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
            specialInstructions: notes || lead.notes || 'Home Care Service Contract provisioned via CRM Lead Conversion',
            servicePrice: 15000.0,
            billingCycle: 'MONTHLY',
          },
        });
        this.logger.log(`[DEPT-PROVISION] Created Home Care Admission & Contract ${contractNumber} for ${leadName}`);
      }
    }

    // 5. RESIDENTIAL & INPATIENT CARE (Assisted Living, Memory Care, etc.)
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
      let patient = await (this.prisma as any).patient.findFirst({
        where: { phone: leadPhone, tenantId: targetTenantId },
      });
      if (!patient) {
        const elderId = `UEC-ELD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
        patient = await (this.prisma as any).patient.create({
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
            unitId: targetUnitId,
          },
        });
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
            admissionPriority: 'NORMAL',
            healthCondition: 'STABLE',
            clinicalStatus: 'AMBULATORY',
            floor: 'Floor 1',
            room: 'Assisted Care Suite',
            bed: 'Bed 1',
            admittedAt: new Date(),
          },
        });
        this.logger.log(`[DEPT-PROVISION] Created Inpatient Admission for ${leadName} (Elder ID: ${patient.elderId})`);
      }
    }

    // 6. COMPLAINTS & FEEDBACK
    else if (category === 'COMPLAINT_OR_SUPPORT' || service.includes('complaint') || service.includes('support')) {
      const refNo = `CMP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      await (this.prisma as any).complaint.create({
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
      this.logger.log(`[DEPT-PROVISION] Created ERP Complaint ${refNo} for ${leadName}`);
    }
  }
}
