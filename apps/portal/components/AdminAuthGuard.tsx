'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePortalAuth } from '@/hooks/usePortalAuth';

export default function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, entraObjectId } = usePortalAuth();
  const [status, setStatus] = useState<'loading' | 'ok' | 'denied'>('loading');

  useEffect(() => {
    if (!isAuthenticated || !entraObjectId) {
      router.replace('/');
      return;
    }

    // Alltid sjekk mot API — ikke stol på cachet rolle fra session
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
    fetch(`${apiUrl}/api/me`, {
      headers: {
        'x-tenant-id': 'lns',
        'x-entra-object-id': entraObjectId,
      },
    })
      .then(async (r) => {
        if (!r.ok) { setStatus('denied'); return; }
        const bruker = await r.json() as { rolle: string };
        const adminRoller = ['admin', 'tenantadmin'];
        setStatus(adminRoller.includes(bruker.rolle) ? 'ok' : 'denied');
      })
      .catch(() => setStatus('denied'));
  }, [isAuthenticated, entraObjectId, router]);

  useEffect(() => {
    if (status === 'denied') router.replace('/dashboard');
  }, [status, router]);

  if (status !== 'ok') return null;
  return <>{children}</>;
}
