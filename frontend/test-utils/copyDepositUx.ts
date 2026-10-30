// Reverse ONLY the owner-approved Copy eligibility presentation changes, so
// historical whole-source/function hashes still protect every other byte.
// Each operation must match once; an unexpected implementation is not ignored.
function once(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error(`Expected one Copy UX anchor: ${before}`);
  return source.replace(before, after);
}

const disabledBranch = `  if (!eligible) {
    return (
      <button
        className={\`button button-copy \${compact ? 'button-small' : ''}\`}
        disabled
        title="Копитрейдинг доступен профессиональным участникам рынка с депозитом от $20 000"
      >
        <Lock size={14} /> Депозит от $20 000
      </button>
    );
  }

`;


function restoreWatchlistOnlyButton(source: string): string {
  let result = once(source,
    '  const { following, toggleFollowing } = useFollowing();',
    '  const { eligible, status, requestId, retry, isCurrent } = useCopyEligibility();\n  const { following, toggleFollowing } = useFollowing();');
  result = once(result,
    '  const isFollowing = following.has(trader.id);',
    '  const [showDepositRequirement, setShowDepositRequirement] = useState(false);\n  const isFollowing = following.has(trader.id);\n  useEffect(() => setShowDepositRequirement(false), [requestId, status]);');
  result = once(result, '  return (\n    <button\n',
    "  if (status !== 'ready') {\n    const loading = status === 'loading';\n    return <button className={`button button-copy ${compact ? 'button-small' : ''}`}\n      disabled={loading} aria-busy={loading ? 'true' : undefined}\n      title={loading ? 'Проверяем доступность копирования' : 'Не удалось проверить депозит. Нажмите, чтобы повторить.'}\n      onClick={event => { event.stopPropagation(); if (!loading) retry(); }}>\n      {loading ? 'Загрузка…' : 'Повторить проверку'}\n    </button>;\n  }\n\n" + '  return (\n    <>\n    <button\n');
  result = once(result, '        event.stopPropagation();\n        toggleFollowing(trader.id);',
    '        event.stopPropagation();\n        if (!isCurrent()) return;\n        if (!eligible) { setShowDepositRequirement(true); return; }\n        toggleFollowing(trader.id);');
  result = once(result, '    </button>\n  );',
    '    </button>\n    {showDepositRequirement && <CopyDepositDialog onClose={() => setShowDepositRequirement(false)} />}\n    </>\n  );');
  return result;
}

export function restoreCopyButtonDepositUx(source: string): string {
  // #644: reverse reviewed watchlist wording BEFORE the historical digest.
  // A changed target, action or threshold must still fail the original guard.
  let result = restoreWatchlistOnlyButton(source);
  const wording: [string, string][] = [
    ["      title=\"Локальный список наблюдения. Автокопирование сделок не запущено.\"\n", ""],
    ["isFollowing ? `Убрано из наблюдения: ${trader.name}` : `Добавлено в наблюдение: ${trader.name}`", "isFollowing ? `Копирование ${trader.name} остановлено` : `Вы копируете ${trader.name}`"],
    ["{ description: 'Только список в этом браузере. Автоматическое копирование сделок не запущено.' }", "{ description: isFollowing ? undefined : `Комиссия за результат ${Math.round(trader.performanceFee * 100)}%. Средства остаются на вашем счёте VOLTEX.` }"],
    ["{isFollowing ? <><Check size={14} /> В наблюдении</> : 'Наблюдать за трейдером'}", "{isFollowing ? <><Check size={14} /> Копируется</> : 'Копировать трейдера'}"],
  ];
  for (const [current, historical] of wording) result = once(result, current, historical);
  result = once(result, '  const { eligible, status, requestId, retry, isCurrent } = useCopyEligibility();', '  const { eligible } = useCopyEligibility();');
  result = once(result, '  useEffect(() => setShowDepositRequirement(false), [requestId, status]);\n', '');
  result = once(result, `  if (status !== 'ready') {
    const loading = status === 'loading';
    return <button className={\`button button-copy \${compact ? 'button-small' : ''}\`}
      disabled={loading} aria-busy={loading ? 'true' : undefined}
      title={loading ? 'Проверяем доступность копирования' : 'Не удалось проверить депозит. Нажмите, чтобы повторить.'}
      onClick={event => { event.stopPropagation(); if (!loading) retry(); }}>
      {loading ? 'Загрузка…' : 'Повторить проверку'}
    </button>;
  }

`, '');
  result = once(result, '        if (!isCurrent()) return;\n', '');
  result = once(result, '  const [showDepositRequirement, setShowDepositRequirement] = useState(false);\n', '');
  result = once(result, '        if (!eligible) { setShowDepositRequirement(true); return; }\n', '');
  result = once(result, '  return (\n    <>\n    <button\n', disabledBranch + '  return (\n    <button\n');
  result = once(result, '    {showDepositRequirement && <CopyDepositDialog onClose={() => setShowDepositRequirement(false)} />}\n    </>\n', '');
  return result;
}

