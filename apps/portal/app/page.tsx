'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/authConfig';
import { getLocalSession, setLocalSession } from '@/lib/localAuth';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Step = 'email' | 'microsoft' | 'passord' | 'bytt-passord';

export default function LoginPage() {
  const isAuthenticated = useIsAuthenticated();
  const { instance }    = useMsal();
  const router          = useRouter();

  const [step,          setStep]          = useState<Step>('email');
  const [email,         setEmail]         = useState('');
  const [passord,       setPassord]       = useState('');
  const [nyttPassord,   setNyttPassord]   = useState('');
  const [bekreft,       setBekreft]       = useState('');
  const [visPassord,    setVisPassord]    = useState(false);
  const [feil,          setFeil]          = useState<string | null>(null);
  const [laster,        setLaster]        = useState(false);
  const [pendingEntraOid, setPendingEntraOid] = useState<string | null>(null);

  // Allerede innlogget via MSAL eller lokal sesjon
  useEffect(() => {
    if (isAuthenticated || getLocalSession()) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, router]);

  // ── Steg 1: sjekk e-post ──────────────────────────────────────────────────
  const sjekkEpost = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeil(null);
    const q = email.trim().toLowerCase();
    if (!q) return;
    setLaster(true);
    try {
      const res  = await apiFetch('/api/auth/login-check', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: q }),
      });
      const data = await res.json() as { finnes: boolean; erEntra?: boolean };
      if (!data.finnes) {
        setFeil('Ingen konto er registrert for denne e-postadressen.');
        return;
      }
      setStep(data.erEntra ? 'microsoft' : 'passord');
    } catch {
      setFeil('Kunne ikke nå serveren. Prøv igjen.');
    } finally {
      setLaster(false);
    }
  };

  // ── Steg 2A: Microsoft innlogging ─────────────────────────────────────────
  const loggInnMicrosoft = () => {
    instance.loginRedirect(loginRequest).catch(() => {
      setFeil('Microsoft-innlogging feilet.');
    });
  };

  // ── Steg 2B: lokal passord ────────────────────────────────────────────────
  const loggInnLokal = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeil(null);
    setLaster(true);
    try {
      const res  = await apiFetch('/api/auth/login-lokal', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase(), passord }),
      });
      const data = await res.json() as {
        success?: boolean;
        error?: string;
        entraObjectId?: string;
        displayName?: string | null;
        email?: string | null;
        rolle?: string;
        måByttePassord?: boolean;
      };
      if (!res.ok || !data.success) {
        setFeil(data.error ?? 'Innlogging feilet.');
        return;
      }
      if (data.måByttePassord) {
        setPendingEntraOid(data.entraObjectId!);
        // Ikke nullstill passord her – det brukes som gammeltPassord i bytt-passord-steget
        setStep('bytt-passord');
        return;
      }
      setLocalSession({
        entraObjectId: data.entraObjectId!,
        displayName:   data.displayName ?? null,
        email:         data.email ?? null,
        rolle:         data.rolle ?? 'bruker',
      });
      router.replace('/dashboard');
    } catch {
      setFeil('Kunne ikke nå serveren. Prøv igjen.');
    } finally {
      setLaster(false);
    }
  };

  // ── Steg 3: bytt passord (påkrevd ved første innlogging) ──────────────────
  const byttPassord = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeil(null);
    if (nyttPassord !== bekreft) {
      setFeil('Passordene stemmer ikke overens.');
      return;
    }
    if (!pendingEntraOid) return;
    setLaster(true);
    try {
      const res = await apiFetch('/api/auth/bytt-passord', {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-Entra-Object-Id': pendingEntraOid,
        },
        body: JSON.stringify({ gammeltPassord: passord, nyttPassord }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setFeil(data.error ?? 'Kunne ikke bytte passord.');
        return;
      }
      // Etter bytte: logg inn på nytt for å hente fersk sesjon
      const loginRes = await apiFetch('/api/auth/login-lokal', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase(), passord: nyttPassord }),
      });
      const loginData = await loginRes.json() as {
        success?: boolean; entraObjectId?: string; displayName?: string | null;
        email?: string | null; rolle?: string;
      };
      if (loginData.success) {
        setLocalSession({
          entraObjectId: loginData.entraObjectId!,
          displayName:   loginData.displayName ?? null,
          email:         loginData.email ?? null,
          rolle:         loginData.rolle ?? 'bruker',
        });
        router.replace('/dashboard');
      }
    } catch {
      setFeil('Kunne ikke nå serveren. Prøv igjen.');
    } finally {
      setLaster(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        background: 'linear-gradient(135deg, #0a1628 0%, #1B2A4A 50%, #0d1f3c 100%)',
      }}
    >
      {/* Bakgrunns-orbs */}
      <div
        style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
          background: 'radial-gradient(ellipse at 15% 20%, var(--gold-dim) 0%, transparent 50%), radial-gradient(ellipse at 85% 80%, rgba(27,42,74,0.6) 0%, transparent 50%)',
        }}
      />

      <div
        className="w-full max-w-sm relative z-10 rounded-2xl p-8 flex flex-col items-center gap-6"
        style={{
          background:     'rgba(15,25,45,0.92)',
          border:         '1px solid rgba(255,255,255,0.10)',
          boxShadow:      '0 24px 64px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <img
            src="/logo/LNS-logo-hvit-gul-liten-RGB.png"
            alt="LNS"
            className="w-14 h-14 object-contain"
          />
          <span
            style={{
              fontFamily:    'Barlow Condensed, sans-serif',
              fontWeight:    700,
              color:         'var(--gold)',
              fontSize:      11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            Analyseportal
          </span>
        </div>

        {/* ── Steg: e-post ─────────────────────────────────────────────── */}
        {step === 'email' && (
          <form onSubmit={sjekkEpost} className="w-full flex flex-col gap-4">
            <div className="text-center">
              <h1 style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 22, color: 'rgba(255,255,255,0.90)' }}>
                Logg inn
              </h1>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.40)' }}>
                Skriv inn e-postadressen din for å fortsette
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>
                E-postadresse
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setFeil(null); }}
                placeholder="navn@bedrift.no"
                required
                autoFocus
                className="w-full px-3 py-2.5 text-sm rounded-lg"
                style={{
                  background:   'rgba(255,255,255,0.06)',
                  border:       '1px solid rgba(255,255,255,0.12)',
                  color:        'rgba(255,255,255,0.85)',
                  outline:      'none',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--gold-dim)'; e.currentTarget.style.boxShadow = '0 0 0 2px var(--glass-gold-bg)'; }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            {feil && <p className="text-xs text-center" style={{ color: 'rgba(252,165,165,0.90)' }}>{feil}</p>}
            <button
              type="submit"
              disabled={laster || !email.trim()}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'var(--gold)', color: '#111D33' }}
            >
              {laster ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fortsett'}
            </button>
          </form>
        )}

        {/* ── Steg: Microsoft ──────────────────────────────────────────── */}
        {step === 'microsoft' && (
          <div className="w-full flex flex-col gap-4">
            <div className="text-center">
              <h1 style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 22, color: 'rgba(255,255,255,0.90)' }}>
                Logg inn med Microsoft
              </h1>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.40)' }}>
                {email}
              </p>
            </div>
            <button
              onClick={loggInnMicrosoft}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2.5"
              style={{
                background: 'rgba(0,120,212,0.15)',
                border:     '1px solid rgba(0,120,212,0.30)',
                color:      'rgba(100,180,255,0.90)',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,120,212,0.25)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,120,212,0.15)'; }}
            >
              <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
                <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
              </svg>
              Logg inn med Microsoft
            </button>
            <button
              onClick={() => { setStep('email'); setFeil(null); }}
              className="text-xs text-center transition-colors"
              style={{ color: 'rgba(255,255,255,0.35)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.65)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.35)'; }}
            >
              ← Tilbake
            </button>
          </div>
        )}

        {/* ── Steg: passord ────────────────────────────────────────────── */}
        {step === 'passord' && (
          <form onSubmit={loggInnLokal} className="w-full flex flex-col gap-4">
            <div className="text-center">
              <h1 style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 22, color: 'rgba(255,255,255,0.90)' }}>
                Skriv inn passord
              </h1>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.40)' }}>
                {email}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Passord
              </label>
              <div className="relative">
                <input
                  type={visPassord ? 'text' : 'password'}
                  value={passord}
                  onChange={(e) => { setPassord(e.target.value); setFeil(null); }}
                  placeholder="••••••••"
                  required
                  autoFocus
                  className="w-full px-3 py-2.5 pr-10 text-sm rounded-lg"
                  style={{
                    background:   'rgba(255,255,255,0.06)',
                    border:       '1px solid rgba(255,255,255,0.12)',
                    color:        'rgba(255,255,255,0.85)',
                    outline:      'none',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--gold-dim)'; e.currentTarget.style.boxShadow = '0 0 0 2px var(--glass-gold-bg)'; }}
                  onBlur={(e)  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
                <button
                  type="button"
                  onClick={() => setVisPassord((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                  tabIndex={-1}
                >
                  {visPassord ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {feil && <p className="text-xs text-center" style={{ color: 'rgba(252,165,165,0.90)' }}>{feil}</p>}
            <button
              type="submit"
              disabled={laster || !passord}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'var(--gold)', color: '#111D33' }}
            >
              {laster ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Logg inn'}
            </button>
            <button
              onClick={() => { setStep('email'); setFeil(null); }}
              type="button"
              className="text-xs text-center transition-colors"
              style={{ color: 'rgba(255,255,255,0.35)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.65)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.35)'; }}
            >
              ← Tilbake
            </button>
          </form>
        )}

        {/* ── Steg: bytt passord (påkrevd) ─────────────────────────────── */}
        {step === 'bytt-passord' && (
          <form onSubmit={byttPassord} className="w-full flex flex-col gap-4">
            <div className="text-center">
              <h1 style={{ fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 22, color: 'rgba(255,255,255,0.90)' }}>
                Sett nytt passord
              </h1>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.40)' }}>
                Du må bytte passord før du kan fortsette
              </p>
            </div>
            {(['nyttPassord', 'bekreft'] as const).map((felt) => (
              <div key={felt} className="flex flex-col gap-1.5">
                <label className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  {felt === 'nyttPassord' ? 'Nytt passord' : 'Bekreft passord'}
                </label>
                <input
                  type="password"
                  value={felt === 'nyttPassord' ? nyttPassord : bekreft}
                  onChange={(e) => {
                    setFeil(null);
                    if (felt === 'nyttPassord') setNyttPassord(e.target.value);
                    else setBekreft(e.target.value);
                  }}
                  placeholder="••••••••"
                  required
                  autoFocus={felt === 'nyttPassord'}
                  className="w-full px-3 py-2.5 text-sm rounded-lg"
                  style={{
                    background:   'rgba(255,255,255,0.06)',
                    border:       '1px solid rgba(255,255,255,0.12)',
                    color:        'rgba(255,255,255,0.85)',
                    outline:      'none',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--gold-dim)'; e.currentTarget.style.boxShadow = '0 0 0 2px var(--glass-gold-bg)'; }}
                  onBlur={(e)  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>
            ))}
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.30)' }}>
              Minst 8 tegn, én stor bokstav og ett tall.
            </p>
            {feil && <p className="text-xs text-center" style={{ color: 'rgba(252,165,165,0.90)' }}>{feil}</p>}
            <button
              type="submit"
              disabled={laster || !nyttPassord || !bekreft}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'var(--gold)', color: '#111D33' }}
            >
              {laster ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Lagre og logg inn'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
