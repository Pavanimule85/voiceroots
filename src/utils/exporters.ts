import type { DialectTranscript } from '../types';

export type ExportFormat = 'txt' | 'json' | 'srt' | 'vtt' | 'csv';

function padTime(seconds: number, separator: ',' | '.'): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(ms).padStart(3, '0')}`;
}

function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?।॥])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text.trim() || ''];
}

export function buildExportContent(item: Pick<
  DialectTranscript,
  | 'title'
  | 'sourceDialect'
  | 'targetLanguage'
  | 'sourceTranscript'
  | 'translatedText'
  | 'phoneticIpa'
  | 'grammarNotes'
  | 'wer'
  | 'cer'
  | 'audioDurationSec'
  | 'department'
>, format: ExportFormat): { content: string; mimeType: string; extension: string } {
  const duration = Math.max(4, item.audioDurationSec || 12);

  if (format === 'json') {
    return {
      content: JSON.stringify(
        {
          title: item.title,
          sourceDialect: item.sourceDialect,
          targetLanguage: item.targetLanguage,
          department: item.department,
          audioDurationSec: item.audioDurationSec,
          sourceTranscript: item.sourceTranscript,
          translatedText: item.translatedText,
          phoneticIpa: item.phoneticIpa,
          grammarNotes: item.grammarNotes,
          metrics: {
            werPercent: item.wer,
            cerPercent: item.cer,
          },
          exportedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      mimeType: 'application/json;charset=utf-8',
      extension: 'json',
    };
  }

  if (format === 'csv') {
    const esc = (val: string | number) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const headers = [
      'Title',
      'Source Dialect',
      'Target Language',
      'Department',
      'Duration (s)',
      'WER (%)',
      'CER (%)',
      'Source Transcript',
      'Translation',
      'Phonetic IPA',
      'Grammar Notes',
    ];
    const row = [
      item.title,
      item.sourceDialect,
      item.targetLanguage,
      item.department,
      item.audioDurationSec,
      item.wer,
      item.cer,
      item.sourceTranscript,
      item.translatedText,
      item.phoneticIpa,
      item.grammarNotes,
    ].map(esc);

    return {
      content: '\uFEFF' + headers.join(',') + '\n' + row.join(',') + '\n',
      mimeType: 'text/csv;charset=utf-8',
      extension: 'csv',
    };
  }

  if (format === 'srt' || format === 'vtt') {
    const sourceLines = splitSentences(item.sourceTranscript);
    const transLines = splitSentences(item.translatedText);
    const count = Math.max(sourceLines.length, transLines.length);
    const step = duration / count;
    const sep = format === 'srt' ? ',' : '.';
    const blocks: string[] = [];

    for (let i = 0; i < count; i++) {
      const start = padTime(i * step, sep);
      const end = padTime((i + 1) * step, sep);
      const src = sourceLines[i] || '';
      const trn = transLines[i] || '';
      const text = [src, trn].filter(Boolean).join('\n');
      if (format === 'srt') {
        blocks.push(`${i + 1}\n${start} --> ${end}\n${text}`);
      } else {
        blocks.push(`${start} --> ${end}\n${text}`);
      }
    }

    const body = format === 'vtt' ? `WEBVTT\n\n${blocks.join('\n\n')}\n` : `${blocks.join('\n\n')}\n`;
    return {
      content: body,
      mimeType: format === 'vtt' ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8',
      extension: format,
    };
  }

  // TXT default
  const txt = [
    `Title: ${item.title}`,
    `Source Dialect: ${item.sourceDialect}`,
    `Target Language: ${item.targetLanguage}`,
    `Department: ${item.department}`,
    `Duration: ${item.audioDurationSec}s | WER: ${item.wer}% | CER: ${item.cer}%`,
    '',
    '--- SOURCE DIALECT TRANSCRIPT ---',
    item.sourceTranscript,
    '',
    '--- TRANSLATED OUTPUT ---',
    item.translatedText,
    '',
    '--- PHONETIC IPA & PRONUNCIATION ---',
    item.phoneticIpa,
    '',
    '--- GRAMMAR & MORPHOLOGY NOTES ---',
    item.grammarNotes,
    '',
  ].join('\n');

  return {
    content: '\uFEFF' + txt,
    mimeType: 'text/plain;charset=utf-8',
    extension: 'txt',
  };
}

export function triggerDownload(
  item: Parameters<typeof buildExportContent>[0],
  format: ExportFormat
) {
  const { content, mimeType, extension } = buildExportContent(item, format);
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const safeName = (item.title || 'dialect-transcript')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName || 'transcript'}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
