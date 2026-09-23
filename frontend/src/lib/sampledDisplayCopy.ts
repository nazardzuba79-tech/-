export function sampledDisplayText(lang: string, asOf: number | null | undefined, cadenceMs = 60_000) {
  const words: Record<string, [string, string]> = {
    en: ['Snapshot', 'Local animation of received data; not new trades or real-time depth'],
    uk: ['Знімок', 'Локальна анімація отриманих даних; не нові угоди й не стакан у реальному часі'],
    ru: ['Снимок', 'Локальная анимация полученных данных; не новые сделки и не стакан в реальном времени'],
    es: ['Instantánea', 'Animación local de datos recibidos; no son operaciones nuevas ni profundidad en tiempo real'],
    pt: ['Instantâneo', 'Animação local dos dados recebidos; não são novas operações nem profundidade em tempo real'],
    zh: ['快照', '已接收数据的本地动画；不是新交易或实时深度'],
    ja: ['スナップショット', '取得済みデータのローカルアニメーション。新しい約定やリアルタイムの板情報ではありません'],
    ko: ['스냅샷', '수신된 데이터의 로컬 애니메이션이며 신규 체결이나 실시간 호가가 아닙니다'],
    hi: ['स्नैपशॉट', 'प्राप्त डेटा का स्थानीय एनिमेशन; नई ट्रेड या वास्तविक समय की गहराई नहीं'],
  };
  const [label, explanation] = words[lang] ?? words.en;
  const valid = typeof asOf === 'number' && Number.isFinite(asOf) && asOf > 0;
  const date = valid ? new Date(asOf!) : null;
  const time = date ? date.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) : '—';
  const cadence = cadenceMs >= 3_600_000 ? `${cadenceMs / 3_600_000}h` : `${cadenceMs / 1000}s`;
  return { label: `${label} · ${time} UTC · ${cadence}`, title: `${explanation}. ${date ? date.toISOString() : '—'}. ${cadence}` };
}
