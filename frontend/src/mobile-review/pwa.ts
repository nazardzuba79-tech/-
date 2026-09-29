import { useEffect, useState } from 'react';
import { isLoopback } from './policy';

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export function usePwa(enabled = true) {
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
  const [update, setUpdate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const prompt = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    const done = () => { setInstalled(true); setInstall(null); };
    window.addEventListener('beforeinstallprompt', prompt);
    window.addEventListener('appinstalled', done);
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let worker: ServiceWorker | null = null;
    const state = () => { if (!disposed) setUpdate(!!registration?.waiting && !!registration?.active); };
    const found = () => {
      worker?.removeEventListener('statechange', state);
      worker = registration?.installing || null;
      worker?.addEventListener('statechange', state);
    };
    if (import.meta.env.PROD && isLoopback(location.hostname) && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/mobile/sw.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
        if (disposed) return;
        registration = reg; state(); reg.addEventListener('updatefound', found); found();
      }).catch(() => { if (!disposed) setError('Offline installation is unavailable.'); });
    }
    return () => {
      disposed = true;
      window.removeEventListener('beforeinstallprompt', prompt);
      window.removeEventListener('appinstalled', done);
      registration?.removeEventListener('updatefound', found);
      worker?.removeEventListener('statechange', state);
    };
  }, [enabled]);
  return { installed, update, error, canInstall: !!install, prompt: async () => {
    if (!install) return;
    await install.prompt(); await install.userChoice; setInstall(null);
  } };
}
