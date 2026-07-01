BEGIN TRY

BEGIN TRAN;

-- Legg til @updatedAt-kolonnen [oppdatert] paa SensorDashbord.
-- Nullable → backfill (via sp_executesql, regel 3) → NOT NULL. Idempotent (regel 2).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'oppdatert' AND Object_ID = Object_ID(N'dbo.SensorDashbord')
)
ALTER TABLE [dbo].[SensorDashbord] ADD [oppdatert] DATETIME2 NULL;

EXEC sp_executesql N'
  UPDATE [dbo].[SensorDashbord]
  SET    [oppdatert] = [opprettet]
  WHERE  [oppdatert] IS NULL;
';

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'oppdatert' AND Object_ID = Object_ID(N'dbo.SensorDashbord') AND is_nullable = 1
)
ALTER TABLE [dbo].[SensorDashbord] ALTER COLUMN [oppdatert] DATETIME2 NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
