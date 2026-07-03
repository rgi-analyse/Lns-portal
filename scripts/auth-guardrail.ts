/**
 * auth-guardrail — Fase 3 (security/auth-guardrail-script)
 *
 * Fanger apiFetch/fetch-kall i apps/portal som treffer et `requireBruker`-
 * beskyttet API-endepunkt UTEN å sende auth-headeren (X-Entra-Object-Id).
 * Dette er regresjonen fra `/api/pbi/query-sql` (#99): apiFetch legger kun på
 * x-tenant-id, auth settes manuelt per kall.
 *
 * Kjernedesign:
 *  - Den beskyttede endepunktlisten UTLEDES automatisk fra API-koden
 *    (apps/api/src/routes/*.ts) ved å lese preHandlers. Ingen håndholdt liste
 *    → et nytt requireBruker-endepunkt dekkes automatisk.
 *  - FAIL-CLOSED: et kall til et beskyttet endepunkt som ikke *beviselig* er
 *    autentisert er et brudd (må fikses med ...authHeaders eller allowlistes).
 *  - Regex-basert (samme tilnærming som audit Fase 1). Ingen nye avhengigheter.
 *
 * Eksporterer rene funksjoner for selv-test (scripts/auth-guardrail.selftest.ts).
 * Kjøres: `npm run check:auth` (exit ≠ 0 ved brudd).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ALLOW, type Allow } from './auth-guardrail.allow';

/** Auth-guards som betyr at endepunktet krever X-Entra-Object-Id-header. */
const AUTH_GUARDS = ['requireBruker', 'requireAdmin', 'requireTenantAdmin', 'requireAnalyseTilgang'];

export interface Route {
  method: string;          // GET/POST/...
  rawPath: string;         // '/api/rapporter/:id/views'
  regex: RegExp;           // ^/api/rapporter/[^/]+/views$
  requiresAuth: boolean;   // preHandler inneholder en auth-guard
  conservative: boolean;   // uløst preHandler-referanse → antatt beskyttet
  guard: string;           // hvilken backend-vakt (f.eks. 'requireBruker')
  paramCount: number;      // antall :param-segmenter (for presedens: statisk > param)
  file: string;
  line: number;
}

export interface PortalCall {
  fn: string;              // apiFetch | fetch
  endpoints: string[];     // normaliserte '/api/...'-kandidater (kan være flere ved ternær)
  method: string;
  hasAuth: boolean;
  file: string;
  line: number;
  rawFirstArg: string;
  unresolved: boolean;     // kunne ikke utlede /api/-endepunkt
}

export interface Violation {
  call: PortalCall;
  route: Route;
  endpoint: string;
}

// ─────────────────────────── hjelpere ───────────────────────────

function lineOf(src: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') n++;
  return n;
}

function pathToRegex(p: string): RegExp {
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withParams = esc.replace(/:[A-Za-z0-9_]+/g, '[^/]+');
  return new RegExp('^' + withParams + '$');
}

