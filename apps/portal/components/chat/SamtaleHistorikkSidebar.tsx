'use client';

import { useEffect, useState, useCallback } from 'react';
import { MessageSquare, Plus, Trash2, ChevronLeft, ChevronRight, Pencil, Check, X } from 'lucide-react';
import { apiFetch, apiHeaders } from '@/lib/apiClient';

interface Samtale {
  øktId: string;
  tittel: string | null;
  tidspunkt: string;
}

interface Props {
  entraObjectId: string;
  aktivtØktId: string | null;
  onVelgSamtale: (øktId: string) => void;
  onNySamtale: () => void;
}

function formaterDato(iso: string): string {
  const dato = new Date(iso);
  const nå = new Date();
  const diffMs = nå.getTime() - dato.getTime();
  const diffDager = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDager === 0) return 'I dag';
  if (diffDager === 1) return 'I går';
  if (diffDager < 7) return `${diffDager} dager siden`;
  return dato.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' });
}

export default function SamtaleHistorikkSidebar({
  entraObjectId,
  aktivtØktId,
  onVelgSamtale,
  onNySamtale,
}: Props) {
  const [samtaler, setSamtaler] = useState<Samtale[]>([]);
  const [kollapset, setKollapset] = useState(false);
  const [redigererØktId, setRedigererØktId] = useState<string | null>(null);
  const [redigeringsTittel, setRedigeringsTittel] = useState('');
  const [laster, setLaster] = useState(true);

  const hentSamtaler = useCallback(async () => {
    try {
      const res = await apiFetch('/api/chat/samtaler', {
        headers: { 'x-entra-object-id': entraObjectId, ...apiHeaders() },
      });
      if (res.ok) {
        const data = (await res.json()) as Samtale[];
        setSamtaler(data);
      }
    } catch {
      // stille feil
    } finally {
      setLaster(false);
    }
  }, [entraObjectId]);

  useEffect(() => {
    hentSamtaler();
  }, [hentSamtaler, aktivtØktId]);

  async function slettSamtale(øktId: string, e: React.MouseEvent) {
    e.stopPropagation();
    await apiFetch(`/api/chat/samtaler/${encodeURIComponent(øktId)}`, {
      method: 'DELETE',
      headers: { 'x-entra-object-id': entraObjectId, ...apiHeaders() },
    });
    setSamtaler(prev => prev.filter(s => s.øktId !== øktId));
    if (øktId === aktivtØktId) onNySamtale();
  }

  function startRedigering(samtale: Samtale, e: React.MouseEvent) {
    e.stopPropagation();
    setRedigererØktId(samtale.øktId);
    setRedigeringsTittel(samtale.tittel ?? '');
  }

  async function lagreTittel(øktId: string) {
    if (!redigeringsTittel.trim()) { setRedigererØktId(null); return; }
    await apiFetch(`/api/chat/samtaler/${encodeURIComponent(øktId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-entra-object-id': entraObjectId, ...apiHeaders() },
      body: JSON.stringify({ tittel: redigeringsTittel.trim() }),
    });
    setSamtaler(prev =>
      prev.map(s => s.øktId === øktId ? { ...s, tittel: redigeringsTittel.trim() } : s),
    );
    setRedigererØktId(null);
  }

  if (kollapset) {
    return (
      <div
        style={{
          width: 36,
          background: 'rgba(10,22,40,0.95)',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 12,
          gap: 8,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setKollapset(false)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 4 }}
          title="Vis samtalehistorikk"
        >
          <ChevronRight size={16} />
        </button>
        <button
          onClick={onNySamtale}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 4 }}
          title="Ny samtale"
        >
          <Plus size={16} />
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        background: 'rgba(10,22,40,0.95)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 12px 8px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600 }}>
          <MessageSquare size={14} />
          Samtaler
        </div>
        <button
          onClick={() => setKollapset(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 2 }}
          title="Skjul historikk"
        >
          <ChevronLeft size={15} />
        </button>
      </div>

      {/* Ny samtale */}
      <div style={{ padding: '8px 10px 4px' }}>
        <button
          onClick={onNySamtale}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 10px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 7,
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.8)',
            fontSize: 13,
          }}
        >
          <Plus size={14} />
          Ny samtale
        </button>
      </div>

      {/* Liste */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
        {laster && (
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', marginTop: 20 }}>
            Laster...
          </p>
        )}
        {!laster && samtaler.length === 0 && (
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', marginTop: 20 }}>
            Ingen samtaler ennå
          </p>
        )}
        {samtaler.map(samtale => {
          const erAktiv = samtale.øktId === aktivtØktId;
          const erRedigering = redigererØktId === samtale.øktId;
          return (
            <div
              key={samtale.øktId}
              onClick={() => !erRedigering && onVelgSamtale(samtale.øktId)}
              style={{
                padding: '7px 8px',
                borderRadius: 7,
                marginBottom: 2,
                cursor: erRedigering ? 'default' : 'pointer',
                background: erAktiv ? 'rgba(245,166,35,0.15)' : 'transparent',
                border: erAktiv ? '1px solid rgba(245,166,35,0.25)' : '1px solid transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                if (!erAktiv) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.05)';
              }}
              onMouseLeave={e => {
                if (!erAktiv) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
              }}
            >
              {erRedigering ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    autoFocus
                    value={redigeringsTittel}
                    onChange={e => setRedigeringsTittel(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') lagreTittel(samtale.øktId);
                      if (e.key === 'Escape') setRedigererØktId(null);
                    }}
                    style={{
                      flex: 1,
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 4,
                      padding: '2px 6px',
                      color: '#fff',
                      fontSize: 12,
                      outline: 'none',
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                  <button
                    onClick={e => { e.stopPropagation(); lagreTittel(samtale.øktId); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5ce07a', padding: 2 }}
                  >
                    <Check size={13} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); setRedigererØktId(null); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e05c5c', padding: 2 }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: erAktiv ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.75)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontWeight: erAktiv ? 600 : 400,
                      }}
                    >
                      {samtale.tittel ?? 'Ny samtale'}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>
                      {formaterDato(samtale.tidspunkt)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 2, opacity: 0 }} className="samtale-handlinger">
                    <button
                      onClick={e => startRedigering(samtale, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 2 }}
                      title="Gi nytt navn"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={e => slettSamtale(samtale.øktId, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e05c5c', padding: 2 }}
                      title="Slett samtale"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        div:hover > div > .samtale-handlinger {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
}
