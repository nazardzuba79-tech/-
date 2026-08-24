import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { styles } from './adminStyles';
import { Skeleton } from '../../components/Skeleton';

type Wallet = Awaited<ReturnType<typeof api.getAdminWallets>>[number];

const CHAIN_LABEL: Record<string, string> = { bitcoin: 'Bitcoin', tron: 'Tron — USDT (TRC-20)', ethereum: 'Ethereum' };

// Tron deposits only support TRC-20 tokens (USDT) — native TRX deposits
// aren't implemented (see TronDepositVerifier), so showing the native
// asset here would incorrectly suggest sending plain TRX works.
function supportedAssetsLabel(chain: string, nativeAsset: string, tokens: string[]): string {
  if (chain === 'tron') return tokens.length ? tokens.join(', ') + ' (TRC-20)' : 'нет поддерживаемых активов';
  return `${nativeAsset}${tokens.length ? `, ${tokens.join(', ')}` : ''}`;
}

/** Кошельки для пополнения — один адрес приёма депозитов на каждую сеть.
 * Сохранение сразу применяется везде, где бэкенд отдаёт адрес пользователю
 * (см. TreasuryWalletService на бэкенде) — без передеплоя. */
export function AdminWalletsPage() {
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyChain, setBusyChain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedChain, setSavedChain] = useState<string | null>(null);

  function reload() {
    api.getAdminWallets().then((rows) => {
      setWallets(rows);
      setDrafts(Object.fromEntries(rows.map((r) => [r.chain, r.address ?? ''])));
    });
  }

  useEffect(reload, []);

  async function handleSave(chain: string) {
    setError(null);
    setSavedChain(null);
    setBusyChain(chain);
    try {
      await api.setAdminWalletAddress(chain, drafts[chain]?.trim() ?? '');
      setSavedChain(chain);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить адрес.');
    } finally {
      setBusyChain(null);
    }
  }

  async function handleReset(chain: string) {
    setError(null);
    setSavedChain(null);
    setBusyChain(chain);
    try {
      await api.resetAdminWallet(chain);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сбросить адрес.');
    } finally {
      setBusyChain(null);
    }
  }

  return (
    <div>
      <h1 style={styles.title}>Кошельки для пополнения</h1>
      {error && <div style={{ ...styles.errorBox, marginBottom: 16 }}>{error}</div>}

      {!wallets && (
        <div style={{ ...styles.card, gap: 20 }}>
          <Skeleton height={80} />
          <Skeleton height={80} />
          <Skeleton height={80} />
        </div>
      )}

      {wallets && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {wallets.map((w) => (
            <div key={w.chain} style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{CHAIN_LABEL[w.chain] ?? w.chain}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {w.nativeAsset ? supportedAssetsLabel(w.chain, w.nativeAsset, w.tokens) : 'Сеть не настроена на бэкенде'}
                  </div>
                </div>
                {w.isOverridden ? (
                  <span style={{ ...styles.badgeAccent, borderRadius: 20, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>
                    Изменён администратором
                  </span>
                ) : (
                  <span style={{ ...styles.badgeDim, borderRadius: 20, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>
                    Значение по умолчанию
                  </span>
                )}
              </div>

              <label style={styles.label}>
                Адрес кошелька
                <input
                  type="text"
                  style={{ ...styles.input, fontFamily: 'var(--font-mono)' }}
                  value={drafts[w.chain] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [w.chain]: e.target.value }))}
                  placeholder="Адрес для приёма депозитов"
                />
              </label>

              {w.isOverridden && w.updatedAt && (
                <div style={styles.hint}>Изменено: {new Date(w.updatedAt).toLocaleString('ru-RU')}</div>
              )}
              {savedChain === w.chain && <div style={styles.successBox}>Адрес сохранён.</div>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  style={styles.primaryBtn}
                  disabled={busyChain === w.chain || !drafts[w.chain]?.trim()}
                  onClick={() => handleSave(w.chain)}
                >
                  Сохранить
                </button>
                {w.isOverridden && (
                  <button style={styles.neutralBtn} disabled={busyChain === w.chain} onClick={() => handleReset(w.chain)}>
                    Сбросить к значению по умолчанию
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
