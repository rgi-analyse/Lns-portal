BEGIN TRY

BEGIN TRAN;

-- Sensor-modul (live KQL/Eventhouse-data). Tenant-DB-tabeller; master = LNS-tenant.
-- For øvrige tenant-DB-er kjøres sql/015_sensor_tenant.sql via runSqlPaaAlleTenants.
-- Idempotent (regel 2): alle DDL bak IF NOT EXISTS. Ingen GO (regel 4).

-- CreateTable Sensor
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Sensor'
)
CREATE TABLE [dbo].[Sensor] (
    [id]           NVARCHAR(1000) NOT NULL,
    [navn]         NVARCHAR(200)  NOT NULL,
    [sensorId]     NVARCHAR(100)  NOT NULL,
    [kqlTabell]    NVARCHAR(100)  NOT NULL,
    [kqlVerdiFelt] NVARCHAR(100)  NOT NULL,
    [enhet]        NVARCHAR(50)   NULL,
    [beskrivelse]  NVARCHAR(500)  NULL,
    [erAktiv]      BIT            NOT NULL CONSTRAINT [Sensor_erAktiv_df] DEFAULT 1,
    [opprettet]    DATETIME2      NOT NULL CONSTRAINT [Sensor_opprettet_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Sensor_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Sensor_sensorId_key] UNIQUE NONCLUSTERED ([sensorId])
);

-- CreateTable WorkspaceSensor (kobling bruker-tilgjengelig via workspace)
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WorkspaceSensor'
)
CREATE TABLE [dbo].[WorkspaceSensor] (
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [sensorId]    NVARCHAR(1000) NOT NULL,
    CONSTRAINT [WorkspaceSensor_pkey] PRIMARY KEY CLUSTERED ([workspaceId],[sensorId])
);

-- CreateTable SensorDashbord
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'SensorDashbord'
)
CREATE TABLE [dbo].[SensorDashbord] (
    [id]                       NVARCHAR(1000) NOT NULL,
    [workspaceId]              NVARCHAR(1000) NOT NULL,
    [navn]                     NVARCHAR(200)  NOT NULL,
    [tidsvinduMinutter]        INT            NOT NULL CONSTRAINT [SensorDashbord_tidsvinduMinutter_df] DEFAULT 30,
    [oppdateringsIntervallSek] INT            NOT NULL CONSTRAINT [SensorDashbord_oppdateringsIntervallSek_df] DEFAULT 10,
    [konfig]                   NVARCHAR(MAX)  NOT NULL,
    [opprettet]                DATETIME2      NOT NULL CONSTRAINT [SensorDashbord_opprettet_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SensorDashbord_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey: WorkspaceSensor -> Workspace (cascade), -> Sensor (no action for å unngå
-- SQL Servers "multiple cascade paths"-feil). Begge bak IF NOT EXISTS for idempotens.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'WorkspaceSensor_workspaceId_fkey')
ALTER TABLE [dbo].[WorkspaceSensor]
  ADD CONSTRAINT [WorkspaceSensor_workspaceId_fkey] FOREIGN KEY ([workspaceId])
  REFERENCES [dbo].[Workspace]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'WorkspaceSensor_sensorId_fkey')
ALTER TABLE [dbo].[WorkspaceSensor]
  ADD CONSTRAINT [WorkspaceSensor_sensorId_fkey] FOREIGN KEY ([sensorId])
  REFERENCES [dbo].[Sensor]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'SensorDashbord_workspaceId_fkey')
ALTER TABLE [dbo].[SensorDashbord]
  ADD CONSTRAINT [SensorDashbord_workspaceId_fkey] FOREIGN KEY ([workspaceId])
  REFERENCES [dbo].[Workspace]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
