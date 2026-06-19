'use client';

import { useEffect, useState } from 'react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';

export default function TenantsLayout({ children }: { children: React.ReactNode }) {
  const { entraObjectId, authHeaders } = usePortalAuth();
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!entraObjectId) { router.replace('/dashboard'); return; }
    apiFetch('/api/me', {
      headers: authHeaders,
    })
      .then(r => r.json())
      .then((b: { rolle?: string }) => {
        if (b.rolle === 'tenantadmin') setOk(true);
        else router.replace('/admin');
      })
      .catch(() => router.replace('/admin'));
  }, [entraObjectId, router]);

  if (!ok) return null;
  return <>{children}</>;
}
