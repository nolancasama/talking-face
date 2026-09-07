import type { SpeechCue, SpeechResult, TTSProvider, Voice } from '../core/types';
import { devDirectConfig, endpointConfig, type DevDirectConfig } from './config';

const AZURE_VOICES: readonly Voice[] = [
  { id: 'en-US-JennyNeural', label: 'Female 1' },
  { id: 'en-US-AriaNeural', label: 'Female 2' },
  { id: 'en-US-GuyNeural', label: 'Male 1' },
  { id: 'en-US-DavisNeural', label: 'Male 2' },
];

interface ProxyViseme {
  audioOffset?: number;
  offsetMs?: number;
  startMs?: number;
  visemeId?: number;
  id?: number;
}

interface ProxyResponse {
  audio?: string;
  audioBase64?: string;
  audioContentType?: string;
  contentType?: string;
  durationMs?: number;
  visemes?: ProxyViseme[];
  cues?: SpeechCue[];
}

/**
 * A dev server (and most static hosts in production, via their SPA rewrite
 * rule) answers ANY unmatched route with a 200 and the app's own index.html
 * rather than a 404. Without this check, a HEAD/POST to a not-yet-deployed
 * /api/tts looks identical to a real proxy responding successfully, so this
 * provider would get picked over the Web Speech fallback and then fail trying
 * to parse HTML as the TTS JSON response.
 */
function isSpaFallback(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('text/html');
}

function randomId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function audioBlob(encoded: string, contentType = 'audio/mpeg'): Blob {
  const comma = encoded.indexOf(',');
  const payload = encoded.startsWith('data:') && comma >= 0 ? encoded.slice(comma + 1) : encoded;
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: contentType });
}

async function decodedDurationMs(blob: Blob, fallbackMs: number): Promise<number> {
  try {
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      return decoded.duration * 1000;
    } finally {
      await context.close();
    }
  } catch {
    return fallbackMs;
  }
}

function normaliseCues(events: readonly ProxyViseme[], durationMs: number): SpeechCue[] {
  const starts = events.map((event) => {
    if (typeof event.startMs === 'number') return event.startMs;
    if (typeof event.offsetMs === 'number') return event.offsetMs;
    // Azure's native audioOffset unit is a 100ns tick.
    return typeof event.audioOffset === 'number' ? event.audioOffset / 10_000 : 0;
  });

  return events.flatMap((event, index) => {
    const id = event.visemeId ?? event.id;
    if (typeof id !== 'number') return [];
    const startMs = Math.max(0, starts[index] ?? 0);
    const following = starts[index + 1];
    return [{
      startMs,
      endMs: Math.max(startMs, Math.min(durationMs, following ?? durationMs)),
      token: { kind: 'viseme' as const, provider: 'azure', id },
    }];
  });
}

function validateProxyResult(payload: ProxyResponse): SpeechResult {
  const encoded = payload.audioBase64 ?? payload.audio;
  if (!encoded) throw new Error('The TTS proxy response did not contain audio.');
  if (typeof payload.durationMs !== 'number' || payload.durationMs < 0) {
    throw new Error('The TTS proxy response did not contain a valid durationMs.');
  }
  const cues = payload.cues ?? normaliseCues(payload.visemes ?? [], payload.durationMs);
  return {
    audio: audioBlob(encoded, payload.audioContentType ?? payload.contentType),
    durationMs: payload.durationMs,
    cues,
  };
}

