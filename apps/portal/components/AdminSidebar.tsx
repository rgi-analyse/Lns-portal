'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, Database, LayoutDashboard, Settings2, Users } from 'lucide-react';

const nav = [
  { href: '/admin',            label: 'Oversikt',   icon: Settings2, exact: true },
  { href: '/admin/workspaces', label: 'Workspaces', icon: Building2 },
  { href: '/admin/brukere',    label: 'Brukere',    icon: Users },
  { href: '/admin/metadata',   label: 'Metadata',   icon: Database },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="w-52 shrink-0 flex flex-col"
      style={{
        background: 'rgba(10,22,40,0.65)',
        backdropFilter: 'blur(30px)',
        WebkitBackdropFilter: 'blur(30px)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >

      {/* Logo */}
      <div
        className="flex flex-col items-center px-4 py-4 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <img
          src="/logo/LNS-logo-hvit-gul-liten-RGB.png"
          alt="LNS"
          className="w-14 h-14 object-contain shrink-0"
        />
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, color: '#F5A623', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 6 }}>
          Analyseportal
        </div>
      </div>

      {/* Back to dashboard */}
      <div className="px-2 pt-3 pb-2">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
          style={{ color: 'rgba(255,255,255,0.5)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLAnchorElement).style.color = '#fff'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.5)'; }}
        >
          <LayoutDashboard className="w-4 h-4 shrink-0" />
          <span>Til dashboard</span>
        </Link>
        <div className="mt-2 mx-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }} />
      </div>

      {/* Admin nav */}
      <div className="px-4 pt-2 pb-1">
        <p className="px-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Administrasjon
        </p>
      </div>
      <nav className="flex-1 px-2 space-y-0.5">
        {nav.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all"
              style={active ? {
                background: 'rgba(245,166,35,0.12)',
                border: '1px solid rgba(245,166,35,0.20)',
                color: '#FFFFFF',
                borderLeft: '2px solid #F5A623',
                paddingLeft: 10,
              } : {
                color: 'rgba(255,255,255,0.45)',
              }}
              onMouseEnter={(e) => { if (!active) { (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.80)'; } }}
              onMouseLeave={(e) => { if (!active) { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.45)'; } }}
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
