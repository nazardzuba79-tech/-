import { API_BASE, getToken } from './api';

export interface AdminAlertSummary {
  depositId: string | null;
  withdrawalId: string | null;
  kycId: string | null;
}

/** Tiny admin-only cursor used by the global notification chime.
 * Detailed deposits, withdrawals and KYC/client rows belong to their admin
 * pages and must never be downloaded by every visible app tab.
 */
export async function getAdminAlertSummary(signal?: AbortSignal): Promise<AdminAlertSummary> {
  const token = getToken();
  if (!token) throw new Error('Admin session unavailable');
  const response = await fetch(`${API_BASE}/admin/alerts-summary`, {
    signal,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Admin alert summary failed (${response.status})`);
  const body = await response.json() as Partial<AdminAlertSummary>;
  return {
    depositId: typeof body.depositId === 'string' ? body.depositId : null,
    withdrawalId: typeof body.withdrawalId === 'string' ? body.withdrawalId : null,
    kycId: typeof body.kycId === 'string' ? body.kycId : null,
  };
}