// #144: reverse only the reviewed state/retry wiring before historical Card
// fingerprints are checked. The original digests and all other bytes stay fixed.
export function restoreCopyCheckContext(source: string): string {
  let result = once(source, `export type CopyDepositCheck = {
  status: 'loading' | 'unavailable' | 'ready';
  depositUsd: number | null;
  requestId: number;
  retry: () => void;
  isCurrent: () => boolean;
};

export type CopyEligibility = CopyDepositCheck & {`, `export type CopyEligibility = {
  depositUsd: number;`);
  result = once(result, '  check,\n', '  depositUsd,\n');
  result = once(result, '  check: CopyDepositCheck;\n', '  depositUsd: number;\n');
  result = once(result, `  const { depositUsd } = check;
  const known = check.status === 'ready' && typeof depositUsd === 'number' && Number.isFinite(depositUsd) && depositUsd >= 0;
  const value: CopyEligibility = { ...check, status: check.status === 'ready' && !known ? 'unavailable' : check.status,
    eligible: known && depositUsd >= COPY_ELIGIBILITY_THRESHOLD_USD };`,
    '  const value: CopyEligibility = { depositUsd, eligible: Number.isFinite(depositUsd) && depositUsd >= COPY_ELIGIBILITY_THRESHOLD_USD };');
  return result;
}

export function restoreCopyCheckPage(source: string): string {
  let result = once(source, "import { Nav } from '../components/Nav';", "import { useCopyDepositCheck } from './copy-trading-bolt/useCopyDepositCheck';\nimport { Nav } from '../components/Nav';");
  result = once(result, "import { FeaturedAvatarProvider } from './copy-trading-bolt/FeaturedAvatarContext';",
    "import { CopyEligibilityProvider } from './copy-trading-bolt/CopyEligibilityContext';\nimport { FeaturedAvatarProvider } from './copy-trading-bolt/FeaturedAvatarContext';");
  result = once(result, '  const [selectedTrader, setSelectedTrader] = useState<Trader>(nazarTrader);',
    '  const [selectedTrader, setSelectedTrader] = useState<Trader>(nazarTrader);\n  const depositCheck = useCopyDepositCheck();');
  result = once(result, '            <DemoRoiProvider nazar={synthetic} ksenia={ksenia}>',
    '          <CopyEligibilityProvider check={depositCheck}>\n            <DemoRoiProvider nazar={synthetic} ksenia={ksenia}>');
  result = once(result, '            </DemoRoiProvider>', '            </DemoRoiProvider>\n          </CopyEligibilityProvider>');
  result = once(result, "import { useMemo, useState } from 'react';", "import { useEffect, useMemo, useState } from 'react';");
  result = once(result, "import { useCopyDepositCheck } from './copy-trading-bolt/useCopyDepositCheck';", "import { api } from '../lib/api';");
  result = once(result, '  const depositCheck = useCopyDepositCheck();', '  const [depositUsd, setDepositUsd] = useState(0);');
  result = once(result, '  const liveNazara = useMemo(() => withStrategyIdentityVerification(', `  // The archive hardcoded a USER_DEPOSIT constant to gate the deposit
  // threshold; this account's real deposit is the most recent portfolio
  // value the Wallet page has persisted (spot + futures, priced live —
  // see portfolio.ts). A brand-new account that has never opened Wallet
  // has no snapshot yet, so it correctly reads as $0 / not eligible rather
  // than guessing.
  useEffect(() => {
    api
      .getPortfolioHistory('90d')
      .then(({ points }) => {
        const latest = points[points.length - 1];
        setDepositUsd(latest ? Number(latest.totalValueUsd) : 0);
      })
      .catch(() => setDepositUsd(0));
  }, []);

  const liveNazara = useMemo(() => withStrategyIdentityVerification(`);
  result = once(result, '<CopyEligibilityProvider check={depositCheck}>', '<CopyEligibilityProvider depositUsd={depositUsd}>');
  return result;
}

