import React, { useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Save, ArrowRight } from 'lucide-react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { ModelEvaluation, UserProfile } from '../types';
import { SUPPORTED_DIALECTS } from '../i18n/translations';
import { computeWerCer } from '../utils/metrics';

interface WerCerEvaluatorProps {
  userProfile: UserProfile | null;
  isSignedIn: boolean;
  isOnline: boolean;
  evaluations: ModelEvaluation[];
  onRequestSignIn: () => void;
}

const BENCHMARK_CASES = [
  {
    dialect: 'Gondi (गोंडी)',
    model: 'gemini-4-hydrogen',
    ref: 'नावा पोरिया तितोर दाता हनांतोर मर्स एड़',
    hyp: 'नावा पोरिया तितर दाता हनांतोर मर्स एर',
  },
  {
    dialect: 'Tulu (ತುಳು)',
    model: 'gemini-4-hydrogen',
    ref: 'ಯಾನ್ ಇತ್ತೆ ಊರುಗು ಪೋಪೆ ನೀರ್ ಕೊರ್ಲೆ',
    hyp: 'ಯಾನ್ ಇತ್ತೆ ಊರುಗು ಪೋಪೆ ನಿರು ಕೊರ್ಲೆ',
  },
  {
    dialect: 'Garhwali (गढ़वळि)',
    model: 'IndicConformer-v2',
    ref: 'मी आज अपणा गौं जाणु छौं पाणी ल्याणु छौं',
    hyp: 'मी आज अपना गौं जानु छौ पाणी ल्याणु छौं',
  },
  {
    dialect: 'Kui (कुई)',
    model: 'Whisper-v3-LoRA',
    ref: 'आनु नेगी मसी साला मुसी पहाड़ काजु',
    hyp: 'आनु नेगी मसी साला पहाड़ काजू',
  },
];

