import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  Square,
  Upload,
  Type as TypeIcon,
  Languages,
  Volume2,
  Lock,
  Unlock,
  Download,
  CloudUpload,
  CheckCircle2,
  WifiOff,
  HardDriveDownload,
  Trash2,
  Sparkles,
  FileAudio,
  AlertCircle,
} from 'lucide-react';
import { doc, setDoc, serverTimestamp, updateDoc, increment } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { UserProfile, OfflineQueueItem, LocaleCode } from '../types';
import { SUPPORTED_DIALECTS, TARGET_LANGUAGES, UI_STRINGS } from '../i18n/translations';
import { computeWerCer } from '../utils/metrics';
import { encryptPayload } from '../utils/crypto';
import { triggerDownload, type ExportFormat } from '../utils/exporters';
import { enqueueOfflineItem } from '../utils/offlineSync';
import {
  type LanguagePack,
  downloadLanguagePack,
  removeLanguagePack,
  runOfflineAudioTranscription,
  runOfflineTranslation,
} from '../utils/languagePacks';

interface DialectStudioProps {
  userProfile: UserProfile | null;
  isSignedIn: boolean;
  isOnline: boolean;
  locale: LocaleCode;
  downloadedPacks: LanguagePack[];
  onPacksChanged: () => Promise<void>;
  onQueueChanged: () => Promise<void>;
  vaultPassphrase: string;
  onRequestSignIn: () => void;
  onSavedTranscript?: () => void;
}

