# Deployment til Azure App Service

## Forutsetninger

- Azure App Service Plan (B2 eller høyere anbefalt)
- To App Services: `lns-dataportal-api` og `lns-dataportal-portal`
- Custom domain: `portal.lns.no` og `api.portal.lns.no`
- SSL: Managed certificate i Azure

## Miljøvariabler i Azure Portal

Sett alle variabler fra `.env.production` under
**Configuration → Application Settings** i Azure Portal.

**Ikke commit `.env.production` til Git!**

### Portal (lns-dataportal-portal)
| Variabel | Eksempel |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.portal.lns.no` |
| `NEXTAUTH_URL` | `https://portal.lns.no` |
| `NEXTAUTH_SECRET` | *(generer med `openssl rand -base64 32`)* |

### API (lns-dataportal-api)
| Variabel | Beskrivelse |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `CORS_ORIGIN` | `https://portal.lns.no` |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_KEY` | Azure OpenAI API-nøkkel |
| `AZURE_OPENAI_DEPLOYMENT` | `gpt-4o` |
| `AZURE_SPEECH_KEY` | Azure Speech Services nøkkel |
| `AZURE_SPEECH_REGION` | `norwayeast` |
| `DATABASE_URL` | Azure SQL connection string (Prisma format) |
| `MSAL_CLIENT_ID` | Entra App Registration Client ID |
| `MSAL_CLIENT_SECRET` | Entra App Registration Client Secret |
| `MSAL_TENANT_ID` | Entra Tenant ID |
| `MSAL_REDIRECT_URI` | `https://portal.lns.no/api/auth/callback` |
| `PBI_CLIENT_ID` | Power BI Service Principal Client ID |
| `PBI_CLIENT_SECRET` | Power BI Service Principal Secret |
| `PBI_TENANT_ID` | Power BI Tenant ID |

## Database-migrasjoner

Kjør SQL-skriptene i `apps/api/sql/` i rekkefølge mot Azure SQL-databasen:

```
001_ai_metadata.sql
002_lokal_brukere.sql
003_kolonne_type.sql
004_prosjekt_kolonne.sql
005_bruker_innstillinger.sql
006_mitt_workspace.sql
007_bruker_favoritter.sql
```

## Første deployment

1. Koble GitHub repo (`rgi-analyse/lns-portal`) til Azure App Service
2. Sett opp miljøvariabler i Azure Portal (se over)
3. Aktiver **HTTPS-only** i Azure Portal
4. Konfigurer custom domain (`portal.lns.no` og `api.portal.lns.no`)
5. Aktiver managed SSL-sertifikat

## CI/CD (GitHub Actions)

Workflow i `.github/workflows/deploy.yml` trigges på push til `main`.

Krev følgende GitHub Secrets:
- `API_URL` — `https://api.portal.lns.no`
- `NEXTAUTH_SECRET` — samme verdi som i Azure Portal
- `AZURE_PUBLISH_PROFILE` — lastet ned fra Azure App Service

## Health checks

- Portal: `https://portal.lns.no/api/health`
- API: `https://api.portal.lns.no/health`

Konfigurer Azure App Service Health Check til å bruke disse endepunktene.

## PM2 (alternativ til Azure App Service)

Bruk `ecosystem.config.js` i prosjektroten:

```bash
npm ci
npm run build -w apps/api
npm run build -w apps/portal
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```
