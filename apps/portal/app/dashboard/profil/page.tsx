'use client';

import { usePortalAuth } from '@/hooks/usePortalAuth';
import { User, Mail, Shield } from 'lucide-react';

export default function ProfilPage() {
  const { displayName, email, rolle, isAuthenticated } = usePortalAuth();

  if (!isAuthenticated) return null;

  const initialer = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('');

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-lg mx-auto pt-8">

        {/* Avatar + navn */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold select-none"
            style={{
              background: 'var(--gold-dim)',
              border: '2px solid var(--gold-dim)',
              color: 'var(--gold)',
              fontFamily: 'Barlow Condensed, sans-serif',
              letterSpacing: '0.05em',
            }}
          >
            {initialer || <User className="w-8 h-8" />}
          </div>
          <div className="text-center">
            <h1
              className="text-xl font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {displayName}
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Pålogget
            </p>
          </div>
        </div>

        {/* Informasjonskort */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--glass-bg-hover)' }}
        >
          {[
            { icon: User,   label: 'Navn',    value: displayName },
            { icon: Mail,   label: 'E-post',  value: email ?? '—' },
            { icon: Shield, label: 'Rolle',   value: rolle === 'admin' ? 'Administrator' : 'Bruker' },
          ].map(({ icon: Icon, label, value }, i, arr) => (
            <div
              key={label}
              className="flex items-center gap-4 px-5 py-4"
              style={{
                background: 'var(--glass-bg)',
                borderBottom: i < arr.length - 1 ? '1px solid var(--glass-bg)' : undefined,
              }}
            >
              <Icon className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
              <span className="text-sm w-20 shrink-0" style={{ color: 'var(--text-muted)' }}>
                {label}
              </span>
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {value}
              </span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
