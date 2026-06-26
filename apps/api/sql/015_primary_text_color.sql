-- 015_primary_text_color.sql
-- Legg til primaryTextColor i OrganisasjonTema — tekstfarge på UI-elementer med
-- primaryColor-bakgrunn (knapper, steg-indikatorer o.l.).
-- Kjøres mot master (lns-dwh) — OrganisasjonTema er master-global.
-- Idempotent: trygt å kjøre flere ganger.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.OrganisasjonTema')
    AND name = 'primaryTextColor'
)
BEGIN
  ALTER TABLE dbo.OrganisasjonTema ADD primaryTextColor NVARCHAR(50) NULL;
END
GO

-- Konkrete defaults for eksisterende rader (kun der NULL → idempotent).
-- LNS: mørk navy på gull (bedre kontrast enn hvit).
UPDATE dbo.OrganisasjonTema
SET    primaryTextColor = '#0a1628'
WHERE  tenantSlug = 'lns' AND primaryTextColor IS NULL;

-- Demo: hvit på lilla (matcher branding / bedre kontrast enn mørk).
UPDATE dbo.OrganisasjonTema
SET    primaryTextColor = '#ffffff'
WHERE  tenantSlug = 'demo' AND primaryTextColor IS NULL;
GO
