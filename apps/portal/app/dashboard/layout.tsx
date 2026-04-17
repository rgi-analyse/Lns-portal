'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import TopbarClient from '@/components/TopbarClient';
import { useTema } from '@/components/ThemeProvider';
import ChatWidget from '@/components/chat/ChatWidget';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { organisasjonNavn } = useTema();
  const pathname = usePathname();

  // Rapport-siden har sin egen kontekstuell AIChat-widget (med rapportId, slicere osv.)
  // — ikke vis global widget der for å unngå dobbel chat-knapp
  const skjulGlobalWidget = pathname.startsWith('/dashboard/rapport/');

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header
          className="h-14 shrink-0 flex items-center justify-between px-6"
          style={{
            background: 'rgba(10,22,40,0.5)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid var(--glass-bg)',
          }}
        >
          <span
            style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: '0.08em',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
            }}
          >
            {organisasjonNavn} Dataportal
          </span>
          <TopbarClient />
        </header>

        {/* Innhold */}
        <main className="flex-1 min-h-0 overflow-hidden">
          {children}
        </main>
      </div>

      {/* Global AI-chat widget — tilgjengelig fra alle sider unntatt rapport */}
      {!skjulGlobalWidget && <ChatWidget />}
    </div>
  );
}
