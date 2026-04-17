'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle, X, Send, Loader2, Download, Mic, Square, Volume2, Settings } from 'lucide-react';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { startAzureSTT, stoppAzureSTT, azureTTS, stoppAzureTTS, AZURE_STEMMER, settEntraObjectId } from '../services/azureSpeech';
import { apiFetch } from '@/lib/apiClient';
import { useTema } from '@/components/ThemeProvider';
import * as XLSX from 'xlsx';

export interface FilterConfig {
  table: string;
  column: string;
  values: (string | number)[];
  operator?: 'In' | 'NotIn' | 'All';
}

export interface SlicerConfig {
  slicerTitle: string;
  values: string[];
  år?: number;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

interface RapportForslag {
  tittel: string;
  beskrivelse?: string;
  visualType: string;
  xAkse?: string;
  yAkse?: string;
  grupperPaa?: string;
  sql: string;
  data: Record<string, unknown>[];
  foreslåSlicere?: string[];
  alleViewKolonner?: { kolonne_navn: string; kolonne_type: string }[];
  prosjektNr?: string | null;
  prosjektNavn?: string | null;
  prosjektKolonne?: string | null;
  prosjektKolonneType?: string | null;
  prosjektFilter?: string | null;
  viewNavn?: string | null;
}

interface DisplayMessage {
  role: 'user' | 'assistant' | 'status' | 'actions' | 'rapport_forslag';
  content: string;
  queryData?: Record<string, unknown>[];
  querySql?: string;
  rapportForslag?: RapportForslag;
}

interface AIChatProps {
  entraObjectId?: string;
  rapportId?: string;
  pbiReportId?: string;
  rapportNavn?: string;
  slicers?: string[];
  slicerValues?: Record<string, Record<string, string[]>>;
  activeSlicerState?: Record<string, unknown>;
  availableTables?: string[];
  aktivSide?: string;
  kanLageRapport?: boolean;
  grupper?: string[];
  øktId?: string;
  /** Rendrer chat som full-side komponent i stedet for flytende widget */
  standaloneMode?: boolean;
  /** Seed meldinger fra historikk ved opplasting av eksisterende samtale */
  initialMessages?: { role: string; content: string }[];
  getVisualsData?: () => Promise<Record<string, string>>;
  onSetFilter?:   (config: FilterConfig) => void;
  onSetSlicer?:   (config: SlicerConfig) => void;
  onClearSlicer?: (slicerTitle: string) => void;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function exportToExcel(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return;
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  const kolBredder = Object.keys(data[0]).map(key => ({
    wch: Math.max(key.length, ...data.map(rad => String(rad[key] ?? '').length), 8),
  }));
  ws['!cols'] = kolBredder;
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export default function AIChat({
  entraObjectId, rapportId, pbiReportId, rapportNavn, slicers, slicerValues,
  activeSlicerState, availableTables, aktivSide, kanLageRapport, grupper,
  øktId, standaloneMode, initialMessages,
  getVisualsData, onSetFilter, onSetSlicer, onClearSlicer,
}: AIChatProps) {
  const router = useRouter();
  const { organisasjonNavn } = useTema();
  const [open, setOpen]       = useState(!!standaloneMode);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [display, setDisplay]   = useState<DisplayMessage[]>([]);
  // Tale-til-tekst state
  const [lytter, setLytter]           = useState(false);
  const [sttFeil, setSttFeil]         = useState<string | null>(null);
  // Tekst-til-tale state
  const [ttsAktivIdx, setTtsAktivIdx] = useState<number | null>(null);
  const ttsTimerRef                   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoOpplesing, setAutoOpplesing] = useState(false);
  const [visTTSInstillinger, setVisTTSInstillinger] = useState(false);
  const [ttsInstillinger, setTtsInstillinger] = useState({
    stemmNavn: 'nb-NO-PernilleNeural',
    hastighet: 1.0,
  });
  const bottomRef    = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLTextAreaElement>(null);
  const abortRef     = useRef<AbortController | null>(null);
  const azureSTTRef            = useRef<SpeechSDK.SpeechRecognizer | null>(null);
  const sttBekreftedRef        = useRef<string>(''); // tekst bekreftet av STT (akkumulert)

  // Auto-resize textarea når input endres
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);
  const pendingQueryRef        = useRef<{ data: Record<string, unknown>[]; sql: string } | null>(null);
  const conversationHistoryRef = useRef<ChatMessage[]>([]);
  const lagreTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [display]);

  useEffect(() => {
    if (open) {
      setTimeout(() => { inputRef.current?.focus(); }, 100);
    }
  }, [open]);

