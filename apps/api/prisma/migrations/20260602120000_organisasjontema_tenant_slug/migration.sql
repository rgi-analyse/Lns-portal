BEGIN TRY

BEGIN TRAN;

-- Legger til tenantSlug-binding på OrganisasjonTema slik at hver tenant kan
-- ha eget tema, logo og organisasjonsnavn. Eksisterende rad backfilles til
-- 'lns'. UNIQUE-constraint flyttes fra organisasjonNavn til tenantSlug.
-- Idempotent: trygt å re-kjøre.

-- 1. Legg til tenantSlug nullable
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'tenantSlug'
    AND Object_ID = Object_ID(N'dbo.OrganisasjonTema')
)
ALTER TABLE [dbo].[OrganisasjonTema]
  ADD [tenantSlug] NVARCHAR(100) NULL;

-- 2. Backfill: eksisterende rad(er) uten tenantSlug -> 'lns'
UPDATE [dbo].[OrganisasjonTema]
SET    [tenantSlug] = 'lns'
WHERE  [tenantSlug] IS NULL;

-- 3. Sett NOT NULL
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'tenantSlug'
    AND Object_ID = Object_ID(N'dbo.OrganisasjonTema')
    AND is_nullable = 1
)
ALTER TABLE [dbo].[OrganisasjonTema]
  ALTER COLUMN [tenantSlug] NVARCHAR(100) NOT NULL;

-- 4. Dropp UNIQUE-constraint på organisasjonNavn (frigjør for gjenbruk av
--    display-navn). Prisma navngir indeksen <Table>_<Field>_key.
IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'OrganisasjonTema_organisasjonNavn_key'
    AND object_id = Object_ID(N'dbo.OrganisasjonTema')
)
DROP INDEX [OrganisasjonTema_organisasjonNavn_key] ON [dbo].[OrganisasjonTema];

-- 5. Legg til UNIQUE på tenantSlug
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'OrganisasjonTema_tenantSlug_key'
    AND object_id = Object_ID(N'dbo.OrganisasjonTema')
)
CREATE UNIQUE NONCLUSTERED INDEX [OrganisasjonTema_tenantSlug_key]
  ON [dbo].[OrganisasjonTema]([tenantSlug]);

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
