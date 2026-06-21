import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { getPrismaForTenant } from '../lib/tenantPrisma';
import type { PrismaClient } from '../generated/prisma/client';

export type TenantRequest = FastifyRequest & {
  tenantPrisma: PrismaClient;
  tenantSlug?: string;
  // Rå databaseUrl for tenant-DB — brukes av ruter som kjører rå SQL via
  // queryAzureSQLForTenant (f.eks. /api/meg/favoritter) i stedet for Prisma.
  tenantDatabaseUrl?: string;
};

/**
 * Kanonisk slug-utleder fra request. X-Tenant-Id-header overstyrer host;
 * host-baserte system-hosts (Azure-domener, localhost, IP-er) faller til
 * 'lns'. Brukes av resolveTenant og av master-DB-endepunkter som er i
 * SKIP_TENANT_PATHS men likevel trenger tenant-binding (f.eks. /api/tema).
 */
export function extractSlug(request: FastifyRequest): string {
  const header = (request.headers['x-tenant-id'] as string | undefined)?.trim().toLowerCase();
  if (header) return header;

  const host = (request.headers['host'] as string | undefined) ?? '';

  // Aldri tolk subdomain fra Azure App Service, localhost eller IP-adresser
  const isSystemHost =
    host.includes('azurewebsites.net') ||
    host.includes('azure.com') ||
    host.includes('.azure.') ||
    host.includes('localhost') ||
    /^[\d.:]+$/.test(host) ||   // ren IP-adresse
    !host.includes('.');         // enkelt hostname uten punktum

  if (!isSystemHost) {
    const sub = host.split('.')[0].toLowerCase();
    if (sub && sub !== 'www') return sub;
  }

  return 'lns';
}

// Ruter som alltid skal bruke master-DB og aldri tenant-resolving
const SKIP_TENANT_PATHS = [
  '/api/me',
  '/api/admin/',
  '/api/auth/',
  '/api/tema',
  '/api/lisens',
  '/api/meg/logg',
  '/health',
];

/**
 * Grense-bevisst matching av skip-path mot request-URL. Oppføringer som slutter
 * på '/' er bevisste prefikser (f.eks. /api/admin/). Øvrige matches kun som
 * eksakt endepunkt eller med ekte understi ('/') — slik at /api/me IKKE svelger
 * /api/meg/favoritter (en ren startsWith ville matchet siden /api/me er en
 * bokstavelig prefiks av /api/meg). Query-string strippes før sammenligning.
 */
function erSkipPath(url: string, skip: string): boolean {
  const path = url.split('?')[0];
  if (skip.endsWith('/')) return path.startsWith(skip);
  return path === skip || path.startsWith(skip + '/');
}

export async function resolveTenant(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (SKIP_TENANT_PATHS.some(p => erSkipPath(request.url, p))) return;

  const slug = extractSlug(request);
  const tenant = await prisma.tenant.findFirst({ where: { slug, erAktiv: true } });
  if (!tenant) {
    return reply.status(404).send({ error: `Tenant '${slug}' ikke funnet.` });
  }
  (request as TenantRequest).tenantPrisma      = getPrismaForTenant(tenant.databaseUrl);
  (request as TenantRequest).tenantSlug        = slug;
  (request as TenantRequest).tenantDatabaseUrl = tenant.databaseUrl;
}

/**
 * Samme som resolveTenant men uten URL-basert skip-sjekk.
 * Brukes på admin-ruter som eksplisitt trenger tenantPrisma.
 */
export async function resolveTenantAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const slug = extractSlug(request);
  const tenant = await prisma.tenant.findFirst({ where: { slug, erAktiv: true } });
  if (!tenant) {
    return reply.status(404).send({ error: `Tenant '${slug}' ikke funnet.` });
  }
  (request as TenantRequest).tenantPrisma      = getPrismaForTenant(tenant.databaseUrl);
  (request as TenantRequest).tenantSlug        = slug;
  (request as TenantRequest).tenantDatabaseUrl = tenant.databaseUrl;
}
