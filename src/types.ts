export type UserRole = 'contributor' | 'reviewer' | 'lead' | 'admin';

export type LocaleCode = 'en' | 'hi' | 'te' | 'ta' | 'or' | 'kn';

export interface DialectInfo {
  id: string;
  name: string;
  iso: string;
  family: string;
  region: string;
  status: string;
  department: string;
  samplePhrase: string;
  sampleRef: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  role: UserRole;
  department: string;
  preferredLocale: LocaleCode;
  primaryDialect: string;
  totalRecordings: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  phone?: string;
  regionNotes?: string;
  encryptedBackupKeyHash?: string;
  updatedAt?: unknown;
}

export interface DialectTranscript {
  id: string;
  ownerId: string;
  ownerName: string;
  department: string;
  sourceDialect: string;
  targetLanguage: string;
  title: string;
  sourceTranscript: string;
  translatedText: string;
  phoneticIpa: string;
  grammarNotes: string;
  referenceTranscript: string;
  wer: number;
  cer: number;
  audioDurationSec: number;
  sourceType: 'recorded' | 'uploaded' | 'text';
  isEncrypted: boolean;
  encryptedPayload: string;
  status: 'draft' | 'pending_review' | 'verified';
  visibility: 'private' | 'archive';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ModelEvaluation {
  id: string;
  ownerId: string;
  dialect: string;
  modelName: string;
  referenceText: string;
  hypothesisText: string;
  wer: number;
  cer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceWords: number;
  department: string;
  createdAt?: unknown;
}

export interface SystemNotification {
  id: string;
  recipientId: string;
  createdBy: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  category: string;
  read: boolean;
  createdAt?: unknown;
}

export interface DepartmentMetric {
  id: string;
  name: string;
  region: string;
  targetHours: number;
  completedHours: number;
  activeDialectsCount: number;
  avgWer: number;
  avgCer: number;
  contributorsCount: number;
  updatedBy: string;
  updatedAt?: unknown;
}

export interface ApiWebhook {
  id: string;
  ownerId: string;
  name: string;
  endpointUrl: string;
  eventType: 'transcript.created' | 'transcript.verified' | 'wer.alert' | 'corpus.sync';
  active: boolean;
  lastStatus: string;
  createdAt?: unknown;
}

export interface OfflineQueueItem {
  id: string;
  title: string;
  sourceDialect: string;
  targetLanguage: string;
  department: string;
  audioBase64?: string;
  mimeType?: string;
  audioDurationSec: number;
  sourceType: 'recorded' | 'uploaded' | 'text';
  sourceTranscript: string;
  translatedText: string;
  phoneticIpa: string;
  grammarNotes: string;
  referenceTranscript: string;
  isEncrypted: boolean;
  encryptedPayload: string;
  createdAtIso: string;
  syncStatus: 'pending' | 'syncing' | 'error';
  lastError?: string;
}