/** Normaliser et portal-endepunkt til '/api/...'-form for matching. */
export function normalizeEndpoint(raw: string): string | null {
  let e = raw;
  const qi = e.indexOf('?');
  if (qi >= 0) e = e.slice(0, qi);
  const ai = e.indexOf('/api/');
  if (ai < 0) return null;
  e = e.slice(ai);
  e = e.replace(/\$\{[^}]*\}/g, 'VAR'); // interpolerte segmenter → placeholder-verdi
  e = e.replace(/`|'|"/g, '').trim();
  return e.startsWith('/api/') ? e : null;
}

/** Slice av teksten inne i (...) fra en åpen-parentes-indeks, streng-bevisst. */
function sliceBalanced(src: string, openIdx: number): { text: string; end: number } {
  let depth = 0, i = openIdx;
  let inStr: string | null = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) { i++; break; } }
  }
  return { text: src.slice(openIdx + 1, i - 1), end: i };
}

/** Splitt call-argumenter på topp-nivå-komma (streng/klamme-bevisst). */
function splitTopLevelArgs(argsText: string): string[] {
  const out: string[] = [];
  let depth = 0, inStr: string | null = null, last = 0;
  for (let i = 0; i < argsText.length; i++) {
    const c = argsText[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(argsText.slice(last, i)); last = i + 1; }
  }
  out.push(argsText.slice(last));
  return out;
}

// ─────────────────────────── API-rute-parsing ───────────────────────────

export function parseApiRoutes(src: string, file: string): Route[] {
  // 1. auth-bærende const-arrays: const PRE = [ ...requireBruker... ]
  const authConst = new Map<string, string[]>();
  const constArrRe = /(?:const|let)\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = constArrRe.exec(src))) {
    const guards = AUTH_GUARDS.filter((g) => m![2].includes(g));
    if (guards.length) authConst.set(m[1], guards);
  }

  // 2. rute-registreringer — ALLE ruter (også offentlige), for korrekt presedens.
  const routes: Route[] = [];
  const routeRe = /fastify\.(get|post|put|patch|delete)\b\s*(?:<[^>]*>)?\s*\(/g;
  while ((m = routeRe.exec(src))) {
    const method = m[1].toUpperCase();
    const openIdx = routeRe.lastIndex - 1;
    const { text: argsText } = sliceBalanced(src, openIdx);
    const args = splitTopLevelArgs(argsText);
    const pathM = (args[0] ?? '').match(/['"`]([^'"`]+)['"`]/);
    if (!pathM) continue;
    const rawPath = pathM[1];
    if (!rawPath.startsWith('/api/')) continue;

    // Options-objektet er første arg (etter path) som starter med '{' — IKKE
    // async-handleren. Slik unngår vi at preHandler fra neste rute lekker inn.
    const optionsArg = args.slice(1).find((a) => a.trim().startsWith('{')) ?? '';
    let requiresAuth = false, conservative = false, guards: string[] = [];
    const phM = optionsArg.match(/preHandler\s*:\s*(\[[^\]]*\]|[A-Za-z0-9_]+)/);
    if (phM) {
      const ph = phM[1];
      if (ph.startsWith('[')) { guards = AUTH_GUARDS.filter((g) => ph.includes(g)); requiresAuth = guards.length > 0; }
      else if (authConst.has(ph)) { guards = authConst.get(ph)!; requiresAuth = true; }
      else conservative = true; // uløst referanse → antatt beskyttet
    }
    routes.push({
      method, rawPath, regex: pathToRegex(rawPath), requiresAuth, conservative,
      guard: guards.join(', ') || (conservative ? 'konservativ (uløst preHandler)' : ''),
      paramCount: (rawPath.match(/:[A-Za-z0-9_]+/g) || []).length,
      file, line: lineOf(src, m.index),
    });
  }
  return routes;
}

// ─────────────────────────── Portal-kall-parsing ───────────────────────────

