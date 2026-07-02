'use client';

/**
 * Sentral ikon-adapter — Design-refresh D2 · Gruppe 4.
 *
 * Re-eksporterer Fluent-ikoner (@fluentui/react-icons, MIT) under de Lucide-
 * navnene appen allerede bruker. Slik trenger hver fil kun å bytte import-sti
 * (`lucide-react` → `@/components/ikoner`) — JSX-bruken (`<X className="w-4 h-4" />`,
 * `<Plus size={16} />`) forblir uendret.
 *
 * Fluent-ikoner rendrer <svg fill="currentColor" width/height=<størrelse>>, så:
 *  - tekstfarge arves (text-* / color virker),
 *  - `className="w-4 h-4"` overstyrer størrelsen (CSS > attributt),
 *  - Lucide-props `size`/`strokeWidth` finnes ikke i Fluent — wrapperen oversetter
 *    `size` → width/height/fontSize og forkaster `strokeWidth` (Fluent er fill-basert).
 *
 * Standard størrelsesvariant er 20 (skarp i det vanlige 14–20px-området; faktisk
 * visningsstørrelse styres uansett av className/size). Aktiv/Filled-varianter
 * håndteres per bruksted ved behov senere.
 */
import * as React from 'react';
import {
  Dismiss20Regular, DismissCircle20Regular, Add20Regular, Subtract20Regular,
  Checkmark20Regular, CheckmarkCircle20Regular, Edit20Regular, Delete20Regular,
  ArrowDownload20Regular, Save20Regular, Search20Regular, ArrowSync20Regular,
  ArrowLeft20Regular, ArrowRight20Regular, ChevronDown20Regular, ChevronRight20Regular,
  ChevronLeft20Regular, Open20Regular, Link20Regular, Eye20Regular, EyeOff20Regular,
  SignOut20Regular, Shield20Regular, Key20Regular, Clock20Regular, Star20Regular,
  Mail20Regular, Sparkle20Regular, Pulse20Regular, Building20Regular, BuildingMultiple20Regular,
  Wallet20Regular, Database20Regular, Globe20Regular, Board20Regular, Layer20Regular,
  Color20Regular, Settings20Regular, People20Regular, Person20Regular, PersonAdd20Regular,
  Chat20Regular, Send20Regular, Mic20Regular, Stop20Regular, Speaker220Regular,
  PanelLeftContract20Regular, PanelLeftExpand20Regular, ReOrderDotsHorizontal20Regular,
  ReOrderDotsVertical20Regular, DataTrending20Regular, DataBarVertical20Regular,
  DocumentData20Regular, DocumentTable20Regular, DocumentText20Regular,
  ErrorCircle20Regular, Warning20Regular, Info20Regular,
  Play20Regular, Power20Regular, MoreVertical20Regular, Presenter20Regular,
  Table20Regular, FullScreenMaximize20Regular, ArrowMaximize20Regular,
  ArrowCounterclockwise20Regular, ZoomIn20Regular, ZoomOut20Regular, Scan20Regular,
  type FluentIcon,
} from '@fluentui/react-icons';

interface IkonProps extends React.SVGProps<SVGSVGElement> {
  /** Lucide-kompatibel størrelse (px). Oversettes til width/height/fontSize. */
  size?: number | string;
}

function lag(Icon: FluentIcon, visningsnavn: string) {
  const Ikon = ({ size, className, style, color, strokeWidth: _strokeWidth, ...rest }: IkonProps) => {
    const s: React.CSSProperties = {};
    if (size != null) { s.width = size; s.height = size; s.fontSize = size; }
    if (color) s.color = color;
    Object.assign(s, style);
    return <Icon className={className} style={s} {...rest} />;
  };
  Ikon.displayName = visningsnavn;
  return Ikon;
}

