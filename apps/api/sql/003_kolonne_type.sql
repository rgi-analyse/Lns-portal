-- 003_kolonne_type.sql
-- Legger til kolonne_type i ai_metadata_kolonner

ALTER TABLE ai_metadata_kolonner
  ADD kolonne_type NVARCHAR(20) NOT NULL DEFAULT 'dimensjon';

-- Oppdater numeriske kolonner → measure
UPDATE ai_metadata_kolonner
SET kolonne_type = 'measure'
WHERE LOWER(datatype) IN (
  'int','bigint','smallint','tinyint',
  'decimal','numeric','float','real',
  'money','smallmoney'
);

-- Oppdater dato-kolonner → dato
UPDATE ai_metadata_kolonner
SET kolonne_type = 'dato'
WHERE LOWER(datatype) IN (
  'date','datetime','datetime2',
  'smalldatetime','time','datetimeoffset'
);

-- Oppdater ID-kolonner → id (navn-basert heuristikk, kjøres etter type-oppdateringer)
UPDATE ai_metadata_kolonner
SET kolonne_type = 'id'
WHERE (
  kolonne_navn = 'Id'
  OR kolonne_navn = 'ID'
  OR kolonne_navn LIKE '%Id'
  OR kolonne_navn LIKE '%ID'
  OR kolonne_navn LIKE '%_id'
  OR kolonne_navn LIKE '%Kode'
  OR kolonne_navn LIKE '%Nr'
)
AND kolonne_type = 'dimensjon';