function splitHeader(message: string): { headers: Map<string, string>; body: string } {
  const separator = message.indexOf('\r\n\r\n');
  const headerText = separator < 0 ? message : message.slice(0, separator);
  const body = separator < 0 ? '' : message.slice(separator + 4);
  const headers = new Map<string, string>();
  for (const line of headerText.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return { headers, body };
}

function directSynthesis(
  config: DevDirectConfig,
  text: string,
  voiceId: string,
  speed: number,
): Promise<SpeechResult> {
  return new Promise((resolve, reject) => {
    const connectionId = randomId();
    const requestId = randomId();
    const url = new URL(`wss://${config.region}.tts.speech.microsoft.com/cognitiveservices/websocket/v1`);
    url.searchParams.set('Ocp-Apim-Subscription-Key', config.subscriptionKey);
    url.searchParams.set('X-ConnectionId', connectionId);
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    const chunks: Uint8Array[] = [];
    const visemes: ProxyViseme[] = [];
    let settled = false;

    const fail = (reason: unknown): void => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(reason instanceof Error ? reason : new Error(String(reason)));
    };

    socket.onerror = () => fail(new Error('Azure Speech connection failed.'));
    socket.onopen = () => {
      const timestamp = new Date().toUTCString();
      socket.send(
        `Path: speech.config\r\nX-RequestId: ${requestId}\r\nX-Timestamp: ${timestamp}\r\n` +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataOptions: {
                  sentenceBoundaryEnabled: false,
                  visemeEnabled: true,
                  wordBoundaryEnabled: false,
                },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        }),
      );
      const rate = `${Math.round((Math.max(0.25, Math.min(4, speed)) - 1) * 100)}%`;
      const ssml = `<speak version="1.0" xml:lang="en-US"><voice name="${escapeXml(voiceId)}">` +
        `<prosody rate="${rate}">${escapeXml(text)}</prosody></voice></speak>`;
      socket.send(
        `X-RequestId: ${requestId}\r\nContent-Type: application/ssml+xml\r\nPath: ssml\r\n\r\n${ssml}`,
      );
    };

    socket.onmessage = async (event: MessageEvent<string | ArrayBuffer>) => {
      if (typeof event.data !== 'string') {
        const packet = new Uint8Array(event.data);
        if (packet.length < 2) return;
        const headerLength = (packet[0] ?? 0) * 256 + (packet[1] ?? 0);
        const header = new TextDecoder().decode(packet.slice(2, 2 + headerLength));
        if (splitHeader(header).headers.get('path') === 'audio') chunks.push(packet.slice(2 + headerLength));
        return;
      }

      const { headers, body } = splitHeader(event.data);
      const path = headers.get('path');
      if (path === 'viseme') {
        const data = JSON.parse(body) as { audioOffset?: number; visemeId?: number };
        visemes.push(data);
      } else if (path === 'audio.metadata') {
        const data = JSON.parse(body) as {
          Metadata?: Array<{
            Type?: string;
            Data?: { Offset?: number; VisemeId?: number };
          }>;
        };
        for (const item of data.Metadata ?? []) {
          if (item.Type !== 'Viseme' || !item.Data) continue;
          visemes.push({
            audioOffset: item.Data.Offset,
            visemeId: item.Data.VisemeId,
          });
        }
      } else if (path === 'turn.end') {
        if (settled) return;
        settled = true;
        socket.close();
        const lastOffset = visemes.length === 0
          ? 0
          : (visemes[visemes.length - 1]?.audioOffset ?? 0) / 10_000;
        // Azure does not include container duration in the stream metadata. The
        // final viseme plus a small speech tail is the best deterministic bound.
        const fallbackDurationMs = Math.max(lastOffset + 250, (text.length * 75) / Math.max(0.25, speed));
        const audio = new Blob(
          chunks.map((chunk) => new Uint8Array(chunk).buffer),
          { type: 'audio/mpeg' },
        );
        const durationMs = await decodedDurationMs(audio, fallbackDurationMs);
        resolve({
          audio,
          durationMs,
          cues: normaliseCues(visemes, durationMs),
        });
      } else if (path === 'turn.error') {
        fail(new Error(`Azure Speech rejected synthesis: ${body}`));
      }
    };
  });
}

export class AzureTTSProvider implements TTSProvider {
  readonly name = 'azure';

  async available(): Promise<boolean> {
    if (devDirectConfig()) return true;
    try {
      const response = await fetch(endpointConfig().proxyUrl, { method: 'HEAD' });
      return (response.ok || response.status === 405) && !isSpaFallback(response);
    } catch {
      return false;
    }
  }

  async voices(): Promise<Voice[]> {
    return [...AZURE_VOICES];
  }

  async generate(text: string, voiceId: string, speed: number): Promise<SpeechResult> {
    const direct = devDirectConfig();
    if (direct) return directSynthesis(direct, text, voiceId, speed);

    const response = await fetch(endpointConfig().proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ text, voice: voiceId, speed }),
    });
    if (!response.ok) throw new Error(`TTS proxy request failed (${response.status}).`);
    if (isSpaFallback(response)) {
      throw new Error(
        `No TTS proxy is deployed at "${endpointConfig().proxyUrl}" -- the request landed on the app's own ` +
        "index.html instead. This is expected until a real /api/tts backend exists.",
      );
    }
    return validateProxyResult(await response.json() as ProxyResponse);
  }
}

export { AZURE_VOICES };
