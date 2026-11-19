import React, { useCallback, useEffect, useState } from 'react';
import {
  Mic,
  BarChart3,
  BookOpen,
  LineChart,
  Settings as SettingsIcon,
  Bell,
  Moon,
  Sun,
  WifiOff,
  RefreshCw,
  Globe,
  LogIn,
  LogOut,
  Shield,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import type {
  ApiWebhook,
  DepartmentMetric,
  DialectTranscript,
  LocaleCode,
  ModelEvaluation,
  OfflineQueueItem,
  SystemNotification,
  UserPrivateInfo,
  UserProfile,
} from './types';
import { DEPARTMENTS, LOCALE_OPTIONS, SUPPORTED_DIALECTS, UI_STRINGS } from './i18n/translations';
import { getDownloadedLanguagePacks, type LanguagePack } from './utils/languagePacks';
import { getOfflineQueue, removeOfflineItem } from './utils/offlineSync';
import { computeWerCer } from './utils/metrics';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PWAInstallButton } from './components/PWAInstallButton';
import { DialectStudio } from './components/DialectStudio';
import { WerCerEvaluator } from './components/WerCerEvaluator';
import { CorpusLibrary } from './components/CorpusLibrary';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { ProfileSettings } from './components/ProfileSettings';

type ActiveTab = 'studio' | 'wer' | 'corpus' | 'analytics' | 'settings';

const REGIONAL_SPOTLIGHTS = [
  {
    region: 'Deccan & Nilgiris',
    dialects: 'Tulu · Kodava Takk · Toda',
    image: '/src/assets/images/dialect_region_deccan_1795067872302.jpg',
    alt: 'South Indian palm-leaf manuscripts and handwoven ikat textile on basalt stone',
    note: 'Preserving Dravidian phonology and coastal oral traditions.',
  },
  {
    region: 'Himalayan Valleys',
    dialects: 'Garhwali · Kumaoni · Lepcha',
    image: '/src/assets/images/dialect_region_himalayan_1795067872483.jpg',
    alt: 'Himalayan cedar-wood archive room overlooking misty mountain terraces',
    note: 'Offline-first field recording across high-altitude settlements.',
  },
  {
    region: 'Eastern & Central Forests',
    dialects: 'Gondi · Kui · Kurukh · Mundari',
    image: '/src/assets/images/dialect_region_eastern_1795067872352.jpg',
    alt: 'Handmade terracotta craftwork and stitched linen-bound oral folklore notebooks',
    note: 'Community-led lexicon validation and grammar documentation.',
  },
];

function MainApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('studio');
  const [darkMode, setDarkMode] = useState(false);
  const [locale, setLocale] = useState<LocaleCode>('en');
  const [vaultPassphrase, setVaultPassphrase] = useState('');

  // Auth & Firestore profile state
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [privateInfo, setPrivateInfo] = useState<UserPrivateInfo | null>(null);
  const [authError, setAuthError] = useState('');

  // Firestore synced collections
  const [transcripts, setTranscripts] = useState<DialectTranscript[]>([]);
  const [evaluations, setEvaluations] = useState<ModelEvaluation[]>([]);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [departments, setDepartments] = useState<DepartmentMetric[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [webhooks, setWebhooks] = useState<ApiWebhook[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // Offline packs & queue
  const [downloadedPacks, setDownloadedPacks] = useState<LanguagePack[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);

  const { isOnline, simulatedOffline, setSimulatedOffline } = useOnlineStatus();

  const t = UI_STRINGS[locale] || UI_STRINGS.en;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const refreshPacks = useCallback(async () => {
    const packs = await getDownloadedLanguagePacks();
    setDownloadedPacks(packs);
  }, []);

  const refreshQueue = useCallback(async () => {
    const q = await getOfflineQueue();
    setOfflineQueue(q);
  }, []);

  useEffect(() => {
    refreshPacks();
    refreshQueue();
  }, [refreshPacks, refreshQueue]);

  // Auth initialization & profile provisioning
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (!user) {
        setUserProfile(null);
        setPrivateInfo(null);
        setTranscripts([]);
        setEvaluations([]);
        setNotifications([]);
        setUsersList([]);
        setWebhooks([]);
        setAuthReady(true);
        return;
      }

      try {
        const isBootstrapped =
          user.emailVerified && user.email === 'pavanimule85@gmail.com';
        const userRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          const initialRole = isBootstrapped ? 'admin' : 'contributor';
          const newProfile: UserProfile = {
            uid: user.uid,
            displayName: (user.displayName || user.email?.split('@')[0] || 'Field Linguist').slice(0, 100),
            role: initialRole,
            department: DEPARTMENTS[0],
            preferredLocale: 'en',
            primaryDialect: SUPPORTED_DIALECTS[0].name,
            totalRecordings: 0,
          };

          if (isBootstrapped) {
            await setDoc(doc(db, 'admins', user.uid), {
              uid: user.uid,
              grantedBy: user.uid,
              createdAt: serverTimestamp(),
            });
          }

          await setDoc(userRef, {
            ...newProfile,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          await setDoc(doc(db, 'users', user.uid, 'private', 'info'), {
            uid: user.uid,
            email: (user.email || 'user@vanisetu.org').slice(0, 160),
            phone: '',
            regionNotes: '',
            encryptedBackupKeyHash: '',
            updatedAt: serverTimestamp(),
          });

          setUserProfile(newProfile);
        } else {
          const profileData = snap.data() as UserProfile;
          setUserProfile(profileData);
          if (profileData.preferredLocale && UI_STRINGS[profileData.preferredLocale]) {
            setLocale(profileData.preferredLocale);
          }
          if (isBootstrapped) {
            const adminDoc = await getDoc(doc(db, 'admins', user.uid));
            if (!adminDoc.exists()) {
              await setDoc(doc(db, 'admins', user.uid), {
                uid: user.uid,
                grantedBy: user.uid,
                createdAt: serverTimestamp(),
              });
            }
          }
        }

        const privSnap = await getDoc(doc(db, 'users', user.uid, 'private', 'info'));
        if (privSnap.exists()) {
          setPrivateInfo(privSnap.data() as UserPrivateInfo);
        }
      } catch (err) {
        console.error('Auth profile initialization error:', err);
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsub();
  }, []);

  // Firestore real-time subscriptions (only when authenticated)
  useEffect(() => {
    if (!authReady || !currentUser) return;

    const uid = currentUser.uid;
    const isBootstrappedAdmin =
      currentUser.emailVerified && currentUser.email === 'pavanimule85@gmail.com';

    let ownTranscripts: DialectTranscript[] = [];
    let archiveTranscripts: DialectTranscript[] = [];
    const mergeTranscripts = () => {
      const map = new Map<string, DialectTranscript>();
      [...ownTranscripts, ...archiveTranscripts].forEach((item) => map.set(item.id, item));
      setTranscripts(Array.from(map.values()));
    };

    const unsubOwn = onSnapshot(
      query(collection(db, 'transcripts'), where('ownerId', '==', uid)),
      (snap) => {
        ownTranscripts = snap.docs.map((d) => d.data() as DialectTranscript);
        mergeTranscripts();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'transcripts')
    );

    const unsubArchive = onSnapshot(
      query(collection(db, 'transcripts'), where('visibility', '==', 'archive')),
      (snap) => {
        archiveTranscripts = snap.docs.map((d) => d.data() as DialectTranscript);
        mergeTranscripts();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'transcripts')
    );

    const evalQuery = isBootstrappedAdmin
      ? collection(db, 'evaluations')
      : query(collection(db, 'evaluations'), where('ownerId', '==', uid));

    const unsubEvals = onSnapshot(
      evalQuery,
      (snap) => {
        setEvaluations(snap.docs.map((d) => d.data() as ModelEvaluation));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'evaluations')
    );

    let personalNotifs: SystemNotification[] = [];
    let broadcastNotifs: SystemNotification[] = [];
    const mergeNotifs = () => {
      const map = new Map<string, SystemNotification>();
      [...personalNotifs, ...broadcastNotifs].forEach((n) => map.set(n.id, n));
      setNotifications(Array.from(map.values()));
    };

    const unsubNotifPersonal = onSnapshot(
      query(collection(db, 'notifications'), where('recipientId', '==', uid)),
      (snap) => {
        personalNotifs = snap.docs.map((d) => d.data() as SystemNotification);
        mergeNotifs();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
    );

    const unsubNotifAll = onSnapshot(
      query(collection(db, 'notifications'), where('recipientId', '==', 'all')),
      (snap) => {
        broadcastNotifs = snap.docs.map((d) => d.data() as SystemNotification);
        mergeNotifs();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
    );

    const unsubDepts = onSnapshot(
      query(collection(db, 'departments'), where('targetHours', '>=', 0)),
      (snap) => {
        setDepartments(snap.docs.map((d) => d.data() as DepartmentMetric));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'departments')
    );

    const usersQuery = isBootstrappedAdmin
      ? collection(db, 'users')
      : query(collection(db, 'users'), where('uid', '==', uid));
    const unsubUsers = onSnapshot(
      usersQuery,
      (snap) => {
        setUsersList(snap.docs.map((d) => d.data() as UserProfile));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'users')
    );

    const hooksQuery = isBootstrappedAdmin
      ? collection(db, 'webhooks')
      : query(collection(db, 'webhooks'), where('ownerId', '==', uid));
    const unsubHooks = onSnapshot(
      hooksQuery,
      (snap) => {
        setWebhooks(snap.docs.map((d) => d.data() as ApiWebhook));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'webhooks')
    );

    const unsubProfile = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) setUserProfile(snap.data() as UserProfile);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}`)
    );

    return () => {
      unsubOwn();
      unsubArchive();
      unsubEvals();
      unsubNotifPersonal();
      unsubNotifAll();
      unsubDepts();
      unsubUsers();
      unsubHooks();
      unsubProfile();
    };
  }, [authReady, currentUser]);

  // Background & Manual Offline Queue Synchronization
  const syncOfflineQueueNow = useCallback(async () => {
    if (!isOnline || !userProfile || offlineQueue.length === 0 || isSyncingQueue) return;
    setIsSyncingQueue(true);
    try {
      for (const item of offlineQueue) {
        let sourceTranscript = item.sourceTranscript;
        let translatedText = item.translatedText;
        let phoneticIpa = item.phoneticIpa;
        let grammarNotes = item.grammarNotes;

        // If audio was captured offline and not encrypted, refine with Gemini cloud ASR
        if (item.audioBase64 && !item.isEncrypted) {
          try {
            const resp = await fetch('/api/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audioBase64: item.audioBase64,
                mimeType: item.mimeType || 'audio/webm',
                sourceDialect: item.sourceDialect,
                targetLanguage: item.targetLanguage,
              }),
            });
            if (resp.ok) {
              const cloud = await resp.json();
              sourceTranscript = cloud.sourceTranscript || sourceTranscript;
              translatedText = cloud.translatedText || translatedText;
              phoneticIpa = cloud.phoneticIpa || phoneticIpa;
              grammarNotes = cloud.grammarSuggestions || grammarNotes;
            }
          } catch {
            // Keep local offline pack result if Gemini call fails
          }
        }

        const metrics = computeWerCer(item.referenceTranscript || sourceTranscript, sourceTranscript);
        const docId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        await setDoc(doc(db, 'transcripts', docId), {
          id: docId,
          ownerId: userProfile.uid,
          ownerName: userProfile.displayName.slice(0, 100),
          department: item.department.slice(0, 80),
          sourceDialect: item.sourceDialect.slice(0, 64),
          targetLanguage: item.targetLanguage.slice(0, 64),
          title: item.title.slice(0, 160),
          sourceTranscript: (item.isEncrypted ? '[AES-256-GCM Encrypted Dialect Transcript]' : sourceTranscript).slice(0, 12000),
          translatedText: (item.isEncrypted ? '[AES-256-GCM Encrypted Translation]' : translatedText).slice(0, 12000),
          phoneticIpa: phoneticIpa.slice(0, 6000),
          grammarNotes: (item.isEncrypted ? '[Encrypted]' : grammarNotes).slice(0, 4000),
          referenceTranscript: (item.referenceTranscript || sourceTranscript).slice(0, 12000),
          wer: metrics.wer,
          cer: metrics.cer,
          audioDurationSec: item.audioDurationSec || 6,
          sourceType: item.sourceType,
          isEncrypted: item.isEncrypted,
          encryptedPayload: item.encryptedPayload.slice(0, 24000),
          status: 'pending_review',
          visibility: item.isEncrypted ? 'private' : 'archive',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await removeOfflineItem(item.id);
      }

      const notifId = `nt_${Date.now()}`;
      await setDoc(doc(db, 'notifications', notifId), {
        id: notifId,
        recipientId: userProfile.uid,
        createdBy: userProfile.uid,
        title: `Offline Queue Synchronized (${offlineQueue.length} items)`,
        message: 'Field recordings and local dialect translations captured offline have been synchronized to Firestore.',
        severity: 'info',
        category: 'offline-sync',
        read: false,
        createdAt: serverTimestamp(),
      });

      await refreshQueue();
    } catch (err) {
      console.error('Offline queue sync error:', err);
    } finally {
      setIsSyncingQueue(false);
    }
  }, [isOnline, userProfile, offlineQueue, isSyncingQueue, refreshQueue]);

  useEffect(() => {
    if (isOnline && userProfile && offlineQueue.length > 0) {
      syncOfflineQueueNow();
    }
  }, [isOnline, userProfile, offlineQueue.length, syncOfflineQueueNow]);

  const handleSignIn = async () => {
    setAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const unreadNotifCount = notifications.filter((n) => !n.read && n.recipientId === userProfile?.uid).length;

  const navItems: { id: ActiveTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'studio', label: t.navStudio, icon: Mic },
    { id: 'wer', label: t.navWer, icon: BarChart3 },
    { id: 'corpus', label: t.navCorpus, icon: BookOpen },
    { id: 'analytics', label: t.navAnalytics, icon: LineChart },
    { id: 'settings', label: t.navSettings, icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-20 md:pb-8">
      {/* Desktop 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('studio')}
            className="text-lg font-bold tracking-tight font-display text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            {t.brand}
          </button>

          {/* Zone 2: Concise single-line navigation links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                  activeTab === item.id
                    ? 'border-orange-600 text-slate-900 dark:text-white'
                    : 'border-transparent hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center shrink-0">
            {!currentUser ? (
              <button
                type="button"
                onClick={handleSignIn}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <LogIn className="w-3.5 h-3.5" />
                {t.signInGoogle}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-5 sm:pt-7 space-y-6">
        {/* Offline Mode Alert Banner */}
        {!isOnline && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-medium text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>{t.offlineModeBanner}</span>
            </div>
            {simulatedOffline && (
              <button
                type="button"
                onClick={() => setSimulatedOffline(false)}
                className="underline font-semibold text-left sm:text-right"
              >
                Restore Online Connectivity
              </button>
            )}
          </div>
        )}

        {authError && (
          <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {authError}
          </div>
        )}

        {/* Workspace Toolbar (Mode toggles, localization, sync, notifications, PWA install) */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
            {userProfile ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
                <Shield className="w-3.5 h-3.5 text-orange-600" />
                {userProfile.displayName} · {userProfile.role} · {userProfile.department}
              </span>
            ) : (
              <span>Guest Studio Mode · Sign in for cloud corpus sync & RBAC analytics</span>
            )}
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="font-mono tabular-nums">
              {downloadedPacks.length} offline packs installed
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {offlineQueue.length > 0 && (
              <button
                type="button"
                onClick={isOnline ? syncOfflineQueueNow : () => setActiveTab('settings')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 text-xs font-medium min-h-[38px]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingQueue ? 'animate-spin' : ''}`} />
                {t.syncNow} ({offlineQueue.length})
              </button>
            )}

            <button
              type="button"
              onClick={() => setSimulatedOffline(!simulatedOffline)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors min-h-[38px] ${
                simulatedOffline
                  ? 'border-amber-600 bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <WifiOff className="w-3.5 h-3.5" />
              {simulatedOffline ? 'Offline Test: ON' : 'Offline Test'}
            </button>

            <div className="inline-flex items-center gap-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 h-[38px]">
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <select
                aria-label="Interface Language"
                value={locale}
                onChange={(e) => setLocale(e.target.value as LocaleCode)}
                className="bg-transparent text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none"
              >
                {LOCALE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code} className="bg-white dark:bg-slate-900">
                    {opt.native}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              aria-label="Notifications"
              className="relative inline-flex items-center justify-center w-10 h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-600 text-white text-[10px] font-mono flex items-center justify-center">
                  {unreadNotifCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label="Toggle dark mode"
              className="inline-flex items-center justify-center w-10 h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <PWAInstallButton />
          </div>
        </div>

        {/* Hero Editorial Anchor (Studio Tab) */}
        {activeTab === 'studio' && (
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
              <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-center">
                <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
                  Linguistic Preservation · 12 Under-Digitized Indian Dialects · Offline & Cloud Sync
                </p>
                <h1 className="mt-2 text-2xl sm:text-4xl font-semibold text-slate-900 dark:text-white tracking-tight text-balance">
                  {t.heroTitle}
                </h1>
                <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                  {t.heroSubtitle}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  <span>12 Regional Dialects</span>
                  <span aria-hidden="true">·</span>
                  <span>AES-256-GCM Vault</span>
                  <span aria-hidden="true">·</span>
                  <span>Live WER / CER Scoring</span>
                  <span aria-hidden="true">·</span>
                  <span>TXT / JSON / SRT / VTT / CSV</span>
                </div>
              </div>
              <div className="lg:col-span-5 min-h-[220px] bg-slate-100 dark:bg-slate-800 relative">
                <img
                  src="/src/assets/images/hero_heritage_studio_1795067873050.jpg"
                  alt="Indian linguistic field researcher desk with digital audio recorder and regional script notebook"
                  referrerPolicy="no-referrer"
                  className="w-full h-full lg:h-full object-cover"
                />
              </div>
            </div>
          </section>
        )}

        {/* Active View Content */}
        {activeTab === 'studio' && (
          <>
            <DialectStudio
              userProfile={userProfile}
              isSignedIn={!!currentUser}
              isOnline={isOnline}
              locale={locale}
              downloadedPacks={downloadedPacks}
              onPacksChanged={refreshPacks}
              onQueueChanged={refreshQueue}
              vaultPassphrase={vaultPassphrase}
              onRequestSignIn={handleSignIn}
            />

            {/* Regional Dialect Spotlight Strip */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2">
              {REGIONAL_SPOTLIGHTS.map((card) => (
                <div
                  key={card.region}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden flex flex-col"
                >
                  <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <img
                      src={card.image}
                      alt={card.alt}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-4 sm:p-5">
                    <div className="text-xs font-medium text-orange-700 dark:text-orange-400">
                      {card.dialects}
                    </div>
                    <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">
                      {card.region}
                    </h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {card.note}
                    </p>
                  </div>
                </div>
              ))}
            </section>
          </>
        )}

        {activeTab === 'wer' && (
          <WerCerEvaluator
            userProfile={userProfile}
            isSignedIn={!!currentUser}
            isOnline={isOnline}
            evaluations={evaluations}
            onRequestSignIn={handleSignIn}
          />
        )}

        {activeTab === 'corpus' && (
          <CorpusLibrary
            transcripts={transcripts}
            userProfile={userProfile}
            vaultPassphrase={vaultPassphrase}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsDashboard
            userProfile={userProfile}
            departments={departments}
            transcripts={transcripts}
            evaluations={evaluations}
            usersList={usersList}
            webhooks={webhooks}
            isOnline={isOnline}
          />
        )}

        {activeTab === 'settings' && (
          <ProfileSettings
            userProfile={userProfile}
            privateInfo={privateInfo}
            locale={locale}
            onChangeLocale={setLocale}
            downloadedPacks={downloadedPacks}
            onPacksChanged={refreshPacks}
            offlineQueue={offlineQueue}
            onQueueChanged={refreshQueue}
            onSyncQueueNow={syncOfflineQueueNow}
            isSyncingQueue={isSyncingQueue}
            isOnline={isOnline}
            simulatedOffline={simulatedOffline}
            onToggleSimulatedOffline={setSimulatedOffline}
            vaultPassphrase={vaultPassphrase}
            onChangeVaultPassphrase={setVaultPassphrase}
          />
        )}
      </main>

      {/* Mobile Fixed Bottom Thumb-Zone Navigation (<= 64px height) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 items-center"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center min-h-[44px] px-1 ${
                active
                  ? 'text-orange-700 dark:text-orange-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] mt-1 truncate max-w-full">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <NotificationsDrawer
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        notifications={notifications}
        userProfile={userProfile}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
