-- STEG 1 + 3 + 5: Personlig workspace og designer-rapport-støtte
-- Kjøres én gang mot portaldatabasen.

-- Brukerens personlige workspace-id (satt ved første designer-lagring)
ALTER TABLE bruker
  ADD mittWorkspaceId UNIQUEIDENTIFIER NULL;

-- Marker workspaces som personlige (eies av én bruker)
ALTER TABLE Workspace
  ADD erPersonlig BIT NOT NULL DEFAULT 0;

-- Designer-rapport-kolonner på Rapport-tabellen
ALTER TABLE Rapport
  ADD erDesignerRapport BIT NOT NULL DEFAULT 0,
      designerConfig    NVARCHAR(MAX) NULL;
