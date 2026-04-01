'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ChevronDown, LogOut, Settings, User } from 'lucide-react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function TopbarClient() {
  const { displayName, email, authHeaders, isLocal, rolle: localRolle, logout } = usePortalAuth();

  const name     = displayName;
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  const [isAdmin,  setIsAdmin]  = useState(false);
  const [open,     setOpen]     = useState(false);
  const [dropPos,  setDropPos]  = useState({ top: 0, right: 0 });
  const triggerRef  = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Lokale brukere: rolle er allerede kjent fra sessionStorage
    if (isLocal) {
      setIsAdmin(localRolle === 'admin');
      return;
    }
    // Entra-brukere: hent rolle fra /api/me
    if (!authHeaders['X-Entra-Object-Id']) return;
    apiFetch('/api/me', { headers: authHeaders })
      .then(async (r) => {
        if (!r.ok) return;
        const bruker = await r.json() as { rolle: string };
        setIsAdmin(bruker.rolle === 'admin');
      })
      .catch(() => {});
  }, [authHeaders, isLocal, localRolle]);

  // Lukk ved klikk utenfor — ekskluder både trigger og dropdown-panelet
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger  = triggerRef.current?.contains(target);
      const insideDropdown = dropdownRef.current?.contains(target);
      if (!insideTrigger && !insideDropdown) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropPos({
        top:   rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((o) => !o);
  };

  const handleLogout = () => logout();

  const dropdown = (
    <div
      ref={dropdownRef}
      style={{
        position: 'fixed',
        top:    dropPos.top,
        right:  dropPos.right,
        width:  224,
        zIndex: 99999,
        background: 'rgba(17,29,51,0.97)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid var(--glass-border)',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        padding: '4px 0',
      }}
    >
      {/* Brukerinfo-header */}
      <div className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--glass-bg)' }}>
        <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{name}</p>
        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{email ?? ''}</p>
      </div>

      {/* Min profil */}
      <Link
        href="/dashboard/profil"
        onClick={() => setOpen(false)}
        className="flex items-center gap-2.5 px-3 py-2 text-sm transition-colors"
        style={{ color: 'var(--text-secondary)' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--glass-bg)'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-primary)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-secondary)'; }}
      >
        <User className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
        Min profil
      </Link>

      {/* Administrasjon — kun for admin */}
      {isAdmin && (
        <>
          <div className="my-1" style={{ borderTop: '1px solid var(--glass-bg)' }} />
          <Link
            href="/admin"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-sm transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--glass-bg)'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-secondary)'; }}
          >
            <Settings className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
            Administrasjon
          </Link>
        </>
      )}

      {/* Logg ut */}
      <div className="my-1" style={{ borderTop: '1px solid var(--glass-bg)' }} />
      <button
        onClick={handleLogout}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors"
        style={{ color: 'rgba(239,68,68,0.75)' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.08)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(239,68,68,1)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(239,68,68,0.75)'; }}
      >
        <LogOut className="w-4 h-4 shrink-0" />
        Logg ut
      </button>
    </div>
  );

  return (
    <>
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
        style={{ background: 'transparent' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="text-sm hidden sm:block font-medium" style={{ color: 'var(--text-muted)' }}>
          {name}
        </span>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold select-none shrink-0"
          style={{
            background: 'var(--glass-gold-bg)',
            border: '1px solid var(--glass-gold-border)',
            color: 'var(--gold)',
          }}
        >
          {initials}
        </div>
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          style={{ color: 'var(--text-muted)' }}
        />
      </button>

      {/* Portal: rendres direkte på document.body, utenfor alle stacking contexts */}
      {open && typeof document !== 'undefined' && createPortal(dropdown, document.body)}
    </>
  );
}
