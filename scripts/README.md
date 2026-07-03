# auth-guardrail

Fanger `apiFetch`/`fetch`-kall i `apps/portal` som treffer et `requireBruker`-
beskyttet API-endepunkt **uten** å sende auth-headeren (`X-Entra-Object-Id`).
Forhindrer gjentakelse av `/api/pbi/query-sql`-regresjonen (#99), der `apiFetch`
kun legger på `x-tenant-id` og auth settes manuelt per kall.

## Kjøring

```bash
npm run check:auth            # skann repo — exit ≠ 0 ved brudd
npm run check:auth:selftest   # verifiser selve guardrailen mot fixtures
```

## Hvordan det virker

- **Beskyttet endepunktliste utledes automatisk** fra `apps/api/src/routes/*.ts`
  ved å lese `preHandler`-ene (`requireBruker`/`requireAdmin`/`requireTenantAdmin`/
  `requireAnalyseTilgang`). Ingen håndholdt liste → nytt beskyttet endepunkt
  dekkes automatisk.
- **Presedens** følger Fastify: statisk rute vinner over `:param`-rute (så et
  offentlig `/api/x/statisk` ikke feilaktig matcher et beskyttet `/api/x/:id`).
- **Auth-deteksjon** dekker alle mønstrene i kodebasen: `...authHeaders`,
  `headers: authHeaders`, aliaser (`jsonHeaders`/`metaHeaders`), inline
  `'X-Entra-Object-Id'`, og `const headers`-variabler med entra-tilordning.
- **Fail-closed:** kall til beskyttet endepunkt som ikke *beviselig* er
  autentisert er et brudd.

## Vedlikehold

- **Nytt beskyttet endepunkt:** ingenting å gjøre — utledes fra API. Glemmer et
  frontend-kall auth, feiler `check:auth` med `fil:linje` + matchende rute.
- **Bevisst unntak:** legg en oppføring i `auth-guardrail.allow.ts` med
  `{ fil, endepunkt, reason }`. Begrunnelse er obligatorisk og vurderes i PR.
- **Falske positive/negative:** juster deteksjonen i `auth-guardrail.ts` og legg
  et dekkende scenario i `__fixtures__/` + assert i `auth-guardrail.selftest.ts`.
  (Regex-basert; oppgrader til TypeScript-compiler-API kun ved behov.)

## Filer

| Fil | Rolle |
|---|---|
| `auth-guardrail.ts` | Kjerneskript (eksporterer rene funksjoner for testing) |
| `auth-guardrail.allow.ts` | Allowlist for bevisste unntak |
| `auth-guardrail.selftest.ts` | Selv-test mot fixtures |
| `__fixtures__/*.txt` | Syntetiske ruter/kall (ren tekst, kompileres ikke) |
