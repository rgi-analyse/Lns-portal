/**
 * Sentralisert feilhåndtering for API-ruter.
 *
 * Mål: ALDRI lekke interne detaljer (err.message, stack, SQL-feil, DB-/PBI-/
 * Graph-interna) til klienten. Klienten får en kort, norsk brukermelding +
 * en korrelasjon-id. Den fulle feilen logges server-side med samme id, så
 * support kan slå den opp i Azure App Service-loggen.
 *
 *   Server-logg:  [ERROR id=a3f9c1e2] POST /api/auth/login-lokal — Kunne ikke logge inn  <full err + stack>
 *   Klient ser:   { error: "Kunne ikke logge inn", korrelasjonId: "a3f9c1e2" }
 *
 * Bruk feilRespons(...) i vanlige ruter. Bruk loggFeil(...) der responsen
 * ikke er en standard reply.send — f.eks. SSE-stream (chat) som selv skriver
 * en { error, korrelasjonId }-payload til strømmen.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { logger } from './logger';

/** Kort, lesbar korrelasjon-id (8 hex-tegn), f.eks. "a3f9c1e2". */
export function nyKorrelasjonId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Logger full feil server-side med korrelasjon-id og request-kontekst, og
 * returnerer den trygge klient-payloaden { error, korrelasjonId } — uten
 * interne detaljer. Brukes direkte når responsen ikke er reply.send.
 */
export function loggFeil(
  brukerMelding: string,
  err: unknown,
  req?: Pick<FastifyRequest, 'method' | 'url'>,
): { error: string; korrelasjonId: string } {
  const korrelasjonId = nyKorrelasjonId();
  const kontekst = req ? `${req.method} ${req.url}` : 'ukjent rute';
  // logger.error sender err verbatim videre til console.error → full stack i Azure-loggen.
  logger.error(`[ERROR id=${korrelasjonId}] ${kontekst} — ${brukerMelding}`, err);
  return { error: brukerMelding, korrelasjonId };
}

/**
 * Standard feilrespons for Fastify-ruter. Logger full err server-side og
 * sender KUN { error: brukerMelding, korrelasjonId } til klienten.
 *
 * @param reply         Fastify reply
 * @param status        HTTP-statuskode (behold rutens eksisterende kode)
 * @param brukerMelding Kort, norsk, ikke-teknisk melding til sluttbruker
 * @param err           Den fangede feilen (logges server-side, aldri til klient)
 */
export function feilRespons(
  reply: FastifyReply,
  status: number,
  brukerMelding: string,
  err: unknown,
): FastifyReply {
  const payload = loggFeil(brukerMelding, err, reply.request);
  return reply.status(status).send(payload);
}