type InputMethod = 'record' | 'upload' | 'text' | 'live';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const base64 = res.includes(',') ? res.split(',')[1] : res;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export const DialectStudio: React.FC<DialectStudioProps> = ({
  userProfile,
  isSignedIn,
  isOnline,
  locale,
  downloadedPacks,
  onPacksChanged,
  onQueueChanged,
  vaultPassphrase,
  onRequestSignIn,
  onSavedTranscript,
}) => {
  const t = UI_STRINGS[locale] || UI_STRINGS.en;

  const [inputMethod, setInputMethod] = useState<InputMethod>('record');
  const [selectedDialectId, setSelectedDialectId] = useState<string>(SUPPORTED_DIALECTS[0].id);
  const [targetLanguage, setTargetLanguage] = useState<string>(TARGET_LANGUAGES[0]);
  const [title, setTitle] = useState<string>('Gondi Village Oral Narrative');

  // Audio recording & upload states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [audioSourceType, setAudioSourceType] = useState<'recorded' | 'uploaded' | 'text'>('recorded');
  const [liveSpeechPreview, setLiveSpeechPreview] = useState('');

  // Linguistic results
  const [sourceTranscript, setSourceTranscript] = useState(SUPPORTED_DIALECTS[0].samplePhrase);
  const [referenceTranscript, setReferenceTranscript] = useState(SUPPORTED_DIALECTS[0].sampleRef);
  const [translatedText, setTranslatedText] = useState('');
  const [phoneticIpa, setPhoneticIpa] = useState('');
  const [grammarNotes, setGrammarNotes] = useState('');
  const [modelTag, setModelTag] = useState('');

  // Security & Visibility
  const [encryptOnSave, setEncryptOnSave] = useState(false);
  const [visibility, setVisibility] = useState<'private' | 'archive'>('archive');

  // UI states
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  // Live translation WebSocket state
  const wsRef = useRef<WebSocket | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [liveTranslation, setLiveTranslation] = useState('');
  const [liveIsFinal, setLiveIsFinal] = useState(false);

  const activeDialect = SUPPORTED_DIALECTS.find((d) => d.id === selectedDialectId) || SUPPORTED_DIALECTS[0];
  const installedPack = downloadedPacks.find((p) => p.dialectId === selectedDialectId) || null;

  const werMetrics = computeWerCer(
    referenceTranscript.trim() || sourceTranscript.trim(),
    sourceTranscript.trim()
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((tr) => tr.stop());
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const handleMethodChange = (method: InputMethod) => {
    setInputMethod(method);
    setStatusBanner(null);
    if (method === 'text') {
      setAudioSourceType('text');
    } else if (method === 'upload') {
      setAudioSourceType('uploaded');
    } else if (method === 'live') {
      setAudioSourceType('recorded');
    } else {
      setAudioSourceType('recorded');
    }
  };

  const startLiveTranslation = async () => {
    setStatusBanner(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;

      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:${Number(window.location.port) + 2}/api/live-translate`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'start',
          dialect: activeDialect.name,
          targetLanguage,
        }));
        setIsLiveMode(true);
        setLiveTranscript('');
        setLiveTranslation('');
        setLiveIsFinal(false);
        setStatusBanner({ type: 'success', text: 'Live translation session started. Speak now.' });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'result') {
            setLiveTranscript(msg.transcript || '');
            setLiveTranslation(msg.translation || '');
            setLiveIsFinal(msg.isFinal || false);
          } else if (msg.type === 'error') {
            setStatusBanner({ type: 'error', text: msg.error || 'Live translation error' });
          } else if (msg.type === 'started') {
            // Session started
          } else if (msg.type === 'stopped') {
            setIsLiveMode(false);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        setStatusBanner({ type: 'error', text: 'WebSocket connection error' });
      };

      ws.onclose = () => {
        setIsLiveMode(false);
        wsRef.current = null;
      };

      // Send audio chunks
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            ws.send(JSON.stringify({
              type: 'audio',
              data: base64,
              mimeType: 'audio/webm;codecs=opus',
            }));
          };
          reader.readAsDataURL(e.data);
        }
      };
      recorder.onstop = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop' }));
        }
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;

      setIsRecording(true);
      setRecordingSec(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSec((prev) => prev + 1);
      }, 1000);

      drawWaveform();
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? `Microphone access error: ${err.message}` : 'Unable to access microphone.',
      });
    }
  };

  const stopLiveTranslation = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopRecording();
    setIsLiveMode(false);
  };

  const handleDialectChange = (newId: string) => {
    setSelectedDialectId(newId);
    const info = SUPPORTED_DIALECTS.find((d) => d.id === newId);
    if (info) {
      setTitle(`${info.name.split('(')[0].trim()} Field Session`);
      if (!audioBlob) {
        setSourceTranscript(info.samplePhrase);
        setReferenceTranscript(info.sampleRef);
      }
    }
  };

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const renderFrame = () => {
      if (!analyserRef.current) return;
      animFrameRef.current = requestAnimationFrame(renderFrame);
      analyser.getByteTimeDomainData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#EA580C';
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };
    renderFrame();
  };

  const startRecording = async () => {
    setStatusBanner(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        setAudioSourceType('recorded');
        setUploadedFileName('');
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(blob));
      };

      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSec(0);
      setLiveSpeechPreview('');

      timerRef.current = window.setInterval(() => {
        setRecordingSec((prev) => prev + 1);
      }, 1000);

      drawWaveform();

      const SpeechRec =
        (window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
      if (typeof SpeechRec === 'function') {
        try {
          const rec = new (SpeechRec as new () => {
            continuous: boolean;
            interimResults: boolean;
            lang: string;
            onresult: (ev: { results: ArrayLike<{ 0: { transcript: string } }> }) => void;
            onerror: () => void;
            start: () => void;
            stop: () => void;
          })();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'hi-IN';
          rec.onresult = (ev) => {
            let text = '';
            for (let i = 0; i < ev.results.length; i++) {
              text += ev.results[i][0].transcript + ' ';
            }
            setLiveSpeechPreview(text.trim());
          };
          rec.onerror = () => {};
          rec.start();
          recognitionRef.current = rec;
        } catch {
          // SpeechRecognition unsupported
        }
      }
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? `Microphone access error: ${err.message}` : 'Unable to access microphone.',
      });
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setIsRecording(false);
  };

  const processSelectedFile = (file: File) => {
    setStatusBanner(null);
    setAudioBlob(file);
    setAudioSourceType('uploaded');
    setUploadedFileName(file.name);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setTitle(file.name.replace(/\.[^/.]+$/, ''));

    const audioEl = new Audio(url);
    audioEl.onloadedmetadata = () => {
      if (Number.isFinite(audioEl.duration)) {
        setRecordingSec(Math.round(audioEl.duration));
      }
    };
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processSelectedFile(file);
  };

  const handleFileDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      processSelectedFile(file);
    }
  };

  const handleTogglePack = async () => {
    setPackBusy(true);
    try {
      if (installedPack) {
        await removeLanguagePack(selectedDialectId);
        setStatusBanner({ type: 'info', text: `Removed offline language pack for ${activeDialect.name}.` });
      } else {
        const pack = await downloadLanguagePack(selectedDialectId);
        setStatusBanner({
          type: 'success',
          text: `Downloaded ${pack.dialectName} offline pack (${pack.sizeKb} KB) to local IndexedDB.`,
        });
      }
      await onPacksChanged();
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update offline language pack.',
      });
    } finally {
      setPackBusy(false);
    }
  };

  const handleTranscribeAndTranslate = async () => {
    if (!audioBlob) {
      setStatusBanner({
        type: 'error',
        text: inputMethod === 'upload'
          ? 'Please select or drop an audio file first.'
          : 'Please record an audio clip first.',
      });
      return;
    }
    setIsProcessing(true);
    setStatusBanner(null);

    try {
      if (!isOnline) {
        if (!installedPack) {
          throw new Error(
            `You are currently offline and no local pack is installed for ${activeDialect.name}. Reconnect or install a language pack first.`
          );
        }
        const localRes = runOfflineAudioTranscription(installedPack, liveSpeechPreview, targetLanguage);
        setSourceTranscript(localRes.sourceTranscript);
        setTranslatedText(localRes.translatedText);
        setPhoneticIpa(localRes.phoneticIpa);
        setGrammarNotes(localRes.grammarSuggestions);
        setModelTag(`Offline Local Pack (${installedPack.iso} v${installedPack.version})`);

        const audioBase64 = await blobToBase64(audioBlob);
        const queueItem: OfflineQueueItem = {
          id: `offline_${Date.now()}`,
          title: title.trim() || `${activeDialect.name} Field Capture`,
          sourceDialect: activeDialect.name,
          targetLanguage,
          department: userProfile?.department || activeDialect.department,
          audioBase64,
          mimeType: audioBlob.type || 'audio/webm',
          audioDurationSec: recordingSec || 6,
          sourceType: audioSourceType,
          sourceTranscript: localRes.sourceTranscript,
          translatedText: localRes.translatedText,
          phoneticIpa: localRes.phoneticIpa,
          grammarNotes: localRes.grammarSuggestions,
          referenceTranscript: referenceTranscript.trim() || localRes.sourceTranscript,
          isEncrypted: encryptOnSave,
          encryptedPayload: '',
          createdAtIso: new Date().toISOString(),
          syncStatus: 'pending',
        };
        if (encryptOnSave && vaultPassphrase) {
          queueItem.encryptedPayload = await encryptPayload(
            {
              sourceTranscript: localRes.sourceTranscript,
              translatedText: localRes.translatedText,
              grammarNotes: localRes.grammarSuggestions,
            },
            vaultPassphrase
          );
        }
        await enqueueOfflineItem(queueItem);
        await onQueueChanged();
        setStatusBanner({
          type: 'info',
          text: 'Transcribed & translated locally using your downloaded dialect pack. Queued for cloud synchronization on reconnect.',
        });
        return;
      }

      const base64Audio = await blobToBase64(audioBlob);
      setStatusBanner({ type: 'info', text: 'Sending audio to Gemini server for transcription...' });
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64Audio,
          mimeType: audioBlob.type || 'audio/webm',
          sourceDialect: activeDialect.name,
          targetLanguage,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Server transcription failed.');
      }

      setSourceTranscript(data.sourceTranscript || '');
      setTranslatedText(data.translatedText || '');
      setPhoneticIpa(data.phoneticIpa || '');
      setGrammarNotes(data.grammarSuggestions || '');
      setModelTag(data.modelUsed || 'gemini-4-hydrogen');
      setStatusBanner({
        type: 'success',
        text: `Transcribed & translated: ${data.sourceTranscript?.slice(0, 60)} → ${data.translatedText?.slice(0, 60)}`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Audio processing failed.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTranslateText = async () => {
    if (!sourceTranscript.trim()) {
      setStatusBanner({ type: 'error', text: 'Enter dialect text before translating.' });
      return;
    }
    setIsProcessing(true);
    setStatusBanner(null);

    try {
      if (!isOnline) {
        if (!installedPack) {
          throw new Error(
            `Offline translation requires downloading the ${activeDialect.name} language pack first.`
          );
        }
        const localRes = runOfflineTranslation(sourceTranscript, installedPack, targetLanguage);
        setTranslatedText(localRes.translatedText);
        setPhoneticIpa(localRes.phoneticIpa);
        setGrammarNotes(localRes.grammarSuggestions);
        setModelTag(`Offline Pack (${installedPack.iso} v${installedPack.version})`);
        setStatusBanner({
          type: 'info',
          text: `Translated offline using downloaded ${installedPack.dialectName} pack.`,
        });
        return;
      }

      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sourceTranscript,
          sourceDialect: activeDialect.name,
          targetLanguage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Translation failed.');

      setTranslatedText(data.translatedText || '');
      setPhoneticIpa(data.phoneticIpa || '');
      setGrammarNotes(data.grammarSuggestions || '');
      setModelTag(data.modelUsed || 'gemini-4-hydrogen');
      setStatusBanner({ type: 'success', text: `Translated ${activeDialect.name} to ${targetLanguage}.` });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Translation failed.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSpeakTranslation = async () => {
    if (!translatedText.trim()) return;
    if (!isOnline) {
      if ('speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(translatedText);
        window.speechSynthesis.speak(utter);
      }
      return;
    }
    setIsSpeaking(true);
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: translatedText, language: targetLanguage }),
      });
      const data = await res.json();
      if (data.fallbackSpeechSynthesis || !data.audioBase64) {
        if ('speechSynthesis' in window) {
          const utter = new SpeechSynthesisUtterance(translatedText);
          utter.onend = () => setIsSpeaking(false);
          window.speechSynthesis.speak(utter);
          return;
        }
        throw new Error(data.error || 'Speech synthesis unavailable.');
      }
      const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
      audio.onended = () => setIsSpeaking(false);
      await audio.play();
    } catch (err) {
      setIsSpeaking(false);
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to play synthesized audio.',
      });
    }
  };

  const handleSaveToCorpus = async () => {
    if (!sourceTranscript.trim() && !translatedText.trim()) {
      setStatusBanner({ type: 'error', text: 'Generate a transcript or translation before saving.' });
      return;
    }

    if (!isOnline) {
      const queueItem: OfflineQueueItem = {
        id: `offline_${Date.now()}`,
        title: title.trim() || `${activeDialect.name} Field Entry`,
        sourceDialect: activeDialect.name,
        targetLanguage,
        department: userProfile?.department || activeDialect.department,
        audioDurationSec: recordingSec || 8,
        sourceType: audioSourceType,
        sourceTranscript: sourceTranscript.slice(0, 12000),
        translatedText: translatedText.slice(0, 12000),
        phoneticIpa: phoneticIpa.slice(0, 6000),
        grammarNotes: grammarNotes.slice(0, 4000),
        referenceTranscript: (referenceTranscript || sourceTranscript).slice(0, 12000),
        isEncrypted: encryptOnSave,
        encryptedPayload: '',
        createdAtIso: new Date().toISOString(),
        syncStatus: 'pending',
      };
      if (encryptOnSave && vaultPassphrase) {
        queueItem.encryptedPayload = await encryptPayload(
          {
            sourceTranscript: queueItem.sourceTranscript,
            translatedText: queueItem.translatedText,
            grammarNotes: queueItem.grammarNotes,
          },
          vaultPassphrase
        );
      }
      await enqueueOfflineItem(queueItem);
      await onQueueChanged();
      setStatusBanner({
        type: 'info',
        text: 'Saved to Encrypted Offline Sync Queue. It will upload to Cloud Corpus when online.',
      });
      return;
    }

    if (!isSignedIn || !userProfile) {
      onRequestSignIn();
      return;
    }

    if (encryptOnSave && !vaultPassphrase.trim()) {
      setStatusBanner({
        type: 'error',
        text: 'Set an AES-256-GCM encryption passphrase in Settings before saving encrypted entries.',
      });
      return;
    }

    setIsSaving(true);
    setStatusBanner(null);
    const id = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const path = `transcripts/${id}`;

    try {
      let encryptedPayload = '';
      let storedSource = sourceTranscript.slice(0, 12000);
      let storedTranslation = translatedText.slice(0, 12000);
      let storedGrammar = grammarNotes.slice(0, 4000);

      if (encryptOnSave && vaultPassphrase) {
        encryptedPayload = await encryptPayload(
          {
            sourceTranscript: storedSource,
            translatedText: storedTranslation,
            grammarNotes: storedGrammar,
          },
          vaultPassphrase
        );
        storedSource = '[AES-256-GCM Encrypted Dialect Transcript]';
        storedTranslation = '[AES-256-GCM Encrypted Translation]';
        storedGrammar = '[Encrypted]';
      }

      await setDoc(doc(db, 'transcripts', id), {
        id,
        ownerId: userProfile.uid,
        ownerName: userProfile.displayName.slice(0, 100),
        department: userProfile.department.slice(0, 80),
        sourceDialect: activeDialect.name.slice(0, 64),
        targetLanguage: targetLanguage.slice(0, 64),
        title: (title.trim() || `${activeDialect.name} Session`).slice(0, 160),
        sourceTranscript: storedSource,
        translatedText: storedTranslation,
        phoneticIpa: phoneticIpa.slice(0, 6000),
        grammarNotes: storedGrammar,
        referenceTranscript: (referenceTranscript || sourceTranscript).slice(0, 12000),
        wer: werMetrics.wer,
        cer: werMetrics.cer,
        audioDurationSec: Math.min(7200, Math.max(0, recordingSec || 8)),
        sourceType: audioSourceType,
        isEncrypted: encryptOnSave,
        encryptedPayload: encryptedPayload.slice(0, 24000),
        status: 'pending_review',
        visibility: encryptOnSave ? 'private' : visibility,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'users', userProfile.uid), {
        totalRecordings: increment(1),
        updatedAt: serverTimestamp(),
      });

      if (werMetrics.wer > 25) {
        const notifId = `nt_${Date.now()}`;
        await setDoc(doc(db, 'notifications', notifId), {
          id: notifId,
          recipientId: userProfile.uid,
          createdBy: userProfile.uid,
          title: `High WER Alert (${werMetrics.wer}%) — ${activeDialect.name}`,
          message: `Session "${title}" recorded WER ${werMetrics.wer}% and CER ${werMetrics.cer}%. Review acoustic clarity or dialect lexicon coverage.`,
          severity: 'warning',
          category: 'wer-alert',
          read: false,
          createdAt: serverTimestamp(),
        });
      }

      setStatusBanner({
        type: 'success',
        text: 'Saved to Cloud Corpus with Firestore offline sync & WER/CER telemetry.',
      });
      onSavedTranscript?.();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExport = (format: ExportFormat) => {
    triggerDownload(
      {
        title: title || `${activeDialect.name} Session`,
        sourceDialect: activeDialect.name,
        targetLanguage,
        department: userProfile?.department || activeDialect.department,
        audioDurationSec: recordingSec || 12,
        sourceTranscript,
        translatedText,
        phoneticIpa,
        grammarNotes,
        wer: werMetrics.wer,
        cer: werMetrics.cer,
      },
      format
    );
  };

  return (
    <div className="space-y-6">
      {/* Studio Workspace Header & Input Method Tabs */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
              {activeDialect.family} · ISO {activeDialect.iso} · {activeDialect.region}
            </p>
            <h2 className="mt-1 text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
              Transcription & Dialect Translation Studio
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={packBusy}
              onClick={handleTogglePack}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[44px] border ${
                installedPack
                  ? 'border-teal-600/30 bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60'
                  : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              {installedPack ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                  <span>Offline Pack Installed ({installedPack.sizeKb} KB)</span>
                  <Trash2 className="w-3.5 h-3.5 ml-1 opacity-70" />
                </>
              ) : (
                <>
                  <HardDriveDownload className="w-4 h-4" />
                  <span>Download Offline Pack ({activeDialect.iso})</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Language & Title Selectors */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Low-Resource Source Dialect
            </label>
            <select
              value={selectedDialectId}
              onChange={(e) => handleDialectChange(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
            >
              {SUPPORTED_DIALECTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.status}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Target Translation Language
            </label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
            >
              {TARGET_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Session Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              placeholder="e.g. Bastar Oral Harvest Song"
              className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
            />
          </div>
        </div>

        {/* 4-Option Input Method Segmented Control (Record Audio | Upload Audio | Live Translation | Text) */}
        <div className="mt-5">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => handleMethodChange('record')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                inputMethod === 'record'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Mic className="w-4 h-4 text-orange-600" />
              <span>{t.recordAudio}</span>
            </button>

            <button
              type="button"
              onClick={() => handleMethodChange('upload')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                inputMethod === 'upload'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Upload className="w-4 h-4 text-orange-600" />
              <span>{t.uploadAudio}</span>
            </button>

            <button
              type="button"
              onClick={() => handleMethodChange('live')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                inputMethod === 'live'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Sparkles className="w-4 h-4 text-orange-600" />
              <span>Live Translation</span>
            </button>

            <button
              type="button"
              onClick={() => handleMethodChange('text')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                inputMethod === 'text'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <TypeIcon className="w-4 h-4 text-orange-600" />
              <span>Text Input</span>
            </button>
          </div>
        </div>

        {/* Mode 1: Record Audio */}
        {inputMethod === 'record' && (
          <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 sm:p-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {!isRecording ? (
                  <button
                    type="button"
                    onClick={startRecording}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-700 hover:bg-orange-800 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
                  >
                    <Mic className="w-4 h-4" />
                    Start Microphone Recording
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
                  >
                    <Square className="w-4 h-4" />
                    {t.stopRecording} ({String(Math.floor(recordingSec / 60)).padStart(2, '0')}:
                    {String(recordingSec % 60).padStart(2, '0')})
                  </button>
                )}

                <button
                  type="button"
                  disabled={isProcessing || !audioBlob || isRecording}
                  onClick={handleTranscribeAndTranslate}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-40 text-sm font-medium transition-opacity whitespace-nowrap shrink-0 min-h-[44px]"
                >
                  <FileAudio className="w-4 h-4" />
                  {isProcessing ? 'Transcribing Recording...' : 'Transcribe & Translate Recording'}
                </button>
              </div>

              <div className="flex items-center gap-3">
                {!isOnline && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <WifiOff className="w-4 h-4" />
                    Offline Local Mode
                  </span>
                )}
                {audioUrl && audioSourceType === 'recorded' && (
                  <audio controls src={audioUrl} className="h-10 max-w-[260px]" />
                )}
              </div>
            </div>

            {isRecording && (
              <div className="mt-4 space-y-2">
                <canvas
                  ref={canvasRef}
                  width={720}
                  height={64}
                  className="w-full h-16 rounded-lg bg-slate-900/5 dark:bg-slate-900"
                />
                {liveSpeechPreview && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                    Live interim caption: {liveSpeechPreview}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Mode 2: Live Translation */}
        {inputMethod === 'live' && (
          <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 sm:p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {!isLiveMode ? (
                  <button
                    type="button"
                    onClick={startLiveTranslation}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
                  >
                    <Sparkles className="w-4 h-4" />
                    Start Live Translation
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopLiveTranslation}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
                  >
                    <Square className="w-4 h-4" />
                    Stop Live Translation ({String(Math.floor(recordingSec / 60)).padStart(2, '0')}:{String(recordingSec % 60).padStart(2, '0')})
                  </button>
                )}

                <div className="flex items-center gap-3">
                  {!isOnline && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                      <WifiOff className="w-4 h-4" />
                      Requires Online Connection
                    </span>
                  )}
                </div>
              </div>
            </div>

            {isLiveMode && (
              <div className="mt-4 space-y-3 p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                    Live Transcript ({activeDialect.name.split('(')[0].trim()})
                  </p>
                  <p className="text-base font-mono text-slate-900 dark:text-white min-h-[2.5rem] break-words">
                    {liveTranscript || (isLiveMode ? 'Listening...' : 'Start live translation to see real-time transcript')}
                  </p>
                  {liveIsFinal && <span className="inline-block mt-1 text-xs text-green-700 dark:text-green-400">✓ Final segment</span>}
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                    Live Translation ({targetLanguage})
                  </p>
                  <p className="text-base font-mono text-slate-900 dark:text-white min-h-[2.5rem] break-words">
                    {liveTranslation || 'Waiting for translation...'}
                  </p>
                </div>
                <canvas
                  ref={canvasRef}
                  width={720}
                  height={64}
                  className="w-full h-16 rounded-lg bg-slate-900/5 dark:bg-slate-900"
                />
              </div>
            )}
          </div>
        )}

        {/* Mode 3: Upload Audio */}
        {inputMethod === 'upload' && (
          <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 sm:p-5 space-y-4">
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 py-7 px-4 text-center cursor-pointer hover:border-orange-600 transition-colors"
            >
              <Upload className="w-6 h-6 text-orange-600 mb-2" />
              <span className="text-sm font-medium text-slate-900 dark:text-white">
                {uploadedFileName ? `Selected: ${uploadedFileName}` : 'Click to choose or drag & drop an audio file'}
              </span>
              <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Supports WAV, MP3, WEBM, M4A, and OGG field recordings
              </span>
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {audioUrl && audioSourceType === 'uploaded' ? (
                <audio controls src={audioUrl} className="h-10 w-full sm:max-w-xs" />
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  No audio file selected yet.
                </span>
              )}

              <button
                type="button"
                disabled={isProcessing || !audioBlob}
                onClick={handleTranscribeAndTranslate}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-40 text-sm font-medium transition-opacity whitespace-nowrap shrink-0 min-h-[44px]"
              >
                <FileAudio className="w-4 h-4" />
                {isProcessing ? 'Transcribing Audio...' : 'Transcribe & Translate Audio File'}
              </button>
            </div>
          </div>
        )}

        {/* Mode 4: Text Input */}
        {inputMethod === 'text' && (
          <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-sm text-slate-700 dark:text-slate-300">
              Type or paste a phrase in <strong className="text-slate-900 dark:text-white">{activeDialect.name}</strong> in the Source Dialect box below, then run translation & grammar analysis.
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSourceTranscript(activeDialect.samplePhrase);
                  setReferenceTranscript(activeDialect.sampleRef);
                }}
                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px]"
              >
                Load Dialect Sample
              </button>
              <button
                type="button"
                disabled={isProcessing || !sourceTranscript.trim()}
                onClick={handleTranslateText}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-700 hover:bg-orange-800 disabled:opacity-40 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <Languages className="w-4 h-4" />
                {isProcessing ? 'Translating...' : t.translateText}
              </button>
            </div>
          </div>
        )}

        {statusBanner && (
          <div
            className={`mt-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${
              statusBanner.type === 'error'
                ? 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200'
                : statusBanner.type === 'info'
                ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200'
                : 'border-teal-200 dark:border-teal-900/60 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-200'
            }`}
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{statusBanner.text}</span>
          </div>
        )}
      </div>

      {/* Dual-Column Transcript + Translation + Phonetics/Grammar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Source Dialect Pane */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 flex flex-col">
          <div className="flex items-center justify-between gap-4 mb-3">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Source Dialect Transcript ({activeDialect.name.split('(')[0].trim()})
            </h3>
            <button
              type="button"
              onClick={() => {
                setSourceTranscript(activeDialect.samplePhrase);
                setReferenceTranscript(activeDialect.sampleRef);
              }}
              className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline whitespace-nowrap shrink-0"
            >
              Load Sample
            </button>
          </div>

          <textarea
            rows={5}
            value={sourceTranscript}
            onChange={(e) => setSourceTranscript(e.target.value)}
            placeholder="Recorded/uploaded audio transcript or typed dialect text appears here..."
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3.5 text-base text-slate-900 dark:text-slate-100 leading-relaxed focus:outline-none focus:ring-2 focus:ring-orange-600"
          />

          <div className="mt-4">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Ground-Truth Reference Transcript (for WER & CER evaluation)
            </label>
            <textarea
              rows={2}
              value={referenceTranscript}
              onChange={(e) => setReferenceTranscript(e.target.value)}
              placeholder="Optional ground-truth reference phrase for WER/CER scoring..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-600"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              disabled={isProcessing || !sourceTranscript.trim()}
              onClick={handleTranslateText}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-700 hover:bg-orange-800 disabled:opacity-40 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
            >
              <Languages className="w-4 h-4" />
              {isProcessing ? 'Translating...' : t.translateText}
            </button>

            <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
              <span>WER: <strong className="text-slate-900 dark:text-white">{werMetrics.wer}%</strong></span>
              <span>CER: <strong className="text-slate-900 dark:text-white">{werMetrics.cer}%</strong></span>
              <span>S:{werMetrics.substitutions} D:{werMetrics.deletions} I:{werMetrics.insertions}</span>
            </div>
          </div>
        </div>

        {/* Target Translation + Phonetic IPA + Grammar Pane */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 flex flex-col">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Translation ({targetLanguage})
              </h3>
              {modelTag && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{modelTag}</p>
              )}
            </div>

            <button
              type="button"
              disabled={!translatedText.trim() || isSpeaking}
              onClick={handleSpeakTranslation}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <Volume2 className="w-4 h-4" />
              {isSpeaking ? 'Speaking...' : 'Listen'}
            </button>
          </div>

          <textarea
            rows={4}
            value={translatedText}
            onChange={(e) => setTranslatedText(e.target.value)}
            placeholder="Translated text will appear here..."
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3.5 text-base text-slate-900 dark:text-slate-100 leading-relaxed focus:outline-none focus:ring-2 focus:ring-orange-600"
          />

          <div className="mt-4 grid grid-cols-1 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Phonetic IPA & Pronunciation
              </div>
              <p className="mt-1 text-sm font-mono text-slate-800 dark:text-slate-200 break-words">
                {phoneticIpa || 'Run transcription or translation to inspect IPA phonetics.'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                <Sparkles className="w-3.5 h-3.5 text-orange-600" />
                Grammar & Morphological Suggestions
              </div>
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                {grammarNotes || 'Morphological case markers, tense suffixes, and preservation notes appear here.'}
              </p>
            </div>
          </div>

          {/* Save, Encrypt & Multi-Format Export Controls */}
          <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setEncryptOnSave((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors min-h-[40px] ${
                  encryptOnSave
                    ? 'border-orange-600/40 bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                {encryptOnSave ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                {encryptOnSave ? 'AES-256 Encrypted' : 'Standard Cloud Save'}
              </button>

              {!encryptOnSave && (
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as 'private' | 'archive')}
                  className="h-10 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-200"
                >
                  <option value="archive">Community Archive</option>
                  <option value="private">Private Field Note</option>
                </select>
              )}

              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveToCorpus}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <CloudUpload className="w-4 h-4" />
                {isSaving ? 'Saving...' : isOnline ? 'Save to Corpus' : 'Queue Offline'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(['txt', 'json', 'srt', 'vtt', 'csv'] as ExportFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => handleExport(fmt)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono uppercase text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-h-[36px]"
                >
                  <Download className="w-3 h-3" />
                  {fmt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
