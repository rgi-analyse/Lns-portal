import type { Metadata } from 'next';
import MsalWrapper from '@/components/MsalWrapper';
import ThemeProvider from '@/components/ThemeProvider';
import LisensProvider from '@/components/LisensProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'LNS Dataportal',
  description: 'LNS Power BI Portal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb">
      <head>
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
