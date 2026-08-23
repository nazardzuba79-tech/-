import { useEffect, useRef } from 'react';
import { api } from './api';

const POLL_MS = 15_000;
const SOUND_PREF_KEY = 'exchange_admin_alert_sound';

export function isAdminAlertSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAdminAlertSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(SOUND_PREF_KEY, enabled ? '1' : '0');
  } catch {
    // best-effort — the toggle just won't persist across reloads
  }
}

// Short two-tone chime, synthesized with the Web Audio API — no audio asset
// to bundle or license. Browsers only block *autoplay on page load*; a
// sound triggered later by a poll, in a tab the admin already interacted
// with (e.g. logging in), plays fine.
function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
    setTimeout(() => ctx.close(), 700);
  } catch {
    // best-effort notification sound — never let it break the page
  }
}

function findNewIds(ids: string[], seen: Set<string> | null): boolean {
  if (seen === null) return false; // first poll after mount — this is the baseline, not a new arrival
  return ids.some((id) => !seen.has(id));
}

/**
 * Polls for brand-new deposits, withdrawal requests, and KYC submissions
 * while an admin is anywhere in the app, and plays a short chime the
 * moment one appears — so they don't have to keep the /admin tab open and
 * stare at it. Only alerts on items that show up *after* this hook first
 * mounts in this tab (never replays a backlog on load), and respects the
 * mute toggle (see AdminLayout).
 */
export function useAdminAlertSound(enabled: boolean) {
  const seenDeposits = useRef<Set<string> | null>(null);
  const seenWithdrawals = useRef<Set<string> | null>(null);
  const seenKyc = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function poll() {
      try {
        const [deposits, withdrawals, clients] = await Promise.all([
          api.getAdminDeposits(),
          api.getAdminWithdrawals(),
          api.getAllClients(),
        ]);
        if (cancelled) return;

        const kycIds = clients.filter((c) => c.latestKyc).map((c) => c.latestKyc!.id);
        const depositIds = deposits.map((d) => d.id);
        const withdrawalIds = withdrawals.map((w) => w.id);

        const hasNew =
          findNewIds(depositIds, seenDeposits.current) ||
          findNewIds(withdrawalIds, seenWithdrawals.current) ||
          findNewIds(kycIds, seenKyc.current);

        seenDeposits.current = new Set(depositIds);
        seenWithdrawals.current = new Set(withdrawalIds);
        seenKyc.current = new Set(kycIds);

        if (hasNew && isAdminAlertSoundEnabled()) playChime();
      } catch {
        // Transient — the next poll retries. Never surface this as a user-facing error.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);
}
