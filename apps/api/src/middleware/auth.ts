import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import type { Bruker } from '@synapse/db';

// Extend FastifyRequest with optional bruker field (set by requireBruker)
export type AuthRequest = FastifyRequest & { bruker: Bruker };

function getEntraId(request: FastifyRequest): string | undefined {
  return (request.headers['x-entra-object-id'] as string | undefined)?.trim() || undefined;
}

/**
 * Slår opp bruker fra X-Entra-Object-Id-headeren.
 * Returnerer 401 dersom header mangler eller bruker ikke er registrert / inaktiv.
 * Festner bruker-objektet på request.bruker for videre bruk.
 */
export async function requireBruker(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const entraObjectId = getEntraId(request);
  if (!entraObjectId) {
    return reply.status(401).send({ error: 'Ikke innlogget.' });
  }

  const bruker = await prisma.bruker.findUnique({ where: { entraObjectId } });
  if (!bruker || !bruker.erAktiv) {
    return reply.status(401).send({ error: 'Bruker ikke registrert eller inaktiv.' });
  }

  (request as AuthRequest).bruker = bruker;
}

/**
 * Krever at pålogget bruker har rolle 'admin' eller 'tenantadmin'.
 * Må brukes etter requireBruker.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const bruker = (request as AuthRequest).bruker;
  const adminRoller = ['admin', 'tenantadmin'];
  if (!bruker || !adminRoller.includes(bruker.rolle)) {
    return reply.status(403).send({ error: 'Krever admin-tilgang.' });
  }
}

/**
 * Krever at pålogget bruker har rolle 'tenantadmin'.
 * Må brukes etter requireBruker.
 */
export async function requireTenantAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const bruker = (request as AuthRequest).bruker;
  if (!bruker || bruker.rolle !== 'tenantadmin') {
    return reply.status(403).send({ error: 'Krever tenantadmin-tilgang.' });
  }
}

/**
 * Returnerer true for roller som har admin-nivå tilgang (admin og tenantadmin).
 */
export function erAdmin(rolle: string | undefined): boolean {
  return rolle === 'admin' || rolle === 'tenantadmin';
}

/**
 * Krever at pålogget bruker har harAnalyseTilgang=true på UserProfile.
 * Må brukes etter requireBruker. Returnerer 403 hvis ikke tilgang.
 */
export async function requireAnalyseTilgang(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const bruker = (request as AuthRequest).bruker;
  if (!bruker) {
    return reply.status(401).send({ error: 'Ikke innlogget.' });
  }
  const profil = await prisma.userProfile.findUnique({
    where: { userId: bruker.id },
    select: { harAnalyseTilgang: true },
  });
  if (!profil?.harAnalyseTilgang) {
    return reply.status(403).send({ error: 'Krever analyse-tilgang.' });
  }
}

/**
 * Hjelpe-funksjon: slår opp Bruker fra header uten å returnere feil.
 * Brukes for ruter som er offentlige men oppfører seg annerledes for admins.
 */
export async function resolveBruker(request: FastifyRequest): Promise<Bruker | null> {
  const entraObjectId = getEntraId(request);
  if (!entraObjectId) return null;
  const bruker = await prisma.bruker.findUnique({ where: { entraObjectId } });
  return bruker?.erAktiv ? bruker : null;
}