/** Bygg settet av variabelnavn i filen som bærer auth-header. */
function authCarryingVars(src: string): Set<string> {
  const vars = new Set<string>(['authHeaders']);
  const declRe = /(?:const|let)\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*([^;\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(src))) {
    if (/\bauthHeaders\b/.test(m[2]) || /X-Entra-Object-Id/i.test(m[2])) vars.add(m[1]);
  }
  const assignRe = /([A-Za-z0-9_]+)\s*\[\s*['"]X-Entra-Object-Id['"]\s*\]\s*=/gi;
  while ((m = assignRe.exec(src))) vars.add(m[1]);
  return vars;
}

/** Avgjør om options-teksten sender auth (dekker alle 5 mønstre). */
function optionsHaveAuth(options: string, authVars: Set<string>): boolean {
  if (/X-Entra-Object-Id/i.test(options)) return true;              // inline literal
  if (/\.\.\.\s*authHeaders/.test(options)) return true;            // ...authHeaders
  // headers: <ident>
  const hv = options.match(/headers\s*:\s*([A-Za-z0-9_]+)/);
  if (hv && authVars.has(hv[1])) return true;
  // headers: { ... } — sjekk spreads av auth-vars
  const inline = options.match(/headers\s*:\s*\{([^}]*)\}/);
  if (inline) {
    const spreadM = inline[1].match(/\.\.\.\s*([A-Za-z0-9_]+)/g) || [];
    for (const s of spreadM) { const name = s.replace(/\.\.\.|\s/g, ''); if (authVars.has(name)) return true; }
  }
  // property-shorthand `headers` (verdi = variabel `headers`)
  if (/(^|[{,\s])headers(\s*[,}]|$)/.test(options) && authVars.has('headers')) return true;
  return false;
}

/** Prøv å utlede /api/-endepunkt(er) fra første argument. */
function resolveEndpoints(firstArg: string, src: string, callIdx: number): { endpoints: string[]; unresolved: boolean } {
  const direct = normalizeEndpoint(firstArg);
  if (direct) return { endpoints: [direct], unresolved: false };
  // variabel: ta ledende identifikator (før .replace(...) e.l.)
  const idM = firstArg.trim().match(/^([A-Za-z0-9_]+)/);
  if (!idM) return { endpoints: [], unresolved: true };
  const id = idM[1];
  // finn siste `const id = ...` før kall-stedet
  const declRe = new RegExp('(?:const|let)\\s+' + id + '\\s*(?::[^=]+)?=', 'g');
  let last = -1, m: RegExpExecArray | null;
  while ((m = declRe.exec(src)) && m.index < callIdx) last = m.index;
  if (last < 0) return { endpoints: [], unresolved: true };
  const win = src.slice(last, last + 400);
  const apiM = win.match(/\/api\/[^\s'"`)]+/g) || [];
  const eps = apiM.map((e) => normalizeEndpoint(e)).filter((e): e is string => !!e);
  return eps.length ? { endpoints: [...new Set(eps)], unresolved: false } : { endpoints: [], unresolved: true };
}

export function parsePortalCalls(src: string, file: string): PortalCall[] {
  const authVars = authCarryingVars(src);
  const calls: PortalCall[] = [];
  const callRe = /\b(apiFetch|fetch)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(src))) {
    const fn = m[1];
    const openIdx = callRe.lastIndex - 1;
    const { text: argsText } = sliceBalanced(src, openIdx);
    const args = splitTopLevelArgs(argsText);
    const firstArg = (args[0] ?? '').trim();
    const options = args.slice(1).join(',');
    const { endpoints, unresolved } = resolveEndpoints(firstArg, src, openIdx);
    // rå fetch uten /api/ → ikke vår sak
    if (endpoints.length === 0 && unresolved && !/\/api\//.test(firstArg)) {
      if (fn === 'fetch') continue; // ekstern fetch
    }
    if (endpoints.length === 0 && !/\bapiFetch\b/.test(fn) && !/\/api\//.test(firstArg)) continue;
    const methodM = options.match(/method\s*:\s*['"]([A-Za-z]+)['"]/);
    const method = (methodM ? methodM[1] : 'GET').toUpperCase();
    calls.push({
      fn, endpoints, method,
      hasAuth: optionsHaveAuth(options, authVars),
      file, line: lineOf(src, m.index), rawFirstArg: firstArg.slice(0, 80), unresolved: endpoints.length === 0,
    });
  }
  return calls;
}

// ─────────────────────────── evaluering ───────────────────────────

function isAllowlisted(call: PortalCall, endpoint: string, allow: Allow[]): boolean {
  return allow.some((a) =>
    call.file.replace(/\\/g, '/').endsWith(a.fil.replace(/\\/g, '/')) &&
    (a.endepunkt === '*' || endpoint.includes(a.endepunkt) || a.endepunkt.includes(endpoint)),
  );
}

export function evaluate(calls: PortalCall[], routes: Route[], allow: Allow[]): {
  violations: Violation[];
  allowlisted: Violation[];
  unresolvedCalls: PortalCall[];
} {
  const violations: Violation[] = [];
  const allowlisted: Violation[] = [];
  const unresolvedCalls: PortalCall[] = [];
  for (const call of calls) {
    // Uløst endepunkt: kun verdt manuell verifisering hvis kallet OGSÅ mangler
    // auth (et authet kall er trygt uansett endepunkt).
    if (call.unresolved) { if (!call.hasAuth) unresolvedCalls.push(call); continue; }
    if (call.hasAuth) continue;
    for (const ep of call.endpoints) {
      const candidates = routes.filter((r) => r.method === call.method && r.regex.test(ep));
      if (!candidates.length) continue;
      // Fastify-presedens: mest statiske rute vinner (færrest :param, så lengst path).
      candidates.sort((a, b) => a.paramCount - b.paramCount || b.rawPath.length - a.rawPath.length);
      const route = candidates[0];
      if (!route.requiresAuth && !route.conservative) continue; // vinnende rute er offentlig
      const v: Violation = { call, route, endpoint: ep };
      if (isAllowlisted(call, ep, allow)) allowlisted.push(v);
      else violations.push(v);
      break;
    }
  }
  return { violations, allowlisted, unresolvedCalls };
}

// ─────────────────────────── fil-traversering + main ───────────────────────────

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '__fixtures__') continue;
      out.push(...walk(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

export function runGuardrail(repoRoot: string, allow: Allow[] = ALLOW) {
  const routeFiles = walk(path.join(repoRoot, 'apps/api/src/routes'), ['.ts']);
  const routes: ProtectedRoute[] = [];
  for (const f of routeFiles) routes.push(...parseApiRoutes(fs.readFileSync(f, 'utf-8'), path.relative(repoRoot, f)));

  const portalDirs = ['app', 'components', 'lib', 'services', 'hooks'].map((d) => path.join(repoRoot, 'apps/portal', d));
  const calls: PortalCall[] = [];
  for (const dir of portalDirs)
    for (const f of walk(dir, ['.ts', '.tsx'])) {
      if (path.basename(f) === 'apiClient.ts') continue; // definisjonen av apiFetch, ikke et kall-sted
      calls.push(...parsePortalCalls(fs.readFileSync(f, 'utf-8'), path.relative(repoRoot, f)));
    }

  return { routes, calls, ...evaluate(calls, routes, allow) };
}

// Direkte kjøring (ikke ved import fra selv-test)
const isMain = process.argv[1] && /auth-guardrail\.ts$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const repoRoot = path.resolve(__dirname, '..');
  const { routes, calls, violations, allowlisted, unresolvedCalls } = runGuardrail(repoRoot);
  const beskyttet = routes.filter((r) => r.requiresAuth || r.conservative).length;
  console.log(`\n🔒 auth-guardrail`);
  console.log(`   API-ruter utledet:            ${routes.length} (${beskyttet} krever auth)`);
  console.log(`   Portal-kall skannet:          ${calls.length}`);
  console.log(`   Allowlistede unntak:          ${allowlisted.length}`);
  console.log(`   Uløste endepunkt (info):      ${unresolvedCalls.length}`);
  if (unresolvedCalls.length) {
    console.log(`\n   ℹ️  Kall der endepunkt ikke kunne utledes (manuell verifisering):`);
    for (const c of unresolvedCalls) console.log(`      ${c.file}:${c.line}  ${c.fn}(${c.rawFirstArg})`);
  }
  if (violations.length) {
    const p = (s: string) => s.replace(/\\/g, '/');
    console.error(`\n❌ AUTH-GUARDRAIL BRUDD (${violations.length})\n`);
    for (const v of violations) {
      console.error(`  Fil:          ${p(v.call.file)}:${v.call.line}`);
      console.error(`  Kall:         ${v.call.fn}(${v.call.rawFirstArg}, …)`);
      console.error(`  Endepunkt:    ${v.call.method} ${v.endpoint}`);
      console.error(`  Backend-vakt: ${v.route.guard}  (${p(v.route.file)}:${v.route.line} — ${v.route.rawPath})`);
      console.error(`  Løsning:`);
      console.error(`    Legg til ...authHeaders (fra usePortalAuth):`);
      console.error(`      headers: { ...authHeaders, 'Content-Type': 'application/json' }`);
      console.error(`    Eller legg til i scripts/auth-guardrail.allow.ts med begrunnelse.\n`);
    }
    console.error(`Se scripts/README.md for detaljer.\n`);
    process.exit(1);
  }
  console.log(`\n✅ Ingen brudd. Alle beskyttede endepunkt-kall sender auth-header.\n`);
}
