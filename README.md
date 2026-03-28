# Synapse Portal

Power BI-portal med Azure Entra ID-autentisering, bygget med Next.js 14 og Fastify.

## Struktur

```
synapse-portal/
├── apps/
│   ├── portal/        # Next.js 14 frontend
│   └── api/           # Fastify API backend
├── packages/
│   └── shared/        # Delte typer og utilities
└── package.json       # Rot workspace-konfigurasjon
```

## Krav

- Node.js 18+
- npm 9+ (workspace-støtte)
- Azure Entra ID-appregistrering (for Power BI og MSAL)

## Oppsett

### 1. Klon og installer avhengigheter

```bash
git clone <repo-url>
cd synapse-portal
npm install
```

### 2. Konfigurer miljøvariabler

**Frontend (apps/portal):**
```bash
cp apps/portal/.env.local.example apps/portal/.env.local
```
Fyll inn Azure-verdiene i `apps/portal/.env.local`.

**API (apps/api):**
```bash
cp apps/api/.env.example apps/api/.env
```
Fyll inn verdiene i `apps/api/.env`.

### 3. Azure Entra ID-oppsett

1. Gå til [Azure Portal](https://portal.azure.com) → Azure Active Directory → App registrations
2. Opprett ny registrering
3. Legg til redirect URI: `http://localhost:3000`
4. Under API permissions, legg til `Power BI Service → Report.Read.All`
5. Kopier **Client ID** og **Tenant ID** til `.env.local`

### 4. Start utvikling

```bash
# Start begge apps
npm run dev

# Eller separat
npm run dev:portal    # http://localhost:3000
npm run dev:api       # http://localhost:3001
```

## API-endepunkter

| Metode | Path      | Beskrivelse         |
|--------|-----------|---------------------|
| GET    | /health   | Helsesjekk          |

## Teknologier

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, MSAL React, PowerBI Client
- **Backend**: Fastify, TypeScript
- **Auth**: Azure Entra ID (MSAL)
