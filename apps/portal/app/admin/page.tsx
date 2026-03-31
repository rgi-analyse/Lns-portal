'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, FileBarChart2, Users, ArrowRight } from 'lucide-react';
import { useMsal } from '@azure/msal-react';
import { apiFetch } from '@/lib/apiClient';

interface WorkspaceCount {
  _count: { rapporter: number; tilgang: number };
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function AdminOverviewPage() {
  const { accounts } = useMsal();
  const entraObjectId = accounts[0]?.localAccountId ?? '';

  const [stats, setStats] = useState<{ workspaces: number; rapporter: number; tilgang: number } | null>(null);

  useEffect(() => {
    if (!entraObjectId) return;
    apiFetch('/api/workspaces', { headers: { 'X-Entra-Object-Id': entraObjectId } })
      .then((r) => r.json())
      .then((data: WorkspaceCount[]) =>
        setStats({
          workspaces: data.length,
          rapporter:  data.reduce((s, ws) => s + (ws._count?.rapporter ?? 0), 0),
          tilgang:    data.reduce((s, ws) => s + (ws._count?.tilgang ?? 0), 0),
        }),
      )
      .catch(() => setStats({ workspaces: 0, rapporter: 0, tilgang: 0 }));
  }, [entraObjectId]);

  const cards = [
    {
      label: 'Workspaces',
      value: stats?.workspaces,
      icon: Building2,
      iconBg: 'rgba(27,42,74,0.60)',
      iconBorder: 'rgba(255,255,255,0.10)',
      iconColor: 'rgba(255,255,255,0.70)',
    },
    {
      label: 'Rapporter',
      value: stats?.rapporter,
      icon: FileBarChart2,
      iconBg: 'var(--glass-gold-bg)',
      iconBorder: 'var(--glass-gold-border)',
      iconColor: 'var(--gold)',
    },
    {
      label: 'Tilganger',
      value: stats?.tilgang,
      icon: Users,
      iconBg: 'rgba(16,185,129,0.10)',
      iconBorder: 'rgba(16,185,129,0.20)',
      iconColor: 'rgba(110,231,183,0.9)',
    },
  ];

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1
          className="uppercase tracking-wide"
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 800,
            fontSize: 24,
            color: 'rgba(255,255,255,0.90)',
          }}
        >
          Admin-oversikt
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>
          Administrer workspaces, rapporter og tilganger.
        </p>
      </div>

      {/* Stat-kort */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {cards.map(({ label, value, icon: Icon, iconBg, iconBorder, iconColor }) => (
          <div
            key={label}
            className="rounded-2xl p-6 flex items-center gap-4"
            style={{
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: iconBg, border: `1px solid ${iconBorder}` }}
            >
              <Icon className="w-6 h-6" style={{ color: iconColor }} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold"
                style={{ color: 'rgba(255,255,255,0.30)' }}>
                {label}
              </p>
              <p style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 800,
                fontSize: 28,
                color: 'rgba(255,255,255,0.90)',
                lineHeight: 1,
                marginTop: 2,
              }}>
                {value === undefined
                  ? <span className="inline-block w-8 h-7 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  : value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Snarveier */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.03)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
        >
          <div>
            <p className="font-medium text-sm" style={{ color: 'rgba(255,255,255,0.80)' }}>Workspaces</p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.40)' }}>
              Administrer Power BI-workspaces og rapporter
            </p>
          </div>
          <Link
            href="/admin/workspaces"
            className="inline-flex items-center gap-1 h-7 px-3 text-xs rounded-lg font-medium transition-colors"
            style={{
              background: 'var(--glass-gold-bg)',
              border: '1px solid var(--glass-gold-border)',
              color: 'var(--gold)',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--glass-gold-border)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--glass-gold-bg)'; }}
          >
            Administrer <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