export const WerCerEvaluator: React.FC<WerCerEvaluatorProps> = ({
  userProfile,
  isSignedIn,
  isOnline,
  evaluations,
  onRequestSignIn,
}) => {
  const [dialect, setDialect] = useState(SUPPORTED_DIALECTS[0].name);
  const [modelName, setModelName] = useState('gemini-4-hydrogen');
  const [referenceText, setReferenceText] = useState(BENCHMARK_CASES[0].ref);
  const [hypothesisText, setHypothesisText] = useState(BENCHMARK_CASES[0].hyp);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState('');

  const metrics = useMemo(
    () => computeWerCer(referenceText, hypothesisText),
    [referenceText, hypothesisText]
  );

  const handleSaveEvaluation = async () => {
    if (!isSignedIn || !userProfile) {
      onRequestSignIn();
      return;
    }
    if (!isOnline) {
      setSavedNote('Reconnect to upload evaluation benchmarks to Firestore.');
      return;
    }
    if (!referenceText.trim() || !hypothesisText.trim()) return;

    setSaving(true);
    setSavedNote('');
    const id = `eval_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'evaluations', id), {
        id,
        ownerId: userProfile.uid,
        dialect: dialect.slice(0, 64),
        modelName: modelName.slice(0, 64),
        referenceText: referenceText.slice(0, 8000),
        hypothesisText: hypothesisText.slice(0, 8000),
        wer: metrics.wer,
        cer: metrics.cer,
        substitutions: metrics.substitutions,
        deletions: metrics.deletions,
        insertions: metrics.insertions,
        referenceWords: Math.max(1, metrics.referenceWords),
        department: userProfile.department.slice(0, 80),
        createdAt: serverTimestamp(),
      });
      setSavedNote(`Benchmark saved (${metrics.wer}% WER / ${metrics.cer}% CER).`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `evaluations/${id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
              Speech-to-Text Model Quality & Levenshtein Edit Distance
            </p>
            <h2 className="mt-1 text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
              WER & CER Acoustic Evaluation Bench
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {BENCHMARK_CASES.map((sample, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setDialect(sample.dialect);
                  setModelName(sample.model);
                  setReferenceText(sample.ref);
                  setHypothesisText(sample.hyp);
                }}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                {sample.dialect.split('(')[0].trim()} Sample
              </button>
            ))}
          </div>
        </div>

        {/* KPI Metric Strip */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Word Error Rate</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-orange-700 dark:text-orange-400">
              {metrics.wer}%
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Character Error Rate</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {metrics.cer}%
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Substitutions (S)</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-amber-700 dark:text-amber-400">
              {metrics.substitutions}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Deletions (D)</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-red-700 dark:text-red-400">
              {metrics.deletions}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Insertions (I)</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-sky-700 dark:text-sky-400">
              {metrics.insertions}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Reference Words (N)</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {metrics.referenceWords}
            </div>
          </div>
        </div>

        {/* Inputs */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Target Dialect
            </label>
            <select
              value={dialect}
              onChange={(e) => setDialect(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
            >
              {SUPPORTED_DIALECTS.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              ASR Model Under Evaluation
            </label>
            <select
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
            >
              <option value="gemini-4-hydrogen">gemini-4-hydrogen (Multimodal Audio ASR)</option>
              <option value="IndicConformer-v2">IndicConformer-v2 (Edge)</option>
              <option value="Whisper-v3-LoRA">Whisper-v3-LoRA (Dialect Adapted)</option>
              <option value="Offline-Local-Pack">Offline Local Acoustic Pack</option>
            </select>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Ground-Truth Reference Transcript
            </label>
            <textarea
              rows={4}
              value={referenceText}
              onChange={(e) => setReferenceText(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Model Hypothesis Transcript
            </label>
            <textarea
              rows={4}
              value={hypothesisText}
              onChange={(e) => setHypothesisText(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
            />
          </div>
        </div>

        {/* Word-Level Alignment Diff */}
        <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Word-by-Word Levenshtein Alignment
            </h3>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
              <span>Match</span>
              <span aria-hidden="true">·</span>
              <span className="text-amber-700 dark:text-amber-400 font-medium">Substitution (SUB)</span>
              <span aria-hidden="true">·</span>
              <span className="text-red-700 dark:text-red-400 font-medium">Deletion (DEL)</span>
              <span aria-hidden="true">·</span>
              <span className="text-sky-700 dark:text-sky-400 font-medium">Insertion (INS)</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {metrics.alignment.map((tok, i) => (
              <div
                key={i}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono ${
                  tok.op === 'match'
                    ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200'
                    : tok.op === 'sub'
                    ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200'
                    : tok.op === 'del'
                    ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-900 dark:text-red-200'
                    : 'border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200'
                }`}
              >
                {tok.op === 'match' && <span>{tok.refWord}</span>}
                {tok.op === 'sub' && (
                  <span className="inline-flex items-center gap-1">
                    <span className="line-through opacity-70">{tok.refWord}</span>
                    <ArrowRight className="w-3 h-3" />
                    <strong>{tok.hypWord}</strong>
                    <span className="text-[10px] opacity-75">(SUB)</span>
                  </span>
                )}
                {tok.op === 'del' && (
                  <span>
                    <span className="line-through">{tok.refWord}</span> (DEL)
                  </span>
                )}
                {tok.op === 'ins' && (
                  <span>
                    +{tok.hypWord} (INS)
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={handleSaveEvaluation}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity min-h-[44px]"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving Benchmark...' : 'Record Benchmark to Firestore'}
          </button>

          {savedNote && (
            <span className="inline-flex items-center gap-1.5 text-sm text-teal-700 dark:text-teal-400">
              <CheckCircle2 className="w-4 h-4" />
              {savedNote}
            </span>
          )}
        </div>
      </div>

      {/* Saved Evaluations History */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-orange-700 dark:text-orange-400" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Recorded WER & CER Evaluations
            </h3>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {evaluations.length} benchmark runs
          </span>
        </div>

        {evaluations.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
            No saved evaluations yet. Run an evaluation above and click Record Benchmark to track model accuracy over time.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-4">Dialect</th>
                  <th className="py-2.5 pr-4">ASR Model</th>
                  <th className="py-2.5 pr-4 text-right">WER</th>
                  <th className="py-2.5 pr-4 text-right">CER</th>
                  <th className="py-2.5 pr-4 text-right">S / D / I</th>
                  <th className="py-2.5 text-right">Words</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {evaluations.map((ev) => (
                  <tr key={ev.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 pr-4 font-medium text-slate-900 dark:text-white">{ev.dialect}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-600 dark:text-slate-300">{ev.modelName}</td>
                    <td className="py-3 pr-4 text-right font-mono tabular-nums font-semibold text-orange-700 dark:text-orange-400">
                      {ev.wer}%
                    </td>
                    <td className="py-3 pr-4 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {ev.cer}%
                    </td>
                    <td className="py-3 pr-4 text-right font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                      {ev.substitutions} / {ev.deletions} / {ev.insertions}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {ev.referenceWords}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
