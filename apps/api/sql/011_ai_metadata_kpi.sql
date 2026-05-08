-- 011_ai_metadata_kpi.sql
-- Oppretter ai_metadata_kpi-tabellen som KPI-flyten i AI-chat og designer er
-- avhengig av. Tabellen har vært i bruk siden tidlig prototyping, men har
-- aldri blitt formelt migrert — denne filen tetter det gapet.
-- Idempotent: trygt å kjøre på nytt.

-- ─── ai_metadata_kpi ──────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_NAME = 'ai_metadata_kpi'
)
CREATE TABLE ai_metadata_kpi (
  id            UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  view_id       UNIQUEIDENTIFIER NOT NULL REFERENCES ai_metadata_views(id) ON DELETE CASCADE,
  navn          NVARCHAR(255)    NOT NULL,
  visningsnavn  NVARCHAR(255)    NOT NULL,
  sql_uttrykk   NVARCHAR(MAX)    NOT NULL,
  format        NVARCHAR(20)     NOT NULL DEFAULT 'desimal',
  beskrivelse   NVARCHAR(MAX)    NULL,
  er_aktiv      BIT              NOT NULL DEFAULT 1,
  opprettet     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
  oppdatert     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_ai_metadata_kpi_format
    CHECK (format IN ('prosent','nok','antall','desimal'))
);
GO

-- ─── Filtered unique index: aktive KPI-er må ha unikt navn per view ────────
-- Tillater duplikater på de-aktiverte rader slik at en KPI kan opprettes på
-- nytt etter soft-delete uten konflikt.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_ai_metadata_kpi_view_navn_aktiv'
    AND object_id = OBJECT_ID('ai_metadata_kpi')
)
CREATE UNIQUE INDEX UX_ai_metadata_kpi_view_navn_aktiv
  ON ai_metadata_kpi (view_id, navn)
  WHERE er_aktiv = 1;
GO

-- ─── Migrer manglende kolonner på eksisterende installasjoner ──────────────
-- Tabellen kan ha eksistert som ad hoc-CREATE uten alle nyere kolonner.
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ai_metadata_kpi'
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ai_metadata_kpi' AND COLUMN_NAME = 'er_aktiv'
  )
    ALTER TABLE ai_metadata_kpi
      ADD er_aktiv BIT NOT NULL DEFAULT 1;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ai_metadata_kpi' AND COLUMN_NAME = 'opprettet'
  )
    ALTER TABLE ai_metadata_kpi
      ADD opprettet DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ai_metadata_kpi' AND COLUMN_NAME = 'oppdatert'
  )
    ALTER TABLE ai_metadata_kpi
      ADD oppdatert DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();
END
GO

-- ─── Rydd opp: ai_kpi_foresporsler er en ubrukt stub ──────────────────────
-- Tabellen har aldri blitt lest av noen kode, kun fire-and-forget INSERT i
-- opprett_kpi-tool-handleren. Drop hvis den finnes.
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_NAME = 'ai_kpi_foresporsler'
)
DROP TABLE ai_kpi_foresporsler;
GO
