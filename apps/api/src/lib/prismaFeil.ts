/**
 * Gjenkjenning av kjente Prisma-feilkoder, så ruter kan svare med presis
 * HTTP-status (404/409) i stedet for generisk 500.
 *
 *   P2025 = "An operation failed because it depends on one or more records
 *            that were required but not found" (update/delete på ikke-eksisterende rad)
 *   P2002 = "Unique constraint failed" (duplikat)
 *
 * https://www.prisma.io/docs/orm/reference/error-reference
 */
function prismaKode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const kode = (err as { code?: unknown }).code;
    return typeof kode === 'string' ? kode : undefined;
  }
  return undefined;
}

/** P2025 — rad ikke funnet (update/delete på ikke-eksisterende post) → 404. */
export const erIkkeFunnet = (err: unknown): boolean => prismaKode(err) === 'P2025';

/** P2002 — unique-constraint-brudd (duplikat) → 409. */
export const erDuplikat = (err: unknown): boolean => prismaKode(err) === 'P2002';
