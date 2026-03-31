'use client';

import { useEffect, useState, useCallback } from 'react';
import { Building, Plus, Pencil, CheckCircle, XCircle } from 'lucide-react';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Tenant {
  id:        string;
  slug:      string;
  navn:      string;
  erAktiv:   boolean;
  opprettet: string;
  oppdatert: string;
}

function maskUrl(url: string): string {
  try {
    const noProto = url.replace(/^sqlserver:\/\//, '');
    const server  = noProto.split(';')[0];
    const db      = noProto.match(/database=([^;]+)/i)?.[1] ?? '—';
    return `sqlserver://${server};database=${db};…`;
  } catch {
    return '•'.repeat(Math.min(url.length, 40));
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('nb-NO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

const EMPTY_FORM = { slug: '', navn: '', databaseUrl: '' };

export default function TenantsAdminPage() {
  const { authHeaders } = usePortalAuth();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  // Ny-tenant dialog
  const [nyOpen,   setNyOpen]   = useState(false);
  const [nyForm,   setNyForm]   = useState(EMPTY_FORM);
  const [nyFeil,   setNyFeil]   = useState<string | null>(null);
  const [oppretter, setOppretter] = useState(false);

  // Rediger-dialog
  const [editTenant, setEditTenant] = useState<Tenant | null>(null);
  const [editForm,   setEditForm]   = useState({ navn: '', databaseUrl: '' });
  const [editFeil,   setEditFeil]   = useState<string | null>(null);
  const [lagrer,     setLagrer]     = useState(false);

  const lastTenants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/tenants', { headers: authHeaders });
      if (res.ok) setTenants(await res.json() as Tenant[]);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders['X-Entra-Object-Id']]);

  useEffect(() => { lastTenants(); }, [lastTenants]);

  // ── Opprett ───────────────────────────────────────────────────────────────
  const opprett = async (e: React.FormEvent) => {
    e.preventDefault();
    setNyFeil(null);
    setOppretter(true);
    try {
      const res = await apiFetch('/api/admin/tenants', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body:    JSON.stringify({
          slug:        nyForm.slug.toLowerCase().trim(),
          navn:        nyForm.navn.trim(),
          databaseUrl: nyForm.databaseUrl.trim(),
        }),
      });
      const data = await res.json() as Tenant & { error?: string };
      if (!res.ok) { setNyFeil(data.error ?? 'Kunne ikke opprette tenant.'); return; }
      setTenants((prev) => [...prev, data]);
      toast({ title: `Tenant "${data.slug}" opprettet`, variant: 'success' });
      lukkNy();
    } catch {
      setNyFeil('Nettverksfeil. Prøv igjen.');
    } finally {
      setOppretter(false);
    }
  };

  const lukkNy = () => { setNyOpen(false); setNyForm(EMPTY_FORM); setNyFeil(null); };

  // ── Rediger ───────────────────────────────────────────────────────────────
  const åpneEdit = (t: Tenant) => {
    setEditTenant(t);
    setEditForm({ navn: t.navn, databaseUrl: '' });
    setEditFeil(null);
  };

  const lagreEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTenant) return;
    setEditFeil(null);
    setLagrer(true);
    try {
      const body: Record<string, unknown> = { navn: editForm.navn.trim() };
      if (editForm.databaseUrl.trim()) body.databaseUrl = editForm.databaseUrl.trim();

      const res = await apiFetch(`/api/admin/tenants/${editTenant.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body:    JSON.stringify(body),
      });
      const data = await res.json() as Tenant & { error?: string };
      if (!res.ok) { setEditFeil(data.error ?? 'Kunne ikke lagre.'); return; }
      setTenants((prev) => prev.map((t) => (t.id === data.id ? { ...t, ...data } : t)));
      toast({ title: 'Tenant oppdatert', variant: 'success' });
      lukkEdit();
    } catch {
      setEditFeil('Nettverksfeil. Prøv igjen.');
    } finally {
      setLagrer(false);
    }
  };

  const lukkEdit = () => { setEditTenant(null); setEditForm({ navn: '', databaseUrl: '' }); setEditFeil(null); };

  // ── Aktiver / deaktiver ───────────────────────────────────────────────────
  const toggleAktiv = async (t: Tenant) => {
    const nyStatus = !t.erAktiv;
    setTenants((prev) => prev.map((x) => (x.id === t.id ? { ...x, erAktiv: nyStatus } : x)));
    try {
      if (nyStatus) {
        await apiFetch(`/api/admin/tenants/${t.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body:    JSON.stringify({ erAktiv: true }),
        });
      } else {
        await apiFetch(`/api/admin/tenants/${t.id}`, {
          method:  'DELETE',
          headers: authHeaders,
        });
      }
    } catch {
      setTenants((prev) => prev.map((x) => (x.id === t.id ? { ...x, erAktiv: t.erAktiv } : x)));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'rgba(255,255,255,0.92)' }}>Tenants</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Administrer organisasjoner med separate databaser.
          </p>
        </div>
        <button
          onClick={() => setNyOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity"
          style={{
            background: 'var(--glass-gold-bg)',
            border:     '1px solid rgba(245,166,35,0.30)',
            color:      'var(--gold)',
          }}
        >
          <Plus className="w-4 h-4" />
          Ny tenant
        </button>
      </div>

      {/* Tabell */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
        {loading ? (
          <div className="p-10 text-center text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Laster tenants…
          </div>
        ) : tenants.length === 0 ? (
          <div className="p-16 text-center">
            <Building className="w-10 h-10 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.20)' }} />
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>Ingen tenants opprettet ennå.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                {['Slug', 'Navn', 'Database', 'Opprettet', 'Status', ''].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left font-medium text-[11px] uppercase tracking-wide"
                    style={{ color: 'rgba(255,255,255,0.35)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.map((t, i) => (
                <tr
                  key={t.id}
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    borderBottom: i < tenants.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                  }}
                >
                  <td className="px-5 py-3.5">
                    <code
                      className="px-2 py-0.5 rounded text-xs font-mono"
                      style={{
                        background: 'var(--glass-gold-bg)',
                        border:     '1px solid var(--glass-gold-border)',
                        color:      'var(--gold)',
                      }}
                    >
                      {t.slug}
                    </code>
                  </td>
                  <td className="px-5 py-3.5 font-medium" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    {t.navn}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className="font-mono text-xs"
                      style={{ color: 'rgba(255,255,255,0.40)' }}
                      title="Faktisk URL er skjult av sikkerhetsgrunner"
                    >
                      {maskUrl(t.slug === 'lns' ? 'sqlserver://…' : '(kryptert)')}
                    </span>
                  </td>
                  <td className="px-5 py-3.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    {formatDate(t.opprettet)}
                  </td>
                  <td className="px-5 py-3.5">
                    {t.erAktiv ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: 'rgba(74,222,128,0.85)' }}>
                        <CheckCircle className="w-3.5 h-3.5" /> Aktiv
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: 'rgba(248,113,113,0.75)' }}>
                        <XCircle className="w-3.5 h-3.5" /> Inaktiv
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => åpneEdit(t)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors"
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border:     '1px solid rgba(255,255,255,0.10)',
                          color:      'rgba(255,255,255,0.55)',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.09)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; }}
                      >
                        <Pencil className="w-3 h-3" /> Rediger
                      </button>
                      {t.slug !== 'lns' && (
                        <button
                          onClick={() => toggleAktiv(t)}
                          className="px-3 py-1 rounded-md text-xs transition-colors"
                          style={{
                            background: t.erAktiv ? 'rgba(239,68,68,0.10)' : 'rgba(34,197,94,0.10)',
                            border:     t.erAktiv ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(34,197,94,0.25)',
                            color:      t.erAktiv ? 'rgba(252,165,165,0.85)' : 'rgba(134,239,172,0.85)',
                          }}
                        >
                          {t.erAktiv ? 'Deaktiver' : 'Aktiver'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Dialog: Ny tenant ───────────────────────────────────────────────── */}
      <Dialog open={nyOpen} onClose={lukkNy} title="Ny tenant" className="max-w-lg">
        <form onSubmit={opprett} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'rgba(255,255,255,0.60)' }}>
              Slug <span style={{ color: 'rgba(239,68,68,0.80)' }}>*</span>
            </label>
            <input
              type="text"
              value={nyForm.slug}
              onChange={(e) => setNyForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9\-]/g, '') }))}
              placeholder="acme"
              required
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-lg font-mono"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', outline: 'none' }}
            />
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.30)' }}>
              Brukes i subdomene (acme.portal.no) og x-tenant-id header. Kun a-z, 0-9 og bindestrek.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'rgba(255,255,255,0.60)' }}>
              Navn <span style={{ color: 'rgba(239,68,68,0.80)' }}>*</span>
            </label>
            <input
              type="text"
              value={nyForm.navn}
              onChange={(e) => setNyForm((f) => ({ ...f, navn: e.target.value }))}
              placeholder="Acme AS"
              required
              className="w-full px-3 py-2 text-sm rounded-lg"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', outline: 'none' }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'rgba(255,255,255,0.60)' }}>
              Database-URL <span style={{ color: 'rgba(239,68,68,0.80)' }}>*</span>
            </label>
            <input
              type="password"
              value={nyForm.databaseUrl}
              onChange={(e) => setNyForm((f) => ({ ...f, databaseUrl: e.target.value }))}
              placeholder="sqlserver://server:1433;database=...;user=...;password=..."
              required
              className="w-full px-3 py-2 text-sm rounded-lg font-mono"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', outline: 'none' }}
            />
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.30)' }}>
              Samme format som DATABASE_URL. Lagres kryptert i master-DB.
            </p>
          </div>
          {nyFeil && (
            <p className="text-xs rounded px-3 py-2" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: 'rgba(252,165,165,0.90)' }}>
              {nyFeil}
            </p>
          )}
          <DialogFooter>
            <button type="button" onClick={lukkNy} className="px-4 py-2 text-sm rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.55)' }}>
              Avbryt
            </button>
            <button
              type="submit"
              disabled={oppretter || !nyForm.slug || !nyForm.navn || !nyForm.databaseUrl}
              className="px-4 py-2 text-sm rounded-lg font-medium transition-opacity disabled:opacity-50"
              style={{ background: 'var(--gold-dim)', border: '1px solid rgba(245,166,35,0.35)', color: 'var(--gold)' }}
            >
              {oppretter ? 'Oppretter…' : 'Opprett tenant'}
            </button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* ── Dialog: Rediger tenant ──────────────────────────────────────────── */}
      <Dialog open={!!editTenant} onClose={lukkEdit} title={`Rediger — ${editTenant?.slug ?? ''}`} className="max-w-lg">
        <form onSubmit={lagreEdit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'rgba(255,255,255,0.60)' }}>Navn</label>
            <input
              type="text"
              value={editForm.navn}
              onChange={(e) => setEditForm((f) => ({ ...f, navn: e.target.value }))}
              required
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-lg"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', outline: 'none' }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'rgba(255,255,255,0.60)' }}>
              Ny database-URL <span className="font-normal" style={{ color: 'rgba(255,255,255,0.30)' }}>(la stå tom for å beholde eksisterende)</span>
            </label>
            <input
              type="password"
              value={editForm.databaseUrl}
              onChange={(e) => setEditForm((f) => ({ ...f, databaseUrl: e.target.value }))}
              placeholder="sqlserver://…"
              className="w-full px-3 py-2 text-sm rounded-lg font-mono"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', outline: 'none' }}
            />
          </div>
          {editFeil && (
            <p className="text-xs rounded px-3 py-2" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: 'rgba(252,165,165,0.90)' }}>
              {editFeil}
            </p>
          )}
          <DialogFooter>
            <button type="button" onClick={lukkEdit} className="px-4 py-2 text-sm rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.55)' }}>
              Avbryt
            </button>
            <button
              type="submit"
              disabled={lagrer || !editForm.navn.trim()}
              className="px-4 py-2 text-sm rounded-lg font-medium transition-opacity disabled:opacity-50"
              style={{ background: 'var(--gold-dim)', border: '1px solid rgba(245,166,35,0.35)', color: 'var(--gold)' }}
            >
              {lagrer ? 'Lagrer…' : 'Lagre'}
            </button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}
