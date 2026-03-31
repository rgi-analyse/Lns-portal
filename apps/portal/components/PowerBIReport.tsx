'use client';

import { useState, useEffect, useRef } from 'react';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models, Report } from 'powerbi-client';
import type { FilterConfig, SlicerConfig } from './AIChat';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import {
  FileText, Presentation, Table,
  Maximize, RefreshCw, Bookmark, RotateCcw,
  ZoomIn, ZoomOut, Scan, Maximize2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/apiClient';

type ExportFormat = 'PDF' | 'PPTX';

interface EmbedConfig {
  embedUrl: string;
  accessToken: string;
  tokenId: string;
}

interface ExportingState {
  PDF: boolean;
  PPTX: boolean;
}

interface PowerBIReportProps {
  rapportId?: string;           // Portal DB-ID — fallback hvis PBI-IDer ikke er tilgjengelig
  portalWorkspaceId?: string;   // Portal workspace-ID — for workspace-spesifikk bookmark-lagring
  pbiReportId?: string;         // Power BI Report ID
  pbiDatasetId?: string;        // Power BI Dataset ID
  pbiWorkspaceId?: string;      // Power BI Workspace ID (Fabric)
  filterConfig?: FilterConfig;  // AI-drevet filter
  slicerConfig?: SlicerConfig;  // AI-drevet slicer
  onSlicersLoaded?: (slicers: string[]) => void;
  onSlicerValuesLoaded?: (values: Record<string, Record<string, string[]>>) => void;
  onActiveStateChange?: (state: Record<string, unknown>) => void;
  onTablesLoaded?: (tables: string[]) => void;
  onRegisterGetVisualData?: (fn: () => Promise<Record<string, string>>) => void;
  onAktivSideChange?: (side: string) => void;
  clearSlicerTitle?: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function PowerBIReport({ rapportId, portalWorkspaceId, pbiReportId, pbiDatasetId, pbiWorkspaceId, filterConfig, slicerConfig, clearSlicerTitle, onSlicersLoaded, onSlicerValuesLoaded, onActiveStateChange, onTablesLoaded, onRegisterGetVisualData, onAktivSideChange }: PowerBIReportProps = {}) {
  const { entraObjectId } = usePortalAuth();

  // Workspace-spesifikk nøkkel for bookmark-lagring
  const innstillingerKey = pbiReportId
    ? portalWorkspaceId ? `${portalWorkspaceId}_${pbiReportId}` : pbiReportId
    : undefined;

  const [embedConfig, setEmbedConfig] = useState<EmbedConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<Report | null>(null);
  const [exporting, setExporting] = useState<ExportingState>({ PDF: false, PPTX: false });
  const [eksporterer, setEksporterer] = useState(false);
  const [excelPickerOpen, setExcelPickerOpen] = useState(false);
  const [excelKandidater, setExcelKandidater] = useState<{ pageKey: string; pageLabel: string; visualKey: string; visualLabel: string; type: string }[]>([]);
  const [excelValgte, setExcelValgte] = useState<Set<string>>(new Set());
  const [excelLaster, setExcelLaster] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'pending' | 'saved'>('idle');

  interface RefreshInfo {
    sisteRefresh: { tidspunkt: string | null; status: string | null };
    schedule: { aktivert: boolean; tidspunkter: string[]; dager: string[]; tidssone: string | null };
  }
  const [refreshInfo, setRefreshInfo] = useState<RefreshInfo | null>(null);
  const autoSaveTimer        = useRef<NodeJS.Timeout | null>(null);
  const slicerStateTimer     = useRef<NodeJS.Timeout | null>(null);
  const onActiveStateChangeRef = useRef(onActiveStateChange);
  const fetchedRef = useRef(false);
  const reportRef = useRef<Report | null>(null);
  const accountRef = useRef<string | null>(null);
  const embedContainerRef = useRef<HTMLDivElement>(null);
  // Mapping: nøkkel (kolonne-/visningsnavn) → visual.name (intern PBI-identifikator)
  const slicerMappingRef = useRef<Record<string, string>>({});

  useEffect(() => { reportRef.current = report; }, [report]);
  useEffect(() => { accountRef.current = entraObjectId ?? null; }, [entraObjectId]);
  useEffect(() => { onActiveStateChangeRef.current = onActiveStateChange; }, [onActiveStateChange]);

  useEffect(() => {
    if (!excelPickerOpen) return;
    const handler = (e: MouseEvent) => {
      const picker = document.getElementById('excel-picker-popover');
      if (picker && !picker.contains(e.target as Node)) setExcelPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [excelPickerOpen]);

  useEffect(() => {
    if (!pbiDatasetId || !pbiWorkspaceId) return;
    apiFetch(`/api/pbi/refresh-info?datasetId=${pbiDatasetId}&workspaceId=${pbiWorkspaceId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setRefreshInfo(data as RefreshInfo); })
      .catch(() => { /* ikke kritisk — vis bare ingenting */ });
  }, [pbiDatasetId, pbiWorkspaceId]);

  useEffect(() => {
    if (!report || !filterConfig) return;
    const filter: models.IBasicFilter = {
      $schema: 'http://powerbi.com/product/schema#basic',
      target: { table: filterConfig.table, column: filterConfig.column },
      filterType: models.FilterType.Basic,
      operator: filterConfig.operator ?? 'In',
      values: filterConfig.values,
    };
    report.updateFilters(models.FiltersOperations.Replace, [filter]).catch((err) =>
      console.warn('[PowerBIReport] filter feil:', err),
    );
  }, [filterConfig, report]);

  useEffect(() => {
    if (!slicerConfig || !reportRef.current) return;
    console.log('[PBI] slicerConfig endret, kaller setSlicerValue:', slicerConfig);
    setSlicerValue(slicerConfig.slicerTitle, slicerConfig.values, slicerConfig.år)
      .then(() => getActiveSlicerState().then(onActiveStateChange));
  }, [slicerConfig]);

  useEffect(() => {
    if (!clearSlicerTitle || !reportRef.current) return;
    console.log('[PBI] clearSlicerTitle endret, nullstiller slicer:', clearSlicerTitle);
    clearSlicerValue(clearSlicerTitle)
      .then(() => getActiveSlicerState().then(onActiveStateChange));
  }, [clearSlicerTitle]);

  async function exportVisualData(visualTitle: string): Promise<string> {
    const r = reportRef.current;
    if (!r) return '';
    const pages = await r.getPages();
    const activePage = pages.find((p) => p.isActive);
    if (!activePage) return '';
    const visuals = await activePage.getVisuals();
    const visual = visuals.find((v) => (v.title?.trim() || v.name) === visualTitle);
    if (!visual) return '';
    const exported = await visual.exportData(models.ExportDataType.Summarized);
    return exported.data;
  }

  // Gjenkjenner alle slicer-varianter, inkl. custom visuals som advancedSlicerVisual
  const erSlicerType = (type: string) => type.toLowerCase().includes('slicer');

  // Ekskluder kjente ikke-eksporterbare typer. Alt annet (inkl. custom visuals) får prøve.
  const ikkeEksporterbare = new Set([
    'actionButton', 'pageNavigator', 'image', 'textbox', 'shape', 'basicShape', 'line',
    'filledMap', 'map', 'card', 'multiRowCard',
  ]);

  const erEksporterbar = (type: string): boolean => {
    if (erSlicerType(type)) return false;
    if (ikkeEksporterbare.has(type)) return false;
    return true;
  };

  interface ExcelKandidat {
    pageKey: string;
    pageLabel: string;
    visualKey: string;
    visualLabel: string;
    type: string;
  }

  const synligeSider = async () => {
    if (!reportRef.current) return [];
    const pages = await reportRef.current.getPages();
    return pages.filter((p) => {
      const name = p.displayName.toLowerCase();
      if (name.includes('tooltip')) return false;
      if (name.includes('hidden')) return false;
      // visibility 1 = Hidden i PBI JS API
      if ((p as unknown as Record<string, unknown>)['visibility'] === 1) return false;
      return true;
    });
  };

  const getAllVisualsData = async (
    filter?: Set<string>, // Set av `${pageKey}::${visualKey}` — undefined = alle
  ): Promise<Record<string, string>> => {
    if (!reportRef.current) return {};
    const result: Record<string, string> = {};

    try {
      const pages = await synligeSider();
      console.log(`[PBI] Synlige sider: ${pages.length}`);

      for (const page of pages) {
        const visuals = await page.getVisuals();
        console.log(`[PBI] Side "${page.displayName}": ${visuals.length} visuals`);

        for (const visual of visuals) {
          const compositeKey = `${page.name}::${visual.name}`;
          if (filter && !filter.has(compositeKey)) continue;
          if (!erEksporterbar(visual.type)) {
            console.log(`[PBI] ⏭ skippet: "${visual.title || visual.name}" (${visual.type})`);
            continue;
          }

          const label = `${page.displayName} - ${visual.title || visual.name}`;
          try {
            const exported = await visual.exportData(models.ExportDataType.Summarized, 10000);
            const lines = exported.data?.split('\n') ?? [];
            const rowCount = lines.length - 1;
            console.log(`[PBI] ✅ "${label}" (summarized): ${rowCount} rader`);
            if (rowCount > 0) result[label] = exported.data;
          } catch {
            // Prøv Underlying hvis Summarized feiler
            try {
              const exported = await visual.exportData(models.ExportDataType.Underlying, 10000);
              const lines = exported.data?.split('\n') ?? [];
              const rowCount = lines.length - 1;
              console.log(`[PBI] ✅ "${label}" (underlying): ${rowCount} rader`);
              if (rowCount > 0) result[label] = exported.data;
            } catch (e2) {
              console.warn(`[PBI] ⚠️ "${label}" (${visual.type}) ikke eksporterbar: ${(e2 as Error).message}`);
            }
          }
        }
      }

      console.log(`[PBI] Total data: ${Object.keys(result).length} visuals`);
    } catch (e) {
      console.error('[PBI] getAllVisualsData feil:', (e as Error).message);
    }

    return result;
  };

  const hentExcelKandidater = async (): Promise<ExcelKandidat[]> => {
    if (!reportRef.current) return [];
    const kandidater: ExcelKandidat[] = [];
    try {
      const pages = await synligeSider();
      for (const page of pages) {
        const visuals = await page.getVisuals();
        console.log('[PBI] Kandidater for eksport:', visuals.map((v) => `${v.title || v.name} (${v.type})`));
        for (const visual of visuals) {
          if (!erEksporterbar(visual.type)) continue;
          if (!visual.title?.trim()) continue; // hopp over visuals uten tittel
          kandidater.push({
            pageKey:     page.name,
            pageLabel:   page.displayName,
            visualKey:   visual.name,
            visualLabel: visual.title.trim(),
            type:        visual.type,
          });
        }
      }
    } catch (e) {
      console.error('[PBI] hentExcelKandidater feil:', (e as Error).message);
    }
    return kandidater;
  };

  async function getSlicers(r: Report = reportRef.current!): Promise<string[]> {
    if (!r) return [];
    try {
      const pages = await r.getPages();
      const activePage = pages.find((p) => p.isActive);
      if (!activePage) return [];
      const visuals = await activePage.getVisuals();

      console.log('[PBI] ALLE visuals:', visuals.map((v) => ({
        title:       v.title,
        type:        v.type,
        name:        v.name,
        displayName: (v as unknown as Record<string, unknown>)['displayName'],
      })));

      console.log('[PBI] alle visual typer:', [...new Set(visuals.map((v) => v.type))]);

      const slicers = visuals
        .filter((v) => erSlicerType(v.type))
        .map((v) => {
          const title = v.title?.trim() || v.name;
          if (!v.title?.trim()) console.warn('[PBI] Slicer mangler tittel, bruker name:', v.name);
          return title;
        });
      console.log('[PBI] Tilgjengelige slicers:', slicers);
      return slicers;
    } catch (err) {
      console.error('[PBI] getSlicers feil:', err);
      return [];
    }
  }

  async function getActiveSlicerState(): Promise<Record<string, unknown>> {
    const r = reportRef.current;
    if (!r) return {};
    try {
      const pages = await r.getPages();
      const activePage = pages.find((p) => p.isActive);
      if (!activePage) return {};
      const visuals = await activePage.getVisuals();
      const slicerVisuals = visuals.filter((v) => erSlicerType(v.type));

      // Bygg reverse mapping: visual.name → nøkkel
      const reverseMapping: Record<string, string> = {};
      for (const [nøkkel, visualName] of Object.entries(slicerMappingRef.current)) {
        reverseMapping[visualName] = nøkkel;
      }

      const state: Record<string, unknown> = {};
      for (const slicer of slicerVisuals) {
        // Bruk nøkkel fra mapping hvis tilgjengelig, ellers tittel/name som fallback
        const title = reverseMapping[slicer.name] ?? slicer.title?.trim() ?? slicer.name;
        const slicerState = await slicer.getSlicerState();
        const firstFilter = slicerState.filters?.[0] as unknown as Record<string, unknown> | undefined;

        if (firstFilter?.['filterType'] === 9) {
          // Hierarchy slicer (Tid)
          const hData = firstFilter['hierarchyData'] as Array<Record<string, unknown>> | undefined;
          state[title] = hData?.map((parent) => ({
            år: parent['value'],
            uker: (parent['children'] as Array<Record<string, unknown>> | undefined)
              ?.filter((c) => c['operator'] === 'Selected')
              ?.map((c) => c['value']),
          }));
        } else if (firstFilter && Array.isArray((firstFilter as Record<string, unknown>)['values'])) {
          state[title] = (firstFilter as Record<string, unknown>)['values'];
        } else {
          state[title] = null;
        }
      }

      console.log('[PBI] aktivt slicer-state raw:', JSON.stringify(state));
      return state;
    } catch (err) {
      console.error('[PBI] getActiveSlicerState feil:', err);
      return {};
    }
  }

  async function getSlicerValues(slicerTitle: string, r: Report): Promise<Record<string, string[]>> {
    try {
      const pages = await r.getPages();
      const activePage = pages.find((p) => p.isActive);
      if (!activePage) return {};
      const visuals = await activePage.getVisuals();
      const slicer = visuals.find((v) => erSlicerType(v.type) && (v.title?.trim() || v.name) === slicerTitle);
      if (!slicer) return {};

      const exported = await slicer.exportData();
      const lines = exported.data.split('\n').slice(1).filter(Boolean);
      const result: Record<string, string[]> = {};
      lines.forEach((line) => {
        const parts = line.split(',');
        const firstCol = parts[0].trim();
        const år = parseInt(firstCol, 10);
        if (!isNaN(år) && parts.length > 1) {
          const key = String(år);
          const value = parts.slice(1).join(',').trim();
          if (!result[key]) result[key] = [];
          result[key].push(value);
        } else {
          if (!result['0']) result['0'] = [];
          result['0'].push(firstCol);
        }
      });
      return result;
    } catch (err) {
      console.error('[PBI] getSlicerValues feil for', slicerTitle, ':', err);
      return {};
    }
  }

  /** Les kolonnenavn fra exportData() og bygg nøkkel + mapping for alle slicere i én pass */
  async function loadAllSlicers(r: Report): Promise<{
    nøkler: string[];
    values: Record<string, Record<string, string[]>>;
  }> {
    const newMapping: Record<string, string> = {};
    const slicerValuesMap: Record<string, Record<string, string[]>> = {};
    const nøkler: string[] = [];

    try {
      const pages = await r.getPages();
      const activePage = pages.find((p) => p.isActive);
      if (!activePage) return { nøkler: [], values: {} };
      const visuals = await activePage.getVisuals();
      console.log('[PBI] alle visual typer:', [...new Set(visuals.map((v) => v.type))]);
      const slicerVisuals = visuals.filter((v) => erSlicerType(v.type));

      // Logg alle slicere som finnes på siden
      console.log(`[PBI] Antall slicere funnet: ${slicerVisuals.length} (av ${visuals.length} visuals)`);
      slicerVisuals.forEach((s) => console.log(`[PBI] slicer: name="${s.name}" title="${s.title ?? '(ingen)'}" type="${s.type}"`));

      for (const visual of slicerVisuals) {
        const tittel = visual.title?.trim() ?? '';

        try {
          // STEG 2: Eksporter data og logg resultat/feil per slicer
          const exported = await visual.exportData(models.ExportDataType.Summarized);
          const rawLines = exported.data.split('\n').map((l: string) => l.trim()).filter(Boolean);
          const kolonneNavn = rawLines[0] ?? '';       // første linje = kolonnenavn
          // STEG 5: Begrens til maks 50 verdier per slicer
          const verdier = rawLines.slice(1, 51);

          // Bruk kolonneNavn som nøkkel hvis tittel er generisk ("Slicer") eller mangler
          const nøkkel = (!tittel || tittel === 'Slicer') ? kolonneNavn : tittel;

          console.log(`[PBI] ✅ slicer: "${nøkkel}" (title="${tittel}" kolonneNavn="${kolonneNavn}") → ${verdier.length} verdier`);

          newMapping[nøkkel] = visual.name;            // nøkkel → intern PBI visual.name
          slicerValuesMap[nøkkel] = { '0': verdier };  // STEG 3: flat struktur
          nøkler.push(nøkkel);
        } catch (err) {
          // STEG 2: Logg feil, men legg allikevel til i mapping med tomme verdier
          // slik at AI kan referere til sliceren og sette den via setSlicerValue
          const nøkkel = tittel || visual.name;
          console.log(`[PBI] ❌ slicer feilet: "${nøkkel}"`, (err as Error).message);
          newMapping[nøkkel] = visual.name;
          slicerValuesMap[nøkkel] = { '0': [] };
          nøkler.push(nøkkel);
        }
      }

      slicerMappingRef.current = newMapping;
      console.log('[PBI] slicer mapping:', Object.keys(newMapping));
    } catch (err) {
      console.error('[PBI] loadAllSlicers feil:', err);
    }

    return { nøkler, values: slicerValuesMap };
  }

  async function setSlicerValue(slicerTitle: string, values: string[], år?: number): Promise<void> {
    const r = reportRef.current;
    if (!r) return;
    try {
      const pages = await r.getPages();
      const activePage = pages.find((p) => p.isActive);
      if (!activePage) { console.warn('[PBI] Ingen aktiv side funnet'); return; }

      const visuals = await activePage.getVisuals();
      // Finn slicer via intern visual.name fra mapping, ellers tittel som fallback
      const mappedName = slicerMappingRef.current[slicerTitle];
      const slicer = mappedName
        ? visuals.find((v) => erSlicerType(v.type) && v.name === mappedName)
        : visuals.find((v) => erSlicerType(v.type) && (v.title?.trim() || v.name) === slicerTitle);
      if (!slicer) { console.warn(`[PBI] Slicer "${slicerTitle}" ikke funnet (mapping: ${mappedName ?? 'ingen'})`); return; }

      // Les slicer state FØR setting
      let beforeState: models.ISlicerState | null = null;
      try {
        beforeState = await slicer.getSlicerState();
        console.log('[PBI] Slicer state FØR setting:', JSON.stringify(beforeState, null, 2));
      } catch (e) {
        console.log('[PBI] Kunne ikke lese slicer state før setting:', e);
      }

      const firstFilter = beforeState?.filters?.[0] as Record<string, unknown> | undefined;
      const isHierarchy = firstFilter?.['filterType'] === 9;

      if (isHierarchy) {
        // Hierarchy slicer (f.eks. Tid med år + UkeTekst)
        const targetYear = år ?? new Date().getFullYear();
        console.log(`[PBI] Hierarchy slicer "${slicerTitle}" - år: ${targetYear}, verdier:`, values);

        await slicer.setSlicerState({
          filters: [{
            $schema: 'http://powerbi.com/product/schema#hierarchy',
            target:      (firstFilter as Record<string, unknown>)['target'],
            filterType:  9,
            hierarchyData: [{
              operator: 'Inherited',
              value:    targetYear,
              children: values.map((v) => ({ operator: 'Selected', value: v })),
            }],
          }] as unknown as models.ISlicerFilter[],
        });
      } else {
        // Standard basic slicer — bygg filter fra targets, uavhengig av om filters er tom
        const target = (beforeState as unknown as { targets?: { table: string; column: string }[] })?.targets?.[0];
        if (!target) { console.warn(`[PBI] Slicer "${slicerTitle}" har ingen target`); return; }
        console.log(`[PBI] Basic slicer "${slicerTitle}" - target:`, target, 'verdier:', values);
        await slicer.setSlicerState({
          filters: [{
            $schema: 'http://powerbi.com/product/schema#basic',
            target: { table: target.table, column: target.column },
            filterType: models.FilterType.Basic,
            operator: 'In',
            values,
          }] as unknown as models.ISlicerFilter[],
        });
      }

      console.log(`[PBI] Slicer "${slicerTitle}" satt til:`, values);

      // Les slicer state ETTER setting for å bekrefte
      try {
        const currentState = await slicer.getSlicerState();
        console.log('[PBI] Slicer state ETTER setting:', JSON.stringify(currentState, null, 2));
      } catch (e) {
        console.log('[PBI] Kunne ikke lese slicer state etter setting:', e);
      }
    } catch (err) {
      console.warn('[PBI] setSlicerValue feil:', err);
    }
  }

  async function clearSlicerValue(slicerTitle: string): Promise<void> {
    const r = reportRef.current;
    if (!r) return;
    try {
      const pages = await r.getPages();
      const activePage = pages.find((p) => p.isActive);
      if (!activePage) return;
      const visuals = await activePage.getVisuals();
      const mappedName = slicerMappingRef.current[slicerTitle];
      const slicer = mappedName
        ? visuals.find((v) => erSlicerType(v.type) && v.name === mappedName)
        : visuals.find((v) => erSlicerType(v.type) && (v.title?.trim() || v.name) === slicerTitle);
      if (!slicer) { console.warn(`[PBI] Slicer "${slicerTitle}" ikke funnet for nullstilling (mapping: ${mappedName ?? 'ingen'})`); return; }
      await slicer.setSlicerState({ filters: [] });
      console.log(`[PBI] Slicer "${slicerTitle}" nullstilt`);
    } catch (err) {
      console.warn('[PBI] clearSlicerValue feil:', err);
    }
  }

  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      if (reportRef.current && accountRef.current && innstillingerKey) {
        reportRef.current.bookmarksManager.capture()
          .then(bookmark => {
            apiFetch(`/api/innstillinger/${innstillingerKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                brukerId: accountRef.current,
                type: 'bookmark',
                verdi: JSON.stringify(bookmark),
              }),
              keepalive: true,
            });
          })
          .catch(err => console.warn('[PBI] unmount save feil:', err));
      }
    };
  }, [innstillingerKey]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const fetchToken = async () => {
      console.log('[PBI] fetchToken props:', { pbiReportId, pbiDatasetId, pbiWorkspaceId });
      const body =
        pbiReportId && pbiDatasetId && pbiWorkspaceId
          ? { pbiReportId, pbiDatasetId, pbiWorkspaceId }
          : rapportId
          ? { rapportId }
          : {};
      console.log('[PBI] fetchToken body som sendes:', JSON.stringify(body));
      try {
        const response = await apiFetch(
          '/api/embed-token',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        );
        if (!response.ok) {
          const data = await response.json() as { error?: string };
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        setEmbedConfig(await response.json() as EmbedConfig);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ukjent feil');
      } finally {
        setLoading(false);
      }
    };
    fetchToken();
  }, []);

  const handleSaveBookmark = async () => {
    if (!report || !innstillingerKey || !entraObjectId) return;
    try {
      const bookmark = await report.bookmarksManager.capture();
      await apiFetch(`/api/innstillinger/${innstillingerKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brukerId: entraObjectId,
          type: 'bookmark',
          verdi: JSON.stringify(bookmark),
        }),
      });
      toast({ title: 'Visning lagret!', variant: 'success' });
    } catch (err) {
      console.error('[PowerBIReport] Bookmark feil:', err);
      toast({ title: 'Kunne ikke lagre visning', variant: 'destructive' });
    }
  };

  const handleResetBookmark = async () => {
    if (!report || !innstillingerKey || !entraObjectId) return;
    await apiFetch(
      `/api/innstillinger/${innstillingerKey}?brukerId=${entraObjectId}&type=bookmark`,
      { method: 'DELETE' },
    );
    await report.reload();
    toast({ title: 'Visning nullstilt', variant: 'success' });
  };

  const autoSaveBookmark = async () => {
    console.log('[PBI] autoSaveBookmark kjører');
    console.log('[PBI] report instans:', reportRef.current);
    console.log('[PBI] account:', accountRef.current);
    console.log('[PBI] pbiReportId:', pbiReportId);

    if (!reportRef.current) {
      console.log('[PBI] autoSave avbrutt - report er null');
      return;
    }
    if (!accountRef.current) {
      console.log('[PBI] autoSave avbrutt - account er null');
      return;
    }
    if (!innstillingerKey) {
      console.log('[PBI] autoSave avbrutt - innstillingerKey er null');
      return;
    }

    try {
      const bookmark = await reportRef.current.bookmarksManager.capture();
      console.log('[PBI] bookmark captured:', bookmark?.name);

      const response = await apiFetch(`/api/innstillinger/${innstillingerKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brukerId: accountRef.current,
          type: 'bookmark',
          verdi: JSON.stringify(bookmark),
        }),
      });
      console.log('[PBI] autoSave response status:', response.status);

      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('[PBI] autoSave feil:', err);
    }
  };

  const triggerSlicerStateUpdate = () => {
    if (slicerStateTimer.current) clearTimeout(slicerStateTimer.current);
    slicerStateTimer.current = setTimeout(async () => {
      const state = await getActiveSlicerState();
      console.log('[PBI] slicer state oppdatert (bruker-interaksjon):', JSON.stringify(state));
      onActiveStateChangeRef.current?.(state);
    }, 500);
  };

  const triggerAutoSave = () => {
    console.log('[PBI] triggerAutoSave kalt, starter 1sek timer');
    setAutoSaveStatus('pending');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { autoSaveBookmark(); }, 1000);
  };

  const handleExport = async (format: ExportFormat) => {
    setExporting((prev) => ({ ...prev, [format]: true }));
    try {
      const response = await apiFetch(
        '/api/export-report',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ format, pbiReportId, pbiWorkspaceId }),
        }
      );
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const ext = format.toLowerCase();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(`${format} eksport feil:`, err);
    } finally {
      setExporting((prev) => ({ ...prev, [format]: false }));
    }
  };

  const TEKST_KOLONNER = [
    'kunde', 'konto', 'navn', 'id', 'beskrivelse', 'tekst',
    'leverandør', 'avdeling', 'prosjekt', 'type', 'kategori',
    'kode', 'nummer', 'nr', 'ref', 'bilag', 'periode',
  ];

  const erTekstKolonne = (header: string): boolean => {
    const lower = header.toLowerCase();
    return TEKST_KOLONNER.some((k) => lower.includes(k));
  };

  const konverterVerdi = (verdi: string, header = ''): string | number => {
    const renset = verdi.replace(/^"|"$/g, '').trim();
    if (renset === '') return renset;

    // Tekst-kolonner basert på header — aldri konverter til tall
    if (erTekstKolonne(header)) return renset;

    // Konverter hvis verdien ser numerisk ut (inkl. vitenskapelig notasjon)
    const harKunTallTegn = /^[\d\s\-,\.eE\+]+$/.test(renset);
    if (harKunTallTegn) {
      const tallStreng = renset.replace(/\s/g, '').replace(',', '.');
      const tall = parseFloat(tallStreng);
      if (!isNaN(tall)) {
        // Svært små tall nær null (f.eks. 4.65e-10) → avrund til 0
        if (Math.abs(tall) < 0.005) return 0;
        // Avrund til 2 desimaler for å fjerne flytepunktfeil
        return Math.round(tall * 100) / 100;
      }
    }

    return renset;
  };

  const parseCSV = (csvTekst: string): (string | number)[][] => {
    const linjer = csvTekst.split('\n').filter((l) => l.trim());

    // Parse råstrenger uten typekonvertering for å hente headers først
    const råRader: string[][] = linjer.map((linje) => {
      const celler: string[] = [];
      let inAnførsel = false;
      let gjeldendeCelle = '';
      for (let i = 0; i < linje.length; i++) {
        const tegn = linje[i];
        if (tegn === '"') {
          if (inAnførsel && linje[i + 1] === '"') {
            gjeldendeCelle += '"';
            i++;
          } else {
            inAnførsel = !inAnførsel;
          }
        } else if (tegn === ',' && !inAnførsel) {
          celler.push(gjeldendeCelle.trim());
          gjeldendeCelle = '';
        } else {
          gjeldendeCelle += tegn;
        }
      }
      celler.push(gjeldendeCelle.trim());
      return celler;
    });

    if (råRader.length === 0) return [];

    const headers = råRader[0].map((h) => h.replace(/^"|"$/g, '').trim());

    return råRader.map((rad, radIndex) => {
      if (radIndex === 0) return headers; // header-rad alltid som tekst
      return rad.map((celle, kolIndex) => konverterVerdi(celle, headers[kolIndex] ?? ''));
    });
  };

  const åpneExcelPicker = async () => {
    if (!reportRef.current || eksporterer) return;
    setExcelLaster(true);
    setExcelPickerOpen(true);
    try {
      const kandidater = await hentExcelKandidater();
      setExcelKandidater(kandidater);
      // Merk alle som valgt som standard
      setExcelValgte(new Set(kandidater.map((k) => `${k.pageKey}::${k.visualKey}`)));
    } finally {
      setExcelLaster(false);
    }
  };

  const eksporterValgte = async () => {
    if (eksporterer || excelValgte.size === 0) return;
    setEksporterer(true);
    setExcelPickerOpen(false);
    try {
      const allData = await getAllVisualsData(excelValgte);
      const keys = Object.keys(allData);
      if (keys.length === 0) {
        toast({ title: 'Ingen data å eksportere', variant: 'destructive' });
        return;
      }
      const wb = XLSX.utils.book_new();
      for (const label of keys) {
        const rows = parseCSV(allData[label]);
        const ws = XLSX.utils.aoa_to_sheet(rows);
        // Sett norsk tallformat på alle numeriske celler (hopp over headerrad)
        const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
        for (let R = range.s.r + 1; R <= range.e.r; R++) {
          for (let C = range.s.c; C <= range.e.c; C++) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            if (ws[addr] && typeof ws[addr].v === 'number') {
              ws[addr].z = '#,##0.00';
              ws[addr].t = 'n';
            }
          }
        }
        const sheetName = label.slice(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rapport.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[PBI] Excel-eksport feil:', err);
      toast({ title: 'Excel-eksport feilet', variant: 'destructive' });
    } finally {
      setEksporterer(false);
    }
  };

  const toggleExcelKandidat = (key: string) => {
    setExcelValgte((prev) => {
      const neste = new Set(prev);
      if (neste.has(key)) neste.delete(key); else neste.add(key);
      return neste;
    });
  };

  const handleRefresh = async () => {
    if (!report) return;
    setRefreshing(true);
    try {
      await report.refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleZoomIn = async () => {
    if (!report) return;
    const current = await report.getZoom();
    const next = Math.round((current + 0.25) * 100) / 100;
    await report.setZoom(next);
    setZoomLevel(next);
  };

  const handleZoomOut = async () => {
    if (!report) return;
    const current = await report.getZoom();
    const next = Math.max(0.25, Math.round((current - 0.25) * 100) / 100);
    await report.setZoom(next);
    setZoomLevel(next);
  };

  const handleZoomReset = async () => {
    if (!report) return;
    await report.setZoom(1);
    setZoomLevel(1);
  };

  // Standard PBI-rapportside er 1280×720 (16:9). Zoom settes slik at rapporten
  // fyller containeren uten å overskride 100 %.
  const handleFitToPage = async () => {
    if (!report || !embedContainerRef.current) return;
    const h = embedContainerRef.current.clientHeight;
    const w = embedContainerRef.current.clientWidth;
    const zoom = Math.min(h / 720, w / 1280, 1.0);
    try {
      await report.setZoom(zoom);
      setZoomLevel(zoom);
      console.log('[PBI] tilpass-zoom satt til:', zoom, `(container: ${w}×${h})`);
    } catch (err) {
      console.warn('[PBI] tilpass-zoom feil:', err);
    }
  };

  const formaterDato = (iso: string | null): string => {
    if (!iso) return 'Ukjent';
    return new Date(iso).toLocaleString('nb-NO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const nesteRefreshTid = (): string => {
    if (!refreshInfo?.schedule.aktivert || !refreshInfo.schedule.tidspunkter.length) return '';
    const now = new Date();
    const sorted = [...refreshInfo.schedule.tidspunkter].sort();
    const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const neste = sorted.find((t) => t > nowHHMM) ?? sorted[0];
    return neste;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 rounded-full animate-spin"
            style={{ borderColor: 'rgba(245,166,35,0.20)', borderTopColor: '#F5A623' }} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>Laster rapport...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="rounded-xl p-6 max-w-md"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.20)',
          }}>
          <h2 className="font-semibold mb-2" style={{ color: 'rgba(252,165,165,0.9)' }}>Kunne ikke laste rapport</h2>
          <p className="text-sm" style={{ color: 'rgba(252,165,165,0.70)' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!embedConfig) return null;

  const anyExporting = Object.values(exporting).some(Boolean);

  const btnTool =
    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-[12px] font-semibold';
  const btnStyle = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.10)',
    color: 'rgba(255,255,255,0.88)',
    fontFamily: 'Barlow, system-ui, sans-serif',
  };
  const btnHover = {
    background: 'rgba(255,255,255,0.10)',
    color: 'rgba(255,255,255,1)',
  };

  const ToolBtn = ({
    onClick, disabled, children,
  }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={btnTool}
      style={btnStyle}
      onMouseEnter={(e) => { if (!disabled) Object.assign((e.currentTarget as HTMLButtonElement).style, btnHover); }}
      onMouseLeave={(e) => { Object.assign((e.currentTarget as HTMLButtonElement).style, btnStyle); }}
    >
      {children}
    </button>
  );

  const Divider = () => (
    <div className="w-px h-4 mx-0.5 shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }} />
  );

  return (
    <div className="flex flex-col h-full">
      {/* Verktøylinje */}
      <div
        className="relative px-4 py-2 shrink-0"
        style={{
          background: 'rgba(10,22,40,0.60)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >

        <div className="flex items-center justify-between">
          {/* Auto-lagret indikator */}
          {autoSaveStatus === 'pending' && (
            <span className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 text-xs font-medium pointer-events-none" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Lagrer...
            </span>
          )}
          {autoSaveStatus === 'saved' && (
            <span className="absolute left-1/2 -translate-x-1/2 text-xs font-medium pointer-events-none" style={{ color: '#F5A623' }}>
              ✓ Visning lagret
            </span>
          )}
          {/* Venstre: Eksport + refresh-info */}
          <div className="flex items-center gap-0.5">
            <ToolBtn onClick={() => handleExport('PDF')} disabled={!report || anyExporting}>
              {exporting.PDF ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              {exporting.PDF ? 'Eksporterer...' : 'PDF'}
            </ToolBtn>
            <ToolBtn onClick={() => handleExport('PPTX')} disabled={!report || anyExporting}>
              {exporting.PPTX ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Presentation className="w-3.5 h-3.5" />}
              {exporting.PPTX ? 'Eksporterer...' : 'PPT'}
            </ToolBtn>
            <div className="relative">
              <ToolBtn onClick={åpneExcelPicker} disabled={!report || eksporterer || anyExporting}>
                {eksporterer ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Table className="w-3.5 h-3.5" />}
                {eksporterer ? 'Eksporterer...' : 'Excel'}
              </ToolBtn>
              {excelPickerOpen && (
                <div
                  id="excel-picker-popover"
                  className="absolute top-full left-0 mt-1 z-50 rounded-lg overflow-hidden"
                  style={{
                    minWidth: 280,
                    background: 'rgba(10,22,40,0.97)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  }}
                >
                  <div className="px-3 pt-3 pb-2 text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    Velg visuals som skal eksporteres
                  </div>
                  <div className="max-h-60 overflow-y-auto py-1">
                    {excelLaster ? (
                      <div className="px-3 py-4 text-xs text-center" style={{ color: 'rgba(255,255,255,0.4)' }}>Laster visuals...</div>
                    ) : excelKandidater.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-center" style={{ color: 'rgba(255,255,255,0.4)' }}>Ingen eksporterbare visuals funnet</div>
                    ) : (
                      excelKandidater.map((k) => {
                        const key = `${k.pageKey}::${k.visualKey}`;
                        const valgt = excelValgte.has(key);
                        return (
                          <div
                            key={key}
                            onClick={() => toggleExcelKandidat(key)}
                            className="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none transition-colors"
                            style={{ background: valgt ? 'rgba(245,166,35,0.08)' : 'transparent' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = valgt ? 'rgba(245,166,35,0.14)' : 'rgba(255,255,255,0.05)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = valgt ? 'rgba(245,166,35,0.08)' : 'transparent'; }}
                          >
                            <input
                              type="checkbox"
                              checked={valgt}
                              onChange={() => toggleExcelKandidat(key)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-3.5 h-3.5 flex-shrink-0 cursor-pointer"
                              style={{ accentColor: '#F5A623' }}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate" style={{ color: 'rgba(255,255,255,0.88)' }}>{k.visualLabel}</p>
                              <p className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{k.pageLabel} · {k.type}</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {excelValgte.size} / {excelKandidater.length} valgt
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setExcelPickerOpen(false)}
                        className="px-2.5 py-1 text-xs rounded-md transition-colors"
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.7)' }}
                      >
                        Avbryt
                      </button>
                      <button
                        onClick={eksporterValgte}
                        disabled={excelValgte.size === 0 || excelLaster}
                        className="px-2.5 py-1 text-xs rounded-md font-semibold transition-colors disabled:opacity-40"
                        style={{ background: 'rgba(245,166,35,0.20)', border: '1px solid rgba(245,166,35,0.40)', color: '#F5A623' }}
                      >
                        Eksporter
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {refreshInfo && (
              <>
                <Divider />
                <span className="flex items-center gap-3 select-none" style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>
                  <span>
                    {refreshInfo.sisteRefresh.status === 'Failed' ? '❌' : '🕐'}{' '}
                    Sist oppdatert: {formaterDato(refreshInfo.sisteRefresh.tidspunkt)}
                  </span>
                  {nesteRefreshTid() && <span>📅 Neste: {nesteRefreshTid()}</span>}
                </span>
              </>
            )}
          </div>

          {/* Høyre: Zoom + Bookmark + Refresh + Fullskjerm */}
          <div className="flex items-center gap-0.5">
            <ToolBtn onClick={handleZoomOut} disabled={!report}>
              <ZoomOut className="w-3.5 h-3.5" />
              Zoom-
            </ToolBtn>
            <span
              className="px-2 py-1 text-xs font-mono min-w-[48px] text-center"
              style={{ color: 'rgba(255,255,255,0.6)' }}
            >
              {Math.round(zoomLevel * 100)}%
            </span>
            <ToolBtn onClick={handleZoomIn} disabled={!report}>
              <ZoomIn className="w-3.5 h-3.5" />
              Zoom+
            </ToolBtn>
            <ToolBtn onClick={handleZoomReset} disabled={!report || zoomLevel === 1}>
              <Scan className="w-3.5 h-3.5" />
              Reset
            </ToolBtn>
            <ToolBtn onClick={handleFitToPage} disabled={!report}>
              <Maximize2 className="w-3.5 h-3.5" />
              Tilpass
            </ToolBtn>
            <Divider />
            <ToolBtn onClick={handleSaveBookmark} disabled={!report || !pbiReportId}>
              <Bookmark className="w-3.5 h-3.5" />
              Lagre visning
            </ToolBtn>
            <ToolBtn onClick={handleResetBookmark} disabled={!report || !pbiReportId}>
              <RotateCcw className="w-3.5 h-3.5" />
              Nullstill
            </ToolBtn>
            <Divider />
            <ToolBtn onClick={handleRefresh} disabled={!report || refreshing}>
              {refreshing
                ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              {refreshing ? 'Oppdaterer...' : 'Refresh'}
            </ToolBtn>
            {/* Fullskjerm — gold accent */}
            <button
              onClick={() => report?.fullscreen()}
              disabled={!report}
              className={btnTool}
              style={{
                background: 'rgba(245,166,35,0.15)',
                border: '1px solid rgba(245,166,35,0.35)',
                color: '#F5A623',
                fontFamily: 'Barlow, system-ui, sans-serif',
              }}
              onMouseEnter={(e) => { if (report) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,166,35,0.25)'; } }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,166,35,0.15)'; }}
            >
              <Maximize className="w-3.5 h-3.5" />
              Fullskjerm
            </button>
          </div>
        </div>

      </div>

      {/* Power BI-rapport — hvit bakgrunn slik at rapport-innhold er lesbart */}
      <div ref={embedContainerRef} className="flex-1 min-h-0 overflow-hidden">
      <div style={{ height: '100%', overflow: 'hidden', background: '#ffffff', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as React.CSSProperties}>
      <PowerBIEmbed
        embedConfig={{
          type: 'report',
          embedUrl: embedConfig.embedUrl,
          accessToken: embedConfig.accessToken,
          tokenType: models.TokenType.Embed,
          permissions: models.Permissions.All,
          settings: {
            panes: { filters: { visible: false } },
            background: models.BackgroundType.Default,
            navContentPaneEnabled: true,
            layoutType: models.LayoutType.Custom,
            customLayout: {
              displayOption: models.DisplayOption.FitToWidth,
            },
          },
        }}
        eventHandlers={new Map([
          ['loaded', (event, embeddedReport) => {
            console.log('[PBI] loaded event', event);
            const r = embeddedReport as Report;
            setReport(r);
            onRegisterGetVisualData?.(getAllVisualsData);

            // Auto-fit: zoom rapporten til å passe containeren ved første innlasting
            setTimeout(async () => {
              try {
                if (embedContainerRef.current) {
                  const h = embedContainerRef.current.clientHeight;
                  const w = embedContainerRef.current.clientWidth;
                  const zoom = Math.min(h / 720, w / 1280, 1.0);
                  await r.setZoom(zoom);
                  setZoomLevel(zoom);
                  console.log('[PBI] auto-zoom satt til:', zoom, `(container: ${w}×${h})`);
                }
              } catch (err) {
                console.warn('[PBI] auto-zoom feil:', err);
              }
            }, 500);

            setTimeout(async () => {
              // Hent og send aktivt sidenavn ved innlasting
              try {
                const pages = await r.getPages();
                const aktiv = pages.find((p) => p.isActive);
                if (aktiv?.displayName) {
                  console.log('[PBI] aktiv side (innlasting):', aktiv.displayName);
                  onAktivSideChange?.(aktiv.displayName);
                }
              } catch { /* ignorer */ }

              // Bruk loadAllSlicers — leser kolonnenavn fra exportData() som nøkkel
              const { nøkler, values: slicerValuesMap } = await loadAllSlicers(r);
              console.log('[PBI] Slicer-nøkler funnet:', nøkler);
              console.log('[PBI] Slicer-verdier funnet:', slicerValuesMap);
              onSlicersLoaded?.(nøkler);
              onSlicerValuesLoaded?.(slicerValuesMap);
              // Hent initialt aktivt slicer-state
              const activeState = await getActiveSlicerState();
              onActiveStateChange?.(activeState);
              // Hent tilgjengelige tabeller fra Fabric
              try {
                const tablesUrl = rapportId ? `${API}/api/tables?rapportId=${encodeURIComponent(rapportId)}` : `${API}/api/tables`;
                const tablesRes = await apiFetch(tablesUrl.replace(API, ''));
                if (tablesRes.ok) {
                  const { tables } = await tablesRes.json() as { tables: string[] };
                  console.log('[PBI] Tilgjengelige tabeller:', tables);
                  onTablesLoaded?.(tables);
                }
              } catch (e) {
                console.warn('[PBI] Kunne ikke hente tabeller:', e);
              }
            }, 2000);
            if (pbiReportId && entraObjectId) {
              (async () => {
                try {
                  console.log('[PBI] henter innstillinger, nøkkel:', innstillingerKey);
                  // Prøv workspace-spesifikk nøkkel først, fall tilbake til kun pbiReportId
                  const keysToTry = innstillingerKey && innstillingerKey !== pbiReportId
                    ? [innstillingerKey, pbiReportId]
                    : [pbiReportId];

                  let innstilling: { verdi?: string } | null = null;
                  for (const key of keysToTry) {
                    if (!key) continue;
                    const res = await apiFetch(
                      `/api/innstillinger/${key}?brukerId=${entraObjectId}`,
                    );
                    if (res.ok) {
                      innstilling = await res.json() as { verdi?: string } | null;
                      if (innstilling?.verdi) {
                        console.log('[PBI] bokmerke funnet med nøkkel:', key);
                        break;
                      }
                    }
                  }

                  if (innstilling?.verdi) {
                    const bookmark = JSON.parse(innstilling.verdi) as { state: string };
                    await r.bookmarksManager.applyState(bookmark.state);
                  }
                } catch (e) {
                  console.warn('[PowerBIReport] Kunne ikke gjenopprette bokmerke:', e);
                }
              })();
            }
          }],
          ['dataSelected',    (event) => { console.log('[PBI] dataSelected event', event); triggerAutoSave(); triggerSlicerStateUpdate(); }],
          ['filtersApplied',  (event) => { console.log('[PBI] filtersApplied event', event); triggerAutoSave(); triggerSlicerStateUpdate(); }],
          ['pageChanged',     (event) => {
            const side = (event as unknown as { detail?: { newPage?: { displayName?: string } } }).detail?.newPage?.displayName ?? '';
            console.log('[PBI] aktiv side:', side);
            onAktivSideChange?.(side);
            triggerAutoSave();
          }],
          ['bookmarkApplied', (event) => { console.log('[PBI] bookmarkApplied event', event); triggerAutoSave(); }],
          ['visualClicked',   (event) => { console.log('[PBI] visualClicked event', event); triggerAutoSave(); }],
        ])}
        cssClassName="h-full w-full"
      />
      </div>
      </div>
    </div>
  );
}
