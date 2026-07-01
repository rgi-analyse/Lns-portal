-- STEG 16: @updatedAt-kolonne [oppdatert] paa SensorDashbord (tenant-DB-er)
--
-- Master (lns-dwh) faar den via prisma migrate deploy
-- (migrations/20260702120000_sensordashbord_oppdatert). Denne fila er for
-- SSMS/oevrige tenant-DB-er:
--   npx tsx scripts/runSqlPaaAlleTenants.ts sql/016_sensordashbord_oppdatert.sql
--
-- GO skiller batchene slik at [oppdatert] finnes foer UPDATE/ALTER COLUMN parses.
-- Idempotent (IF NOT EXISTS / IF EXISTS).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'oppdatert' AND Object_ID = Object_ID(N'dbo.SensorDashbord')
)
ALTER TABLE [dbo].[SensorDashbord] ADD [oppdatert] DATETIME2 NULL;
GO

UPDATE [dbo].[SensorDashbord] SET [oppdatert] = [opprettet] WHERE [oppdatert] IS NULL;
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'oppdatert' AND Object_ID = Object_ID(N'dbo.SensorDashbord') AND is_nullable = 1
)
ALTER TABLE [dbo].[SensorDashbord] ALTER COLUMN [oppdatert] DATETIME2 NOT NULL;
GO
