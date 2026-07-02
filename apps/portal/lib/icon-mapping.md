# Ikon-mapping: Lucide → Fluent (@fluentui/react-icons)

Design-refresh Fase D1. Kartlegger ikonene som faktisk brukes i `apps/portal/`
(grep av `from 'lucide-react'`) til Fluent-ekvivalenter. Global utbytting skjer
i **D2** — dette dokumentet er kartet.

## Konvensjon
- Fluent-navn: `<Navn><Størrelse><Stil>`, f.eks. `Add24Regular`.
- Størrelser: **24** (default), **20** (inline), **16** (micro).
- Stil: **Regular** for standard, **Filled** for aktive/valgte tilstander.
- Verifisér eksakt navn ved import (pakken har tusenvis; noen navn avviker) —
  IDE-autofullføring på `@fluentui/react-icons` bekrefter.

## Mapping (statisk brukte ikoner)

| Lucide | Fluent (Regular) | Aktiv/Filled |
|---|---|---|
| Activity | `Pulse24Regular` | `Pulse24Filled` |
| Building2 / Building | `BuildingMultiple24Regular` / `Building24Regular` | `Building24Filled` |
| CreditCard | `Wallet24Regular` | `Wallet24Filled` |
| Database | `Database24Regular` | `Database24Filled` |
| Globe | `Globe24Regular` | `Globe24Filled` |
| LayoutDashboard | `Board24Regular` | `Board24Filled` |
| Layers | `Layer24Regular` | `Layer24Filled` |
| Palette | `Color24Regular` | `Color24Filled` |
| Settings / Settings2 | `Settings24Regular` | `Settings24Filled` |
| Users | `People24Regular` | `People24Filled` |
| User | `Person24Regular` | `Person24Filled` |
| UserPlus | `PersonAdd24Regular` | — |
| MessageCircle / MessageSquare | `Chat24Regular` | `Chat24Filled` |
| Send | `Send24Regular` | `Send24Filled` |
| X | `Dismiss24Regular` | — |
| XCircle | `DismissCircle24Regular` | `DismissCircle24Filled` |
| Plus | `Add24Regular` | — |
| Minus | `Subtract24Regular` | — |
| Check | `Checkmark24Regular` | — |
| CheckCircle / CheckCircle2 | `CheckmarkCircle24Regular` | `CheckmarkCircle24Filled` |
| Pencil | `Edit24Regular` | `Edit24Filled` |
| Trash2 | `Delete24Regular` | `Delete24Filled` |
| Download | `ArrowDownload24Regular` | — |
| Save | `Save24Regular` | `Save24Filled` |
| Search | `Search24Regular` | — |
| RefreshCw | `ArrowSync24Regular` | — |
| Loader2 (spinner) | `ArrowSync24Regular` (m/ `animate-spin`) | — |
| ArrowLeft | `ArrowLeft24Regular` | — |
| ArrowRight | `ArrowRight24Regular` | — |
| ChevronDown | `ChevronDown24Regular` | — |
| ChevronRight | `ChevronRight24Regular` | — |
| ChevronLeft | `ChevronLeft24Regular` | — |
| ExternalLink | `Open24Regular` | — |
| Link2 | `Link24Regular` | — |
| Eye | `Eye24Regular` | — |
| EyeOff | `EyeOff24Regular` | — |
| LogOut | `SignOut24Regular` | — |
| Shield | `Shield24Regular` | `Shield24Filled` |
| Key / KeyRound | `Key24Regular` | — |
| Clock | `Clock24Regular` | — |
| Star | `Star24Regular` | `Star24Filled` |
| Mail | `Mail24Regular` | `Mail24Filled` |
| Sparkles | `Sparkle24Regular` | `Sparkle24Filled` |
| TrendingUp | `DataTrending24Regular` / `ArrowTrendingLines24Regular` | — |
| FileBarChart / FileBarChart2 | `DataBarVertical24Regular` / `DocumentData24Regular` | — |
| BarChart2 | `DataBarVertical24Regular` | — |
| FileSpreadsheet | `DocumentTable24Regular` / `Table24Regular` | — |
| AlertCircle | `ErrorCircle24Regular` | `ErrorCircle24Filled` |
| AlertTriangle | `Warning24Regular` | `Warning24Filled` |
| Info | `Info24Regular` | `Info24Filled` |
| Mic | `Mic24Regular` | `Mic24Filled` |
| Square (stop) | `Stop24Regular` | `Stop24Filled` |
| Volume2 | `Speaker224Regular` | — |
| PanelLeftClose | `PanelLeftContract24Regular` | — |
| PanelLeftOpen | `PanelLeftExpand24Regular` | — |
| GripHorizontal | `ReOrderDotsHorizontal24Regular` | — |
| GripVertical | `ReOrderDotsVertical24Regular` | — |

## Spesialtilfelle: `components/analyse/AnalyseIkon.tsx`
Bruker `import * as Icons from 'lucide-react'` og velger ikon **dynamisk** på
navn (bruker-/data-styrt ikonvalg). Kan ikke tabell-mappes 1:1. Håndteres eget i
D2: enten (a) en Lucide→Fluent-oppslagsmap for de tillatte analyse-ikonene, eller
(b) behold Lucide kun for denne komponenten. Besluttes i D2.

## Bruk i POC (D1)
Proof-of-concept-komponentene (`components/designv2/`) importerer per-ikon fra
`@fluentui/react-icons` (tree-shaking) — se `Button.tsx`/`TabellRad.tsx` og
`/admin/design-preview`.

## Implementert i D2 · Gruppe 4 — sentral adapter
Migreringen ble gjort via `components/ikoner.tsx`: en adapter som re-eksporterer
Fluent-ikoner under Lucide-navnene appen brukte. Hver fil byttet kun import-sti
(`lucide-react` → `@/components/ikoner`); JSX (`className`, `size`) er uendret.
Adapteren oversetter Lucide-`size` → width/height/fontSize og forkaster
`strokeWidth`. `lucide-react` er avinstallert.

`AnalyseIkon.tsx` (data-drevet `ikon`-navn fra DB) slår nå opp mot adapter-
namespacet med Fluent-fallback (`FileText`). Ikon-navn i DB som ikke finnes i
adapteren vises som fallback — utvid adapteren ved behov.

Standardvariant er `20Regular`; faktisk visningsstørrelse styres av className/size.
Filled/aktiv-varianter kan innføres per bruksted senere.
