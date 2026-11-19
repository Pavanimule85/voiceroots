import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 90000;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

function computeLevenshtein<T>(ref: T[], hyp: T[]): {
  distance: number;
  substitutions: number;
  deletions: number;
  insertions: number;
} {
  const n = ref.length;
  const m = hyp.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  const ops: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 0; i <= n; i++) {
    dp[i][0] = i;
    ops[i][0] = 2; // deletion
  }
  for (let j = 0; j <= m; j++) {
    dp[0][j] = j;
    ops[0][j] = 3; // insertion
  }
  ops[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (ref[i - 1] === hyp[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
        ops[i][j] = 0; // match
      } else {
        const sub = dp[i - 1][j - 1] + 1;
        const del = dp[i - 1][j] + 1;
        const ins = dp[i][j - 1] + 1;
        if (sub <= del && sub <= ins) {
          dp[i][j] = sub;
          ops[i][j] = 1; // substitution
        } else if (del <= ins) {
          dp[i][j] = del;
          ops[i][j] = 2; // deletion
        } else {
          dp[i][j] = ins;
          ops[i][j] = 3; // insertion
        }
      }
    }
  }

  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;

  while (i > 0 || j > 0) {
    const op = ops[i][j];
    if (op === 0) {
      i--;
      j--;
    } else if (op === 1) {
      substitutions++;
      i--;
      j--;
    } else if (op === 2) {
      deletions++;
      i--;
    } else {
      insertions++;
      j--;
    }
  }

  return {
    distance: dp[n][m],
    substitutions,
    deletions,
    insertions,
  };
}

function evaluateMetrics(reference: string, hypothesis: string) {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.,!?;:"'()\[\]{}।॥]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const refNorm = norm(reference);
  const hypNorm = norm(hypothesis);

  const refWords = refNorm ? refNorm.split(' ') : [];
  const hypWords = hypNorm ? hypNorm.split(' ') : [];

  const wordEdit = computeLevenshtein(refWords, hypWords);
  const wer = refWords.length > 0 ? Number(((wordEdit.distance / refWords.length) * 100).toFixed(2)) : 0;

  const refChars = Array.from(refNorm.replace(/\s+/g, ''));
  const hypChars = Array.from(hypNorm.replace(/\s+/g, ''));
  const charEdit = computeLevenshtein(refChars, hypChars);
  const cer = refChars.length > 0 ? Number(((charEdit.distance / refChars.length) * 100).toFixed(2)) : 0;

  return {
    wer,
    cer,
    substitutions: wordEdit.substitutions,
    deletions: wordEdit.deletions,
    insertions: wordEdit.insertions,
    referenceWords: refWords.length,
    hypothesisWords: hypWords.length,
    referenceChars: refChars.length,
  };
}

