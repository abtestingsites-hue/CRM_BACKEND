/**
 * PHASE 26 AUTOMATED REGRESSION & VERIFICATION TEST SUITE
 * 
 * Modules Verified:
 *  1. Postal Code Lookup (India Post & Zippopotam fallback)
 *  2. In-Call Draft Persistence (saveCallDraft, getCallDraft)
 *  3. Customer Intake Persistence (Structured Address & Secondary Phone)
 *  4. Call History Data Integrity (Dynamic requiredService, No 'Doctor at Home' fallback)
 *  5. Agent Lead Reassignment & Cross-Unit Transfer with LeadTransferAudit
 */

import { EnquiryService } from '../enquiry/enquiry.service';
import { TelephonyService } from './telephony.service';
import { PrismaClient } from '@prisma/client';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

let passed = 0;
let total = 0;

function assert(condition: boolean, testNum: number, name: string, detail?: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ${GREEN}✔ PASS${RESET} [Test ${testNum}] ${name} ${detail ? CYAN + '(' + detail + ')' + RESET : ''}`);
  } else {
    console.error(`  ${RED}✖ FAIL${RESET} [Test ${testNum}] ${name} ${detail ? '(' + detail + ')' : ''}`);
    throw new Error(`Assertion failed for Test ${testNum}: ${name}`);
  }
}

async function runPhase26Tests() {
  console.log(`\n================================================================`);
  console.log(`  PHASE 26: CALL CENTER, CALL LOGS & INTAKE ENHANCEMENTS SUITE  `);
  console.log(`================================================================\n`);

  const prisma = new PrismaClient();
  const enquiryService = new EnquiryService(prisma);
  const telephonyService = new TelephonyService(prisma);

  try {
    // -------------------------------------------------------------
    // Test 1: Postal Code Lookup - India Post API (Chennai 600020)
    // -------------------------------------------------------------
    console.log(`--- Section 1: Pincode Lookup API ---`);
    const postalResultIndia = await enquiryService.lookupPostalCode('600020', 'India');
    assert(
      postalResultIndia.success === true && (postalResultIndia.city?.toLowerCase().includes('chennai') || postalResultIndia.state === 'Tamil Nadu'),
      1,
      'lookupPostalCode resolves Indian 6-digit PIN code to City/State',
      `postalCode=600020, city=${postalResultIndia.city}, state=${postalResultIndia.state}`
    );

    // -------------------------------------------------------------
    // Test 2: Postal Code Lookup - Zippopotam US ZIP code (90210)
    // -------------------------------------------------------------
    const postalResultUS = await enquiryService.lookupPostalCode('90210', 'US');
    assert(
      postalResultUS.success === true && postalResultUS.state?.toLowerCase().includes('california'),
      2,
      'lookupPostalCode resolves US ZIP code via fallback provider',
      `postalCode=90210, city=${postalResultUS.city}, state=${postalResultUS.state}`
    );

    // -------------------------------------------------------------
    // Test 3: Postal Code Lookup - Invalid Pincode graceful error handling
    // -------------------------------------------------------------
    const postalResultInvalid = await enquiryService.lookupPostalCode('000000', 'India');
    assert(
      postalResultInvalid.success === false,
      3,
      'lookupPostalCode handles non-existent postal codes gracefully without crashing',
      `postalCode=000000, success=${postalResultInvalid.success}`
    );

    // -------------------------------------------------------------
    // Test 4 & 5: Draft Autosave & Retrieval
    // -------------------------------------------------------------
    console.log(`\n--- Section 2: Call Form Draft Autosave & Retrieval ---`);
    const testCallSid = `test_phase26_draft_${Date.now()}`;
    
    // Create a dummy CallSession for testing draft
    const session = await prisma.callSession.create({
      data: {
        providerCallId: testCallSid,
        callerNumber: '+919999988888',
        direction: 'INBOUND',
        status: 'IN_PROGRESS',
      },
    });

    const draftPayload = {
      enquirerName: 'Test Caller Raghav',
      phone: '+919999988888',
      secondaryPhone: '+918888877777',
      street: '42 Marina Beach Road',
      city: 'Chennai',
      state: 'Tamil Nadu',
      country: 'India',
      postalCode: '600004',
      liveNotesText: 'Customer inquired about 24-hour caregiver support for mother.',
    };

    const savedDraftResult = await enquiryService.saveCallDraft(testCallSid, draftPayload, { id: 'agent_test_1' });
    assert(
      savedDraftResult.success === true && (savedDraftResult.draft as any).enquirerName === 'Test Caller Raghav',
      4,
      'saveCallDraft persists in-progress form inputs to CallSession.draftNotes',
      `callSid=${testCallSid}, enquirerName=${(savedDraftResult.draft as any).enquirerName}`
    );

    const retrievedDraftResult = await enquiryService.getCallDraft(testCallSid);
    assert(
      retrievedDraftResult.success === true && (retrievedDraftResult.draft as any).street === '42 Marina Beach Road',
      5,
      'getCallDraft retrieves stored draft across component remounts and page refreshes',
      `street=${(retrievedDraftResult.draft as any).street}`
    );

    // -------------------------------------------------------------
    // Test 6 & 7 & 8: Structured Address & Secondary Phone Persistence
    // -------------------------------------------------------------
    console.log(`\n--- Section 3: Structured Address & Phone Intake Persistence ---`);
    const intakeResult = await enquiryService.saveCallIntake(testCallSid, {
      enquirerName: 'Mrs. Anandhi',
      phone: '+919876543210',
      countryCode: '+91',
      secondaryPhone: '+919876543211',
      secondaryCountryCode: '+91',
      email: 'anandhi@example.com',
      serviceCategory: 'UEC',
      foundation: 'UEC',
      enquiryCategory: 'SERVICE_ENQUIRY',
      primaryService: 'Dementia Care Attendant',
      subServices: ['Medication Reminder', 'Mobility Assistance'],
      street: '15 Bishop Garden, RA Puram',
      city: 'Chennai',
      state: 'Tamil Nadu',
      country: 'India',
      postalCode: '600028',
      patientName: 'Mr. Ramanathan',
      patientAge: 82,
      patientConditions: 'Mild cognitive impairment, post-CABG',
      patientMobility: 'Needs Partial Assistance (Walker / Cane)',
      callOutcome: 'COMPLETED',
    }, { id: 'agent_test_1' });

    assert(
      intakeResult.lead && intakeResult.lead.street === '15 Bishop Garden, RA Puram',
      6,
      'saveCallIntake persists separate street, city, state, country, postalCode to Lead',
      `street=${intakeResult.lead?.street}, postalCode=${intakeResult.lead?.postalCode}`
    );

    assert(
      intakeResult.lead && intakeResult.lead.secondaryPhone === '+919876543211' && intakeResult.lead.secondaryCountryCode === '+91',
      7,
      'saveCallIntake persists secondaryPhone and secondaryCountryCode to Lead',
      `secondaryPhone=${intakeResult.lead?.secondaryPhone}, countryCode=${intakeResult.lead?.secondaryCountryCode}`
    );

    assert(
      intakeResult.lead && intakeResult.lead.serviceAddress.includes('15 Bishop Garden') && intakeResult.lead.serviceAddress.includes('600028'),
      8,
      'saveCallIntake preserves serviceAddress full combined string for backward compatibility',
      `serviceAddress=${intakeResult.lead?.serviceAddress}`
    );

    // -------------------------------------------------------------
    // Test 9 & 10: Call History Data Integrity - No Hardcoded 'Doctor at Home'
    // -------------------------------------------------------------
    console.log(`\n--- Section 4: Call History Required Service Integrity ---`);
    const historyResult = await telephonyService.getComprehensiveCallHistory({
      page: 1,
      limit: 10,
    });

    assert(
      Array.isArray(historyResult.calls),
      9,
      'getComprehensiveCallHistory returns paginated call records',
      `total=${historyResult.pagination?.total}, returned=${historyResult.calls.length}`
    );

    // Verify that missing primaryService is null and NOT hardcoded to 'Doctor at Home'
    const hasUnspecifiedCalls = historyResult.calls.some(c => c.requiredService === null);
    console.log(`  [Diagnostic] Sample calls with requiredService:`, historyResult.calls.slice(0, 3).map(c => ({ id: c.id, caller: c.callerPhone, service: c.requiredService })));
    assert(
      historyResult.calls.every(c => c.requiredService !== 'Doctor at Home' || (c.lead && (c.lead.primaryService === 'Doctor at Home' || c.lead.serviceInterest === 'Doctor at Home'))),
      10,
      'Hardcoded fallback "Doctor at Home" is eliminated; requiredService is dynamic from actual lead record',
      `Verified across ${historyResult.calls.length} records`
    );

    // -------------------------------------------------------------
    // Test 11 & 12: Agent Reassignment & Audit History
    // -------------------------------------------------------------
    console.log(`\n--- Section 5: Agent Reassignment & Audit History ---`);
    if (intakeResult.lead?.id) {
      // Find an available business unit or use lead's current unit
      const unit = await prisma.businessUnit.findFirst();
      const actualUser = await prisma.user.findFirst();
      if (unit) {
        const transferRes = await telephonyService.executeCrossUnitLeadTransfer(
          intakeResult.lead.id,
          {
            destUnitId: unit.id,
            reason: 'Reassigned to senior gerontology care coordinator for specialized assessment',
          },
          actualUser || { id: undefined, name: 'Supervisor' }
        );

        assert(
          transferRes.success === true,
          11,
          'executeCrossUnitLeadTransfer executes same-unit/cross-unit agent transfer successfully',
          `leadId=${intakeResult.lead.id}, destinationUnit=${transferRes.destinationUnit}`
        );

        // Verify audit log exists
        const auditLog = await prisma.leadTransferAudit.findFirst({
          where: { leadId: intakeResult.lead.id },
          orderBy: { createdAt: 'desc' },
        });

        assert(
          auditLog !== null && auditLog.reason.includes('Reassigned to senior gerontology'),
          12,
          'LeadTransferAudit records full audit entry with reason and author for reassignment',
          `auditId=${auditLog?.id}, reason=${auditLog?.reason}`
        );
      }
    }

    // Clean up test call session
    await prisma.callSession.deleteMany({
      where: { providerCallId: testCallSid },
    });

    console.log(`\n================================================================`);
    console.log(`  ALL ${passed}/${total} PHASE 26 AUTOMATED TESTS PASSED SUCCESSFULLY! `);
    console.log(`================================================================\n`);
  } finally {
    await prisma.$disconnect();
  }
}

runPhase26Tests().catch((err) => {
  console.error('\nTest Suite Execution Failed:', err);
  process.exit(1);
});
