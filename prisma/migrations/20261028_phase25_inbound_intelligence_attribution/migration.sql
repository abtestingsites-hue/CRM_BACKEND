-- ==============================================================================
-- MIGRATION: 20261028_phase25_inbound_intelligence_attribution
-- ELDERCARE CRM — Phase 25 Inbound Call Source Attribution, Cross-Unit Caller Intelligence & Workflow
-- Non-destructive additive migration with full backwards compatibility
-- ==============================================================================

-- 1. Ensure AMBULANCE business unit exists
INSERT INTO "BusinessUnit" (
    "id", 
    "code", 
    "name", 
    "description", 
    "status", 
    "isolationMode", 
    "enabledProducts", 
    "enabledModules", 
    "createdAt", 
    "updatedAt"
) VALUES (
    'b72e1850-932d-4ef1-8a90-349092892911',
    'AMBULANCE',
    'Ambulance & Emergency Services',
    'Emergency response, critical care transport, and non-emergency patient transfer',
    'ACTIVE',
    'SHARED',
    ARRAY['CRM'],
    ARRAY['TELEPHONY', 'OMNICHANNEL', 'LEADS', 'APPOINTMENTS', 'ANALYTICS'],
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT ("code") DO NOTHING;

-- 2. Add Phase 25 Columns to CallSession table
ALTER TABLE "CallSession" 
    ADD COLUMN IF NOT EXISTS "providerCallId" VARCHAR(100),
    ADD COLUMN IF NOT EXISTS "callerNumber" VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "originalCallerId" VARCHAR(100),
    ADD COLUMN IF NOT EXISTS "calledNumber" VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "direction" VARCHAR(20) DEFAULT 'INBOUND',
    ADD COLUMN IF NOT EXISTS "provider" VARCHAR(50) DEFAULT 'vobiz',
    ADD COLUMN IF NOT EXISTS "source" VARCHAR(100),
    ADD COLUMN IF NOT EXISTS "sourceType" VARCHAR(20) DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS "campaign" VARCHAR(150),
    ADD COLUMN IF NOT EXISTS "trackingNumber" VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "referralSource" VARCHAR(150),
    ADD COLUMN IF NOT EXISTS "sourceMetadata" JSONB,
    ADD COLUMN IF NOT EXISTS "callerMatchStatus" VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "unitId" UUID REFERENCES "BusinessUnit"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "departmentId" UUID REFERENCES "Department"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "queueId" UUID REFERENCES "Queue"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "draftNotes" JSONB,
    ADD COLUMN IF NOT EXISTS "disposition" VARCHAR(50),
    ADD COLUMN IF NOT EXISTS "enquiryCategory" "EnquiryCategory";

-- 3. Add High-Performance Indexes for CallSession Phone & Identity Lookups
CREATE INDEX IF NOT EXISTS "idx_call_session_provider_call_id" 
    ON "CallSession" ("providerCallId");

CREATE INDEX IF NOT EXISTS "idx_call_session_caller_number" 
    ON "CallSession" ("callerNumber");

CREATE INDEX IF NOT EXISTS "idx_call_session_called_number" 
    ON "CallSession" ("calledNumber");

CREATE INDEX IF NOT EXISTS "idx_call_session_unit_id" 
    ON "CallSession" ("unitId");

CREATE INDEX IF NOT EXISTS "idx_call_session_department_id" 
    ON "CallSession" ("departmentId");

CREATE INDEX IF NOT EXISTS "idx_call_session_queue_id" 
    ON "CallSession" ("queueId");

CREATE INDEX IF NOT EXISTS "idx_call_session_source_type" 
    ON "CallSession" ("sourceType");