const DIALECT_CATALOG = [
  { id: 'gondi', name: 'Gondi (गोंडी)', iso: 'gon', family: 'Dravidian (Central)', region: 'Madhya Pradesh · Chhattisgarh · Maharashtra', status: 'Vulnerable', department: 'Central Tribal Linguistics Dept' },
  { id: 'kui', name: 'Kui (कुई)', iso: 'kxu', family: 'Dravidian (South-Central)', region: 'Odisha (Kandhamal)', status: 'Vulnerable', department: 'Eastern Folk & Munda Division' },
  { id: 'tulu', name: 'Tulu (ತುಳು)', iso: 'tcy', family: 'Dravidian (Southern)', region: 'Coastal Karnataka · Kasaragod', status: 'Under-Digitized', department: 'Deccan & Dravidian Heritage Unit' },
  { id: 'kodava', name: 'Kodava Takk (ಕೊಡವ)', iso: 'kfa', family: 'Dravidian (Southern)', region: 'Kodagu, Karnataka', status: 'Endangered', department: 'Deccan & Dravidian Heritage Unit' },
  { id: 'kurukh', name: 'Kurukh / Oraon (कुड़ुख़)', iso: 'kru', family: 'Dravidian (Northern)', region: 'Jharkhand · Odisha · Chhattisgarh', status: 'Vulnerable', department: 'Eastern Folk & Munda Division' },
  { id: 'mundari', name: 'Mundari (मुण्डारी)', iso: 'unr', family: 'Austroasiatic (Munda)', region: 'Jharkhand · West Bengal · Odisha', status: 'Vulnerable', department: 'Eastern Folk & Munda Division' },
  { id: 'bhili', name: 'Bhili / Wagdi (भीली)', iso: 'bhb', family: 'Indo-Aryan (Western)', region: 'Rajasthan · Gujarat · Madhya Pradesh', status: 'Under-Digitized', department: 'Central Tribal Linguistics Dept' },
  { id: 'garhwali', name: 'Garhwali (गढ़वळि)', iso: 'gbm', family: 'Indo-Aryan (Northern)', region: 'Uttarakhand Himalayas', status: 'Vulnerable', department: 'Himalayan Oral Archive' },
  { id: 'kumaoni', name: 'Kumaoni (कुमाऊँनी)', iso: 'kfy', family: 'Indo-Aryan (Northern)', region: 'Kumaon, Uttarakhand', status: 'Vulnerable', department: 'Himalayan Oral Archive' },
  { id: 'lepcha', name: 'Lepcha (ᰛᰩᰴ)', iso: 'lep', family: 'Sino-Tibetan', region: 'Sikkim · Darjeeling', status: 'Endangered', department: 'Himalayan Oral Archive' },
  { id: 'toda', name: 'Toda (தோதா)', iso: 'tcx', family: 'Dravidian (Nilgiri)', region: 'Nilgiris, Tamil Nadu', status: 'Critically Endangered', department: 'Deccan & Dravidian Heritage Unit' },
  { id: 'halbi', name: 'Halbi (हल्बी)', iso: 'hlb', family: 'Indo-Aryan (Eastern-Central)', region: 'Bastar, Chhattisgarh', status: 'Under-Digitized', department: 'Central Tribal Linguistics Dept' },
];

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'vanisetu-api', timestamp: new Date().toISOString() });
  });

  app.get('/api/v1/dialects', (_req: Request, res: Response) => {
    res.json({ count: DIALECT_CATALOG.length, dialects: DIALECT_CATALOG });
  });

  app.post('/api/v1/evaluate-wer', (req: Request, res: Response) => {
    const { referenceText, hypothesisText } = req.body ?? {};
    if (typeof referenceText !== 'string' || typeof hypothesisText !== 'string' || !referenceText.trim() || !hypothesisText.trim()) {
      res.status(400).json({ error: 'Both referenceText and hypothesisText are required.' });
      return;
    }
    res.json(evaluateMetrics(referenceText, hypothesisText));
  });

  app.post('/api/transcribe', async (req: Request, res: Response) => {
    try {
      const { audioBase64, mimeType, sourceDialect, targetLanguage } = req.body ?? {};
      if (typeof audioBase64 !== 'string' || !audioBase64) {
        res.status(400).json({ error: 'audioBase64 is required.' });
        return;
      }

      let cleanMime = typeof mimeType === 'string' && mimeType.startsWith('audio/')
        ? mimeType.split(';')[0].trim().toLowerCase()
        : 'audio/webm';
      if (cleanMime === 'audio/x-m4a') cleanMime = 'audio/mp4';
      if (cleanMime === 'audio/mp3') cleanMime = 'audio/mpeg';
      if (cleanMime === 'audio/wave' || cleanMime === 'audio/x-wav') cleanMime = 'audio/wav';

      const dialect = typeof sourceDialect === 'string' && sourceDialect.trim() ? sourceDialect : 'Gondi';
      const target = typeof targetLanguage === 'string' && targetLanguage.trim() ? targetLanguage : 'English';

      const ai = getGeminiClient();

      // Multimodal audio transcription + translation + IPA + grammar
      const analysisResp = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: cleanMime,
                  data: audioBase64,
                },
              },
              {
                text: `You are an expert Indian computational linguist specializing in low-resource and endangered dialects.
Listen carefully to this spoken ${dialect} audio clip.
Target Translation Language: ${target}

Return a JSON object with:
1. rawTranscript: Verbatim transcription of the spoken audio in its authentic regional script or Devanagari/Latin phonetic orthography for ${dialect}. If no intelligible speech is present, return an empty string "".
2. cleanedTranscript: Cleaned dialect transcript preserving authentic ${dialect} lexemes and inflectional endings.
3. translatedText: Accurate, natural translation into ${target} preserving cultural idioms and register.
4. phoneticIpa: Phonetic IPA + Romanized pronunciation guide for the utterance.
5. grammarSuggestions: Concise grammatical breakdown (morphology, postpositions, verb agreement, and suggested normalization or preservation notes).`,
              },
            ],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                rawTranscript: { type: Type.STRING },
                cleanedTranscript: { type: Type.STRING },
                translatedText: { type: Type.STRING },
                phoneticIpa: { type: Type.STRING },
                grammarSuggestions: { type: Type.STRING },
              },
              required: ['rawTranscript', 'cleanedTranscript', 'translatedText', 'phoneticIpa', 'grammarSuggestions'],
            },
          },
        }),
        GEMINI_TIMEOUT_MS,
        'Gemini transcription'
      );

      const parsed = JSON.parse((analysisResp.text ?? '{}').trim() || '{}');
      const rawTranscript = (parsed.rawTranscript || parsed.cleanedTranscript || '').trim();
      if (!rawTranscript) {
        res.status(422).json({ error: 'Audio did not contain recognizable speech. Please record closer to the microphone or upload a clearer clip.' });
        return;
      }

      res.json({
        sourceTranscript: parsed.cleanedTranscript || rawTranscript,
        rawTranscript,
        translatedText: parsed.translatedText || '',
        phoneticIpa: parsed.phoneticIpa || '',
        grammarSuggestions: parsed.grammarSuggestions || '',
        modelUsed: 'gemini-2.5-flash (Multimodal Audio ASR + Translation)',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transcription failed.';
      console.error('Error in /api/transcribe:', msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/translate', async (req: Request, res: Response) => {
    try {
      const { text, sourceDialect, targetLanguage } = req.body ?? {};
      if (typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'Text to translate is required.' });
        return;
      }
      const dialect = typeof sourceDialect === 'string' && sourceDialect.trim() ? sourceDialect : 'Gondi';
      const target = typeof targetLanguage === 'string' && targetLanguage.trim() ? targetLanguage : 'English';

      const ai = getGeminiClient();
      const resp = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `You are an expert Indian computational linguist preserving low-resource dialects.
Source Dialect: ${dialect}
Target Language: ${target}
Input Utterance: """${text.trim()}"""

Translate accurately into ${target}, provide an IPA/Romanized phonetic guide, and give grammar suggestions & heritage morphological notes.`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                translatedText: { type: Type.STRING },
                phoneticIpa: { type: Type.STRING },
                grammarSuggestions: { type: Type.STRING },
              },
              required: ['translatedText', 'phoneticIpa', 'grammarSuggestions'],
            },
          },
        }),
        GEMINI_TIMEOUT_MS,
        'Gemini translation'
      );

      const parsed = JSON.parse((resp.text ?? '{}').trim() || '{}');
      res.json({
        translatedText: parsed.translatedText || '',
        phoneticIpa: parsed.phoneticIpa || '',
        grammarSuggestions: parsed.grammarSuggestions || '',
        modelUsed: 'gemini-2.5-flash',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Translation failed.';
      console.error('Error in /api/translate:', msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/tts', async (req: Request, res: Response) => {
    try {
      const { text, language } = req.body ?? {};
      if (typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'Text is required for speech synthesis.' });
        return;
      }
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: text.trim().slice(0, 1200),
                speechMetadata: {
                  style: `Clear, warm, natural pronunciation in ${typeof language === 'string' ? language : 'English'}`,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        res.json({ fallbackSpeechSynthesis: true });
        return;
      }
      res.json({ audioBase64: base64Audio, mimeType: 'audio/wav' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Speech synthesis failed.';
      console.warn('TTS model unavailable, falling back to browser SpeechSynthesis:', msg);
      res.json({ fallbackSpeechSynthesis: true });
    }
  });

  app.post('/api/v1/webhooks/test', async (req: Request, res: Response) => {
    const { endpointUrl, eventType, payload } = req.body ?? {};
    if (typeof endpointUrl !== 'string' || !endpointUrl.startsWith('https://')) {
      res.status(400).json({ error: 'A valid https:// endpointUrl is required.' });
      return;
    }
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VaniSetu-Event': typeof eventType === 'string' ? eventType : 'corpus.sync',
        },
        body: JSON.stringify({
          event: eventType || 'corpus.sync',
          timestamp: new Date().toISOString(),
          data: payload || { sampleDialect: 'Gondi', status: 'verified' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      res.json({
        delivered: response.ok,
        statusCode: response.status,
        latencyMs: Date.now() - started,
      });
    } catch (err: unknown) {
      res.json({
        delivered: false,
        statusCode: 0,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : 'Webhook request timed out or unreachable.',
      });
    }
  });

  // Live translation WebSocket endpoint setup function
  const setupLiveTranslationWS = (httpServer: any) => {
    const wss = new WebSocketServer({ noServer: true });

    interface LiveSession {
      ws: WebSocket;
      dialect: string;
      targetLanguage: string;
      ai: GoogleGenAI;
      liveSession: any;
      buffer: Buffer[];
    }

    const sessions = new Map<WebSocket, LiveSession>();

    wss.on('connection', (ws: WebSocket, req) => {
      console.log('Live translation WS connection accepted');
      console.log('Live translation WS connected');
      let session: LiveSession | null = null;

      ws.on('message', async (data: Buffer | string) => {
        try {
          const msg = typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString());

          if (msg.type === 'start') {
            const dialect = typeof msg.dialect === 'string' && msg.dialect.trim() ? msg.dialect : 'Gondi';
            const targetLanguage = typeof msg.targetLanguage === 'string' && msg.targetLanguage.trim() ? msg.targetLanguage : 'English';

            const ai = getGeminiClient();

            // Create Gemini Live session for streaming audio
            const liveSession = await ai.live.connect({
              model: 'gemini-2.5-flash-preview-native-audio-dialog',
              config: {
                responseModalities: ['TEXT'],
                systemInstruction: `You are an expert Indian computational linguist specializing in low-resource and endangered dialects.
Listen to streaming ${dialect} audio and provide real-time transcription and translation to ${targetLanguage}.
Output JSON with: transcript (partial/final), translation, isFinal (boolean).`,
              },
            });

            session = { ws, dialect, targetLanguage, ai, liveSession, buffer: [] };
            sessions.set(ws, session);

            // Handle responses from Gemini Live
            for await (const response of liveSession) {
              if (ws.readyState !== WebSocket.OPEN) break;
              if (response.text) {
                try {
                  const parsed = JSON.parse(response.text);
                  ws.send(JSON.stringify({
                    type: 'result',
                    transcript: parsed.transcript || '',
                    translation: parsed.translation || '',
                    isFinal: parsed.isFinal || false,
                  }));
                } catch {
                  // If not JSON, treat as plain text
                  ws.send(JSON.stringify({
                    type: 'result',
                    transcript: response.text,
                    translation: '',
                    isFinal: false,
                  }));
                }
              }
            }

            ws.send(JSON.stringify({ type: 'started', dialect, targetLanguage }));
          } else if (msg.type === 'audio' && session) {
            // Send audio chunk to Gemini Live
            if (msg.data && session.liveSession) {
              const audioBuffer = Buffer.from(msg.data, 'base64');
              session.liveSession.sendRealtimeInput({
                audio: {
                  data: msg.data,
                  mimeType: msg.mimeType || 'audio/webm;codecs=opus',
                },
              });
            }
          } else if (msg.type === 'stop' && session) {
            session.liveSession?.close();
            sessions.delete(ws);
            ws.send(JSON.stringify({ type: 'stopped' }));
          }
        } catch (err) {
          console.error('WS message error:', err);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : 'Processing error' }));
          }
        }
      });

      ws.on('close', () => {
        if (session) {
          session.liveSession?.close();
          sessions.delete(ws);
        }
        console.log('Live translation WS disconnected');
      });

      ws.on('error', (err) => {
        console.error('WS error:', err);
        if (session) {
          session.liveSession?.close();
          sessions.delete(ws);
        }
      });
    });

    return wss;
  };

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
    const httpServer = createServer(app);
    setupLiveTranslationWS(httpServer);
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Voice Roos full-stack server running on http://0.0.0.0:${PORT}`);
      console.log(`Live translation WebSocket at ws://0.0.0.0:${PORT}/api/live-translate`);
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, port: PORT },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    // Create separate HTTP server for WebSocket to avoid Vite HMR conflicts
    const wsHttpServer = createServer();
    setupLiveTranslationWS(wsHttpServer);
    wsHttpServer.listen(PORT + 2, '0.0.0.0', () => {
      console.log(`Voice Roos full-stack server running on http://0.0.0.0:${PORT}`);
      console.log(`Live translation WebSocket at ws://0.0.0.0:${PORT + 2}/api/live-translate`);
    });
  }
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
