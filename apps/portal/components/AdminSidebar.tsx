'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, Database, Globe, LayoutDashboard, Palette, Settings2, Users } from 'lucide-react';
import { useMsal } from '@azure/msal-react';
import { apiFetch } from '@/lib/apiClient';

const nav = [
  { href: '/admin',            label: 'Oversikt',   icon: Settings2, exact: true },
  { href: '/admin/workspaces', label: 'Workspaces', icon: Building2 },
  { href: '/admin/brukere',    label: 'Brukere',    icon: Users },
  { href: '/admin/metadata',   label: 'Metadata',   icon: Database },
  { href: '/admin/tema',       label: 'Tema',       icon: Palette },
  { href: '/admin/tenants',    label: 'Tenants',    icon: Globe, kreverRolle: 'tenantadmin' as const },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const { accounts } = useMsal();
  const [rolle, setRolle] = useState<string>('');

  useEffect(() => {
    const account = accounts[0];
    if (!account) return;
    apiFetch('/api/me', {
      headers: { 'X-Entra-Object-Id': account.localAccountId },
    })
      .then(r => r.json())
      .then((b: { rolle?: string }) => setRolle(b.rolle ?? ''))
      .catch(() => {});
  }, [accounts]);

  const synligeNav = nav.filter(item => !item.kreverRolle || item.kreverRolle === rolle);

  return (
    <aside
      className="w-52 shrink-0 flex flex-col"
      style={{
        background: 'rgba(10,22,40,0.65)',
        backdropFilter: 'blur(30px)',
        WebkitBackdropFilter: 'blur(30px)',
        borderRight: '1px solid var(--glass-bg)',
      }}
    >

      {/* Logo */}
      <div
        className="flex flex-col items-center px-4 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--glass-bg)' }}
      >
        <img
          src="/logo/LNS-logo-hvit-gul-liten-RGB.png"
          alt="LNS"
          className="w-14 h-14 object-contain shrink-0"
        />
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, color: 'var(--gold)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 6 }}>
          Analyseportal
        </div>
      </div>

      {/* Back to dashboard */}
      <div className="px-2 pt-3 pb-2">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--glass-bg-hover)'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-secondary)'; }}
        >
          <LayoutDashboard className="w-4 h-4 shrink-0" />
          <span>Til dashboard</span>
        </Link>
        <div className="mt-2 mx-2" style={{ borderTop: '1px solid var(--glass-bg-hover)' }} />
      </div>

      {/* Admin nav */}
      <div className="px-4 pt-2 pb-1">
        <p className="px-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Administrasjon
        </p>
      </div>
      <nav className="flex-1 px-2 space-y-0.5">
        {synligeNav.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all"
              style={active ? {
                background: 'var(--glass-gold-bg)',
                border: '1px solid var(--glass-gold-border)',
                color: 'var(--text-primary)',
                borderLeft: '2px solid var(--gold)',
                paddingLeft: 10,
              } : {
                color: 'var(--text-muted)',
              }}
              onMouseEnter={(e) => { if (!active) { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--glass-bg)'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-primary)'; } }}
              onMouseLeave={(e) => { if (!active) { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-muted)'; } }}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="font-medium">{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
