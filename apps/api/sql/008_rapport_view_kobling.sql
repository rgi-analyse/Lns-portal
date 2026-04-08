-- 008_rapport_view_kobling.sql
-- Oppretter koblingstabell mellom rapporter og metadata-views
-- Legger også til manglende kolonner dersom tidligere migrasjoner ikke er kjørt
-- Idempotent: trygt å kjøre på nytt

-- ─── ai_metadata_kolonner: kolonne_type (fra 003) ─────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ai_metadata_kolonner' AND COLUMN_NAME = 'kolonne_type'
)
ALTER TABLE ai_metadata_kolonner
  ADD kolonne_type NVARCHAR(20) NOT NULL DEFAULT 'dimensjon';
GO

-- ─── ai_metadata_kolonner: lenketekst (fra 004_url_kolonnetype) ───────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ai_metadata_kolonner' AND COLUMN_NAME = 'lenketekst'
)
ALTER TABLE ai_metadata_kolonner
  ADD lenketekst NVARCHAR(200) NULL;
GO

-- ─── ai_metadata_views: prosjekt_kolonne og prosjekt_kolonne_type (fra 004) ─
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ai_metadata_views' AND COLUMN_NAME = 'prosjekt_kolonne'
)
ALTER TABLE ai_metadata_views
  ADD prosjekt_kolonne      NVARCHAR(100) NULL,
      prosjekt_kolonne_type NVARCHAR(20)  NOT NULL DEFAULT 'number';
GO

-- ─── ai_rapport_view_kobling (ny tabell) ──────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_NAME = 'ai_rapport_view_kobling'
)
CREATE TABLE ai_rapport_view_kobling (
  rapport_id  NVARCHAR(200)    NOT NULL,
  view_id     UNIQUEIDENTIFIER NOT NULL REFERENCES ai_metadata_views(id) ON DELETE CASCADE,
  prioritet   INT              NOT NULL DEFAULT 0,
  opprettet   DATETIME         NOT NULL DEFAULT GETDATE(),
  PRIMARY KEY (rapport_id, view_id)
);
GO
