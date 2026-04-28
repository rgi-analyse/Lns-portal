-- 010: sortOrder-kolonne på Workspace
-- Lar admin endre rekkefølgen workspaces vises i sidebaren.
-- Idempotent: kan kjøres flere ganger uten å feile.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'sortOrder' AND Object_ID = Object_ID(N'dbo.Workspace')
)
BEGIN
  ALTER TABLE dbo.Workspace
    ADD sortOrder INT NOT NULL CONSTRAINT DF_Workspace_sortOrder DEFAULT 0;
END
GO

-- Initialiser eksisterende rader med 10, 20, 30... i alfabetisk rekkefølge
-- slik at admin har "luft" mellom radene for senere innsetting.
-- Kjøres kun hvis ingen rader har sortOrder satt ennå (alle er 0).
IF NOT EXISTS (SELECT 1 FROM dbo.Workspace WHERE sortOrder > 0)
BEGIN
  WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY navn ASC) AS rn
    FROM dbo.Workspace
  )
  UPDATE w
    SET w.sortOrder = ordered.rn * 10
  FROM dbo.Workspace w
  INNER JOIN ordered ON w.id = ordered.id;
END
GO
