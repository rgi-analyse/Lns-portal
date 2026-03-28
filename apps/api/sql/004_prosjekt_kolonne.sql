-- 004_prosjekt_kolonne.sql
-- Legger til prosjektfilter-definisjon i ai_metadata_views

ALTER TABLE ai_metadata_views
  ADD prosjekt_kolonne      NVARCHAR(100) NULL,
      prosjekt_kolonne_type NVARCHAR(20)  NOT NULL DEFAULT 'number';

-- Seed kjente views med Prosjektnr (numerisk)
UPDATE ai_metadata_views
SET prosjekt_kolonne      = 'Prosjektnr',
    prosjekt_kolonne_type = 'number'
WHERE view_name IN (
  'vw_Fact_Bolting_BeverBas',
  'vw_Fact_sprut_BeverBas',
  'vw_Fact_Produksjon_tidslinje_BeverBas'
);

-- Seed RUH-view med ProsjektId (numerisk)
UPDATE ai_metadata_views
SET prosjekt_kolonne      = 'ProsjektId',
    prosjekt_kolonne_type = 'number'
WHERE view_name = 'vw_Fact_RUH';