const oldGate = `function EligibilityGate({ compact = false }: { compact?: boolean }) {
  const { eligible } = useCopyEligibility();
  if (eligible) return null;
  return (
    <div className={\`eligibility \${compact ? 'eligibility-compact' : ''}\`}>
      <div className="eligibility-icon"><ShieldCheck size={17} /></div>
      <div>
        <strong>{compact ? 'Депозит от $20 000 для копирования' : 'Разблокируйте копитрейдинг'}</strong>
        {!compact && <p>Копитрейдинг доступен профессиональным участникам рынка с депозитом от $20 000.</p>}
      </div>
      {!compact && <button className="button button-outline">Увеличить депозит <ChevronRight size={15} /></button>}
    </div>
  );
}

/** Always rendered, never hidden. Below the $20,000 deposit it is present
 * but disabled and says why; at or above it, it actually starts and stops
 * copying — the Following tab reads the same list. */`;

export function restoreCopyDepositUx(source: string): string {
  const start = source.indexOf('function CopyButton(');
  const end = source.indexOf('/** The star', start);
  if (start < 0 || end <= start) throw new Error('Missing CopyButton source boundaries');
  let result = source.slice(0, start) + restoreCopyButtonDepositUx(source.slice(start, end)) + source.slice(end);
  result = once(result, "import { MonthlyPerformanceLauncher }", "import { CopyDepositDialog } from './CopyDepositDialog';\nimport { MonthlyPerformanceLauncher }");
  result = once(result, '/** Browser-only watchlist: no deposit, no finance request, no copy execution. */',
    '/** Explain the unchanged deposit requirement only after an explicit Copy\n * click. Eligible accounts continue through the existing Following action. */');
  // Restore only the removed follower-policy footer at its exact local anchor.
  result = once(result, "      {followers.length > 8 && <button className=\"button button-outline\" onClick={() => setShowAll(value => !value)}>{showAll ? 'Свернуть список' : `Показать всех подписчиков (${followers.length})`}</button>}\n", "      {followers.length > 8 && <button className=\"button button-outline\" onClick={() => setShowAll(value => !value)}>{showAll ? 'Свернуть список' : `Показать всех подписчиков (${followers.length})`}</button>}\n      {synthetic?.economics && <p className=\"daily-note\">Текущий минимум для новых подписчиков: {numberLabel(synthetic.economics.policy.currentCopyMinimum, 0)} USDT. <ReviewDisclosure neutral=\"Действует с\">В синтетическом сценарии действует с</ReviewDisclosure> {formatSyntheticHistoryDate(synthetic.economics.policy.copyMinimumPolicyEffectiveDate)}; более ранние подписчики сохраняют исторические условия.</p>}\n");
  result = once(result, '  LineChart,\n', '  LineChart,\n  Lock,\n');
  result = once(result, '  Users,\n', '  Users,\n  WalletCards,\n');
  result = once(result, "import { CopyDepositDialog } from './CopyDepositDialog';\n", '');
  result = once(result, '/** Explain the unchanged deposit requirement only after an explicit Copy\n * click. Eligible accounts continue through the existing Following action. */', oldGate);
  result = once(result, '<div><CopyButton trader={trader} /></div></div>', '<div><CopyButton trader={trader} /><small>Минимальный депозит: <b>20 000 USDT</b></small></div></div>');
  result = once(result, '  const { favorites } = useFavorites();\n  const { following } = useFollowing();', '  const { depositUsd, eligible } = useCopyEligibility();\n  const { favorites } = useFavorites();\n  const { following } = useFollowing();');
  result = once(result, '      <section className="marketplace-section">', '      <div className="access-strip"><EligibilityGate /><div className="deposit-status"><WalletCards size={17} /><div><span>Ваш депозит</span><strong>${depositUsd.toLocaleString()}.00</strong></div><span className="status-pill">{eligible ? \'Есть доступ\' : \'Нет доступа\'}</span></div></div>\n\n      <section className="marketplace-section">');
  // #644: reverse the reviewed empty-watchlist label before the older
  // guard, without accepting drift in the action or threshold.
  result = once(result,
    '<span>Откройте профиль трейдера и нажмите «Наблюдать за трейдером». Сделки не копируются автоматически.</span>',
    '<span>Откройте профиль трейдера и нажмите «Копировать трейдера».</span>');
  result = once(result, '<span>Откройте профиль трейдера и нажмите «Копировать трейдера».</span>', '<span>{eligible ? \'Откройте профиль трейдера и нажмите «Копировать трейдера».\' : \'Копирование доступно клиентам с депозитом от $20 000.\'}</span>');
  return result;
}
