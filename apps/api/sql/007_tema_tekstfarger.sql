-- 007_tema_tekstfarger.sql
-- Legg til tekstfarge-felter i OrganisasjonTema
-- Idempotent: trygt å kjøre flere ganger

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.OrganisasjonTema')
    AND name = 'textColor'
)
BEGIN
  ALTER TABLE dbo.OrganisasjonTema
    ADD textColor NVARCHAR(50) NOT NULL CONSTRAINT DF_OrganisasjonTema_textColor DEFAULT '#FFFFFF';
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.OrganisasjonTema')
    AND name = 'textMutedColor'
)
BEGIN
  ALTER TABLE dbo.OrganisasjonTema
    ADD textMutedColor NVARCHAR(50) NOT NULL CONSTRAINT DF_OrganisasjonTema_textMutedColor DEFAULT 'rgba(255,255,255,0.65)';
END
