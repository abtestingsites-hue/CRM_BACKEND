-- Phase 26: Call Center, Call Logs & Intake Form Enhancements
-- AlterTable Customer
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "secondaryPhone" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "street" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;

-- AlterTable Lead
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "secondaryPhone" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "secondaryCountryCode" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "street" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "country" TEXT;

