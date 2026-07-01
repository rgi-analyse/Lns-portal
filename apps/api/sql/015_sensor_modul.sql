-- STEG 15: Sensor-modul (live KQL/Eventhouse-data)
--
-- Tre TENANT-lokale tabeller (samme mønster som WorkspaceRapport / brukerFavoritter):
--   Sensor          — sensor-katalog. kqlTabell + kqlVerdiFelt peker til KQL/Eventhouse
--                     (én tabell per sensor-type; verdi-kolonne varierer, f.eks.
--                     fill_grade_percentage). Begge valideres strikt server-side før
--                     interpolasjon i KQL (Kusto har ikke parametre for identifiers).
--   WorkspaceSensor — kobling: hvilke sensorer et workspace gir tilgang til.
--   SensorDashbord  — kontrollrom-konfig (tidsvindu, oppdaterings-intervall, layout-JSON).
--
-- Master (lns-dwh) får tabellene via prisma migrate deploy
-- (migrations/20260701120000_sensor_modul). Denne fila er for SSMS-review/-kjøring og
-- for ØVRIGE tenant-DB-er via:
--   npx tsx scripts/runSqlPaaAlleTenants.ts sql/015_sensor_modul.sql
--
-- Idempotent: IF NOT EXISTS hopper over der tabellene allerede finnes.
--
-- Indeks-merknad: Sensor.sensorId er UNIQUE (= indeksert). Workspace→Sensor-oppslaget
-- i hentSensorTilgang dekkes av WorkspaceSensor sin PK (workspaceId først). KQL-siden
-- (SensorID / ProsessTime) indekseres i Eventhouse, ikke i denne portal-DB-en.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Sensor'
)
CREATE TABLE [dbo].[Sensor] (
  [id]           NVARCHAR(1000) NOT NULL,
  [navn]         NVARCHAR(200)  NOT NULL,
  [sensorId]     NVARCHAR(100)  NOT NULL,   -- SensorID-verdi i KQL
  [kqlTabell]    NVARCHAR(100)  NOT NULL,   -- KQL-tabellnavn (én per sensor-type)
  [kqlVerdiFelt] NVARCHAR(100)  NOT NULL,   -- verdi-kolonne i KQL (varierer per tabell)
  [enhet]        NVARCHAR(50)   NULL,
  [beskrivelse]  NVARCHAR(500)  NULL,
  [erAktiv]      BIT            NOT NULL CONSTRAINT [Sensor_erAktiv_df] DEFAULT 1,
  [opprettet]    DATETIME2      NOT NULL CONSTRAINT [Sensor_opprettet_df] DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT [Sensor_pkey] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [Sensor_sensorId_key] UNIQUE NONCLUSTERED ([sensorId])
);
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WorkspaceSensor'
)
CREATE TABLE [dbo].[WorkspaceSensor] (
  [workspaceId] NVARCHAR(1000) NOT NULL,
  [sensorId]    NVARCHAR(1000) NOT NULL,
  CONSTRAINT [WorkspaceSensor_pkey] PRIMARY KEY CLUSTERED ([workspaceId],[sensorId]),
  CONSTRAINT [WorkspaceSensor_workspaceId_fkey] FOREIGN KEY ([workspaceId])
    REFERENCES [dbo].[Workspace]([id]) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT [WorkspaceSensor_sensorId_fkey] FOREIGN KEY ([sensorId])
    REFERENCES [dbo].[Sensor]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);
GO

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
  CONSTRAINT [SensorDashbord_pkey] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [SensorDashbord_workspaceId_fkey] FOREIGN KEY ([workspaceId])
    REFERENCES [dbo].[Workspace]([id]) ON DELETE CASCADE ON UPDATE NO ACTION
);
GO
