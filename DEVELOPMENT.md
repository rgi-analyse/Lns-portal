# Utvikling

## Oversikt

Synapse Portal er et monorepo bygget med npm workspaces. Samme `package-lock.json` i root styrer alle apps og pakker.

## Struktur

- `apps/api` — Fastify API (port 3001)
- `apps/portal` — Next.js frontend (port 3000)
- `packages/db` — Delt Prisma-klient, publisert internt som `@synapse/db`
- `packages/shared` — Delte typer og utilities, `@synapse/shared`

## Kom i gang

```bash
npm install
```

Fra repo-root. `postinstall`-hook i `@synapse/db` kjører `prisma generate` automatisk, så Prisma-klienten ligger klar etter install.

## Dev-oppstart

API:

```bash
npm run dev:api
```

Portal må startes manuelt med HTTPS fordi MSAL krever det lokalt:

```bash
cd apps/portal
npx next dev --experimental-https
```

## Build

```bash
npm run build --workspaces
```

Respekterer byggerekkefølge definert i root `package.json` (db → api → portal).

## Typecheck

```bash
npm run typecheck --workspaces --if-present
```

## Prisma-endringer

Etter endringer i `packages/db/prisma/schema.prisma`:

```bash
npm run db:generate --workspace=@synapse/db
```

Dette regenererer klienten i `packages/db/src/generated/prisma/`.

## Miljøvariabler

- `apps/api/.env` — kopier fra `.env.example` og fyll inn `DATABASE_URL` + Azure-verdier
- `apps/portal/.env.local` — kopier fra `.env.local.example` og fyll inn MSAL/Azure-verdier
