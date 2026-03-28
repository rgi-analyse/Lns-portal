import Sidebar from '@/components/Sidebar';
import TopbarClient from '@/components/TopbarClient';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
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
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <span
            style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: '0.08em',
              color: 'rgba(255,255,255,0.55)',
              textTransform: 'uppercase',
            }}
          >
            LNS Dataportal
          </span>
          <TopbarClient />
        </header>

        {/* Innhold */}
        <main className="flex-1 min-h-0 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
