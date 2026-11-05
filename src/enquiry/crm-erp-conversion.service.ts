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
}
