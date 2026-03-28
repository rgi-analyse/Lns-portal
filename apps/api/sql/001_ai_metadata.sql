-- ============================================================
-- STEG 1: Opprett metadata-tabeller for AI-chat
-- Kjøres mot Azure SQL (lns-dwh)
-- ============================================================

CREATE TABLE ai_metadata_views (
  id                UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  schema_name       NVARCHAR(50)  NOT NULL,
  view_name         NVARCHAR(100) NOT NULL,
  visningsnavn      NVARCHAR(100) NOT NULL,
  beskrivelse       NVARCHAR(500),
  område            NVARCHAR(50),
  prosjekter        NVARCHAR(200),  -- 'alle' eller '4200,6050'
  er_aktiv          BIT DEFAULT 1,
  sist_synkronisert DATETIME,
  opprettet         DATETIME DEFAULT GETDATE(),
  UNIQUE(schema_name, view_name)
)
GO

CREATE TABLE ai_metadata_kolonner (
  id               UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  view_id          UNIQUEIDENTIFIER REFERENCES ai_metadata_views(id) ON DELETE CASCADE,
  kolonne_navn     NVARCHAR(100) NOT NULL,
  datatype         NVARCHAR(50),
  beskrivelse      NVARCHAR(300),
  eksempel_verdier NVARCHAR(500),  -- auto eller manuelt
  er_filtrerbar    BIT DEFAULT 1,
  sort_order       INT DEFAULT 0
)
GO

CREATE TABLE ai_metadata_eksempler (
  id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  view_id      UNIQUEIDENTIFIER REFERENCES ai_metadata_views(id) ON DELETE CASCADE,
  spørsmål     NVARCHAR(300),
  sql_eksempel NVARCHAR(1000)
)
GO

CREATE TABLE ai_metadata_regler (
  id        UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  view_id   UNIQUEIDENTIFIER REFERENCES ai_metadata_views(id) ON DELETE CASCADE,
  regel     NVARCHAR(500)
)
GO

-- ============================================================
-- STEG 2: Seed eksisterende views
-- ============================================================

INSERT INTO ai_metadata_views (schema_name, view_name, visningsnavn, beskrivelse, område, prosjekter)
VALUES ('ai_gold', 'vw_Fact_RUH', 'Uønskede hendelser (RUH)',
        'Rapportering av uønskede hendelser og HMS-avvik på tvers av prosjekter',
        'HMS', 'alle')
GO

INSERT INTO ai_metadata_views (schema_name, view_name, visningsnavn, beskrivelse, område, prosjekter)
VALUES ('ai_gold', 'vw_Fact_Bolting_BeverBas', 'Bolting og sikring',
        'Bolting og sikringsdata per profil, pelplassering og bolttype',
        'Produksjon', '4200,6040,6050')
GO

INSERT INTO ai_metadata_views (schema_name, view_name, visningsnavn, beskrivelse, område, prosjekter)
VALUES ('ai_gold', 'vw_Fact_sprut_BeverBas', 'Sprøytebetong',
        'Sprøytebetong volum per profil og betongtype',
        'Produksjon', '4200,6040,6050')
GO

INSERT INTO ai_metadata_views (schema_name, view_name, visningsnavn, beskrivelse, område, prosjekter)
VALUES ('ai_gold', 'vw_Fact_Produksjon_tidslinje_BeverBas', 'Produksjonstidslinje',
        'Produksjon per operasjon og tidslinje, inkludert stopptid og ansvarlig',
        'Produksjon', '4200,6040,6050')
GO

-- ============================================================
-- STEG 7: Seed regler for vw_Fact_RUH (idempotent)
-- ============================================================

INSERT INTO ai_metadata_regler (view_id, regel)
SELECT v.id, 'Bruk alltid LIKE for Prosjekt-kolonnen: WHERE Prosjekt LIKE ''%søkeord%'''
FROM ai_metadata_views v
WHERE v.view_name = 'vw_Fact_RUH'
  AND NOT EXISTS (
    SELECT 1 FROM ai_metadata_regler r
    WHERE r.view_id = v.id AND r.regel LIKE 'Bruk alltid LIKE%'
  )
GO

INSERT INTO ai_metadata_regler (view_id, regel)
SELECT v.id, 'Gyldige Alvorlighetsgrad-verdier: Alvorlig, Mindre alvorlig, Svært alvorlig'
FROM ai_metadata_views v
WHERE v.view_name = 'vw_Fact_RUH'
  AND NOT EXISTS (
    SELECT 1 FROM ai_metadata_regler r
    WHERE r.view_id = v.id AND r.regel LIKE 'Gyldige Alvorlighetsgrad%'
  )
GO

INSERT INTO ai_metadata_regler (view_id, regel)
SELECT v.id, 'BeskrivelseHendelse kan inneholde HTML-tags - fjern disse ved presentasjon'
FROM ai_metadata_views v
WHERE v.view_name = 'vw_Fact_RUH'
  AND NOT EXISTS (
    SELECT 1 FROM ai_metadata_regler r
    WHERE r.view_id = v.id AND r.regel LIKE 'BeskrivelseHendelse%'
  )
GO

INSERT INTO ai_metadata_regler (view_id, regel)
SELECT v.id, 'Høy alvorlighetsgrad tolkes som: Alvorlighetsgrad IN (''Alvorlig'', ''Svært alvorlig'')'
FROM ai_metadata_views v
WHERE v.view_name = 'vw_Fact_RUH'
  AND NOT EXISTS (
    SELECT 1 FROM ai_metadata_regler r
    WHERE r.view_id = v.id AND r.regel LIKE 'Høy alvorlighetsgrad%'
  )
GO
