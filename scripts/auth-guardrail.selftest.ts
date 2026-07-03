/**
 * Selv-test for auth-guardrail. Kjører parserne mot syntetiske fixtures og
 * verifiserer at kategoriseringen er korrekt FØR skriptet stoles på mot ekte
 * repo. Kjøres: `npm run check:auth:selftest` (exit ≠ 0 ved feil).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseApiRoutes, parsePortalCalls, evaluate, type Route } from './auth-guardrail';

let feil = 0;
function ok(cond: boolean, navn: string) {
  console.log(`${cond ? '  ✓' : '  ✗ FEIL:'} ${navn}`);
  if (!cond) feil++;
}
/** «beskyttet» = ruten finnes OG krever auth (requireBruker eller konservativ). */
function isProtected(routes: Route[], method: string, rawPath: string): boolean {
  return routes.some((r) => r.method === method && r.rawPath === rawPath && (r.requiresAuth || r.conservative));
}

const fx = path.join(__dirname, '__fixtures__');
const routesSrc = fs.readFileSync(path.join(fx, 'api-routes.fixture.txt'), 'utf-8');
const callsSrc = fs.readFileSync(path.join(fx, 'portal-calls.fixture.txt'), 'utf-8');

console.log('\nauth-guardrail selv-test\n');

// ── API-rute-utledning ──
const routes = parseApiRoutes(routesSrc, 'fixture/api-routes');
console.log('API-rute-utledning:');
ok(isProtected(routes, 'POST', '/api/protected-thing'), 'POST /api/protected-thing → beskyttet (inline requireBruker)');
ok(isProtected(routes, 'POST', '/api/protected-thing/:id'), 'POST /api/protected-thing/:id → beskyttet (param)');
ok(isProtected(routes, 'GET', '/api/shared-pre-thing'), 'GET /api/shared-pre-thing → beskyttet (delt const PRE)');
ok(isProtected(routes, 'GET', '/api/unresolved-thing'), 'GET /api/unresolved-thing → beskyttet (konservativt, uløst PRE)');
ok(routes.find((r) => r.rawPath === '/api/unresolved-thing')?.conservative === true, '  …markert conservative');
ok(isProtected(routes, 'POST', '/api/items/:id'), 'POST /api/items/:id → beskyttet');
ok(!isProtected(routes, 'GET', '/api/public-thing'), 'GET /api/public-thing → IKKE beskyttet (offentlig)');
ok(!isProtected(routes, 'GET', '/api/items/:id'), 'GET /api/items/:id → IKKE beskyttet (metode-mismatch)');
ok(isProtected(routes, 'GET', '/api/dyn/:id'), 'GET /api/dyn/:id → beskyttet (param)');
ok(!isProtected(routes, 'GET', '/api/dyn/static-thing'), 'GET /api/dyn/static-thing → IKKE beskyttet (statisk offentlig)');
ok(!isProtected(routes, 'GET', '/api/no-options-thing'), 'GET /api/no-options-thing → IKKE beskyttet (bleed-test: ingen options)');
ok(isProtected(routes, 'POST', '/api/after-no-options'), 'POST /api/after-no-options → beskyttet (etter no-options-rute)');

// ── Portal-kall + evaluering ──
const calls = parsePortalCalls(callsSrc, 'fixture/portal-calls');
const { violations } = evaluate(calls, routes, []);
const vset = new Set(violations.map((v) => `${v.call.method} ${v.endpoint}`));

console.log('\nKall-evaluering (forventer 4 brudd: [2], [5b], [6], [9]):');
ok(violations.length === 4, `antall brudd === 4 (fikk ${violations.length})`);
ok(vset.has('POST /api/protected-thing'), '[2] beskyttet + ingen auth → brudd');
ok(vset.has('POST /api/items/VAR'), '[5b] POST items beskyttet + ingen auth → brudd');
ok(vset.has('POST /api/protected-thing/VAR'), '[6] template-literal beskyttet + ingen auth → brudd');
ok(vset.has('GET /api/dyn/VAR'), '[9] param-beskyttet uten auth → brudd');

console.log('\nIkke-brudd (auth/presedens oppdaget korrekt):');
ok(violations.filter((v) => v.endpoint === '/api/protected-thing').length === 1,
  '[1] spread, [3] alias, [7] shorthand headers m/ entra → IKKE brudd (kun [2] gjenstår)');
ok(!vset.has('GET /api/public-thing') && !vset.has('GET /api/items/VAR'),
  '[4] offentlig + [5a] GET items → IKKE brudd');
ok(!vset.has('GET /api/dyn/static-thing'),
  '[8] statisk offentlig vinner over param-beskyttet → IKKE brudd');

console.log(feil === 0 ? '\n✅ Selv-test bestått.\n' : `\n❌ Selv-test feilet: ${feil} assert(er).\n`);
process.exit(feil === 0 ? 0 : 1);
