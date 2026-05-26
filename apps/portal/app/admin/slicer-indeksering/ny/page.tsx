'use client';

/**
 * Wizard: ny slicer-indekserings-konfig.
 * Bruker glass-morphic dark for chrome/banner, light cards for input-skjema —
 * matcher form-stilen i /admin/workspaces/ny.
 *
 * Fire steg:
 *   1. Velg rapport (søkbar dropdown — 92 rapporter for LNS)
 *   2. Slicer-detaljer (tittel + type)
 *   3. Datakilde (tabell + kolonner med Test-knapp som kaller
 *      /api/admin/datasets/:ws/:ds/tabeller?tabell=...)
 *   4. Preview (auto-generert DAX) + Opprett og indekser
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import {
  adminApi,
  type RapportMedSlicereOversikt,
  type TabellKolonne,
  type TabellNavn,
  type OpprettBody,
} from '../_lib';

type Steg = 1 | 2 | 3 | 4;

interface Form {
  rapport:        RapportMedSlicereOversikt | null;
  slicer_tittel:  string;
  slicer_type:    'basic' | 'hierarchy';
  tabell:         string;
  verdi_kolonne:  string;
  forelder_kolonne: string;
}

const TOMT_FORM: Form = {
  rapport:        null,
  slicer_tittel:  '',
  slicer_type:    'basic',
  tabell:         '',
  verdi_kolonne:  '',
  forelder_kolonne: '',
};

// ── Steg-indikator ─────────────────────────────────────────────────────

function StegIndikator({ aktiv }: { aktiv: Steg }) {
  const steg = [1, 2, 3, 4] as const;
  const navn = ['Rapport', 'Slicer', 'Datakilde', 'Bekreft'];
  return (
    <ol className="flex items-center gap-2 mb-6">
      {steg.map((s, i) => {
        const ferdig = s < aktiv;
        const denne  = s === aktiv;
        return (
          <li key={s} className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={
                denne ? {
                  background: 'var(--gold)', color: 'var(--navy-darkest)', boxShadow: '0 0 0 4px var(--glass-gold-bg)',
                } : ferdig ? {
                  background: 'var(--glass-gold-bg)', color: 'var(--gold)', border: '1px solid var(--glass-gold-border)',
                } : {
                  background: 'var(--glass-bg)', color: 'var(--text-muted)', border: '1px solid var(--glass-bg-hover)',
                }
              }
            >
              {ferdig ? <Check className="w-3.5 h-3.5" /> : s}
            </div>
            <span className="text-xs uppercase tracking-wider font-semibold" style={{
              color: denne ? 'var(--text-primary)' : ferdig ? 'var(--text-secondary)' : 'var(--text-muted)',
            }}>
              {navn[i]}
            </span>
            {i < steg.length - 1 && <span className="w-6 h-px" style={{ background: 'var(--glass-bg-hover)' }} />}
          </li>
        );
      })}
    </ol>
  );
}

// ── Søkbar rapport-dropdown ────────────────────────────────────────────

function RapportVelger({
  rapporter,
  valgt,
  onVelg,
}: {
  rapporter: RapportMedSlicereOversikt[];
  valgt:     RapportMedSlicereOversikt | null;
  onVelg:    (r: RapportMedSlicereOversikt) => void;
}) {
  const [åpen, setÅpen]   = useState(false);
  const [filter, setFilter] = useState('');
  const [kunUtenIndeks, setKunUtenIndeks] = useState(false);

  const filtrert = rapporter.filter((r) => {
    if (kunUtenIndeks && r.antall_indekserte > 0) return false;
    if (!filter) return true;
    const f = filter.toLowerCase();
    return r.navn.toLowerCase().includes(f) || (r.område?.toLowerCase().includes(f) ?? false);
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setÅpen((v) => !v)}
        className="w-full flex items-center justify-between rounded-md px-3 py-2 text-sm text-left transition-colors"
        style={{
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-bg-hover)',
          color: 'var(--text-primary)',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-gold-border)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-bg-hover)'; }}
      >
        <span style={{ color: valgt ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {valgt ? `${valgt.navn}${valgt.område ? ` — ${valgt.område}` : ''}` : 'Velg rapport…'}
        </span>
        <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
      </button>

      {åpen && (
        <div
          className="absolute top-full left-0 right-0 mt-1 z-30 rounded-lg overflow-hidden shadow-xl"
          style={{
            maxHeight: 380,
            background: 'rgba(10,22,40,0.96)',
            backdropFilter: 'blur(30px)',
            WebkitBackdropFilter: 'blur(30px)',
            border: '1px solid var(--glass-bg-hover)',
          }}
        >
          <div className="p-2 space-y-2" style={{ borderBottom: '1px solid var(--glass-bg-hover)' }}>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Søk i ${rapporter.length} rapporter…`}
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md focus:outline-none transition-colors"
                style={{
                  background: 'var(--glass-bg)',
                  border: '1px solid var(--glass-bg-hover)',
                  color: 'var(--text-primary)',
                }}
                onFocus={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--glass-gold-border)'; }}
                onBlur={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--glass-bg-hover)'; }}
              />
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={kunUtenIndeks}
                onChange={(e) => setKunUtenIndeks(e.target.checked)}
                className="rounded"
                style={{ accentColor: 'var(--gold)' }}
              />
              Vis kun rapporter uten indeksering
            </label>
          </div>
          <ul className="overflow-y-auto" style={{ maxHeight: 290 }}>
            {filtrert.length === 0 ? (
              <li className="px-3 py-4 text-sm text-center" style={{ color: 'var(--text-muted)' }}>Ingen treff</li>
            ) : filtrert.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => { onVelg(r); setÅpen(false); setFilter(''); }}
                  className="w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 transition-colors"
                  style={{ background: 'transparent' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-gold-bg)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{r.navn}</div>
                    {r.område && <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{r.område}</div>}
                  </div>
                  <div className="text-xs whitespace-nowrap shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {r.antall_indekserte > 0 ? `${r.antall_indekserte} indeksert` : 'ingen indeksering'}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Hovedkomponent ─────────────────────────────────────────────────────

export default function NyKonfigurasjonPage() {
  const router = useRouter();
  const { accounts } = useMsal();
  const entraObjectId = accounts[0]?.localAccountId ?? '';

  const [steg, setSteg] = useState<Steg>(1);
  const [form, setForm] = useState<Form>(TOMT_FORM);
  const [rapporter, setRapporter] = useState<RapportMedSlicereOversikt[] | null>(null);

  // Tabell-test resultater
  const [tester, setTester] = useState(false);
  const [kolonner, setKolonner] = useState<TabellKolonne[] | null>(null);
  const [tabellFeil, setTabellFeil] = useState<string | null>(null);

  // Tabell-dropdown (auto-utfylling fra PBI-datasettet)
  const [tabeller, setTabeller] = useState<TabellNavn[] | null>(null);
  const [tabellerLaster, setTabellerLaster] = useState(false);
  const [tabellerFeil, setTabellerFeil] = useState<string | null>(null);

  // Submit
  const [oppretter, setOppretter] = useState(false);

  const lastRapporter = useCallback(async () => {
    if (!entraObjectId) return;
    try {
      const r = await adminApi.rapporterMedSlicere(entraObjectId);
      setRapporter(r);
    } catch (err) {
      toast({ title: 'Kunne ikke laste rapporter', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    }
  }, [entraObjectId]);

  useEffect(() => { lastRapporter(); }, [lastRapporter]);

  // Last tabell-liste når rapport er valgt (Steg 3 entry).
  // Defensiv: ved feil setter vi tabeller=null så UI faller tilbake til fri-tekst-input.
  const workspaceId = form.rapport?.pbiWorkspaceId ?? '';
  const datasetId   = form.rapport?.pbiDatasetId   ?? '';
  useEffect(() => {
    if (!entraObjectId || !workspaceId || !datasetId) {
      setTabeller(null);
      setTabellerFeil(null);
      return;
    }
    let avbrutt = false;
    setTabellerLaster(true);
    setTabellerFeil(null);
    adminApi.hentTabeller(entraObjectId, workspaceId, datasetId)
      .then((r) => {
        if (avbrutt) return;
        setTabeller(r.tabeller);
      })
      .catch((err: unknown) => {
        if (avbrutt) return;
        setTabeller(null);
        setTabellerFeil(err instanceof Error ? err.message : 'Ukjent feil');
      })
      .finally(() => { if (!avbrutt) setTabellerLaster(false); });
    return () => { avbrutt = true; };
  }, [entraObjectId, workspaceId, datasetId]);

  const oppdater = (delta: Partial<Form>) => {
    setForm((prev) => ({ ...prev, ...delta }));
    // Hvis tabell endres, glem testet kolonner
    if ('tabell' in delta) { setKolonner(null); setTabellFeil(null); }
  };

  const testTabell = async () => {
    if (!form.rapport || !form.tabell.trim()) return;
    setTester(true);
    setKolonner(null);
    setTabellFeil(null);
    try {
      const r = await adminApi.hentKolonner(
        entraObjectId,
        form.rapport.pbiWorkspaceId,
        form.rapport.pbiDatasetId,
        form.tabell.trim(),
      );
      setKolonner(r.kolonner);
    } catch (err) {
      setTabellFeil(err instanceof Error ? err.message : 'Ukjent feil');
    } finally {
      setTester(false);
    }
  };

  // Steg-validering
  const kanGåVidere: Record<Steg, boolean> = {
    1: form.rapport !== null,
    2: form.slicer_tittel.trim().length > 0,
    3: form.tabell.trim().length > 0
       && form.verdi_kolonne.trim().length > 0
       && (form.slicer_type === 'basic' || form.forelder_kolonne.trim().length > 0)
       && kolonner !== null,    // krev at testen er kjørt
    4: true,
  };

  // Auto-generert DAX (preview)
  const dax = (() => {
    if (!form.tabell || !form.verdi_kolonne) return '';
    if (form.slicer_type === 'basic') {
      return `EVALUATE\nDISTINCT('${form.tabell}'[${form.verdi_kolonne}])\nORDER BY [${form.verdi_kolonne}]`;
    }
    if (!form.forelder_kolonne) return '';
    return (
      `EVALUATE\nSUMMARIZE(\n  '${form.tabell}',\n  '${form.tabell}'[${form.forelder_kolonne}],\n  '${form.tabell}'[${form.verdi_kolonne}]\n)\n` +
      `ORDER BY [${form.forelder_kolonne}], [${form.verdi_kolonne}]`
    );
  })();

  const submit = async () => {
    if (!form.rapport) return;
    setOppretter(true);
    try {
      const body: OpprettBody = form.slicer_type === 'basic'
        ? {
            rapport_id:    form.rapport.id,
            slicer_tittel: form.slicer_tittel.trim(),
            slicer_type:   'basic',
            tabell:        form.tabell.trim(),
            verdi_kolonne: form.verdi_kolonne.trim(),
          }
        : {
            rapport_id:       form.rapport.id,
            slicer_tittel:    form.slicer_tittel.trim(),
            slicer_type:      'hierarchy',
            tabell:           form.tabell.trim(),
            verdi_kolonne:    form.verdi_kolonne.trim(),
            forelder_kolonne: form.forelder_kolonne.trim(),
          };
      const opprettet = await adminApi.opprett(entraObjectId, body);
      try {
        const r = await adminApi.indekser(entraObjectId, opprettet.id);
        toast({
          title: 'Opprettet og indeksert',
          description: `${r.antall_rader} rader på ${r.dax_ms + r.indeks_ms}ms`,
          variant: 'success',
        });
      } catch (indeksErr) {
        toast({
          title: 'Opprettet, men indeksering feilet',
          description: indeksErr instanceof Error ? indeksErr.message : undefined,
          variant: 'destructive',
        });
      }
      router.push(`/admin/slicer-indeksering/${opprettet.id}`);
    } catch (err) {
      toast({
        title: 'Kunne ikke opprette',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setOppretter(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl">
      <Link
        href="/admin/slicer-indeksering"
        className="inline-flex items-center gap-1.5 text-sm mb-4"
        style={{ color: 'var(--text-muted)' }}
      >
        <ArrowLeft className="w-4 h-4" /> Tilbake til oversikt
      </Link>

      <h1
        className="uppercase tracking-wide mb-1"
        style={{
          fontFamily: 'Barlow Condensed, sans-serif',
          fontWeight: 800,
          fontSize: 24,
          color: 'var(--text-primary)',
        }}
      >
        Ny indekserings-konfig
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Velg en rapport og slicer, sett opp DAX-spørringen, og indeksér med ett klikk.
      </p>

      <StegIndikator aktiv={steg} />

      <div
        className="rounded-xl p-6 space-y-5"
        style={{
          background: 'rgba(17,29,51,0.65)',
          backdropFilter: 'blur(20px)',
          border: '1px solid var(--glass-bg-hover)',
        }}
      >
        {/* ── Steg 1 ───────────────────────────────────────────────── */}
        {steg === 1 && (
          <>
            <div>
              <Label htmlFor="rapport" style={{ color: 'var(--text-primary)' }}>Rapport <span className="text-red-500">*</span></Label>
              <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                Velg hvilken Power BI-rapport sliceren tilhører.
              </p>
              {rapporter === null ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <RapportVelger
                  rapporter={rapporter}
                  valgt={form.rapport}
                  onVelg={(r) => oppdater({ rapport: r })}
                />
              )}
            </div>
          </>
        )}

        {/* ── Steg 2 ───────────────────────────────────────────────── */}
        {steg === 2 && (
          <>
            <div>
              <Label htmlFor="slicer_tittel" style={{ color: 'var(--text-primary)' }}>
                Slicer-tittel <span className="text-red-500">*</span>
              </Label>
              <Input
                id="slicer_tittel"
                placeholder='F.eks. "Kunder", "LevNavn", "Hovedprosjekt"'
                value={form.slicer_tittel}
                onChange={(e) => oppdater({ slicer_tittel: e.target.value })}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Må matche EKSAKT det Power BI-rapporten bruker som slicer-tittel.
                Sjekk i F12-konsollen mens du står på rapporten — søk etter
                <code className="px-1 mx-0.5 rounded" style={{ background: 'var(--glass-bg-hover)', color: 'var(--text-secondary)' }}>[slicerOps] basic</code>
                eller <code className="px-1 mx-0.5 rounded" style={{ background: 'var(--glass-bg-hover)', color: 'var(--text-secondary)' }}>[slicerOps] hierarchy</code>.
              </p>
            </div>
            <div>
              <Label style={{ color: 'var(--text-primary)' }}>Type <span className="text-red-500">*</span></Label>
              <div className="flex gap-3 mt-2">
                {(['basic', 'hierarchy'] as const).map((t) => (
                  <label
                    key={t}
                    className="flex-1 cursor-pointer rounded-lg border p-3 transition-colors"
                    style={{
                      background: form.slicer_type === t ? 'var(--glass-gold-bg)' : 'var(--glass-bg)',
                      borderColor: form.slicer_type === t ? 'var(--glass-gold-border)' : 'var(--glass-bg-hover)',
                    }}
                  >
                    <input
                      type="radio"
                      name="type"
                      checked={form.slicer_type === t}
                      onChange={() => oppdater({ slicer_type: t })}
                      className="sr-only"
                    />
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {t === 'basic' ? 'Basic' : 'Hierarchy'}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {t === 'basic' ? 'Én kolonne (kunde, status, etc.)' : 'To nivåer (Hovedprosjekt → Prosjekt)'}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Steg 3 ───────────────────────────────────────────────── */}
        {steg === 3 && (
          <>
            <div>
              <Label htmlFor="tabell" style={{ color: 'var(--text-primary)' }}>
                Tabellnavn <span className="text-red-500">*</span>
              </Label>
              {/* Dropdown med tabell-liste fra PBI-datasettet. Faller tilbake
                  til fri-tekst-input hvis listing feiler eller er tom. */}
              {tabeller ? (
                <select
                  id="tabell"
                  value={form.tabell}
                  onChange={(e) => oppdater({ tabell: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-md border text-sm"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-bg-hover)', color: 'var(--text-primary)' }}
                >
                  <option value="">Velg tabell…</option>
                  {/* Hvis form.tabell allerede er satt men ikke i listen
                      (manuelt skrevet inn / tabell skjult i mellomtiden),
                      vis den øverst slik at brukeren ikke mister verdien. */}
                  {form.tabell && !tabeller.some((t) => t.navn === form.tabell) && (
                    <option value={form.tabell}>{form.tabell} (ikke i listen)</option>
                  )}
                  {tabeller.map((t) => (
                    <option key={t.navn} value={t.navn}>{t.navn}</option>
                  ))}
                </select>
              ) : tabellerLaster ? (
                <select
                  id="tabell"
                  disabled
                  value=""
                  className="w-full mt-1 px-3 py-2 rounded-md border text-sm opacity-60"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-bg-hover)', color: 'var(--text-muted)' }}
                >
                  <option value="">Laster tabeller…</option>
                </select>
              ) : (
                /* Fallback: API-feil eller ingen rapport valgt → fri-tekst-input */
                <Input
                  id="tabell"
                  placeholder='F.eks. "core Dim_Customer_LNS"'
                  value={form.tabell}
                  onChange={(e) => oppdater({ tabell: e.target.value })}
                />
              )}
              {tabellerFeil && (
                <p className="text-xs mt-1" style={{ color: 'rgba(252,165,165,0.95)' }}>
                  Kunne ikke hente tabell-liste — skriv tabellnavn manuelt. ({tabellerFeil})
                </p>
              )}
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                LNS-mønster: <code style={{ color: 'var(--text-secondary)' }}>core Dim_&lt;Entity&gt;_LNS</code>
                {' '}— f.eks. core Dim_Customer_LNS, core Dim_Supplier_LNS, Dim_Prosjekt_LNS.
              </p>
            </div>

            <div>
              <Button type="button" variant="outline" size="sm" onClick={testTabell} disabled={tester || !form.tabell.trim()}>
                {tester ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Tester…</> : 'Test tabell'}
              </Button>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Verifiserer at tabellen finnes og henter kolonne-listen.
              </p>
              {tabellFeil && (
                <p className="text-xs mt-2" style={{ color: 'rgba(252,165,165,0.95)' }}>
                  {tabellFeil}
                </p>
              )}
              {kolonner && (
                <p className="text-xs mt-2" style={{ color: 'rgba(110,231,183,0.95)' }}>
                  ✓ {kolonner.length} kolonner funnet i tabellen.
                </p>
              )}
            </div>

            {kolonner && (
              <>
                {form.slicer_type === 'hierarchy' && (
                  <div>
                    <Label style={{ color: 'var(--text-primary)' }}>
                      Forelder-kolonne <span className="text-red-500">*</span>
                    </Label>
                    <select
                      value={form.forelder_kolonne}
                      onChange={(e) => oppdater({ forelder_kolonne: e.target.value })}
                      className="w-full mt-1 px-3 py-2 rounded-md border text-sm"
                      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-bg-hover)', color: 'var(--text-primary)' }}
                    >
                      <option value="">Velg…</option>
                      {kolonner.map((k) => (
                        <option key={k.navn} value={k.navn}>{k.navn}</option>
                      ))}
                    </select>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Grupperingen — f.eks. Hovedprosjekt.</p>
                  </div>
                )}
                <div>
                  <Label style={{ color: 'var(--text-primary)' }}>
                    Verdi-kolonne <span className="text-red-500">*</span>
                  </Label>
                  <select
                    value={form.verdi_kolonne}
                    onChange={(e) => oppdater({ verdi_kolonne: e.target.value })}
                    className="w-full mt-1 px-3 py-2 rounded-md border text-sm"
                    style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-bg-hover)', color: 'var(--text-primary)' }}
                  >
                    <option value="">Velg…</option>
                    {kolonner
                      .filter((k) => k.navn !== form.forelder_kolonne)
                      .map((k) => (
                        <option key={k.navn} value={k.navn}>{k.navn}</option>
                      ))}
                  </select>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Det brukeren faktisk velger i sliceren — f.eks. Kunde, LevNavn, Prosjekt.
                  </p>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Steg 4 ───────────────────────────────────────────────── */}
        {steg === 4 && (
          <>
            <div className="text-sm space-y-1" style={{ color: 'var(--text-primary)' }}>
              <p><span style={{ color: 'var(--text-muted)' }}>Rapport:</span> {form.rapport?.navn}</p>
              <p><span style={{ color: 'var(--text-muted)' }}>Slicer:</span> {form.slicer_tittel} ({form.slicer_type})</p>
              <p><span style={{ color: 'var(--text-muted)' }}>Tabell:</span> {form.tabell}</p>
              <p><span style={{ color: 'var(--text-muted)' }}>Verdi-kolonne:</span> {form.verdi_kolonne}</p>
              {form.slicer_type === 'hierarchy' && (
                <p><span style={{ color: 'var(--text-muted)' }}>Forelder-kolonne:</span> {form.forelder_kolonne}</p>
              )}
            </div>
            <div>
              <Label style={{ color: 'var(--text-primary)' }}>Generert DAX</Label>
              <pre
                className="text-xs rounded-md p-3 mt-1 overflow-x-auto whitespace-pre"
                style={{
                  background: 'rgba(0,0,0,0.30)',
                  border: '1px solid var(--glass-bg-hover)',
                  color: 'var(--text-secondary)',
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                {dax}
              </pre>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Når du klikker "Opprett og indekser" lagres konfig og DAX kjøres mot Power BI for indeksering.
              </p>
            </div>
          </>
        )}

        {/* Navigasjon */}
        <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--glass-bg-hover)' }}>
          <Button
            type="button" variant="outline" size="sm"
            disabled={steg === 1 || oppretter}
            onClick={() => setSteg((s) => (s - 1) as Steg)}
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Tilbake
          </Button>

          {steg < 4 ? (
            <Button
              type="button" size="sm"
              disabled={!kanGåVidere[steg]}
              onClick={() => setSteg((s) => (s + 1) as Steg)}
            >
              Neste <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={oppretter} onClick={submit}>
              {oppretter ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Oppretter…</> : 'Opprett og indekser'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
