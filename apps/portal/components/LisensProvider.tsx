'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { type Lisens, STANDARD_LISENS } from '@/lib/lisens';

const LisensCtx = createContext<Lisens>(STANDARD_LISENS);

export function useLisens(): Lisens {
  return useContext(LisensCtx);
}

export default function LisensProvider({ children }: { children: React.ReactNode }) {
  const [lisens, setLisens] = useState<Lisens>(STANDARD_LISENS);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
    const tenantId =
      typeof window !== 'undefined' &&
      !window.location.hostname.includes('azurewebsites.net') &&
      !window.location.hostname.includes('localhost')
        ? window.location.hostname.split('.')[0]
        : 'lns';

    fetch(`${apiUrl}/api/lisens`, {
      headers: { 'x-tenant-id': tenantId },
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: Lisens | null) => { if (data) setLisens(data); })
      .catch(() => {});
  }, []);

  return (
    <LisensCtx.Provider value={lisens}>
      {children}
    </LisensCtx.Provider>
  );
}
