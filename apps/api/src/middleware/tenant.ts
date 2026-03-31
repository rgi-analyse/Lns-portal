import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { getPrismaForTenant } from '../lib/tenantPrisma';
import type { PrismaClient } from '../generated/prisma/client';

export type TenantRequest = FastifyRequest & { tenantPrisma: PrismaClient };

function extractSlug(request: FastifyRequest): string {
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

export async function resolveTenant(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const slug = extractSlug(request);
  const tenant = await prisma.tenant.findFirst({ where: { slug, erAktiv: true } });
  if (!tenant) {
    return reply.status(404).send({ error: `Tenant '${slug}' ikke funnet.` });
  }
  (request as TenantRequest).tenantPrisma = getPrismaForTenant(tenant.databaseUrl);
}
