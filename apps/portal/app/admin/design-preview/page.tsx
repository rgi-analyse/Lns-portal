'use client';

/**
 * /admin/design-preview — visuell POC for design-refresh (Fase D1).
 * Viser de tre POC-komponentene (Button/Card/TabellRad) + tokens (farger,
 * typografi, radii, shadows) + Fluent-ikoner, i BÅDE LNS- og demo-tema.
 * Endrer ingen eksisterende komponenter.
 */
import { type CSSProperties } from 'react';
import {
  Add24Regular, Edit20Regular, Delete20Regular, Open20Regular, ArrowDownload20Regular,
  CheckmarkCircle16Regular, Warning16Regular, Info16Regular, DismissCircle16Regular,
} from '@fluentui/react-icons';
import { tokens } from '@/lib/design-tokens';
import { Button } from '@/components/designv2/Button';
import { Card } from '@/components/designv2/Card';
import { TabellRad } from '@/components/designv2/TabellRad';

// Kun brand/flate-variabler overstyres per tema; tekst/border arves fra :root.
const LNS_TEMA = { '--gold': '#ffbb00', '--primary-text': '#0a1628', '--navy-darkest': '#0a1628', '--navy-dark': '#14233f', '--navy': '#1e3050' } as CSSProperties;
const DEMO_TEMA = { '--gold': '#8b5cf6', '--primary-text': '#ffffff', '--navy-darkest': '#17132a', '--navy-dark': '#241c40', '--navy': '#322753' } as CSSProperties;

const seksjonTittel: CSSProperties = { fontFamily: tokens.fontFamily.segoe, fontSize: tokens.fontSize.small, fontWeight: tokens.fontWeight.semibold, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted, rgba(255,255,255,0.45))', margin: '18px 0 8px' };

function Swatch({ farge, navn }: { farge: string; navn: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
      <div style={{ width: 44, height: 44, borderRadius: tokens.radii.medium, background: farge, border: '1px solid rgba(255,255,255,0.12)' }} />
      <span style={{ fontFamily: tokens.fontFamily.segoe, fontSize: 10, color: 'var(--text-muted, rgba(255,255,255,0.45))' }}>{navn}</span>
    </div>
  );
}

