# Schema-migrasjoner

## Hvorfor automatisert

Tidligere ble schema-endringer kjørt manuelt i SSMS, og prod-DB hadde
ingen `_prisma_migrations`-tabell. Konsekvensen var at vi ikke kunne
være sikre på om en migrasjon hadde kjørt — og at ny kode kunne ende
opp mot gammelt schema.

Fra 2026-06-05 kjører deploy-pipelinen `prisma migrate deploy` mot
prod master-DB **før** API og Portal deployes. Hvis migrasjonen feiler,
stopper hele deployen.

## De fem reglene for `migration.sql`

1. **Transaksjon** — wrap i `BEGIN TRY / BEGIN TRAN / COMMIT / CATCH ROLLBACK / THROW`.
2. **Idempotens** — alle DDL bak `IF EXISTS` / `IF NOT EXISTS`-guards. Migrasjonen skal kunne re-kjøres trygt.
3. **Dynamic SQL for ny-kolonne-DML** — `EXEC sp_executesql N'UPDATE ...'` for DML som refererer til kolonner lagt til i samme migrasjon. SSMS' batch-parser sjekker kolonne-eksistens ved parse-tid (deferred name resolution gjelder kun objekt-navn, ikke kolonne-navn); `sp_executesql` utsetter resolving til exec-tid og er den eneste pålitelige måten å kjøre `ALTER ADD col` etterfulgt av `UPDATE ... SET col = ...` i samme migrasjon.
4. **Ingen `GO`** — `prisma migrate deploy` splitter SQL-en på `;` og kjenner ikke `GO` (som er et sqlcmd/SSMS-direktiv, ikke T-SQL). En `GO` i `migration.sql` vil sendes som SQL-statement og feile. Hvis du må kjøre manuelt i SSMS som fallback, legg `GO` i en lokal kopi — men commit aldri en `migration.sql` med `GO`.
5. **Forward-only** — drop ikke en kolonne som prod-kode fortsatt leser. Destruktive endringer gjøres i to faser, hver i egen PR/migrasjon: først fjern lese-koden og deploy, så lag ny migrasjon som dropper kolonnen.

## Eksempel — riktig form

```sql
BEGIN TRY

BEGIN TRAN;

-- Legger til tenantSlug på OrganisasjonTema og backfiller eksisterende rad til 'lns'.
-- Idempotent: trygt å re-kjøre.

-- 1. Legg til kolonne nullable (regel 2: IF NOT EXISTS)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'tenantSlug'
    AND Object_ID = Object_ID(N'dbo.OrganisasjonTema')
)
ALTER TABLE [dbo].[OrganisasjonTema] ADD [tenantSlug] NVARCHAR(100) NULL;

-- 2. Backfill via dynamic SQL (regel 3: sp_executesql for DML mot ny kolonne)
EXEC sp_executesql N'
  UPDATE [dbo].[OrganisasjonTema]
  SET    [tenantSlug] = ''lns''
  WHERE  [tenantSlug] IS NULL;
';

-- 3. Sett NOT NULL (regel 2: betinget ALTER)
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = N'tenantSlug'
    AND Object_ID = Object_ID(N'dbo.OrganisasjonTema')
    AND is_nullable = 1
)
ALTER TABLE [dbo].[OrganisasjonTema]
  ALTER COLUMN [tenantSlug] NVARCHAR(100) NOT NULL;

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
```

Merk: ingen `GO`, alle DDL har eksistens-sjekk, DML mot ny kolonne
går via `sp_executesql`, og alt er forward-only.

## Sjekkliste per PR med schema-endring

- [ ] Endring i `apps/api/prisma/schema.prisma`.
- [ ] Kjør lokalt mot dev-DB: `cd apps/api && DATABASE_URL='<dev>' npx prisma migrate dev --name <kebab-navn>`.
- [ ] Inspisér generert `migration.sql` — passer reglene 1–5? Prisma genererer ofte SQL som bryter regel 3 (DML mot ny kolonne uten dynamic SQL). Rediger fila manuelt før commit hvis nødvendig.
- [ ] Drop dev-DB schema, kjør `npx prisma migrate deploy` fra rent state — verifiser at den bygger korrekt.
- [ ] Migration-mappen + `schema.prisma`-diff commit'es i samme PR som koden som bruker endringen.
- [ ] PR-beskrivelsen sier om migrasjonen er additiv eller destruktiv.

## Når noe går galt

**Forward-only-prinsippet:** lag NY migrasjon som korrigerer. Rediger
aldri en `migration.sql` som er applisert i prod. Kjør aldri manuell
SQL i prod uten å legge resultatet inn i en migrasjon — ellers driver
schema og repo fra hverandre, og neste `migrate deploy` kan feile på
umulig diff.

Hvis prod og repo har drevet: `npx prisma migrate diff` viser
forskjellen. Lag korrigerende migrasjon basert på outputen.

**Feilsøking når deploy-migrations-jobben feiler i pipelinen:**
Kjør `npx prisma migrate status` lokalt mot
`PROD_MASTER_DATABASE_URL`-secret for å se nøyaktig tilstand. Outputen
viser:

- Om migrasjonen aldri startet (siste applied = forrige migrasjon) →
  trygt å fikse `migration.sql` og re-trigger deployen.
- Om migrasjonen er delvis applisert (rad finnes i `_prisma_migrations`
  uten `finished_at`) → DB er i mellomtilstand. BEGIN TRY/CATCH skal ha
  rollback'et endringene, men sjekk faktisk schema-state i SSMS før du
  fikser noe. Lag en korrigerende migrasjon hvis nødvendig, og bruk
  `prisma migrate resolve --rolled-back <navn>` for å rydde
  mellomraden før neste deploy.
- Om alt er applisert men `status` rapporterer drift → schema er endret
  utenfor migrasjonene. Bruk `migrate diff` mot schema.prisma for å se
  hva som mangler.