/* Lucide-navn → Fluent-komponent (jf. lib/icon-mapping.md) */
export const X              = lag(Dismiss20Regular, 'X');
export const XCircle        = lag(DismissCircle20Regular, 'XCircle');
export const Plus           = lag(Add20Regular, 'Plus');
export const Minus          = lag(Subtract20Regular, 'Minus');
export const Check          = lag(Checkmark20Regular, 'Check');
export const CheckCircle    = lag(CheckmarkCircle20Regular, 'CheckCircle');
export const CheckCircle2   = lag(CheckmarkCircle20Regular, 'CheckCircle2');
export const Pencil         = lag(Edit20Regular, 'Pencil');
export const Trash2         = lag(Delete20Regular, 'Trash2');
export const Download       = lag(ArrowDownload20Regular, 'Download');
export const Save           = lag(Save20Regular, 'Save');
export const Search         = lag(Search20Regular, 'Search');
export const RefreshCw      = lag(ArrowSync20Regular, 'RefreshCw');
export const Loader2        = lag(ArrowSync20Regular, 'Loader2');
export const ArrowLeft      = lag(ArrowLeft20Regular, 'ArrowLeft');
export const ArrowRight     = lag(ArrowRight20Regular, 'ArrowRight');
export const ChevronDown    = lag(ChevronDown20Regular, 'ChevronDown');
export const ChevronRight   = lag(ChevronRight20Regular, 'ChevronRight');
export const ChevronLeft    = lag(ChevronLeft20Regular, 'ChevronLeft');
export const ExternalLink   = lag(Open20Regular, 'ExternalLink');
export const Link2          = lag(Link20Regular, 'Link2');
export const Eye            = lag(Eye20Regular, 'Eye');
export const EyeOff         = lag(EyeOff20Regular, 'EyeOff');
export const LogOut         = lag(SignOut20Regular, 'LogOut');
export const Shield         = lag(Shield20Regular, 'Shield');
export const KeyRound       = lag(Key20Regular, 'KeyRound');
export const Clock          = lag(Clock20Regular, 'Clock');
export const Star           = lag(Star20Regular, 'Star');
export const Mail           = lag(Mail20Regular, 'Mail');
export const Sparkles       = lag(Sparkle20Regular, 'Sparkles');
export const Activity       = lag(Pulse20Regular, 'Activity');
export const Building       = lag(Building20Regular, 'Building');
export const Building2      = lag(BuildingMultiple20Regular, 'Building2');
export const CreditCard     = lag(Wallet20Regular, 'CreditCard');
export const Database       = lag(Database20Regular, 'Database');
export const Globe          = lag(Globe20Regular, 'Globe');
export const LayoutDashboard = lag(Board20Regular, 'LayoutDashboard');
export const Layers         = lag(Layer20Regular, 'Layers');
export const Palette        = lag(Color20Regular, 'Palette');
export const Settings       = lag(Settings20Regular, 'Settings');
export const Settings2      = lag(Settings20Regular, 'Settings2');
export const Users          = lag(People20Regular, 'Users');
export const User           = lag(Person20Regular, 'User');
export const UserPlus       = lag(PersonAdd20Regular, 'UserPlus');
export const MessageCircle  = lag(Chat20Regular, 'MessageCircle');
export const MessageSquare  = lag(Chat20Regular, 'MessageSquare');
export const Send           = lag(Send20Regular, 'Send');
export const Mic            = lag(Mic20Regular, 'Mic');
export const Square         = lag(Stop20Regular, 'Square');
export const Volume2        = lag(Speaker220Regular, 'Volume2');
export const PanelLeftClose = lag(PanelLeftContract20Regular, 'PanelLeftClose');
export const PanelLeftOpen  = lag(PanelLeftExpand20Regular, 'PanelLeftOpen');
export const GripHorizontal = lag(ReOrderDotsHorizontal20Regular, 'GripHorizontal');
export const GripVertical   = lag(ReOrderDotsVertical20Regular, 'GripVertical');
export const TrendingUp     = lag(DataTrending20Regular, 'TrendingUp');
export const BarChart2      = lag(DataBarVertical20Regular, 'BarChart2');
export const FileBarChart   = lag(DocumentData20Regular, 'FileBarChart');
export const FileBarChart2  = lag(DocumentData20Regular, 'FileBarChart2');
export const FileSpreadsheet = lag(DocumentTable20Regular, 'FileSpreadsheet');
export const FileText       = lag(DocumentText20Regular, 'FileText');
export const AlertCircle    = lag(ErrorCircle20Regular, 'AlertCircle');
export const AlertTriangle  = lag(Warning20Regular, 'AlertTriangle');
export const Info           = lag(Info20Regular, 'Info');
export const Play           = lag(Play20Regular, 'Play');
export const Power          = lag(Power20Regular, 'Power');
export const MoreVertical   = lag(MoreVertical20Regular, 'MoreVertical');
export const Presentation   = lag(Presenter20Regular, 'Presentation');
export const Table          = lag(Table20Regular, 'Table');
export const Maximize       = lag(FullScreenMaximize20Regular, 'Maximize');
export const Maximize2      = lag(ArrowMaximize20Regular, 'Maximize2');
export const RotateCcw      = lag(ArrowCounterclockwise20Regular, 'RotateCcw');
export const ZoomIn         = lag(ZoomIn20Regular, 'ZoomIn');
export const ZoomOut        = lag(ZoomOut20Regular, 'ZoomOut');
export const Scan           = lag(Scan20Regular, 'Scan');
