import React, { useMemo, useState } from 'react';
import { Search, Lock, Unlock, Download, CheckCircle2, Trash2 } from 'lucide-react';
import { doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { DialectTranscript, UserProfile } from '../types';
import { SUPPORTED_DIALECTS } from '../i18n/translations';
import { decryptPayload } from '../utils/crypto';
import { triggerDownload, type ExportFormat } from '../utils/exporters';

interface CorpusLibraryProps {
  transcripts: DialectTranscript[];
  userProfile: UserProfile | null;
  vaultPassphrase: string;
}

export const CorpusLibrary: React.FC<CorpusLibraryProps> = ({
  transcripts,
  userProfile,
  vaultPassphrase,
}) => {
  const [search, setSearch] = useState('');
  const [dialectFilter, setDialectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [decryptedMap, setDecryptedMap] = useState<
    Record<string, { sourceTranscript: string; translatedText: string; grammarNotes: string }>
  >({});
  const [errorMsg, setErrorMsg] = useState('');

  const canVerify = userProfile?.role === 'admin' || userProfile?.role === 'reviewer' || userProfile?.role === 'lead';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transcripts.filter((item) => {
      if (dialectFilter !== 'all' && !item.sourceDialect.toLowerCase().includes(dialectFilter.toLowerCase())) {
        return false;
      }
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.sourceDialect.toLowerCase().includes(q) ||
        item.translatedText.toLowerCase().includes(q) ||
        item.sourceTranscript.toLowerCase().includes(q)
      );
    });
  }, [transcripts, search, dialectFilter, statusFilter]);

  const handleDecrypt = async (item: DialectTranscript) => {
    setErrorMsg('');
    if (!vaultPassphrase.trim()) {
      setErrorMsg('Enter your AES-256-GCM Vault Passphrase in Settings to unlock encrypted transcripts.');
      return;
    }
    try {
      const dec = await decryptPayload<{
        sourceTranscript: string;
        translatedText: string;
        grammarNotes: string;
      }>(item.encryptedPayload, vaultPassphrase);
      setDecryptedMap((prev) => ({ ...prev, [item.id]: dec }));
    } catch {
      setErrorMsg(`Decryption failed for "${item.title}". Verify your Vault Passphrase in Settings.`);
    }
  };

  const handleVerify = async (item: DialectTranscript) => {
    if (!userProfile) return;
    try {
      await updateDoc(doc(db, 'transcripts', item.id), {
        status: 'verified',
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `transcripts/${item.id}`);
    }
  };

  const handleDelete = async (item: DialectTranscript) => {
    try {
      await deleteDoc(doc(db, 'transcripts', item.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `transcripts/${item.id}`);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
              Verified Dialect Corpus & Field Archive
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Search transcriptions, unlock AES-256-GCM encrypted interviews, verify linguistic accuracy, and export in multiple formats.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dialect or transcript..."
                className="h-10 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 w-56"
              />
            </div>

            <select
              value={dialectFilter}
              onChange={(e) => setDialectFilter(e.target.value)}
              className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-slate-200"
            >
              <option value="all">All Dialects</option>
              {SUPPORTED_DIALECTS.map((d) => (
                <option key={d.id} value={d.name.split('(')[0].trim()}>
                  {d.name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-slate-200"
            >
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="pending_review">Pending Review</option>
              <option value="verified">Verified</option>
            </select>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {errorMsg}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No dialect records match your filter. Record or upload audio in the Studio to populate the corpus.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((item) => {
            const dec = decryptedMap[item.id];
            const displaySource = dec ? dec.sourceTranscript : item.sourceTranscript;
            const displayTranslation = dec ? dec.translatedText : item.translatedText;
            const displayGrammar = dec ? dec.grammarNotes : item.grammarNotes;
            const isOwner = userProfile?.uid === item.ownerId;

            return (
              <article
                key={item.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-medium text-orange-700 dark:text-orange-400">
                        {item.sourceDialect}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{item.targetLanguage}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.department}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        WER {item.wer}% / CER {item.cer}%
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {item.status === 'verified'
                          ? 'Verified'
                          : item.status === 'pending_review'
                          ? 'Pending Review'
                          : 'Draft'}
                      </span>
                    </div>
                    <h3 className="mt-1.5 text-lg font-semibold text-slate-900 dark:text-white">
                      {item.title}
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {item.isEncrypted && !dec && (
                      <button
                        type="button"
                        onClick={() => handleDecrypt(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-600/40 bg-orange-50 dark:bg-orange-950/40 text-xs font-medium text-orange-800 dark:text-orange-300 min-h-[36px]"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        Decrypt Entry
                      </button>
                    )}
                    {item.isEncrypted && dec && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-400">
                        <Unlock className="w-3.5 h-3.5" />
                        Unlocked
                      </span>
                    )}
                    {canVerify && item.status !== 'verified' && userProfile?.role === 'admin' && (
                      <button
                        type="button"
                        onClick={() => handleVerify(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium min-h-[36px]"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Verify
                      </button>
                    )}
                    {(isOwner && item.status !== 'verified') || userProfile?.role === 'admin' ? (
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        aria-label="Delete transcript"
                        className="inline-flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600 hover:border-red-300 transition-colors min-h-[36px] min-w-[36px]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3.5 border border-slate-100 dark:border-slate-800">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Dialect Transcript
                    </div>
                    <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed">
                      {displaySource}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3.5 border border-slate-100 dark:border-slate-800">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Translated Output
                    </div>
                    <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed">
                      {displayTranslation}
                    </p>
                  </div>
                </div>

                {displayGrammar && (
                  <p className="mt-3 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    <strong className="text-slate-800 dark:text-slate-200">Grammar & Phonetics:</strong>{' '}
                    {item.phoneticIpa ? `${item.phoneticIpa} — ` : ''}
                    {displayGrammar}
                  </p>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Contributor: {item.ownerName} · {item.audioDurationSec}s audio
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['txt', 'json', 'srt', 'vtt', 'csv'] as ExportFormat[]).map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() =>
                          triggerDownload(
                            {
                              ...item,
                              sourceTranscript: displaySource,
                              translatedText: displayTranslation,
                              grammarNotes: displayGrammar,
                            },
                            fmt
                          )
                        }
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-mono uppercase text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Download className="w-3 h-3" />
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
