-- Seed-data for ai_slicer_indeksering — to test-konfigurasjoner
-- Idempotent: bruker MERGE slik at gjentatt kjøring oppdaterer eksisterende rader.

MERGE [dbo].[ai_slicer_indeksering] AS mål
USING (
  SELECT * FROM (VALUES
    -- 1) Hovedprosjekt-hierarki for Resultatrapport (LNS)
    (
      'lns',
      '6c758833-1f94-497f-b89a-2e89b4db2af7',
      'fba6eae4-4aaa-40ba-82a3-d08f4dea212d',
      'e627bb29-dc52-40ee-a8c3-a6d4a930d2e6',
      'Hovedprosjekt',
      'hierarchy',
      N'EVALUATE
SUMMARIZE(
  ''Dim_Prosjekt_LNS'',
  ''Dim_Prosjekt_LNS''[Hovedprosjekt],
  ''Dim_Prosjekt_LNS''[Prosjekt]
)
ORDER BY [Hovedprosjekt], [Prosjekt]',
      'Dim_Prosjekt_LNS[Hovedprosjekt]',
      'Dim_Prosjekt_LNS[Prosjekt]'
    ),

    -- 2) LevNavn-basic for Leverandørstatistikk (LNS)
    (
      'lns',
      '8a686e18-5ed2-449c-a010-7cc6a6cd25d7',
      '3d24f616-8ea3-4718-ac9f-78d612c67e46',
      'cee82cb5-ff1d-44fd-aec8-588a46328b36',
      'LevNavn',
      'basic',
      N'EVALUATE
DISTINCT(''core Dim_Supplier_LNS''[LevNavn])
ORDER BY [LevNavn]',
      NULL,
      'core Dim_Supplier_LNS[LevNavn]'
    )
  ) AS v(tenant, rapport_id, workspace_id, dataset_id, slicer_tittel, slicer_type,
         dax_query, forelder_kolonne, verdi_kolonne)
) AS kilde
ON  mål.tenant        = kilde.tenant
AND mål.rapport_id    = kilde.rapport_id
AND mål.slicer_tittel = kilde.slicer_tittel

WHEN MATCHED THEN UPDATE SET
  workspace_id     = kilde.workspace_id,
  dataset_id       = kilde.dataset_id,
  slicer_type      = kilde.slicer_type,
  dax_query        = kilde.dax_query,
  forelder_kolonne = kilde.forelder_kolonne,
  verdi_kolonne    = kilde.verdi_kolonne,
  er_aktiv         = 1,
  oppdatert        = SYSUTCDATETIME()

WHEN NOT MATCHED THEN INSERT (
  id, tenant, rapport_id, workspace_id, dataset_id,
  slicer_tittel, slicer_type, dax_query,
  forelder_kolonne, verdi_kolonne,
  er_aktiv, opprettet, oppdatert
)
VALUES (
  LOWER(CONVERT(NVARCHAR(36), NEWID())),
  kilde.tenant, kilde.rapport_id, kilde.workspace_id, kilde.dataset_id,
  kilde.slicer_tittel, kilde.slicer_type, kilde.dax_query,
  kilde.forelder_kolonne, kilde.verdi_kolonne,
  1, SYSUTCDATETIME(), SYSUTCDATETIME()
);
