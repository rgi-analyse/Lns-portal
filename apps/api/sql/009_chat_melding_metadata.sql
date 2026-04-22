-- 009_chat_melding_metadata.sql
-- Legger til melding_metadata-kolonne på ChatHistorikk for å lagre
-- regenererbar metadata (rapport-forslag, KPI-forslag, visualiseringer).
-- Idempotent: trygt å kjøre på nytt

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ChatHistorikk' AND COLUMN_NAME = 'melding_metadata'
)
ALTER TABLE ChatHistorikk
  ADD melding_metadata NVARCHAR(MAX) NULL;
GO
