-- Migrering: Opprett Tenant-tabell (master-DB)
-- Kjør én gang mot master-databasen (DATABASE_URL)

IF OBJECT_ID(N'dbo.Tenant', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Tenant (
    id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID()  PRIMARY KEY,
    slug        NVARCHAR(100)    NOT NULL UNIQUE,
    navn        NVARCHAR(200)    NOT NULL,
    databaseUrl NVARCHAR(500)    NOT NULL,
    erAktiv     BIT              NOT NULL DEFAULT 1,
    opprettet   DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
    oppdatert   DATETIME2        NOT NULL DEFAULT GETUTCDATE()
  );
  PRINT 'Tenant-tabell opprettet.';
END
ELSE
BEGIN
  PRINT 'Tenant-tabell finnes allerede — ingen endringer.';
END;

-- Seed: standard LNS-tenant
-- Erstatt DATABASE_URL_PLACEHOLDER med faktisk connection string
-- INSERT INTO dbo.Tenant (slug, navn, databaseUrl)
-- SELECT 'lns', 'LNS', '<DATABASE_URL>'
-- WHERE NOT EXISTS (SELECT 1 FROM dbo.Tenant WHERE slug = 'lns');
