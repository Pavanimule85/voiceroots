import React, { useState } from 'react';
import {
  HardDriveDownload,
  Lock,
  RefreshCw,
  Trash2,
  UserCheck,
  WifiOff,
  CheckCircle2,
  Globe,
} from 'lucide-react';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { LocaleCode, OfflineQueueItem, UserPrivateInfo, UserProfile } from '../types';
import { DEPARTMENTS, LOCALE_OPTIONS, SUPPORTED_DIALECTS } from '../i18n/translations';
import {
  type LanguagePack,
  downloadLanguagePack,
  removeLanguagePack,
} from '../utils/languagePacks';
import { hashPassphraseFingerprint } from '../utils/crypto';
import { removeOfflineItem } from '../utils/offlineSync';

interface ProfileSettingsProps {
  userProfile: UserProfile | null;
  privateInfo: UserPrivateInfo | null;
  locale: LocaleCode;
  onChangeLocale: (loc: LocaleCode) => void;
  downloadedPacks: LanguagePack[];
  onPacksChanged: () => Promise<void>;
  offlineQueue: OfflineQueueItem[];
  onQueueChanged: () => Promise<void>;
  onSyncQueueNow: () => Promise<void>;
  isSyncingQueue: boolean;
  isOnline: boolean;
  simulatedOffline: boolean;
  onToggleSimulatedOffline: (val: boolean) => void;
  vaultPassphrase: string;
  onChangeVaultPassphrase: (val: string) => void;
}

