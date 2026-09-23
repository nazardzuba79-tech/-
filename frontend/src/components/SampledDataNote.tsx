import { useEffect } from 'react';
import { useLanguage } from '../lib/i18n';
import '../pages/trade-terminal/SampledDisplay.css';

export function sampledDisplayText(lang: string, asOf: number | null | undefined, cadenceMs = 60_000) {
  const words: Record<string, [string, string]> = {
    en: ['Snapshot', 'Local animation of received data; not new trades or real-time depth'],
    uk: ['Знімок', 'Локальна анімація отриманих даних; не нові угоди й не стакан у реальному часі'],
    ru: ['Снимок', 'Локальная анимация полученных данных; не новые сделки и не стакан в реальном времени'],
    es: ['Instantánea', 'Animación local de datos recibidos; no son operaciones nuevas ni profundidad en tiempo real'],
    pt: ['Instantâneo', 'Animação local dos dados recebidos; não são novas operações nem profundidade em tempo real'],
    zh: ['快照', '已接收数据的本地动画；不是新交易或实时深度'],
    hi: ['स्नैपशॉट', 'प्राप्त डेटा का स्थानीय एनिमेशन; नई ट्रेड या वास्तविक समय की गहराई नहीं'],
  };
  const [label, explanation] = words[lang] ?? words.en;
  const valid = typeof asOf === 'number' && Number.isFinite(asOf) && asOf > 0;
  const date = valid ? new Date(asOf!) : null;
  const time = date ? date.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) : '—';
  const cadence = cadenceMs >= 3_600_000 ? `${cadenceMs / 3_600_000}h` : `${cadenceMs / 1000}s`;
  return { label: `${label} · ${time} UTC · ${cadence}`, title: `${explanation}. ${date ? date.toISOString() : '—'}. ${cadence}` };
}
let motionUsers = 0;
const reflectVisibility = () => { if (typeof document !== 'undefined') document.documentElement.dataset.sampledMotion = document.hidden ? 'paused' : 'running'; };
export function useSampledMotion(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (motionUsers++ === 0) { reflectVisibility(); document.addEventListener('visibilitychange', reflectVisibility); }
    return () => { if (--motionUsers === 0) { document.removeEventListener('visibilitychange', reflectVisibility); delete document.documentElement.dataset.sampledMotion; } };
  }, []);
}
export function SampledDataNote({ asOf, cadenceMs = 60_000 }: { asOf?: number | null; cadenceMs?: number }) {
  const { lang } = useLanguage(); useSampledMotion();
  const copy = sampledDisplayText(lang, asOf, cadenceMs);
  return <span className="sampled-data-note" data-sampled-note="true" data-refresh-ms={cadenceMs}
    data-observed-at={asOf ?? undefined} title={copy.title}>{copy.label}</span>;
}
