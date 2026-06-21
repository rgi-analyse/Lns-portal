-- STEG 13: brukerFavoritter per tenant-DB (flyttet fra global lns-dwh)
--
-- Bakgrunn: brukerFavoritter lå tidligere kun i lns-dwh (master). workspaceId-FK
-- pekte på Workspace i lns-dwh, så favoritter mot per-tenant-workspaces (f.eks.
-- demo i test-dwh) feilet med FK-violation. Tabellen flyttes derfor til hver
-- tenant-DB slik at FK-en peker på riktig tenants Workspace.
--
-- Kjøres mot ALLE tenant-DB-er:
--   npx tsx scripts/runSqlPaaAlleTenants.ts sql/013_brukerFavoritter_tenant.sql
--
-- lns-dwh har tabellen fra før (007) -> IF NOT EXISTS hopper over (LNS sine
-- eksisterende favoritter beholdes). test-dwh + fremtidige tenants -> CREATE.
-- NB: brukerId har ingen FK (global Bruker.id lagres som string — ingen cross-DB-FK).

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'brukerFavoritter')
BEGIN
  CREATE TABLE brukerFavoritter (
    id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    brukerId    NVARCHAR(450)    NOT NULL,
    workspaceId UNIQUEIDENTIFIER NOT NULL,
    opprettet   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT uq_bruker_workspace UNIQUE (brukerId, workspaceId),
    CONSTRAINT fk_favoritt_workspace FOREIGN KEY (workspaceId)
      REFERENCES Workspace(id) ON DELETE CASCADE
  );

  CREATE INDEX ix_favoritter_bruker ON brukerFavoritter (brukerId);
END
