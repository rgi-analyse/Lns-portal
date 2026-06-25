-- STEG 14: ai_rapport_view_kobling per tenant-DB
--
-- Bakgrunn: ai_rapport_view_kobling.rapport_id er en TENANT-lokal rapport-ID,
-- men tabellen lå tidligere kun i master (008_rapport_view_kobling.sql). Med
-- flere tenants kan ikke én master-tabell holde koblinger for ulike tenants
-- (samme rapport_id-rom kolliderer). Tabellen flyttes derfor til hver tenant-DB.
-- ai_metadata_views (view-katalogen) forblir master-global.
--
-- Kjøres mot ALLE tenant-DB-er:
--   npx tsx scripts/runSqlPaaAlleTenants.ts sql/014_rapport_view_kobling_per_tenant.sql
--
-- LNS (lns-dwh == master) har tabellen fra før (008) -> IF NOT EXISTS hopper over,
-- og eksisterende LNS-koblinger beholdes. test-dwh + fremtidige tenants -> CREATE.
--
-- NB: view_id har INGEN FK til ai_metadata_views her — den tabellen er master-only,
-- så view_id er en logisk (cross-DB) peker til masters view-katalog.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_NAME = 'ai_rapport_view_kobling'
)
CREATE TABLE ai_rapport_view_kobling (
  rapport_id  NVARCHAR(200)    NOT NULL,
  view_id     UNIQUEIDENTIFIER NOT NULL,
  prioritet   INT              NOT NULL DEFAULT 0,
  opprettet   DATETIME         NOT NULL DEFAULT GETDATE(),
  PRIMARY KEY (rapport_id, view_id)
);
GO
