import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import {
  UpdateEnquiryClassificationDto,
  CreateLeadFromEnquiryDto,
  SaveCallIntakeDto,
  SaveLiveNotesDto,
  OverrideEmergencyPriorityDto,
  CreateCatalogItemDto,
} from './dto/enquiry.dto';

@Controller('api/v1/enquiry')
export class EnquiryController {
  private readonly logger = new Logger(EnquiryController.name);

  constructor(private readonly enquiryService: EnquiryService) {}

  // 1. Service Catalog & Config
  @Get('catalog')
  async getCatalog(@Query('foundationKey') foundationKey?: string) {
    return await this.enquiryService.getCatalog(foundationKey);
  }

  @Post('catalog')
  async createCatalogItem(@Body() dto: CreateCatalogItemDto, @Req() req: any) {
    return await this.enquiryService.createCatalogItem(dto, req.user);
  }

  @Put('catalog/:id')
  async updateCatalogItem(
    @Param('id') id: string,
    @Body() dto: Partial<CreateCatalogItemDto>,
    @Req() req: any,
  ) {
    return await this.enquiryService.updateCatalogItem(id, dto, req.user);
  }

  @Delete('catalog/:id')
  async deleteCatalogItem(@Param('id') id: string, @Req() req: any) {
    return await this.enquiryService.deleteCatalogItem(id, req.user);
  }

  // 2. Intelligent Omnichannel Conversation Understanding
  @Post('conversations/:id/classify')
  async classifyConversation(
    @Param('id') conversationId: string,
    @Body('text') text?: string,
  ) {
    return await this.enquiryService.classifyConversation(conversationId, text);
  }

  @Patch('conversations/:id/classification')
  async updateConversationClassification(
    @Param('id') conversationId: string,
    @Body() dto: UpdateEnquiryClassificationDto,
    @Req() req: any,
  ) {
    return await this.enquiryService.updateConversationClassification(
      conversationId,
      dto,
      req.user,
    );
  }

  // 3. Lead Creation & Synchronization
  @Post('conversations/:id/lead')
  async createOrSyncLead(
    @Param('id') conversationId: string,
    @Body() dto: CreateLeadFromEnquiryDto,
    @Req() req: any,
  ) {
    return await this.enquiryService.createOrSyncLead(conversationId, dto, req.user);
  }

  // 4. Call Intake Form Persistence (Supports PATCH and POST, with call ID in param or body)
  @Patch('calls/:id/intake')
  @Post('calls/:id/intake')
  async saveCallIntake(
    @Param('id') callSidOrId: string,
    @Body() dto: SaveCallIntakeDto,
    @Req() req: any,
  ) {
    return await this.enquiryService.saveCallIntake(callSidOrId, dto, req.user);
  }

  @Post('calls/save-intake')
  async saveCallIntakeDirect(
    @Body() dto: SaveCallIntakeDto & { callSid?: string; sessionId?: string },
    @Req() req: any,
  ) {
    const callSidOrId = dto.callSid || dto.sessionId || 'direct_intake';
    return await this.enquiryService.saveCallIntake(callSidOrId, dto, req.user);
  }

  // 4b. Standalone / Manual Lead Structured Intake Persistence
  @Post('leads/intake')
  async saveStructuredEnquiry(@Body() dto: SaveCallIntakeDto, @Req() req: any) {
    return await this.enquiryService.saveStructuredEnquiryLead(dto, req.user);
  }

  @Patch('leads/:id/intake')
  @Post('leads/:id/intake')
  async updateStructuredEnquiry(
    @Param('id') leadId: string,
    @Body() dto: SaveCallIntakeDto,
    @Req() req: any,
  ) {
    return await this.enquiryService.saveStructuredEnquiryLead(dto, req.user, leadId);
  }

  // 4c. Postal Code Location Lookup (Supports postal-lookup and pincode-lookup, param and query variants)
  @Get('postal-lookup/:postalCode')
  @Get('pincode-lookup/:postalCode')
  async lookupPostalCode(
    @Param('postalCode') postalCode: string,
    @Query('country') country?: string,
  ) {
    return await this.enquiryService.lookupPostalCode(postalCode, country);
  }

  @Get('postal-lookup')
  @Get('pincode-lookup')
  async lookupPostalCodeQuery(
    @Query('postalCode') postalCode?: string,
    @Query('pincode') pincode?: string,
    @Query('country') country?: string,
  ) {
    const code = postalCode || pincode || '';
    return await this.enquiryService.lookupPostalCode(code, country);
  }

  // 4d. Form Draft Persistence (Supports PATCH, POST, PUT)
  @Patch('calls/:id/draft')
  @Post('calls/:id/draft')
  @Put('calls/:id/draft')
  async saveCallDraft(
    @Param('id') callSidOrId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return await this.enquiryService.saveCallDraft(callSidOrId, body, req.user);
  }

  @Get('calls/:id/draft')
  async getCallDraft(@Param('id') callSidOrId: string) {
    return await this.enquiryService.getCallDraft(callSidOrId);
  }

  // 4d-2. Lead Draft Persistence (When editing lead without active call session)
  @Patch('leads/:id/draft')
  @Post('leads/:id/draft')
  @Put('leads/:id/draft')
  async saveLeadDraft(
    @Param('id') leadId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const draftData = body.draftData || body;
    return await this.enquiryService.saveLeadDraft(leadId, draftData, req.user);
  }

  @Get('leads/:id/draft')
  async getLeadDraft(@Param('id') leadId: string) {
    return await this.enquiryService.getLeadDraft(leadId);
  }

  // 4e. Phone WhatsApp Registration Status
  @Get('whatsapp-status/:phone')
  async checkWhatsAppStatus(@Param('phone') phone: string) {
    return await this.enquiryService.checkWhatsAppStatus(phone);
  }

  // 5. Incremental Live Notes Auto-Save
  @Patch('live-notes/:targetType/:id')
  async saveLiveNotes(
    @Param('targetType') targetType: 'call' | 'lead' | 'conversation',
    @Param('id') id: string,
    @Body() dto: SaveLiveNotesDto,
    @Req() req: any,
  ) {
    return await this.enquiryService.saveLiveNotes(targetType, id, dto, req.user);
  }

  // 6. Ambulance Priority Override & Audit
  @Post('emergency/override')
  async overrideEmergencyPriority(
    @Body() dto: OverrideEmergencyPriorityDto,
    @Req() req: any,
  ) {
    return await this.enquiryService.overrideEmergencyPriority(dto, req.user);
  }
}
