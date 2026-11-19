import React, { useState } from 'react';
import { Bell, Check, Megaphone, X } from 'lucide-react';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { SystemNotification, UserProfile } from '../types';

interface NotificationsDrawerProps {
  open: boolean;
  onClose: () => void;
  notifications: SystemNotification[];
  userProfile: UserProfile | null;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  open,
  onClose,
  notifications,
  userProfile,
}) => {
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('info');
  const [sending, setSending] = useState(false);

  if (!open) return null;

  const handleMarkRead = async (notif: SystemNotification) => {
    if (!userProfile || notif.recipientId !== userProfile.uid || notif.read) return;
    try {
      await updateDoc(doc(db, 'notifications', notif.id), {
        read: true,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${notif.id}`);
    }
  };

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || userProfile.role !== 'admin' || !broadcastTitle.trim() || !broadcastMsg.trim()) return;
    setSending(true);
    const id = `nt_${Date.now()}`;
    try {
      await setDoc(doc(db, 'notifications', id), {
        id,
        recipientId: 'all',
        createdBy: userProfile.uid,
        title: broadcastTitle.trim().slice(0, 140),
        message: broadcastMsg.trim().slice(0, 600),
        severity,
        category: 'announcement',
        read: false,
        createdAt: serverTimestamp(),
      });
      setBroadcastTitle('');
      setBroadcastMsg('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `notifications/${id}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-orange-700 dark:text-orange-400" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Real-Time Updates
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {notifications.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
              No notifications yet. High-WER alerts, offline sync completions, and department announcements appear here in real time.
            </p>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`rounded-xl border p-3.5 ${
                  n.severity === 'critical'
                    ? 'border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/30'
                    : n.severity === 'warning'
                    ? 'border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {n.severity} · {n.category}
                  </span>
                  {!n.read && n.recipientId === userProfile?.uid && (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(n)}
                      className="inline-flex items-center gap-1 text-xs text-teal-700 dark:text-teal-400 hover:underline"
                    >
                      <Check className="w-3 h-3" />
                      Mark Read
                    </button>
                  )}
                </div>
                <h4 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{n.title}</h4>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {n.message}
                </p>
              </div>
            ))
          )}
        </div>

        {userProfile?.role === 'admin' && (
          <form onSubmit={handleBroadcast} className="p-5 border-t border-slate-200 dark:border-slate-800 space-y-3 bg-slate-50 dark:bg-slate-950">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Megaphone className="w-4 h-4 text-orange-600" />
              Broadcast Critical Update
            </div>
            <input
              type="text"
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              placeholder="Update headline"
              className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
            <textarea
              rows={2}
              value={broadcastMsg}
              onChange={(e) => setBroadcastMsg(e.target.value)}
              placeholder="Message to all field teams..."
              className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
            <div className="flex items-center gap-2">
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as 'info' | 'warning' | 'critical')}
                className="h-9 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
              <button
                type="submit"
                disabled={sending || !broadcastTitle.trim() || !broadcastMsg.trim()}
                className="flex-1 h-9 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium disabled:opacity-40"
              >
                {sending ? 'Sending...' : 'Send Broadcast'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
