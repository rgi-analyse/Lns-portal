import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';
import type { config as MssqlConfig } from 'mssql';

function parsePrismaUrl(url: string): MssqlConfig {
  const withoutProtocol = url.replace(/^sqlserver:\/\//, '');
  const parts = withoutProtocol.split(';');
  const [server, portStr] = parts[0].split(':');
  const port = portStr ? parseInt(portStr, 10) : 1433;
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq !== -1) params[part.slice(0, eq).toLowerCase()] = part.slice(eq + 1);
  }
  return {
    server,
    port,
    database: params['database'],
    user: params['user'],
    password: params['password'],
    options: {
      encrypt: params['encrypt'] !== 'false',
      trustServerCertificate: params['trustservercertificate'] === 'true',
      connectTimeout: parseInt(params['connectiontimeout'] ?? '30', 10) * 1000,
    },
  };
}

const adapter = new PrismaMssql(parsePrismaUrl(process.env.DATABASE_URL!));
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Starter seeding...');

  // 0. Opprett standard LNS-tenant (peker på same DB som master)
  const connectionString = process.env.DATABASE_URL!;
  await prisma.tenant.upsert({
    where: { slug: 'lns' },
    update: { databaseUrl: connectionString },
    create: { slug: 'lns', navn: 'LNS', databaseUrl: connectionString },
  });
  console.log('Tenant "lns" klar.');

  // 1. Opprett rapport globalt (uavhengig av workspace)
  const rapport = await prisma.rapport.upsert({
    where: { id: 'seed-rapport-01' },
    update: {},
    create: {
      id:             'seed-rapport-01',
      navn:           'Test Lakehouse',
      beskrivelse:    'Automatisk opprettet testrapport',
      pbiReportId:    '9d4c5b2f-a472-48ac-b25e-8d5cf37c4d8e',
      pbiDatasetId:   '241bde4f-4498-4e8a-9287-d8bf59b80992',
      pbiWorkspaceId: 'b018f0c2-28e0-4c28-bd6c-06a3c287cf26',
    },
  });
  console.log(`Rapport opprettet: ${rapport.navn} (${rapport.id})`);

  // 2. Opprett workspace (organisatorisk mappe, uten PBI-ID)
  const workspace = await prisma.workspace.upsert({
    where: { id: 'seed-workspace-01' },
    update: {},
    create: {
      id:          'seed-workspace-01',
      navn:        'Test Workspace',
      beskrivelse: 'Automatisk opprettet testdata',
      opprettetAv: 'seed',
    },
  });
  console.log(`Workspace opprettet: ${workspace.navn} (${workspace.id})`);

  // 3. Koble rapporten til workspacet via WorkspaceRapport
  await prisma.workspaceRapport.upsert({
    where: {
      workspaceId_rapportId: {
        workspaceId: workspace.id,
        rapportId:   rapport.id,
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      rapportId:   rapport.id,
      rekkefølge:  0,
    },
  });
  console.log(`Rapport koblet til workspace.`);

  console.log('Seeding ferdig.');
}

main()
  .catch((e) => {
    console.error('Seed feilet:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