function Showcase() {
  const tekst = { color: 'var(--text-primary, #fff)', fontFamily: tokens.fontFamily.segoe };
  return (
    <>
      {/* Typografi */}
      <div style={seksjonTittel}>Typografi (Segoe UI)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...tekst, fontSize: tokens.fontSize.h1, fontWeight: tokens.fontWeight.semibold }}>H1 · 24 semibold</span>
        <span style={{ ...tekst, fontSize: tokens.fontSize.h2, fontWeight: tokens.fontWeight.semibold }}>H2 · 18 semibold</span>
        <span style={{ ...tekst, fontSize: tokens.fontSize.h3, fontWeight: tokens.fontWeight.semibold }}>H3 · 16 semibold</span>
        <span style={{ ...tekst, fontSize: tokens.fontSize.body, fontWeight: tokens.fontWeight.regular }}>Body · 14 regular — data-tett Azure-tekst.</span>
        <span style={{ ...tekst, fontSize: tokens.fontSize.small, color: 'var(--text-muted, #999)' }}>Small · 12 — metadata / hjelpetekst.</span>
      </div>

      {/* Knapper */}
      <div style={seksjonTittel}>Knapper</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="primary" ikon={<Add24Regular fontSize={18} />}>Nytt dashbord</Button>
        <Button variant="secondary" ikon={<ArrowDownload20Regular fontSize={16} />}>Eksporter</Button>
        <Button variant="secondary">Avbryt</Button>
      </div>

      {/* Kort */}
      <div style={seksjonTittel}>Kort</div>
      <Card
        header="Fyllingsgrad Flake 1"
        footer={<><Button variant="secondary" ikon={<Edit20Regular fontSize={16} />}>Rediger</Button><Button variant="primary" ikon={<Open20Regular fontSize={16} />}>Åpne</Button></>}
      >
        Sensor-dashbord med 1 graf. Oppdaterer hvert 10. sekund. Elevation via
        border + bakgrunn, ikke soft-shadow.
      </Card>

      {/* Tabell */}
      <div style={seksjonTittel}>Tabell (kompakt)</div>
      <div style={{ border: '1px solid var(--glass-border, rgba(255,255,255,0.12))', borderRadius: tokens.radii.medium, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><TabellRad header celler={['Navn', 'Grafer', 'Intervall', '']} /></thead>
          <tbody>
            <TabellRad celler={['Skaland kontrollrom', '1', '10 s', <span key="a" style={{ display: 'inline-flex', gap: 8 }}><Edit20Regular fontSize={16} /><Delete20Regular fontSize={16} /></span>]} />
            <TabellRad celler={['Produksjonslinje 2', '3', '5 s', <span key="a" style={{ display: 'inline-flex', gap: 8 }}><Edit20Regular fontSize={16} /><Delete20Regular fontSize={16} /></span>]} />
          </tbody>
        </table>
      </div>

      {/* Farger */}
      <div style={seksjonTittel}>Merkevare + Azure-semantikk</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Swatch farge="var(--gold)" navn="brand" />
        <Swatch farge={tokens.colors.semantic.info} navn="info" />
        <Swatch farge={tokens.colors.semantic.success} navn="success" />
        <Swatch farge={tokens.colors.semantic.warning} navn="warning" />
        <Swatch farge={tokens.colors.semantic.danger} navn="danger" />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {Object.entries(tokens.colors.neutral).map(([k, v]) => <Swatch key={k} farge={v} navn={k} />)}
      </div>

      {/* Semantiske ikoner */}
      <div style={seksjonTittel}>Fluent-ikoner (semantiske)</div>
      <div style={{ display: 'flex', gap: 16, ...tekst, fontSize: 13, alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: tokens.colors.semantic.success }}><CheckmarkCircle16Regular /> OK</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: tokens.colors.semantic.warning }}><Warning16Regular /> Advarsel</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: tokens.colors.semantic.danger }}><DismissCircle16Regular /> Feil</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: tokens.colors.semantic.info }}><Info16Regular /> Info</span>
      </div>

      {/* Radii + shadows */}
      <div style={seksjonTittel}>Radii + elevation</div>
      <div style={{ display: 'flex', gap: 12 }}>
        {(['small', 'medium', 'large'] as const).map(r => (
          <div key={r} style={{ width: 70, height: 44, background: 'var(--navy)', border: '1px solid var(--glass-border, rgba(255,255,255,0.12))', borderRadius: tokens.radii[r], boxShadow: tokens.shadows.elevation2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: tokens.fontFamily.segoe, fontSize: 10, color: 'var(--text-muted, #999)' }}>{tokens.radii[r]}</div>
        ))}
      </div>
    </>
  );
}

export default function DesignPreview() {
  return (
    <div className="p-8 overflow-y-auto h-full" style={{ fontFamily: tokens.fontFamily.segoe }}>
      <h1 style={{ fontFamily: tokens.fontFamily.segoe, fontSize: tokens.fontSize.h1, fontWeight: tokens.fontWeight.semibold, color: 'var(--text-primary)', margin: 0 }}>
        Design-preview (Fase D1)
      </h1>
      <p style={{ fontFamily: tokens.fontFamily.segoe, fontSize: tokens.fontSize.body, color: 'var(--text-secondary)', margin: '6px 0 20px' }}>
        Microsoft/Azure-inspirert POC — tokens, Segoe UI, Fluent-ikoner. Venstre: LNS-tema (gull). Høyre: demo-tema (lilla).
      </p>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ ...LNS_TEMA, background: 'var(--navy-darkest)', border: '1px solid var(--glass-border, rgba(255,255,255,0.12))', borderRadius: tokens.radii.large, padding: 20, flex: 1, minWidth: 360 }}>
          <div style={seksjonTittel}>LNS-tema</div>
          <Showcase />
        </div>
        <div style={{ ...DEMO_TEMA, background: 'var(--navy-darkest)', border: '1px solid var(--glass-border, rgba(255,255,255,0.12))', borderRadius: tokens.radii.large, padding: 20, flex: 1, minWidth: 360 }}>
          <div style={seksjonTittel}>Demo-tema</div>
          <Showcase />
        </div>
      </div>
    </div>
  );
}
