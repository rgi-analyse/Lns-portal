import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { apiFetch } from '@/lib/apiClient';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ── Auth header ───────────────────────────────────────────────────────────────

let _entraObjectId: string | null = null;

/** Kalles fra AIChat.tsx når entraObjectId er kjent. */
export function settEntraObjectId(id: string | undefined | null) {
  _entraObjectId = id ?? null;
}

// ── Token cache ───────────────────────────────────────────────────────────────

interface TokenCache {
  token: string;
  region: string;
  expires: number;
}

let cachetToken: TokenCache | null = null;

async function hentToken(): Promise<TokenCache> {
  if (cachetToken && Date.now() < cachetToken.expires) return cachetToken;

  const headers: Record<string, string> = {};
  if (_entraObjectId) headers['X-Entra-Object-Id'] = _entraObjectId;

  const res = await apiFetch('/api/speech/token', {
    credentials: 'include',
    headers,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Speech token feil ${res.status}: ${body}`);
  }

  cachetToken = await res.json() as TokenCache;
  return cachetToken;
}

// ── STT ───────────────────────────────────────────────────────────────────────

export async function startAzureSTT(
  onResultat: (tekst: string, erEndelig: boolean) => void,
  onStopp: () => void,
  onFeil: (feil: string) => void,
): Promise<SpeechSDK.SpeechRecognizer> {
  const { token, region } = await hentToken();

  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
  speechConfig.speechRecognitionLanguage = 'nb-NO';

  const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
  const recognizer  = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognizing = (_s, e) => {
    if (e.result.text) onResultat(e.result.text, false);
  };

  recognizer.recognized = (_s, e) => {
    if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text) {
      onResultat(e.result.text, true);
    }
  };

  recognizer.canceled = (_s, e) => {
    if (e.reason === SpeechSDK.CancellationReason.Error) {
      onFeil(e.errorDetails);
    }
    onStopp();
  };

  recognizer.sessionStopped = () => onStopp();

  await new Promise<void>((resolve, reject) => {
    recognizer.startContinuousRecognitionAsync(
      () => { console.log('[Azure STT] startet'); resolve(); },
      (err) => { reject(new Error(err)); },
    );
  });

  return recognizer;
}

export function stoppAzureSTT(recognizer: SpeechSDK.SpeechRecognizer): void {
  recognizer.stopContinuousRecognitionAsync(
    () => { console.log('[Azure STT] stoppet'); recognizer.close(); },
    (err) => { console.error('[Azure STT] stopp feil:', err); recognizer.close(); },
  );
}

// ── TTS ───────────────────────────────────────────────────────────────────────

// Norske Azure Neural-stemmer
export const AZURE_STEMMER = [
  { navn: 'nb-NO-PernilleNeural',  visNavn: 'Pernille (nb-NO) ☁️' },
  { navn: 'nb-NO-FinnNeural',      visNavn: 'Finn (nb-NO) ☁️' },
  { navn: 'nb-NO-IselinNeural',    visNavn: 'Iselin (nb-NO) ☁️' },
];

let aktivSynthesizer: SpeechSDK.SpeechSynthesizer | null = null;
let aktivPlayer: SpeechSDK.SpeakerAudioDestination | null = null;

export function rensTekstForTTS(tekst: string): string {
  return tekst
    // Fjern UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    // Fjern hex-strenger (>= 8 tegn)
    .replace(/\b[0-9a-f]{8,}\b/gi, '')
    // Fjern URL-er
    .replace(/https?:\/\/[^\s]+/g, '')
    // Fjern tabellnavn (ai_gold.vw_*, schema.view)
    .replace(/\b(ai_gold|gold)\.\w+/gi, 'datavisningen')
    // Erstatt SQL med kort label
    .replace(/SELECT\s[\s\S]*?(?=\n\n|$)/gi, 'SQL-spørring')
    .replace(/\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|JOIN|INSERT|UPDATE|DELETE|HAVING)\b/gi, '')
    // Fjern kolonnenavn i brackets
    .replace(/\[[^\]]+\]/g, '')
    // Fjern filnavn og stier
    .replace(/\b\w+\.(tsx?|jsx?|css|json|sql|pbix|png|jpg)\b/gi, '')
    .replace(/apps\/[^\s]*/g, '')
    // Fjern store tallrekker (org-nr, tlf osv)
    .replace(/\b\d{8,}\b/g, '')
    // Markdown
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[-•]\s/g, ', ')
    // Rens opp resterende
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 3000);
}

export async function azureTTS(
  tekst: string,
  stemme = 'nb-NO-PernilleNeural',
  hastighet = 1.0,
  onFerdig?: () => void,
): Promise<void> {
  stoppAzureTTS();

  const { token, region } = await hentToken();

  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
  speechConfig.speechSynthesisVoiceName = stemme;

  const renTekst = rensTekstForTTS(tekst);
  console.log('[TTS] original lengde:', tekst.length, '→ renset:', renTekst.length);

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="nb-NO">
  <voice name="${stemme}">
    <prosody rate="${hastighet}">${renTekst}</prosody>
  </voice>
</speak>`;

  // SpeakerAudioDestination gir oss onAudioEnd som fyrer NÅR LYDEN ER FERDIG SPILT
  const player      = new SpeechSDK.SpeakerAudioDestination();
  const audioConfig = SpeechSDK.AudioConfig.fromSpeakerOutput(player);
  const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, audioConfig);

  aktivSynthesizer = synthesizer;
  aktivPlayer      = player;

  return new Promise<void>((resolve) => {
    // onAudioEnd fyrer etter at lyden faktisk er ferdig avspilt lokalt
    player.onAudioEnd = () => {
      console.log('[TTS] onAudioEnd — lyd ferdig avspilt');
      if (aktivSynthesizer === synthesizer) aktivSynthesizer = null;
      if (aktivPlayer === player) aktivPlayer = null;
      try { synthesizer.close(); } catch { /* ignore */ }
      onFerdig?.();
      resolve();
    };

    synthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        console.log('[TTS] speakSsmlAsync reason:', result.reason);
        // Kun håndter feil — normal avslutning håndteres av onAudioEnd
        if (result.reason === SpeechSDK.ResultReason.Canceled) {
          console.error('[TTS] Canceled:', result.errorDetails);
          if (aktivSynthesizer === synthesizer) aktivSynthesizer = null;
          if (aktivPlayer === player) aktivPlayer = null;
          try { synthesizer.close(); } catch { /* ignore */ }
          onFerdig?.();
          resolve();
        }
      },
      (err) => {
        console.error('[TTS] speakSsmlAsync feil:', err);
        if (aktivSynthesizer === synthesizer) aktivSynthesizer = null;
        if (aktivPlayer === player) aktivPlayer = null;
        try { synthesizer.close(); } catch { /* ignore */ }
        onFerdig?.();
        resolve();
      },
    );
  });
}

export function stoppAzureTTS(): void {
  console.log('[TTS] stoppAzureTTS kalt');

  // pause() + close() stopper bufferet lyd umiddelbart
  if (aktivPlayer) {
    try {
      aktivPlayer.pause();
      aktivPlayer.close();
      console.log('[TTS] player pauset og lukket');
    } catch (err) {
      console.error('[TTS] player stopp feil:', err);
    }
    aktivPlayer = null;
  }

  if (aktivSynthesizer) {
    try {
      aktivSynthesizer.close();
      console.log('[TTS] synthesizer lukket');
    } catch (err) {
      console.error('[TTS] synthesizer lukk feil:', err);
    }
    aktivSynthesizer = null;
  }
}
