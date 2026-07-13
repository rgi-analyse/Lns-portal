BEGIN TRY

BEGIN TRAN;

-- Sensor-datakilde-abstraksjon: legg til dataKilde + Azure SQL-felter på Sensor.
-- Gjør kqlTabell/kqlVerdiFelt nullable (påkrevd kun for dataKilde='kusto';
-- håndheves per datakilde i validerKonfig). Backwards compat: eksisterende
-- Kusto-rader beholder verdiene sine og får dataKilde='kusto' via DEFAULT.
-- Idempotent (regel 2): all DDL bak IF NOT EXISTS / IF EXISTS. Ingen GO (regel 4).

-- dataKilde (NOT NULL DEFAULT 'kusto' — eksisterende rader blir kusto)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE Name = N'dataKilde' AND Object_ID = Object_ID(N'dbo.Sensor')
)
ALTER TABLE [dbo].[Sensor]
  ADD [dataKilde] NVARCHAR(50) NOT NULL CONSTRAINT [Sensor_dataKilde_df] DEFAULT 'kusto';

-- Azure SQL-felter (alle NULL)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE Name = N'azureSqlTabell' AND Object_ID = Object_ID(N'dbo.Sensor')
)
ALTER TABLE [dbo].[Sensor] ADD [azureSqlTabell] NVARCHAR(200) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE Name = N'azureSqlIdKolonne' AND Object_ID = Object_ID(N'dbo.Sensor')
)
ALTER TABLE [dbo].[Sensor] ADD [azureSqlIdKolonne] NVARCHAR(100) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE Name = N'azureSqlVerdiKolonne' AND Object_ID = Object_ID(N'dbo.Sensor')
)
ALTER TABLE [dbo].[Sensor] ADD [azureSqlVerdiKolonne] NVARCHAR(100) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE Name = N'azureSqlTidKolonne' AND Object_ID = Object_ID(N'dbo.Sensor')
)
ALTER TABLE [dbo].[Sensor] ADD [azureSqlTidKolonne] NVARCHAR(100) NULL;

-- Gjør KQL-feltene nullable (var NOT NULL). ALTER COLUMN er idempotent nok:
-- kjøring nr. 2 setter samme nullable-tilstand uten feil.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'kqlTabell' AND Object_ID = Object_ID(N'dbo.Sensor') AND is_nullable = 0
)
ALTER TABLE [dbo].[Sensor] ALTER COLUMN [kqlTabell] NVARCHAR(100) NULL;

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'kqlVerdiFelt' AND Object_ID = Object_ID(N'dbo.Sensor') AND is_nullable = 0
)
ALTER TABLE [dbo].[Sensor] ALTER COLUMN [kqlVerdiFelt] NVARCHAR(100) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
