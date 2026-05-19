import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  TableOfContents, ImageRun, Footer, PageNumber, PageBreak,
  LevelFormat, TabStopType, BorderStyle,
} from 'docx';
import { marked } from 'marked';

export interface WordSeksjon {
  tittel: string;          // H1-tekst (menneskelig seksjonsnavn)
  markdownTekst: string;   // AI-tekst (sammendrag.seksjoner[id])
  grafPng?: Buffer;        // valgfri innebygd graf (allerede nedlastet)
}

export interface WordRapportInput {
  tittel: string;          // forside-hovedtittel (analyseType.navn)
  undertittel?: string;    // f.eks. "Prosjekt 4200 · 1. jan – 31. mar 2026"
  tenantNavn: string;      // "LNS AS" (OrganisasjonTema.organisasjonNavn)
  generertDato: Date;
  seksjoner: WordSeksjon[];
  temaPrimaer: string;     // #ffbb00
  temaNavy: string;        // #1B2A4A
}

const FONT = 'Calibri';
const SVART = '000000';
const GRAA = '808080';

// docx vil ha hex uten '#'.
function hex(farge: string): string {
  return farge.replace(/^#/, '');
}

// marked@4 lagrer HTML-escaped tekst i token.text (&quot; &amp; osv.).
// Sendt uendret til Word vises de literalt. Dekod før TextRun-bygging.
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');   // sist: ellers blir &amp;quot; → &quot; → "
}

// ── Markdown (inline) → TextRun[] ────────────────────────────────────
// marked@4: inline-tokens ligger i token.tokens på heading/paragraph/list-item.
function inlineRuns(
  tokens: unknown[] | undefined,
  arv: { bold?: boolean; italics?: boolean } = {},
): TextRun[] {
  if (!tokens || tokens.length === 0) return [];
  const runs: TextRun[] = [];
  for (const t of tokens as Array<Record<string, unknown>>) {
    const type = t.type as string;
    if (type === 'strong') {
      runs.push(...inlineRuns(t.tokens as unknown[], { ...arv, bold: true }));
    } else if (type === 'em') {
      runs.push(...inlineRuns(t.tokens as unknown[], { ...arv, italics: true }));
    } else if (type === 'codespan') {
      runs.push(new TextRun({ text: decodeHtmlEntities(String(t.text ?? '')), font: 'Consolas', size: 22, color: SVART }));
    } else if (type === 'text' && Array.isArray(t.tokens)) {
      runs.push(...inlineRuns(t.tokens as unknown[], arv));
    } else if (type === 'br') {
      runs.push(new TextRun({ break: 1 }));
    } else {
      // text / escape / ukjent inline → behold tekst (taper aldri innhold)
      const tekst = decodeHtmlEntities(String((t.text as string) ?? (t.raw as string) ?? ''));
      if (tekst) {
        runs.push(new TextRun({ text: tekst, bold: arv.bold, italics: arv.italics, font: FONT, size: 22, color: SVART }));
      }
    }
  }
  return runs;
}

// ── Markdown (block) → Paragraph[] ───────────────────────────────────
function markdownTilParagraphs(md: string, temaNavy: string): Paragraph[] {
  const ut: Paragraph[] = [];
  let tokens: Array<Record<string, unknown>>;
  try {
    tokens = marked.lexer(md ?? '') as unknown as Array<Record<string, unknown>>;
  } catch {
    // Parser-feil skal ikke velte hele rapporten — fall tilbake til ren tekst.
    return [new Paragraph({ children: [new TextRun({ text: md ?? '', font: FONT, size: 22, color: SVART })] })];
  }

  for (const tok of tokens) {
    const type = tok.type as string;
    if (type === 'heading') {
      const depth = (tok.depth as number) ?? 2;
      const size = depth <= 1 ? 32 : depth === 2 ? 28 : 24;
      ut.push(new Paragraph({
        heading: depth >= 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
        children: [new TextRun({
          text: decodeHtmlEntities(String(tok.text ?? '')),
          bold: true, font: FONT, size, color: hex(temaNavy),
        })],
      }));
    } else if (type === 'paragraph') {
      ut.push(new Paragraph({
        spacing: { line: 276, after: 120 },
        children: inlineRuns(tok.tokens as unknown[]),
      }));
    } else if (type === 'list') {
      const ordered = Boolean(tok.ordered);
      const items = (tok.items as Array<Record<string, unknown>>) ?? [];
      for (const item of items) {
        ut.push(new Paragraph({
          spacing: { line: 276, after: 60 },
          ...(ordered
            ? { numbering: { reference: 'num-ordered', level: 0 } }
            : { bullet: { level: 0 } }),
          children: inlineRuns(item.tokens as unknown[]),
        }));
      }
    } else if (type === 'space') {
      // hopp over
    } else {
      // ukjent block-token (tabell/kodeblokk utenfor MD-subset) → behold raw
      const raw = String((tok.raw as string) ?? (tok.text as string) ?? '').trim();
      if (raw) {
        ut.push(new Paragraph({ children: [new TextRun({ text: raw, font: FONT, size: 22, color: SVART })] }));
      }
    }
  }
  return ut;
}

