-- Snapshot av OrganisasjonTema FØR migrasjon til per-tenant.
-- Kjør i master-DB FØR Prisma-migrasjon (20260602120000_organisasjontema_tenant_slug).
-- Beholder kopi for sammenligning post-migrasjon (Rogers curl-diff-test).
--
-- Idempotent: re-kjøring lager ikke ny backup hvis tabellen finnes.

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = N'OrganisasjonTema_backup_pre_per_tenant'
)
BEGIN
  SELECT *
  INTO   dbo.OrganisasjonTema_backup_pre_per_tenant
  FROM   dbo.OrganisasjonTema;

  PRINT 'Backup laget: dbo.OrganisasjonTema_backup_pre_per_tenant';
END
ELSE
  PRINT 'Backup-tabell finnes allerede - ingen ny snapshot.';

-- Verifisering: antall rader + innhold
SELECT COUNT(*) AS antall_rader_snapshot FROM dbo.OrganisasjonTema_backup_pre_per_tenant;
SELECT * FROM dbo.OrganisasjonTema_backup_pre_per_tenant;
