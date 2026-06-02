import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { getPrismaForTenant } from '../lib/tenantPrisma';
import type { PrismaClient } from '../generated/prisma/client';

export type TenantRequest = FastifyRequest & {
  tenantPrisma: PrismaClient;
  tenantSlug?: string;
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

export async function resolveTenant(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (SKIP_TENANT_PATHS.some(p => request.url.startsWith(p))) return;

  const slug = extractSlug(request);
  const tenant = await prisma.tenant.findFirst({ where: { slug, erAktiv: true } });
  if (!tenant) {
    return reply.status(404).send({ error: `Tenant '${slug}' ikke funnet.` });
  }
  (request as TenantRequest).tenantPrisma = getPrismaForTenant(tenant.databaseUrl);
  (request as TenantRequest).tenantSlug   = slug;
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
  (request as TenantRequest).tenantPrisma = getPrismaForTenant(tenant.databaseUrl);
  (request as TenantRequest).tenantSlug   = slug;
}
