-- STEG 17: Sensor-datakilde-abstraksjon — dataKilde + Azure SQL-felter paa Sensor.
--
-- Sensor kan naa hente tidsserie fra Kusto/Eventhouse (default) ELLER Azure SQL
-- (lns-dwh gold.*). dataKilde velger service i ruten. KQL-feltene blir nullable
-- (paakrevd kun for dataKilde='kusto'); Azure SQL-feltene er nullable og valideres
-- strikt med regex foer interpolering (mssql har ikke parametre for identifiers).
--
-- Master (lns-dwh) faar dette via prisma migrate deploy
-- (migrations/20260713120000_sensor_azuresql_datakilde). Denne fila er for
-- SSMS-review og OEVRIGE tenant-DB-er:
--   npx tsx scripts/runSqlPaaAlleTenants.ts sql/017_sensor_datakilde.sql
--
-- GO skiller batchene slik at nye kolonner finnes foer ALTER COLUMN parses.
-- Idempotent (IF NOT EXISTS / IF EXISTS).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE Name = N'dataKilde' AND Object_ID = Object_ID(N'dbo.Sensor')
)
ALTER TABLE [dbo].[Sensor]
  ADD [dataKilde] NVARCHAR(50) NOT NULL CONSTRAINT [Sensor_dataKilde_df] DEFAULT 'kusto';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE Name = N'azureSqlTabell' AND Object_ID = Object_ID(N'dbo.Sensor')
)
ALTER TABLE [dbo].[Sensor] ADD [azureSqlTabell] NVARCHAR(200) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE Name = N'azureSqlIdKolonne' AND Object_ID = Object_ID(N'dbo.Sensor')
)
ALTER TABLE [dbo].[Sensor] ADD [azureSqlIdKolonne] NVARCHAR(100) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE Name = N'azureSqlVerdiKolonne' AND Object_ID = Object_ID(N'dbo.Sensor')
)
ALTER TABLE [dbo].[Sensor] ADD [azureSqlVerdiKolonne] NVARCHAR(100) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE Name = N'azureSqlTidKolonne' AND Object_ID = Object_ID(N'dbo.Sensor')
)
ALTER TABLE [dbo].[Sensor] ADD [azureSqlTidKolonne] NVARCHAR(100) NULL;
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'kqlTabell' AND Object_ID = Object_ID(N'dbo.Sensor') AND is_nullable = 0
)
ALTER TABLE [dbo].[Sensor] ALTER COLUMN [kqlTabell] NVARCHAR(100) NULL;
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'kqlVerdiFelt' AND Object_ID = Object_ID(N'dbo.Sensor') AND is_nullable = 0
)
ALTER TABLE [dbo].[Sensor] ALTER COLUMN [kqlVerdiFelt] NVARCHAR(100) NULL;
GO