export const ProfileSettings: React.FC<ProfileSettingsProps> = ({
  userProfile,
  privateInfo,
  locale,
  onChangeLocale,
  downloadedPacks,
  onPacksChanged,
  offlineQueue,
  onQueueChanged,
  onSyncQueueNow,
  isSyncingQueue,
  isOnline,
  simulatedOffline,
  onToggleSimulatedOffline,
  vaultPassphrase,
  onChangeVaultPassphrase,
}) => {
  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');
  const [department, setDepartment] = useState(userProfile?.department || DEPARTMENTS[0]);
  const [primaryDialect, setPrimaryDialect] = useState(userProfile?.primaryDialect || SUPPORTED_DIALECTS[0].name);
  const [phone, setPhone] = useState(privateInfo?.phone || '');
  const [regionNotes, setRegionNotes] = useState(privateInfo?.regionNotes || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [packBusyId, setPackBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !isOnline) return;
    setSavingProfile(true);
    setFeedback('');

    try {
      await updateDoc(doc(db, 'users', userProfile.uid), {
        displayName: (displayName.trim() || userProfile.displayName).slice(0, 100),
        department: department.slice(0, 80),
        preferredLocale: locale,
        primaryDialect: primaryDialect.slice(0, 64),
        updatedAt: serverTimestamp(),
      });

      const keyHash = vaultPassphrase
        ? await hashPassphraseFingerprint(vaultPassphrase)
        : privateInfo?.encryptedBackupKeyHash || '';

      await setDoc(
        doc(db, 'users', userProfile.uid, 'private', 'info'),
        {
          uid: userProfile.uid,
          email: privateInfo?.email || 'verified-user@vanisetu.org',
          phone: phone.slice(0, 32),
          regionNotes: regionNotes.slice(0, 500),
          encryptedBackupKeyHash: keyHash,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setFeedback('Profile & encrypted PII vault saved to Firestore.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userProfile.uid}`);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDownloadOrRemovePack = async (dialectId: string, isInstalled: boolean) => {
    setPackBusyId(dialectId);
    try {
      if (isInstalled) {
        await removeLanguagePack(dialectId);
      } else {
        await downloadLanguagePack(dialectId);
      }
      await onPacksChanged();
    } finally {
      setPackBusyId(null);
    }
  };

  const handleDeleteQueuedItem = async (id: string) => {
    await removeOfflineItem(id);
    await onQueueChanged();
  };

  return (
    <div className="space-y-6">
      {/* Offline Packs Manager */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
              Remote Accessibility & Local Edge Models
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
              Downloadable Offline Dialect Language Packs
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Download regional lexicons, acoustic phoneme tables, and grammar rules for offline transcription and translation without internet access.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onToggleSimulatedOffline(!simulatedOffline)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap shrink-0 min-h-[44px] ${
              simulatedOffline
                ? 'border-amber-600 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100'
            }`}
          >
            <WifiOff className="w-4 h-4" />
            {simulatedOffline ? 'Exit Offline Test Mode' : 'Test Offline Mode'}
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {SUPPORTED_DIALECTS.map((d) => {
            const installed = downloadedPacks.find((p) => p.dialectId === d.id);
            const busy = packBusyId === d.id;
            return (
              <div
                key={d.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">{d.name}</span>
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{d.iso}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {d.family} · {d.region}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-200/70 dark:border-slate-800">
                  {installed ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Ready ({installed.sizeKb} KB)
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500 dark:text-slate-400">{d.status}</span>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDownloadOrRemovePack(d.id, !!installed)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[36px] ${
                      installed
                        ? 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-700'
                        : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90'
                    }`}
                  >
                    {installed ? (
                      <>
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove
                      </>
                    ) : (
                      <>
                        <HardDriveDownload className="w-3.5 h-3.5" />
                        {busy ? 'Installing...' : 'Download'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Offline Synchronization Queue */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Offline Synchronization Queue ({offlineQueue.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Field recordings & translations saved offline automatically synchronize to Firestore and Gemini once connectivity is restored.
            </p>
          </div>
          <button
            type="button"
            disabled={!isOnline || offlineQueue.length === 0 || isSyncingQueue}
            onClick={onSyncQueueNow}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-700 hover:bg-orange-800 disabled:opacity-40 text-white text-xs font-medium whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingQueue ? 'animate-spin' : ''}`} />
            {isSyncingQueue ? 'Synchronizing...' : 'Sync Queue Now'}
          </button>
        </div>

        {offlineQueue.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
            All local captures are synchronized with the cloud archive.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {offlineQueue.map((item) => (
              <div key={item.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">{item.title}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {item.sourceDialect} → {item.targetLanguage} · {item.syncStatus}
                    {item.lastError ? ` (${item.lastError})` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteQueuedItem(item.id)}
                  aria-label="Remove queued item"
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Regional Localization & AES-256 Encryption Vault + User Profile */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-orange-700 dark:text-orange-400" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Regional Localization & Encryption Key
            </h3>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
              Interface Localization Language
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {LOCALE_OPTIONS.map((opt) => (
                <button
                  key={opt.code}
                  type="button"
                  onClick={() => onChangeLocale(opt.code)}
                  className={`px-3 py-2 rounded-xl border text-xs font-medium text-left transition-colors min-h-[44px] ${
                    locale === opt.code
                      ? 'border-orange-600 bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div>{opt.native}</div>
                  <div className="text-[11px] opacity-70">{opt.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              <Lock className="w-3.5 h-3.5 text-orange-600" />
              AES-256-GCM Client-Side Vault Passphrase
            </label>
            <input
              type="password"
              value={vaultPassphrase}
              onChange={(e) => onChangeVaultPassphrase(e.target.value)}
              placeholder="Enter passphrase for encrypting/decrypting field notes"
              className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              Used strictly in-browser via Web Crypto PBKDF2 + AES-GCM before storing encrypted transcripts in Firestore. Never sent to the server.
            </p>
          </div>
        </div>

        {/* Cloud User Profile & Isolated PII Vault */}
        <form
          onSubmit={handleSaveProfile}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-orange-700 dark:text-orange-400" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Cloud Profile & Isolated PII Record
            </h3>
          </div>

          {!userProfile ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Sign in with Google to synchronize your cloud profile, department assignment, and private contact vault.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Primary Dialect
                  </label>
                  <select
                    value={primaryDialect}
                    onChange={(e) => setPrimaryDialect(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  >
                    {SUPPORTED_DIALECTS.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Department
                  </label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Contact Phone (Private Subcollection)
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98..."
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Field Region Notes (Private)
                </label>
                <textarea
                  rows={2}
                  value={regionNotes}
                  onChange={(e) => setRegionNotes(e.target.value)}
                  placeholder="Field station, community coordinator notes..."
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="submit"
                  disabled={savingProfile || !isOnline}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 disabled:opacity-40 min-h-[40px]"
                >
                  {savingProfile ? 'Saving...' : 'Save Profile & Private Info'}
                </button>
                {feedback && (
                  <span className="text-xs text-teal-700 dark:text-teal-400">{feedback}</span>
                )}
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
