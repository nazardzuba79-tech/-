import { useEffect, useRef } from 'react';
import { getAdminAlertSummary, type AdminAlertSummary } from './adminAlertApi';

// A notification chime is not trading-state freshness. One tiny cursor request
// per visible minute is enough; detailed admin lists load only on admin pages.
const POLL_MS = 60_000;
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
    // Notification audio is best-effort and must never break navigation.
  }
}

function changed(previous: AdminAlertSummary | null, next: AdminAlertSummary): boolean {
  return previous !== null && (
    previous.depositId !== next.depositId ||
    previous.withdrawalId !== next.withdrawalId ||
    previous.kycId !== next.kycId
  );
}

/**
 * Global admin chime. The first successful read establishes a baseline and
 * never replays old items. Hidden tabs make zero polling requests and refresh
 * once when visible again.
 */
export function useAdminAlertSound(enabled: boolean) {
  const cursor = useRef<AdminAlertSummary | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let running = false;

    async function poll() {
      if (cancelled || running || document.hidden) return;
      running = true;
      try {
        const next = await getAdminAlertSummary();
        if (cancelled) return;
        const hasNew = changed(cursor.current, next);
        cursor.current = next;
        if (hasNew && isAdminAlertSoundEnabled()) playChime();
      } catch {
        // Transient — preserve the last successful cursor and retry later.
      } finally {
        running = false;
      }
    }

    void poll();
    const interval = setInterval(() => { void poll(); }, POLL_MS);
    const onVisibility = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
