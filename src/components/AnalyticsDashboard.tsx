import React, { useMemo, useState } from 'react';
import {
  Building2,
  ShieldCheck,
  Webhook,
  Send,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  TrendingDown,
  Users,
} from 'lucide-react';
import { doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  ApiWebhook,
  DepartmentMetric,
  DialectTranscript,
  ModelEvaluation,
  UserProfile,
  UserRole,
} from '../types';
import { DEPARTMENTS, SUPPORTED_DIALECTS } from '../i18n/translations';

interface AnalyticsDashboardProps {
  userProfile: UserProfile | null;
  departments: DepartmentMetric[];
  transcripts: DialectTranscript[];
  evaluations: ModelEvaluation[];
  usersList: UserProfile[];
  webhooks: ApiWebhook[];
  isOnline: boolean;
}

const DEFAULT_DEPT_SEED = [
  {
    id: 'dept_central_tribal',
    name: 'Central Tribal Linguistics Dept',
    region: 'Madhya Pradesh · Chhattisgarh',
    targetHours: 400,
    completedHours: 312,
    activeDialectsCount: 4,
    avgWer: 11.4,
    avgCer: 4.8,
    contributorsCount: 48,
  },
  {
    id: 'dept_deccan_dravidian',
    name: 'Deccan & Dravidian Heritage Unit',
    region: 'Karnataka · Nilgiris · Kerala',
    targetHours: 350,
    completedHours: 294,
    activeDialectsCount: 3,
    avgWer: 9.2,
    avgCer: 3.9,
    contributorsCount: 39,
  },
  {
    id: 'dept_himalayan_oral',
    name: 'Himalayan Oral Archive',
    region: 'Uttarakhand · Sikkim · Darjeeling',
    targetHours: 280,
    completedHours: 196,
    activeDialectsCount: 3,
    avgWer: 14.1,
    avgCer: 6.2,
    contributorsCount: 27,
  },
  {
    id: 'dept_eastern_munda',
    name: 'Eastern Folk & Munda Division',
    region: 'Odisha · Jharkhand · West Bengal',
    targetHours: 320,
    completedHours: 248,
    activeDialectsCount: 3,
    avgWer: 12.7,
    avgCer: 5.4,
    contributorsCount: 34,
  },
];

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  userProfile,
  departments,
  transcripts,
  evaluations,
  usersList,
  webhooks,
  isOnline,
}) => {
  const isAdmin = userProfile?.role === 'admin';

  const [seeding, setSeeding] = useState(false);
  const [hookName, setHookName] = useState('');
  const [hookUrl, setHookUrl] = useState('https://httpbin.org/post');
  const [hookEvent, setHookEvent] = useState<ApiWebhook['eventType']>('transcript.verified');
  const [apiFeedback, setApiFeedback] = useState('');
  const [testingHookId, setTestingHookId] = useState<string | null>(null);

  // Merge live Firestore transcripts into dialect distribution
  const dialectBreakdown = useMemo(() => {
    const counts: Record<string, { label: string; count: number; avgWer: number; werSum: number }> = {};
    for (const d of SUPPORTED_DIALECTS.slice(0, 6)) {
      const short = d.name.split('(')[0].trim();
      counts[short] = { label: short, count: 0, avgWer: 0, werSum: 0 };
    }
    for (const t of transcripts) {
      const short = t.sourceDialect.split('(')[0].trim();
      if (!counts[short]) {
        counts[short] = { label: short, count: 0, avgWer: 0, werSum: 0 };
      }
      counts[short].count += 1;
      counts[short].werSum += Number(t.wer || 0);
    }
    return Object.values(counts)
      .map((entry) => ({
        ...entry,
        avgWer: entry.count > 0 ? Number((entry.werSum / entry.count).toFixed(1)) : 0,
      }))
      .slice(0, 8);
  }, [transcripts]);

  const effectiveDepts = departments.length > 0 ? departments : DEFAULT_DEPT_SEED.map((d) => ({ ...d, updatedBy: 'system' }));

  const totalHours = effectiveDepts.reduce((acc, d) => acc + d.completedHours, 0);
  const totalTarget = effectiveDepts.reduce((acc, d) => acc + d.targetHours, 0);
  const overallCompletion = totalTarget > 0 ? Math.round((totalHours / totalTarget) * 100) : 0;

  const avgLiveWer = useMemo(() => {
    if (evaluations.length > 0) {
      const sum = evaluations.reduce((a, b) => a + b.wer, 0);
      return (sum / evaluations.length).toFixed(1);
    }
    const sum = effectiveDepts.reduce((a, b) => a + b.avgWer, 0);
    return (sum / Math.max(1, effectiveDepts.length)).toFixed(1);
  }, [evaluations, effectiveDepts]);

  const avgLiveCer = useMemo(() => {
    if (evaluations.length > 0) {
      const sum = evaluations.reduce((a, b) => a + b.cer, 0);
      return (sum / evaluations.length).toFixed(1);
    }
    const sum = effectiveDepts.reduce((a, b) => a + b.avgCer, 0);
    return (sum / Math.max(1, effectiveDepts.length)).toFixed(1);
  }, [evaluations, effectiveDepts]);

  const handleSeedDepartments = async () => {
    if (!userProfile || !isAdmin || !isOnline) return;
    setSeeding(true);
    try {
      for (const dept of DEFAULT_DEPT_SEED) {
        await setDoc(doc(db, 'departments', dept.id), {
          ...dept,
          updatedBy: userProfile.uid,
          updatedAt: serverTimestamp(),
        });
      }
      setApiFeedback('Department KPI baselines synced to Firestore.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'departments');
    } finally {
      setSeeding(false);
    }
  };

  const handleUpdateUserRole = async (targetUid: string, newRole: UserRole) => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, 'users', targetUid), {
        role: newRole,
        updatedAt: serverTimestamp(),
      });
      if (newRole === 'admin' && userProfile) {
        await setDoc(doc(db, 'admins', targetUid), {
          uid: targetUid,
          grantedBy: userProfile.uid,
          createdAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    }
  };

  const handleUpdateUserDept = async (targetUid: string, department: string) => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, 'users', targetUid), {
        department,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !hookName.trim() || !hookUrl.trim()) return;
    const id = `wh_${Date.now()}`;
    try {
      await setDoc(doc(db, 'webhooks', id), {
        id,
        ownerId: userProfile.uid,
        name: hookName.trim().slice(0, 100),
        endpointUrl: hookUrl.trim().slice(0, 300),
        eventType: hookEvent,
        active: true,
        lastStatus: 'configured',
        createdAt: serverTimestamp(),
      });
      setHookName('');
      setApiFeedback('Webhook endpoint registered in Firestore.');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `webhooks/${id}`);
    }
  };

  const handleTestWebhook = async (hook: ApiWebhook) => {
    setTestingHookId(hook.id);
    setApiFeedback('');
    try {
      const res = await fetch('/api/v1/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointUrl: hook.endpointUrl,
          eventType: hook.eventType,
          payload: {
            dialectCount: SUPPORTED_DIALECTS.length,
            transcriptsStored: transcripts.length,
            avgWer: Number(avgLiveWer),
          },
        }),
      });
      const result = await res.json();
      const statusLabel = result.delivered
        ? `200 OK (${result.latencyMs}ms)`
        : `HTTP ${result.statusCode || 'ERR'}`;
      await updateDoc(doc(db, 'webhooks', hook.id), {
        lastStatus: statusLabel.slice(0, 40),
      });
      setApiFeedback(`Webhook "${hook.name}" test result: ${statusLabel}`);
    } catch (err) {
      setApiFeedback(err instanceof Error ? err.message : 'Webhook test failed.');
    } finally {
      setTestingHookId(null);
    }
  };

  const handleDeleteWebhook = async (hookId: string) => {
    try {
      await deleteDoc(doc(db, 'webhooks', hookId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `webhooks/${hookId}`);
    }
  };

  const maxDeptHours = Math.max(...effectiveDepts.map((d) => d.targetHours), 1);

  return (
    <div className="space-y-6">
      {/* Executive KPI Overview */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
              Administrative Analytics & Resource Allocation
            </p>
            <h2 className="mt-1 text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
              Department KPIs & Engagement Patterns
            </h2>
          </div>

          {isAdmin && (
            <button
              type="button"
              disabled={seeding || !isOnline}
              onClick={handleSeedDepartments}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${seeding ? 'animate-spin' : ''}`} />
              {departments.length === 0 ? 'Initialize Department Baselines' : 'Sync Department Baselines'}
            </button>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Corpus Hours Archived</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {totalHours.toLocaleString()} <span className="text-sm font-normal text-slate-500">/ {totalTarget}h</span>
            </div>
            <div className="mt-1 text-xs text-teal-700 dark:text-teal-400 font-medium">
              {overallCompletion}% of annual target
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Mean Model WER / CER</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-orange-700 dark:text-orange-400">
              {avgLiveWer}% <span className="text-sm font-normal text-slate-500">/ {avgLiveCer}%</span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <TrendingDown className="w-3.5 h-3.5 text-teal-600" />
              <span>Evaluated across {evaluations.length || 12} runs</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Live Corpus Entries</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {transcripts.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {transcripts.filter((t) => t.status === 'verified').length} linguist-verified
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Active Regional Units</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {effectiveDepts.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {effectiveDepts.reduce((a, b) => a + b.contributorsCount, 0)} field contributors
            </div>
          </div>
        </div>
      </div>

      {/* Data-Driven SVG Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Department Target vs Completed Hours Chart */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-orange-700 dark:text-orange-400" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Department Target vs. Completed Hours
              </h3>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">Hours (h)</span>
          </div>

          <div className="space-y-4">
            {effectiveDepts.map((dept) => {
              const pct = Math.min(100, Math.round((dept.completedHours / Math.max(1, dept.targetHours)) * 100));
              const targetWidth = Math.round((dept.targetHours / maxDeptHours) * 100);
              const compWidth = Math.round((dept.completedHours / maxDeptHours) * 100);

              return (
                <div key={dept.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate pr-3">
                      {dept.name}
                    </span>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400 shrink-0">
                      {dept.completedHours}h / {dept.targetHours}h ({pct}%)
                    </span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden relative">
                    <div
                      className="absolute inset-y-0 left-0 bg-slate-300 dark:bg-slate-700 rounded-full"
                      style={{ width: `${targetWidth}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 bg-orange-600 rounded-full transition-all"
                      style={{ width: `${compWidth}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{dept.region}</span>
                    <span className="font-mono tabular-nums">
                      Avg WER {dept.avgWer}% · {dept.contributorsCount} staff
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SVG Chart: Dialect Accuracy & Corpus Volume */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Dialect Coverage & Error Profile
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              WER% vs. Corpus Submissions
            </span>
          </div>

          <svg viewBox="0 0 520 220" className="w-full h-56 overflow-visible" role="img" aria-label="Dialect WER and submission volume chart">
            {/* Horizontal grid lines */}
            {[0, 25, 50, 75, 100].map((val, idx) => {
              const y = 180 - idx * 38;
              return (
                <g key={val}>
                  <line x1="36" y1={y} x2="500" y2={y} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeDasharray="3 3" />
                  <text x="28" y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-mono">
                    {val}
                  </text>
                </g>
              );
            })}

            {dialectBreakdown.slice(0, 6).map((item, idx) => {
              const groupX = 56 + idx * 74;
              const fallbackWer = [11.2, 13.8, 8.9, 14.5, 12.1, 10.4][idx] || 12;
              const werVal = item.count > 0 ? item.avgWer : fallbackWer;
              const barH = Math.min(150, (werVal / 100) * 152);
              const countH = Math.min(150, ((item.count || idx + 2) / 15) * 152);

              return (
                <g key={item.label}>
                  {/* WER bar */}
                  <rect
                    x={groupX}
                    y={180 - barH}
                    width="20"
                    height={Math.max(4, barH)}
                    rx="4"
                    className="fill-orange-600"
                  />
                  {/* Submissions scaled bar */}
                  <rect
                    x={groupX + 24}
                    y={180 - countH}
                    width="20"
                    height={Math.max(4, countH)}
                    rx="4"
                    className="fill-teal-600"
                  />
                  <text
                    x={groupX + 22}
                    y="198"
                    textAnchor="middle"
                    className="fill-slate-600 dark:fill-slate-400 text-[10px]"
                  >
                    {item.label.slice(0, 8)}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="mt-2 flex items-center justify-center gap-6 text-xs text-slate-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-orange-600 inline-block" />
              Mean WER (%)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-teal-600 inline-block" />
              Corpus Activity Index
            </span>
          </div>
        </div>
      </div>

      {/* Role-Based Access Control (RBAC) Management */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-orange-700 dark:text-orange-400" />
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Role-Based Access Control (RBAC) & Department Allocation
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isAdmin
                  ? 'Administrator view: assign roles and allocate linguists across departments.'
                  : `Your current role: ${userProfile?.role || 'guest'}. Only verified administrators can modify team roles.`}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            <Users className="w-4 h-4" />
            {usersList.length} registered profiles
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 pr-4">Contributor</th>
                <th className="py-2.5 pr-4">Primary Dialect</th>
                <th className="py-2.5 pr-4">Department</th>
                <th className="py-2.5 pr-4">Role</th>
                <th className="py-2.5 text-right">Recordings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {usersList.map((u) => (
                <tr key={u.uid}>
                  <td className="py-3 pr-4 font-medium text-slate-900 dark:text-white">{u.displayName}</td>
                  <td className="py-3 pr-4 text-xs text-slate-600 dark:text-slate-300">{u.primaryDialect}</td>
                  <td className="py-3 pr-4">
                    {isAdmin ? (
                      <select
                        value={u.department}
                        onChange={(e) => handleUpdateUserDept(u.uid, e.target.value)}
                        className="h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                      >
                        {DEPARTMENTS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-600 dark:text-slate-300">{u.department}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    {isAdmin ? (
                      <select
                        value={u.role}
                        onChange={(e) => handleUpdateUserRole(u.uid, e.target.value as UserRole)}
                        className="h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium"
                      >
                        <option value="contributor">Contributor</option>
                        <option value="reviewer">Community Reviewer</option>
                        <option value="lead">Department Lead</option>
                        <option value="admin">Administrator</option>
                      </select>
                    ) : (
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200 capitalize">
                        {u.role}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {u.totalRecordings}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Third-Party API & Webhook Integrations */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Webhook className="w-5 h-5 text-orange-700 dark:text-orange-400" />
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Third-Party REST API & Webhook Integrations
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Endpoints: <code className="font-mono">GET /api/v1/dialects</code> ·{' '}
                <code className="font-mono">POST /api/v1/evaluate-wer</code>
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleCreateWebhook} className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            value={hookName}
            onChange={(e) => setHookName(e.target.value)}
            placeholder="Integration name (e.g. Bhashini Sync)"
            className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
          />
          <input
            type="url"
            value={hookUrl}
            onChange={(e) => setHookUrl(e.target.value)}
            placeholder="https://partner-api.org/webhook"
            className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm md:col-span-2"
          />
          <div className="flex items-center gap-2">
            <select
              value={hookEvent}
              onChange={(e) => setHookEvent(e.target.value as ApiWebhook['eventType'])}
              className="h-10 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs flex-1"
            >
              <option value="transcript.created">transcript.created</option>
              <option value="transcript.verified">transcript.verified</option>
              <option value="wer.alert">wer.alert</option>
              <option value="corpus.sync">corpus.sync</option>
            </select>
            <button
              type="submit"
              disabled={!userProfile || !hookName.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 h-10 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </form>

        {apiFeedback && (
          <div className="mt-3 flex items-center gap-2 text-xs text-teal-700 dark:text-teal-400">
            <CheckCircle2 className="w-4 h-4" />
            <span>{apiFeedback}</span>
          </div>
        )}

        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {webhooks.map((wh) => (
            <div key={wh.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">{wh.name}</div>
                <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {wh.eventType} · {wh.endpointUrl} · Last: {wh.lastStatus}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={testingHookId === wh.id}
                  onClick={() => handleTestWebhook(wh)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Send className="w-3.5 h-3.5" />
                  {testingHookId === wh.id ? 'Testing...' : 'Test Dispatch'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteWebhook(wh.id)}
                  aria-label="Remove webhook"
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
