BEGIN TRY

BEGIN TRAN;

-- CreateTable
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_NAME = 'ai_slicer_indeksering'
)
CREATE TABLE [dbo].[ai_slicer_indeksering] (
    [id]                NVARCHAR(1000) NOT NULL,
    [tenant]            NVARCHAR(100)  NOT NULL,
    [rapport_id]        NVARCHAR(100)  NOT NULL,
    [workspace_id]      NVARCHAR(100)  NOT NULL,
    [dataset_id]        NVARCHAR(100)  NOT NULL,
    [slicer_tittel]     NVARCHAR(200)  NOT NULL,
    [slicer_type]       NVARCHAR(20)   NOT NULL,
    [dax_query]         NVARCHAR(MAX)  NOT NULL,
    [forelder_kolonne]  NVARCHAR(200)  NULL,
    [verdi_kolonne]     NVARCHAR(200)  NOT NULL,
    [er_aktiv]          BIT            NOT NULL CONSTRAINT [ai_slicer_indeksering_er_aktiv_df] DEFAULT 1,
    [sist_indeksert]    DATETIME2      NULL,
    [sist_antall_rader] INT            NULL,
    [opprettet]         DATETIME2      NOT NULL CONSTRAINT [ai_slicer_indeksering_opprettet_df] DEFAULT CURRENT_TIMESTAMP,
    [oppdatert]         DATETIME2      NOT NULL,
    CONSTRAINT [ai_slicer_indeksering_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ai_slicer_indeksering_tenant_rapport_id_slicer_tittel_key]
      UNIQUE NONCLUSTERED ([tenant], [rapport_id], [slicer_tittel])
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
