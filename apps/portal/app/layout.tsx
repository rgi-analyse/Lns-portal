import type { Metadata } from 'next';
import MsalWrapper from '@/components/MsalWrapper';
import ThemeProvider from '@/components/ThemeProvider';
import LisensProvider from '@/components/LisensProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dataportal',          // tenant-nøytral fallback; ThemeProvider setter ekte tittel når tema er hentet
  description: 'Power BI Portal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb">
      <head>
        {/*
          Blokkerende inline-script som setter cachet tema (fra forrige besøk) før
          first paint, slik at refresh ikke flasher fallback-temaet. Slug-utledningen
          speiler getTenantSlug() i lib/apiClient.ts og prefikset TEMA_CACHE_PREFIX i
          ThemeProvider.tsx. Kjører før React; ThemeProvider henter fersk data og
          oppdaterer cachen + UI etterpå.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var h=location.hostname.toLowerCase();var sys=h.indexOf('azurewebsites.net')>-1||h.indexOf('azure.com')>-1||h.indexOf('.azure.')>-1||h==='localhost'||/^[\\d.]+$/.test(h)||h.indexOf('.')===-1;var slug='lns';if(!sys){var s=h.split('.')[0];if(s&&s!=='www')slug=s;}var raw=localStorage.getItem('tema:'+slug);if(!raw)return;var d=JSON.parse(raw);if(d&&d.vars){var r=document.documentElement;for(var k in d.vars){r.style.setProperty(k,d.vars[k]);}}}catch(e){}})();`,
          }}
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <MsalWrapper>
          <ThemeProvider>
            <LisensProvider>
              {children}
            </LisensProvider>
          </ThemeProvider>
        </MsalWrapper>
      </body>
    </html>
  );
}
