-- STEG 7: Bruker-favoritter for workspace-pinning
-- Kjøres én gang mot portaldatabasen.

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
