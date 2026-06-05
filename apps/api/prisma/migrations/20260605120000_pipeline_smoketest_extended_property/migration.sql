BEGIN TRY

BEGIN TRAN;

-- No-op pipeline-smoketest: legger en MS_Description-egenskap paa
-- OrganisasjonTema-tabellen. Beviser at deploy-migrations-jobben kjorer.
-- Ingen schema-endring, ingen data-endring, ingen kode-paavirkning.
-- Idempotent: dropper eksisterende egenskap forst.

IF EXISTS (
  SELECT 1 FROM sys.extended_properties
  WHERE class    = 1
    AND major_id = OBJECT_ID(N'dbo.OrganisasjonTema')
    AND minor_id = 0
    AND name     = N'MS_Description'
)
EXEC sp_dropextendedproperty
  @name       = N'MS_Description',
  @level0type = N'SCHEMA', @level0name = N'dbo',
  @level1type = N'TABLE',  @level1name = N'OrganisasjonTema';

EXEC sp_addextendedproperty
  @name       = N'MS_Description',
  @value      = N'Per-tenant tema. Bootstrap fullfort 2026-06-05.',
  @level0type = N'SCHEMA', @level0name = N'dbo',
  @level1type = N'TABLE',  @level1name = N'OrganisasjonTema';

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