  // Seed meldinger fra historikk (ved bytte av samtale i standalone-modus)
  useEffect(() => {
    if (!initialMessages || initialMessages.length === 0) return;
    const chatMsgs: ChatMessage[] = initialMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    const displayMsgs = initialMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    conversationHistoryRef.current = chatMsgs;
    setMessages(chatMsgs);
    setDisplay(displayMsgs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Registrer entraObjectId i Azure Speech service for auth-header
  useEffect(() => {
    settEntraObjectId(entraObjectId);
  }, [entraObjectId]);

  // Hent velkomstmelding første gang entraObjectId er tilgjengelig — kun på dashboard
  useEffect(() => {
    if (rapportId || !entraObjectId) return;
    apiFetch('/api/chat/velkomst', {
      headers: { 'X-Entra-Object-Id': entraObjectId },
    })
      .then(r => r.ok ? r.json() : null)
      .then((d: { melding?: string | null } | null) => {
        if (d?.melding) {
          setMessages(prev => prev.length > 0 ? prev : [{ role: 'assistant', content: d.melding! }]);
          setDisplay(prev => prev.length > 0 ? prev : [{ role: 'assistant', content: d.melding! }]);
        }
      })
      .catch(() => {});
  }, [entraObjectId, rapportId]);

  // Last TTS-innstillinger fra brukerprofil ved oppstart
  useEffect(() => {
    if (!entraObjectId) return;
    const headers: Record<string, string> = { 'X-Entra-Object-Id': entraObjectId };
    apiFetch('/api/meg/innstillinger', { credentials: 'include', headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.tts) {
          setTtsInstillinger(p => ({ ...p, ...data.tts }));
          if (data.tts.autoOpplesing !== undefined) setAutoOpplesing(data.tts.autoOpplesing);
          console.log('[TTS] innstillinger lastet:', data.tts);
        }
      })
      .catch(err => console.error('[TTS] kunne ikke laste innstillinger:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entraObjectId]);

  // Lagre TTS-innstillinger (debounced, 1 sek)
  const lagreInnstillinger = (nyeTts: typeof ttsInstillinger & { autoOpplesing?: boolean }) => {
    if (!entraObjectId) return;
    if (lagreTimerRef.current) clearTimeout(lagreTimerRef.current);
    lagreTimerRef.current = setTimeout(() => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Entra-Object-Id': entraObjectId,
      };
      apiFetch('/api/meg/innstillinger', {
        method: 'PUT',
        credentials: 'include',
        headers,
        body: JSON.stringify({ tts: nyeTts }),
      }).catch(err => console.error('[TTS] lagring feilet:', err));
    }, 1000);
  };

  // Rydd opp Azure speech ved unmount
  useEffect(() => {
    return () => {
      if (azureSTTRef.current) stoppAzureSTT(azureSTTRef.current);
      stoppAzureTTS();
      if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
      if (lagreTimerRef.current) clearTimeout(lagreTimerRef.current);
    };
  }, []);

  // Fjern skjulte [rapport_id:UUID]-annotasjoner fra tekst som vises til bruker.
  // Ingen .trim() — ville fjernet mellomrom fra individuelle streaming-tokens.
  const stripHiddenIds = (text: string) =>
    text.replace(/\s*\[rapport_id:[^\]]+\]/g, '');

  const addDisplay    = (msg: DisplayMessage) => setDisplay((prev) => [...prev, { ...msg, content: stripHiddenIds(msg.content) }]);
  const appendToLast  = (content: string) => {
    const stripped = stripHiddenIds(content);
    setDisplay((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') {
        return [...prev.slice(0, -1), { ...last, content: last.content + stripped }];
      }
      return [...prev, { role: 'assistant', content: stripped }];
    });
  };

  console.log('[AIChat] props:', { rapportId, pbiReportId, rapportNavn });

  // ── Azure STT ─────────────────────────────────────────────────────────────
  const startLytting = async () => {
    setSttFeil(null);
    // Bevar eksisterende input som startpunkt — akkumuler videre fra dette
    sttBekreftedRef.current = inputRef.current
      ? inputRef.current.value
      : '';
    try {
      const recognizer = await startAzureSTT(
        (tekst, erEndelig) => {
          if (erEndelig) {
            // Bekreftet ytring — legg til i akkumulatoren
            sttBekreftedRef.current = (sttBekreftedRef.current + tekst + ' ').trimStart();
            setInput(sttBekreftedRef.current);
            console.log('[Azure STT] bekreftet:', tekst);
          } else {
            // Interim — vis akkumulert + pågående frase uten å endre akkumulatoren
            setInput((sttBekreftedRef.current + tekst).trimStart());
          }
        },
        () => {
          setLytter(false);
          azureSTTRef.current = null;
          setTimeout(() => inputRef.current?.focus(), 50);
        },
        (feil) => {
          console.error('[Azure STT] feil:', feil);
          setSttFeil(feil);
          setLytter(false);
        },
      );
      azureSTTRef.current = recognizer;
      setLytter(true);
    } catch (err) {
      console.error('[Azure STT] oppstart feil:', err);
      setSttFeil((err as Error).message);
      setLytter(false);
    }
  };

  const stoppLytting = () => {
    if (azureSTTRef.current) {
      stoppAzureSTT(azureSTTRef.current);
      azureSTTRef.current = null;
    }
    setLytter(false);
  };

  const toggleMikrofon = () => {
    if (lytter) stoppLytting();
    else startLytting();
  };

  // ── Azure TTS ─────────────────────────────────────────────────────────────
  const visStopp = ttsAktivIdx !== null;

  const STATUSTEKSTER = ['kobler til', 'henter data', 'søker', 'venter', 'laster'];

  const lesOppMelding = (tekst: string, idx: number) => {
    if (ttsAktivIdx === idx) { stoppOpplesing(); return; }
    // Ikke les opp korte statustekster
    const lower = tekst.toLowerCase().trim();
    if (tekst.length < 50 && STATUSTEKSTER.some(s => lower.includes(s))) {
      console.log('[TTS] skipper statustekst:', tekst);
      return;
    }
    stoppOpplesing();
    setTtsAktivIdx(idx);
    // Timeout-fallback: ordtelling / 2.5 ord/sek / hastighet + 3 sek buffer
    const wordCount = tekst.split(/\s+/).filter(Boolean).length;
    const estimertMs = Math.ceil((wordCount / 2.5 / ttsInstillinger.hastighet) * 1000) + 3000;
    ttsTimerRef.current = setTimeout(() => setTtsAktivIdx(null), estimertMs);
    azureTTS(
      tekst,
      ttsInstillinger.stemmNavn,
      ttsInstillinger.hastighet,
      () => {
        // onFerdig kalles fra onAudioEnd — lyd er faktisk ferdig
        console.log('[AIChat] TTS ferdig (onAudioEnd)');
        if (ttsTimerRef.current) { clearTimeout(ttsTimerRef.current); ttsTimerRef.current = null; }
        setTtsAktivIdx(null);
      },
    ).catch(err => console.error('[Azure TTS] feil:', err));
  };

  // Brukes av auto-opplesing (ingen meldings-index)
  const lesOppTekst = (tekst: string) => lesOppMelding(tekst, -1);

  function stoppOpplesing() {
    stoppAzureTTS();
    if (ttsTimerRef.current) { clearTimeout(ttsTimerRef.current); ttsTimerRef.current = null; }
    setTtsAktivIdx(null);
    console.log('[TTS] stoppet manuelt');
  }

  function visRapportFullskjerm(forslag: RapportForslag) {
    console.log('[CreateReport] åpner fullskjerm, rader:', forslag.data?.length);
    try {
      sessionStorage.setItem('rapport_forslag', JSON.stringify(forslag));
    } catch (e) {
      console.warn('[CreateReport] sessionStorage feil:', e);
    }
    router.push('/dashboard/rapport-interaktiv');
  }

  function eksporterRapport(forslag: RapportForslag) {
    if (!forslag.data?.length) return;
    exportToExcel(forslag.data, forslag.tittel || 'rapport');
  }

  const LAG_RAPPORT_TRIGGERS = [
    'lag rapport', 'lage rapport', 'opprett rapport', 'opprette rapport',
    'ny rapport', 'create report', 'lag en rapport', 'kan du lage',
  ];

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    // Hvis brukeren er på dashboard uten rapport-kontekst og spør om å lage rapport,
    // vis veiledning lokalt uten API-kall
    const erUtenKontekst = !rapportId && !pbiReportId;
    if (erUtenKontekst && LAG_RAPPORT_TRIGGERS.some(t => text.toLowerCase().includes(t))) {
      setInput('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      addDisplay({ role: 'user', content: text });
      addDisplay({
        role: 'assistant',
        content: `For å lage en rapport trenger jeg kontekst fra en eksisterende rapport.\n\n**Slik gjør du det:**\n1. Gå til et workspace i venstremenyen\n2. Åpne en rapport som er relevant for analysen din\n3. Klikk på **+**-knappen nede til høyre i rapporten\n\nDa kan jeg hjelpe deg lage en tilpasset rapport basert på riktig datasett!`,
      });
      return;
    }

    // Stopp mikrofon automatisk ved sending
    if (lytter) stoppLytting();

    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setLoading(true);

    const userMsg: ChatMessage = { role: 'user', content: text };
    const nextMessages = [...conversationHistoryRef.current, userMsg];
    conversationHistoryRef.current = nextMessages;
    setMessages(nextMessages);
    addDisplay({ role: 'user', content: text });

    abortRef.current = new AbortController();

    let visualData: Record<string, string> = {};
    if (getVisualsData) {
      try {
        visualData = await getVisualsData();
        console.log('[AIChat] visual data hentet:', Object.keys(visualData));
      } catch (e) {
        console.warn('[AIChat] Kunne ikke hente visual data:', e);
      }
    }

    console.log('[AIChat] activeSlicerState:', JSON.stringify(activeSlicerState));
    console.log('[AIChat] activeSlicerState sendes:', Object.keys(activeSlicerState ?? {}).length, 'slicere');

    const requestBody = {
      messages: nextMessages, rapportId, pbiReportId, rapportNavn,
      slicers, slicerValues: slicerValues ?? {},
      activeSlicerState: activeSlicerState ?? {},
      aktivSide, visualData,
      grupper: grupper ?? [],
      ...(kanLageRapport ? { kanLageRapport: true } : {}),
      ...(øktId ? { øktId } : {}),
    };
    console.log('[AIChat] grupper som sendes:', grupper?.length ?? 0, grupper);
    console.log('[AIChat] slicerValues som sendes:', JSON.stringify(slicerValues));
    console.log('[AIChat] sender body activeSlicerState:', JSON.stringify(requestBody.activeSlicerState));

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (entraObjectId) headers['X-Entra-Object-Id'] = entraObjectId;
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: abortRef.current.signal,
      });

      console.log('[AIChat] fetch status:', res.status);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error('Ingen body i respons');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText   = '';
      let historyReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          const json = part.slice(6);
          let chunk: {
            type: string;
            content?: string;
            tool?: string;
            filterConfig?: FilterConfig;
            slicerTitle?: string;
            values?: string[];
            år?: number;
            message?: string;
            rapportId?: string;
            rapportNavn?: string;
            data?: Record<string, unknown>[];
            sql?: string;
            messages?: ChatMessage[];
            forslag?: RapportForslag;
          };
          try { chunk = JSON.parse(json) as typeof chunk; } catch { continue; }

          console.log('[AIChat] SSE event mottatt:', chunk);

          if (chunk.type === 'text' && chunk.content) {
            assistantText += chunk.content;
            appendToLast(chunk.content);
          } else if (chunk.type === 'tool_call') {
            const labels: Record<string, string> = {
              query_database:      '🔍 Henter data fra database...',
              get_schema:          '📋 Henter tabellstruktur...',
              set_report_filter:   '🔧 Setter filter i rapport...',
              set_report_slicer:   '🎛️ Setter slicer i rapport...',
              clear_report_slicer: '🗑️ Nullstiller slicer...',
              create_report:       '📊 Utformer rapportforslag...',
            };
            addDisplay({ role: 'status', content: labels[chunk.tool ?? ''] ?? `⚙️ ${chunk.tool}` });
          } else if (chunk.type === 'filter' && chunk.filterConfig) {
            onSetFilter?.(chunk.filterConfig);
          } else if (chunk.type === 'slicer' && chunk.slicerTitle && chunk.values) {
            const slicerConfig: SlicerConfig = { slicerTitle: chunk.slicerTitle, values: chunk.values, år: chunk.år };
            console.log('[AIChat] kaller onSetSlicer:', slicerConfig);
            onSetSlicer?.(slicerConfig);
          } else if (chunk.type === 'slicer_clear' && chunk.slicerTitle) {
            console.log('[AIChat] kaller onClearSlicer:', chunk.slicerTitle);
            onClearSlicer?.(chunk.slicerTitle);
          } else if (chunk.type === 'open_report' && chunk.rapportId) {
            router.push(`/dashboard/rapport/${chunk.rapportId}`);
          } else if (chunk.type === 'rapport_forslag' && chunk.forslag) {
            addDisplay({ role: 'rapport_forslag', content: '', rapportForslag: chunk.forslag });
          } else if (chunk.type === 'query_result' && chunk.data) {
            pendingQueryRef.current = { data: chunk.data, sql: chunk.sql ?? '' };
          } else if (chunk.type === 'done') {
            if (pendingQueryRef.current) {
              addDisplay({ role: 'actions', content: '', queryData: pendingQueryRef.current.data, querySql: pendingQueryRef.current.sql });
              pendingQueryRef.current = null;
            }
            // STEG 4 – Auto-opplesing av ferdig AI-svar
            if (autoOpplesing && assistantText) {
              lesOppTekst(assistantText);
            }
          } else if (chunk.type === 'conversation_history' && chunk.messages) {
            historyReceived = true;
            conversationHistoryRef.current = chunk.messages;
            setMessages(chunk.messages);
          } else if (chunk.type === 'error') {
            addDisplay({ role: 'status', content: `❌ Feil: ${chunk.message}` });
          }
        }
      }

      if (assistantText && !historyReceived) {
        const updated = [...conversationHistoryRef.current, { role: 'assistant' as const, content: assistantText }];
        conversationHistoryRef.current = updated;
        setMessages(updated);
      }
    } catch (err) {
      console.error('[AIChat] fetch feil:', err);
      if ((err as Error).name !== 'AbortError') {
        addDisplay({ role: 'status', content: '❌ Kunne ikke koble til AI-assistenten.' });
      }
    } finally {
      setLoading(false);
      setTimeout(() => { inputRef.current?.focus(); }, 50);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (lytter) stoppLytting();
      send();
    }
  }

  const renderMedLenker = (tekst: string | null) => {
    if (!tekst) return null;
    const deler = tekst.split(/(\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
    return deler.map((del, i) => {
      const match = del.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (match) {
        return (
          <a
            key={i}
            href={match[2]}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#f59e0b', textDecoration: 'underline', cursor: 'pointer' }}
          >
            {match[1]}
          </a>
        );
      }
      return <span key={i}>{del}</span>;
    });
  };

  return (
    <div
      className={standaloneMode ? 'flex flex-col h-full' : 'fixed bottom-6 right-6 flex flex-col items-end gap-3'}
      style={standaloneMode ? {} : { zIndex: 10000 }}
    >
      {/* Chat panel */}
      {(standaloneMode || open) && (
        <div
          className={standaloneMode ? 'flex flex-col overflow-hidden relative flex-1 w-full' : 'w-[360px] h-[520px] rounded-2xl flex flex-col overflow-hidden relative'}
          style={{
            background: 'rgba(15,25,45,0.92)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid var(--glass-border)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{
              background: 'rgba(10,18,35,0.95)',
              borderBottom: '1px solid var(--glass-bg-hover)',
            }}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                style={{
                  background: 'var(--glass-gold-bg)',
                  border: '1px solid var(--glass-gold-border)',
                }}
              >
                <MessageCircle className="w-3.5 h-3.5" style={{ color: 'var(--gold)' }} />
              </div>
              <div>
                <div style={{
                  fontFamily: 'Barlow Condensed, sans-serif',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  fontSize: 15,
                  letterSpacing: '0.02em',
                }}>
                  {organisasjonNavn} Assistent
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
                  AI-drevet dataanalyse
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {/* STEG 3 – Stopp-knapp når TTS er aktiv */}
              {visStopp && (
                <button
                  onClick={stoppOpplesing}
                  title="Stopp opplesing"
                  className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    background: 'rgba(239,68,68,0.15)',
                    border: '1px solid rgba(239,68,68,0.30)',
                    color: '#ef4444',
                    animation: 'mic-pulse 1.5s infinite',
                  }}
                >
                  <Square className="w-2.5 h-2.5" />
                  Stopp
                </button>
              )}
              {/* Auto-opplesing toggle */}
              <button
                onClick={() => {
                  const ny = !autoOpplesing;
                  setAutoOpplesing(ny);
                  lagreInnstillinger({ ...ttsInstillinger, autoOpplesing: ny });
                }}
                title={autoOpplesing ? 'Slå av automatisk opplesing' : 'Slå på automatisk opplesing'}
                className="rounded p-1 transition-colors"
                style={{
                  background: autoOpplesing ? 'var(--glass-gold-bg)' : 'transparent',
                  border: autoOpplesing ? '1px solid var(--glass-gold-border)' : '1px solid transparent',
                  color: autoOpplesing ? 'var(--gold)' : 'var(--text-muted)',
                }}
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
              {/* STEG 2 – Innstillingsknapp */}
              <button
                onClick={() => setVisTTSInstillinger((v) => !v)}
                title="Tale-innstillinger"
                className="rounded p-1 transition-colors"
                style={{
                  background: visTTSInstillinger ? 'var(--glass-border)' : 'transparent',
                  border: '1px solid transparent',
                  color: visTTSInstillinger ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              {!standaloneMode && (
                <button
                  onClick={() => setOpen(false)}
                  className="rounded p-1 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg-hover)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
                  }}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* STEG 3 – TTS Innstillinger-panel */}
          {visTTSInstillinger && (
            <div
              style={{
                position: 'absolute',
                top: 52,
                right: 8,
                background: 'rgba(12,20,38,0.98)',
                border: '1px solid var(--glass-border)',
                borderRadius: 10,
                padding: 14,
                width: 240,
                zIndex: 100,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.10em', marginBottom: 12 }}>
                TALE-INNSTILLINGER
              </div>

              {/* Stemmevalg — Azure Neural */}
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Stemme</label>
              <select
                value={ttsInstillinger.stemmNavn}
                onChange={(e) => {
                  const ny = { ...ttsInstillinger, stemmNavn: e.target.value };
                  setTtsInstillinger(ny);
                  lagreInnstillinger(ny);
                }}
                style={{
                  width: '100%', marginBottom: 10, padding: '5px 8px', fontSize: 12,
                  background: 'var(--glass-bg-hover)', border: '1px solid var(--glass-border-hover)',
                  borderRadius: 6, color: 'var(--text-primary)',
                }}
              >
                {AZURE_STEMMER.map((s) => (
                  <option key={s.navn} value={s.navn}>{s.visNavn}</option>
                ))}
              </select>

              {/* Hastighet */}
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                Hastighet: {ttsInstillinger.hastighet.toFixed(1)}x
              </label>
              <input
                type="range" min="0.5" max="2" step="0.1"
                value={ttsInstillinger.hastighet}
                onChange={(e) => {
                  const ny = { ...ttsInstillinger, hastighet: parseFloat(e.target.value) };
                  setTtsInstillinger(ny);
                  lagreInnstillinger(ny); // debounced 1 sek
                }}
                style={{ width: '100%', marginBottom: 12, accentColor: 'var(--gold)' }}
              />

              {/* Test-knapp */}
              <button
                onClick={() => lesOppTekst('Hei! Dette er en test av tale-innstillingene.')}
                style={{
                  width: '100%', padding: '7px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: 'var(--glass-gold-bg)', border: '1px solid var(--gold-dim)', color: 'var(--gold)',
                }}
              >
                🔊 Test stemme
              </button>
            </div>
          )}

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto p-3 space-y-2 text-sm"
            style={{ background: 'rgba(10,18,35,0.85)' }}
          >
            {!rapportNavn && (
              <div
                className="rounded-lg px-3 py-2 text-xs"
                style={{
                  background: 'var(--glass-bg)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--text-secondary)',
                }}
              >
                Ingen rapport er åpen. Spør meg hvilke rapporter som finnes, eller åpne en rapport fra sidemenyen.
              </div>
            )}
            {display.length === 0 && (
              <p className="text-xs text-center mt-4" style={{ color: 'var(--text-muted)' }}>
                Spør meg om rapportdata eller be om å filtrere rapporten.
              </p>
            )}
            {display.map((msg, i) => {
              if (msg.role === 'rapport_forslag' && msg.rapportForslag) {
              const f = msg.rapportForslag;
              const visTypeLabel: Record<string, string> = {
                bar: 'Søylediagram', line: 'Linjediagram', table: 'Tabell',
                pie: 'Kakediagram', card: 'KPI-kort',
              };

              // Mini bar chart SVG preview
              const miniChart = (() => {
                if (!f.data?.length || f.visualType === 'table') return null;
                const W = 290, H = 72, pad = 4;
                if (f.visualType === 'card') {
                  const yCol = f.yAkse ?? Object.keys(f.data[0])[0];
                  const val  = f.data[0][yCol];
                  return (
                    <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 22, fontWeight: 700, color: 'var(--gold)' }}>
                      {typeof val === 'number' ? val.toLocaleString('nb-NO') : String(val ?? '')}
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>{yCol}</div>
                    </div>
                  );
                }
                if (f.visualType === 'pie') {
                  const labelCol = f.xAkse ?? Object.keys(f.data[0])[0];
                  const valCol   = f.yAkse ?? Object.keys(f.data[0])[1] ?? Object.keys(f.data[0])[0];
                  const slices   = f.data.slice(0, 6).map(r => ({ label: String(r[labelCol] ?? ''), val: Math.abs(Number(r[valCol]) || 0) }));
                  const total    = slices.reduce((s, x) => s + x.val, 0) || 1;
                  const colors   = ['var(--gold)','#3B82F6','#10B981','#8B5CF6','#F43F5E','#06B6D4'];
                  let cumAngle = -Math.PI / 2;
                  const cx = 36, cy = 36, r = 30;
                  const paths = slices.map((s, idx) => {
                    const angle = (s.val / total) * 2 * Math.PI;
                    const x1 = cx + r * Math.cos(cumAngle), y1 = cy + r * Math.sin(cumAngle);
                    cumAngle += angle;
                    const x2 = cx + r * Math.cos(cumAngle), y2 = cy + r * Math.sin(cumAngle);
                    const large = angle > Math.PI ? 1 : 0;
                    return <path key={idx} d={`M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`} fill={colors[idx % colors.length]} opacity={0.85} />;
                  });
                  return (
                    <svg width={W} height={H} style={{ display: 'block' }}>
                      {paths}
                      {slices.map((s, idx) => (
                        <rect key={`l${idx}`} x={80 + (idx % 2) * 100} y={8 + Math.floor(idx / 2) * 18} width={8} height={8} fill={colors[idx % colors.length]} rx={1} />
                      ))}
                      {slices.map((s, idx) => (
                        <text key={`t${idx}`} x={92 + (idx % 2) * 100} y={16 + Math.floor(idx / 2) * 18} fontSize={9} fill="var(--text-secondary)">{s.label.slice(0, 12)}</text>
                      ))}
                    </svg>
                  );
                }
                // Bar / line
                const xCol    = f.xAkse ?? Object.keys(f.data[0])[0];
                const yCol    = f.yAkse ?? Object.keys(f.data[0])[1] ?? Object.keys(f.data[0])[0];
                const preview = f.data.slice(0, 10);
                const vals    = preview.map(r => Number(r[yCol]) || 0);
                const maxVal  = Math.max(...vals, 1);
                const barW    = (W - pad * 2) / preview.length;
                const barH    = H - pad * 2 - 14;
                if (f.visualType === 'line') {
                  const pts = preview.map((_, idx) => {
                    const x = pad + idx * barW + barW / 2;
                    const y = pad + barH - (vals[idx] / maxVal) * barH;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(' ');
                  return (
                    <svg width={W} height={H} style={{ display: 'block' }}>
                      <polyline points={pts} fill="none" stroke="var(--gold)" strokeWidth={1.5} opacity={0.85} />
                      {preview.map((r, idx) => {
                        const x = pad + idx * barW + barW / 2;
                        const y = pad + barH - (vals[idx] / maxVal) * barH;
                        return <circle key={idx} cx={x} cy={y} r={2.5} fill="var(--gold)" />;
                      })}
                      {preview.map((r, idx) => (
                        <text key={`l${idx}`} x={pad + idx * barW + barW / 2} y={H - 2} fontSize={7} textAnchor="middle" fill="var(--text-muted)">
                          {String(r[xCol] ?? '').slice(0, 6)}
                        </text>
                      ))}
                    </svg>
                  );
                }
                // bar
                return (
                  <svg width={W} height={H} style={{ display: 'block' }}>
                    {preview.map((r, idx) => {
                      const bh = Math.max(1, (vals[idx] / maxVal) * barH);
                      const x  = pad + idx * barW + 1;
                      const y  = pad + barH - bh;
                      return (
                        <g key={idx}>
                          <rect x={x} y={y} width={Math.max(1, barW - 2)} height={bh} fill="var(--gold)" opacity={0.75} rx={1} />
                          <text x={x + (barW - 2) / 2} y={H - 2} fontSize={7} textAnchor="middle" fill="var(--text-muted)">
                            {String(r[xCol] ?? '').slice(0, 6)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                );
              })();

              return (
                <div key={i} className="flex justify-start">
                  <div
                    className="w-full max-w-[95%] rounded-xl p-3 text-sm"
                    style={{
                      background: 'var(--gold-dim)',
                      border: '1px solid var(--glass-gold-border)',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--gold)', marginBottom: 4 }}>
                      📊 {f.tittel}
                    </div>
                    {f.beskrivelse && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                        {f.beskrivelse}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                      {visTypeLabel[f.visualType] ?? f.visualType}
                      {f.xAkse ? ` · X: ${f.xAkse}` : ''}
                      {f.yAkse ? ` · Y: ${f.yAkse}` : ''}
                      {f.data?.length ? ` · ${f.data.length} rader` : ''}
                    </div>
                    {miniChart && (
                      <div style={{ marginBottom: 8, borderRadius: 6, overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
                        {miniChart}
                      </div>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); visRapportFullskjerm(f); }}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                        style={{
                          background: 'var(--glass-gold-border)',
                          border: '1px solid var(--gold-dim)',
                          color: 'var(--gold)',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gold-dim)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-gold-border)'; }}
                      >
                        Vis fullskjerm
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); eksporterRapport(f); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                        style={{
                          background: 'var(--glass-bg)',
                          border: '1px solid var(--glass-border-hover)',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
                      >
                        Eksporter
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDisplay((prev) => prev.filter((_, idx) => idx !== i)); }}
                        className="px-3 py-1.5 rounded-lg text-xs transition-colors"
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--glass-border)',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}
                      >
                        Lukk
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            if (msg.role === 'actions' && msg.queryData) {
                return (
                  <div key={i} className="flex gap-2 flex-wrap pl-1">
                    <button
                      onClick={() => exportToExcel(msg.queryData!, `eksport-${new Date().toISOString().slice(0, 10)}`)}
                      className="flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition-colors font-semibold"
                      style={{
                        background: 'var(--glass-gold-border)',
                        border: '1px solid var(--gold-dim)',
                        color: 'var(--gold)',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gold-dim)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-gold-border)'; }}
                    >
                      <Download className="w-3 h-3" />
                      Last ned Excel
                    </button>
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className={
                    msg.role === 'user'
                      ? 'flex justify-end'
                      : msg.role === 'status'
                      ? 'flex justify-center'
                      : 'flex justify-start'
                  }
                >
                  <div
                    className="max-w-[85%]"
                    style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                  >
                    <div
                      className="px-3 py-2 whitespace-pre-wrap text-sm"
                      style={
                        msg.role === 'user'
                          ? {
                              background: 'var(--gold-dim)',
                              border: '1px solid var(--glass-gold-border)',
                              color: 'var(--text-primary)',
                              borderRadius: '10px 10px 3px 10px',
                            }
                          : msg.role === 'status'
                          ? {
                              fontSize: 11,
                              color: 'var(--text-muted)',
                              fontStyle: 'italic',
                              padding: '2px 0',
                            }
                          : {
                              background: 'var(--glass-bg)',
                              border: '1px solid var(--glass-border)',
                              color: 'var(--text-primary)',
                              borderRadius: '3px 10px 10px 10px',
                            }
                      }
                    >
                      {renderMedLenker(msg.content)}
                    </div>
                    {/* Les opp / Stopp per AI-melding */}
                    {msg.role === 'assistant' && msg.content && (
                      <button
                        onClick={() => lesOppMelding(msg.content, i)}
                        title={ttsAktivIdx === i ? 'Stopp opplesing' : 'Les opp dette svaret'}
                        className="flex items-center gap-1 self-start transition-all"
                        style={{
                          padding: '2px 8px',
                          borderRadius: 5,
                          fontSize: 11,
                          background: ttsAktivIdx === i ? 'rgba(239,68,68,0.10)' : 'var(--glass-bg)',
                          border: ttsAktivIdx === i ? '1px solid rgba(239,68,68,0.25)' : '1px solid var(--glass-border)',
                          color: ttsAktivIdx === i ? '#ef4444' : 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                      >
                        <Volume2 className="w-2.5 h-2.5" />
                        {ttsAktivIdx === i ? '⏹ Stopp' : 'Les opp'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {loading && display[display.length - 1]?.role !== 'assistant' && (
              <div className="flex justify-start">
                <div
                  className="px-3 py-2"
                  style={{
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '3px 10px 10px 10px',
                  }}
                >
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div
            className="p-3 flex gap-2 shrink-0"
            style={{ borderTop: '1px solid var(--glass-bg-hover)', background: 'rgba(10,18,35,0.95)', position: 'relative' }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Skriv et spørsmål..."
              rows={1}
              disabled={loading}
              autoFocus
              className="flex-1 text-sm disabled:opacity-50 focus:outline-none"
              style={{
                resize: 'none',
                overflow: 'hidden',
                minHeight: 36,
                maxHeight: 160,
                lineHeight: '1.5',
                padding: '8px 12px',
                background: 'var(--glass-bg-hover)',
                border: '1px solid var(--glass-border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                transition: 'height 0.1s ease, border-color 0.15s',
              }}
              onFocus={(e) => { (e.currentTarget as HTMLTextAreaElement).style.borderColor = 'var(--gold-dim)'; }}
              onBlur={(e)  => { (e.currentTarget as HTMLTextAreaElement).style.borderColor = 'var(--glass-border)'; }}
            />
            {/* STEG 2 – Mikrofon-knapp */}
            <button
              onClick={toggleMikrofon}
              disabled={loading}
              title={lytter ? 'Stopp innspilling' : 'Start tale-til-tekst (nb-NO)'}
              className="flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                border: lytter
                  ? '1px solid rgba(239,68,68,0.50)'
                  : '1px solid var(--glass-border)',
                background: lytter
                  ? 'rgba(239,68,68,0.15)'
                  : 'var(--glass-bg)',
                color: lytter ? '#ef4444' : 'var(--text-muted)',
                animation: lytter ? 'mic-pulse 1.5s infinite' : 'none',
              }}
            >
              {lytter ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </button>
            {sttFeil && (
              <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4, padding: '4px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.30)', color: '#ef4444', fontSize: 10 }}>
                STT feil: {sttFeil}
              </div>
            )}
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="px-3 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: 'var(--gold-dim)',
                border: '1px solid var(--gold-dim)',
                color: 'var(--gold)',
                borderRadius: 7,
              }}
              onMouseEnter={(e) => {
                if (!loading && input.trim()) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-gold-border)';
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--gold-dim)';
              }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Toggle button — vises kun i widget-modus */}
      {!standaloneMode && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-12 h-12 rounded-full shadow-lg transition-all flex items-center justify-center"
          style={{
            background: 'var(--gold)',
            border: 'none',
            color: 'var(--navy-dark)',
            boxShadow: '0 4px 20px var(--gold-dim)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--gold)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 24px var(--gold-dim)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--gold)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px var(--gold-dim)';
          }}
          aria-label="Åpne AI-assistent"
        >
          {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
        </button>
      )}
    </div>
  );
}
