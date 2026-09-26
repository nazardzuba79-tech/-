import { API_BASE, getToken } from '../../lib/api';

/** Admin → Поддержка: the inbox and the email-delivery diagnostics (ADMIN only on the server). */

export type SupportDeliveryState = 'working' | 'not_configured' | 'failing' | 'unverified';
export type SupportNotificationStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface SupportDiagnostics {
  state: SupportDeliveryState;
  recipient: string | null;
  smtpConfigured: boolean;
  inboundConfigured: boolean;
  lastSentAt: string | null;
  lastFailedAt: string | null;
  lastFailureCategory: string | null;
  lastFailureCode: number | null;
  pending: number;
  failed: number;
  sent: number;
  lastTest: { at: string; ok: boolean; category: string | null; code: number | null } | null;
}

export interface SupportNotificationState {
  status: SupportNotificationStatus;
  failureCategory: string | null;
  sentAt: string | null;
  attempts: number;
}

export interface SupportInboxItem {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  subject: 'TECHNICAL' | 'KYC' | 'CARD' | 'OTHER';
  unreadByAdmin: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: { sender: 'USER' | 'ADMIN'; preview: string; createdAt: string } | null;
  notification: SupportNotificationState | null;
}

export interface SupportInboxPage {
  page: number;
  pageSize: number;
  total: number;
  unread: number;
  items: SupportInboxItem[];
}

export interface SupportThreadMessage {
  id: string;
  sender: 'USER' | 'ADMIN';
  body: string;
  createdAt: string;
  notification: (SupportNotificationState & { failureCode?: number | null; nextAttemptAt?: string }) | null;
}

export interface SupportThread {
  conversation: { id: string; userId: string | null; name: string; email: string; subject: SupportInboxItem['subject']; unreadByUser: boolean; createdAt: string; updatedAt: string };
  messages: SupportThreadMessage[];
}

export type SupportInboxFilter = 'all' | 'unread' | 'attention';

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const token = getToken();
  if (!token) throw new Error('Admin session unavailable');
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, body };
}

async function ok<T>(path: string, init?: RequestInit): Promise<T> {
  const { status, body } = await call<T>(path, init);
  if (status < 200 || status >= 300) throw new Error(`Support admin request failed (${status})`);
  return body;
}

export const getSupportDiagnostics = () => ok<SupportDiagnostics>('/admin/support/diagnostics');

/** Resolves with the real outcome — Sent or Failed with a category — never throws on a relay failure. */
export async function sendSupportTestEmail(): Promise<{ ok: boolean; category?: string | null; code?: number | null; recipient?: string }> {
  const { status, body } = await call<{ ok?: boolean; category?: string; code?: number | null; recipient?: string; error?: string }>(
    '/admin/support/test-email', { method: 'POST' },
  );
  if (status === 429) return { ok: false, category: 'RATE_LIMITED' };
  if (status === 401 || status === 403) throw new Error('Admin session unavailable');
  return { ok: body.ok === true, category: body.category ?? null, code: body.code ?? null, recipient: body.recipient };
}

export const retryFailedSupportNotifications = () => ok<{ requeued: number }>('/admin/support/notifications/retry-failed', { method: 'POST' });

export const getSupportInbox = (filter: SupportInboxFilter, page = 1) =>
  ok<SupportInboxPage>(`/admin/support/conversations?filter=${filter}&page=${page}`);

export const getSupportThread = (id: string) => ok<SupportThread>(`/admin/support/conversations/${encodeURIComponent(id)}`);

export const replyToSupportThread = (id: string, body: string) =>
  ok<SupportThreadMessage>(`/admin/support/conversations/${encodeURIComponent(id)}/reply`, { method: 'POST', body: JSON.stringify({ body }) });

export { failureText, SUPPORT_FAILURE_TEXT } from './supportFailureText';
