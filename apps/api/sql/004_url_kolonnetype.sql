-- Migration 004: Legg til lenketekst-kolonne for URL-kolonnetypen
-- Kjør én gang mot Azure SQL

ALTER TABLE ai_metadata_kolonner
  ADD lenketekst NVARCHAR(200) NULL;

-- Eksempel: marker en kolonne manuelt som URL
-- UPDATE ai_metadata_kolonner SET kolonne_type = 'url', lenketekst = 'Åpne dokument'
-- WHERE kolonne_navn = 'SharepointURL';

-- Sjekk eksisterende typer:
-- SELECT DISTINCT kolonne_type FROM ai_metadata_kolonner ORDER BY kolonne_type;
