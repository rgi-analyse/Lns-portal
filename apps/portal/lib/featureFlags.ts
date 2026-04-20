/**
 * Feature flags — kontrollerer tilgang til beta-funksjonalitet.
 */

// Spesifikke brukere med early-access uavhengig av tenant
const BETA_BRUKERE: string[] = [];

// Tenants der ALLE brukere har beta-tilgang
const BETA_TENANTS = ['lns'];

/**
 * Deriv tenant-slug fra hostname (samme logikk som LisensProvider).
 * Returnerer 'lns' på localhost/azurewebsites.net (dev/staging).
 */
export function getTenantSlug(): string {
  if (typeof window === 'undefined') return 'lns';
  const hostname = window.location.hostname;
  if (
    hostname.includes('localhost') ||
    hostname.includes('azurewebsites.net')
  ) {
    return 'lns';
  }
  return hostname.split('.')[0] ?? 'lns';
}

export function harBetaTilgang(
  entraObjectId: string | null | undefined,
  tenantSlug?: string | null,
): boolean {
  if (!entraObjectId) return false;
  const slug = (tenantSlug ?? getTenantSlug()).trim().toLowerCase();

  // Tenant-nivå: alle brukere i listede tenants har beta
  if (BETA_TENANTS.includes(slug)) return true;

  // Bruker-nivå: spesifikke IDer på tvers av tenants
  return BETA_BRUKERE.includes(entraObjectId.trim().toLowerCase());
}
