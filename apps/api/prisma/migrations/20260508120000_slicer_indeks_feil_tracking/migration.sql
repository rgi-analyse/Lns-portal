BEGIN TRY

BEGIN TRAN;

-- AlterTable: legg til sist_kjort og sist_feil for fail-soft scheduler-tracking
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ai_slicer_indeksering' AND COLUMN_NAME = 'sist_kjort'
)
ALTER TABLE [dbo].[ai_slicer_indeksering] ADD [sist_kjort] DATETIME2 NULL;

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ai_slicer_indeksering' AND COLUMN_NAME = 'sist_feil'
)
ALTER TABLE [dbo].[ai_slicer_indeksering] ADD [sist_feil] NVARCHAR(MAX) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