function norskDato(d: Date): string {
  return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

// Filsystem-uvennlige tegn → mellomrom (blob-sti og nedlastingsnavn).
function rensFilnavn(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function formaterPeriode(fra?: string, til?: string): string | null {
  if (!fra || !til) return null;
  const fraDato = new Date(fra);
  const tilDato = new Date(til);
  if (isNaN(fraDato.getTime()) || isNaN(tilDato.getTime())) return null;

  const fraAar = fraDato.getFullYear();
  const tilAar = tilDato.getFullYear();
  const fraMnd = fraDato.getMonth();   // 0-indeksert
  const tilMnd = tilDato.getMonth();
  const fraDag = fraDato.getDate();
  const tilDag = tilDato.getDate();

  // Kvartal: starter 1. dag, dekker akkurat 3 måneder, samme år, slutter siste dag
  if (fraAar === tilAar && fraDag === 1 && fraMnd % 3 === 0 && tilMnd === fraMnd + 2) {
    const sisteDagIMnd = new Date(tilAar, tilMnd + 1, 0).getDate();
    if (tilDag === sisteDagIMnd) {
      return `Q${Math.floor(fraMnd / 3) + 1} ${fraAar}`;
    }
  }

  const mnd = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
  if (fraAar === tilAar) return `${mnd[fraMnd]}-${mnd[tilMnd]} ${fraAar}`;
  return `${mnd[fraMnd]} ${fraAar} - ${mnd[tilMnd]} ${tilAar}`;
}

/**
 * Menneskelig dokumentnavn, f.eks. "Varekostnad - Prosjekt 4200 - Q1 2026.docx".
 * Faller tilbake til kun typenavn hvis prosjekt/periode mangler.
 */
export function byggDokumentNavn(
  analyseType: { id: string; navn: string | null },
  parametre: { prosjekt?: string; fraDato?: string; tilDato?: string } | null | undefined,
  _generertDato: Date,
): string {
  let typenavn = analyseType.navn ?? analyseType.id;
  typenavn = typenavn.charAt(0).toUpperCase() + typenavn.slice(1);

  const deler: string[] = [rensFilnavn(typenavn)];
  if (parametre?.prosjekt) deler.push(rensFilnavn(`Prosjekt ${parametre.prosjekt}`));
  const periode = formaterPeriode(parametre?.fraDato, parametre?.tilDato);
  if (periode) deler.push(rensFilnavn(periode));

  return deler.join(' - ') + '.docx';
}

export async function byggWordRapport(input: WordRapportInput): Promise<Buffer> {
  const primaer = hex(input.temaPrimaer);
  const navy = hex(input.temaNavy);
  const generertTekst = `Generert ${norskDato(input.generertDato)} · ${input.tenantNavn}`;

  // ── Forside ──────────────────────────────────────────────
  const forside: Paragraph[] = [
    new Paragraph({ spacing: { before: 3000 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: input.tittel, bold: true, font: FONT, size: 64, color: primaer })],
    }),
    // Aksent-linje i primærfarge
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: primaer } },
      children: [],
    }),
  ];
  if (input.undertittel) {
    forside.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [new TextRun({ text: input.undertittel, font: FONT, size: 32, color: navy })],
    }));
  }
  forside.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 1200 },
    children: [new TextRun({ text: generertTekst, font: FONT, size: 22, color: GRAA })],
  }));

  // ── Innhold ──────────────────────────────────────────────
  const innhold: (Paragraph | TableOfContents)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 240 },
      children: [new TextRun({ text: 'Innholdsfortegnelse', bold: true, font: FONT, size: 36, color: primaer })],
    }),
    // Auto-TOC: noen Word-versjoner krever manuell F9 / høyreklikk →
    // "Oppdater felt" første gang dokumentet åpnes, selv med updateFields:true.
    new TableOfContents('Innhold', { hyperlink: true, headingStyleRange: '1-1' }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  input.seksjoner.forEach((seksjon, idx) => {
    if (idx > 0) {
      innhold.push(new Paragraph({ children: [new PageBreak()] }));
    }
    innhold.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 120, after: 200 },
      children: [new TextRun({ text: seksjon.tittel, bold: true, font: FONT, size: 36, color: primaer })],
    }));
    innhold.push(...markdownTilParagraphs(seksjon.markdownTekst, input.temaNavy));
    if (seksjon.grafPng) {
      innhold.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 240 },
        children: [new ImageRun({
          data: seksjon.grafPng,
          type: 'png',
          transformation: { width: 600, height: 400 },  // grafer er deterministisk 1200×800 (3:2)
        })],
      }));
    }
  });

  // ── Footer (kun innholds-seksjon; forside har titlePage uten footer) ──
  const footer = new Footer({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9026 }],  // A4 innenfor 1" marg
      children: [
        new TextRun({ text: generertTekst, font: FONT, size: 16, color: GRAA }),
        new TextRun({ text: '\t', font: FONT, size: 16 }),
        new TextRun({ text: 'Side ', font: FONT, size: 16, color: GRAA }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: GRAA }),
        new TextRun({ text: ' av ', font: FONT, size: 16, color: GRAA }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: GRAA }),
      ],
    })],
  });

  const sideOppsett = {
    page: {
      size: { width: 11906, height: 16838 },  // A4 twips
      margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    },
  };

  const doc = new Document({
    features: { updateFields: true },
    styles: { default: { document: { run: { font: FONT } } } },
    numbering: {
      config: [{
        reference: 'num-ordered',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
    sections: [
      {
        properties: { titlePage: true, page: sideOppsett.page },
        children: forside,
      },
      {
        properties: { page: sideOppsett.page },
        footers: { default: footer },
        children: innhold,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
