-- VAR.2 (addition A) — the optional inventory-enforcement toggle.
--
-- ONE additive column with a default, so old code running against the new
-- schema is safe: nothing reads it until the deploy that introduces it, and
-- every existing row gets `false`, which is the behaviour those pages have
-- today (sell whatever is chosen; the call-centre sorts it out).
--
-- Default OFF is the merchant's own decision, recorded in NEXT_STEPS §VAR.2:
-- a new product or variant is routinely tested before it has been sent to the
-- Manager or given stock, and strict inventory rules during that phase block
-- the test.
--
-- No RLS change: `LandingSetting` is already a policy-covered table and this
-- adds a column to it, not a table.

-- AlterTable
ALTER TABLE "LandingSetting" ADD COLUMN     "inventoryEnforcement" BOOLEAN NOT NULL DEFAULT false;
