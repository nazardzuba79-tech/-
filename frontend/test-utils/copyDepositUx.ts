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

export function restoreCopyButtonDepositUx(source: string): string {
  let result = once(source, '  const [showDepositRequirement, setShowDepositRequirement] = useState(false);\n', '');
  result = once(result, '        if (!eligible) { setShowDepositRequirement(true); return; }\n', '');
  result = once(result, '  return (\n    <>\n    <button\n', disabledBranch + '  return (\n    <button\n');
  result = once(result, '    {showDepositRequirement && <CopyDepositDialog onClose={() => setShowDepositRequirement(false)} />}\n    </>\n', '');
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
  let result = restoreCopyButtonDepositUx(source);
  result = once(result, '  LineChart,\n', '  LineChart,\n  Lock,\n');
  result = once(result, '  Users,\n', '  Users,\n  WalletCards,\n');
  result = once(result, "import { CopyDepositDialog } from './CopyDepositDialog';\n", '');
  result = once(result, '/** Explain the unchanged deposit requirement only after an explicit Copy\n * click. Eligible accounts continue through the existing Following action. */', oldGate);
  result = once(result, '<div><CopyButton trader={trader} /></div></div>', '<div><CopyButton trader={trader} /><small>Минимальный депозит: <b>20 000 USDT</b></small></div></div>');
  result = once(result, '  const { favorites } = useFavorites();\n  const { following } = useFollowing();', '  const { depositUsd, eligible } = useCopyEligibility();\n  const { favorites } = useFavorites();\n  const { following } = useFollowing();');
  result = once(result, '      <section className="marketplace-section">', '      <div className="access-strip"><EligibilityGate /><div className="deposit-status"><WalletCards size={17} /><div><span>Ваш депозит</span><strong>${depositUsd.toLocaleString()}.00</strong></div><span className="status-pill">{eligible ? \'Есть доступ\' : \'Нет доступа\'}</span></div></div>\n\n      <section className="marketplace-section">');
  result = once(result, '<span>Откройте профиль трейдера и нажмите «Копировать трейдера».</span>', '<span>{eligible ? \'Откройте профиль трейдера и нажмите «Копировать трейдера».\' : \'Копирование доступно клиентам с депозитом от $20 000.\'}</span>');
  return result;
}
