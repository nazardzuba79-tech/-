import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { styles } from './adminStyles';
import { Skeleton } from '../../components/Skeleton';

type Wallet = Awaited<ReturnType<typeof api.getAdminWallets>>[number];

const CHAIN_LABEL: Record<string, string> = {
  bitcoin: 'Bitcoin',
  tron: 'Tron',
  ethereum: 'Ethereum',
  bsc: 'BNB Smart Chain',
  solana: 'Solana',
  ton: 'TON',
};

// The token-standard suffix shown after each NON-native asset, so
// "USDT (ERC-20)" reads unambiguously as "USDT, on this network".
const TOKEN_STANDARD_LABEL: Record<string, string> = {
  ethereum: 'ERC-20',
  bsc: 'BEP-20',
  tron: 'TRC-20',
  solana: 'SPL',
  ton: 'Jetton',
};

// One row per asset this ONE address accepts, each tagged with what it
// actually is — "монета сети" (native coin) vs "токен на этой сети"
// (a token riding on the same network) — instead of a flat "ETH, USDT"
// list that reads as two native coins on two different addresses. Tron
// deposits only support TRC-20 tokens (USDT) — native TRX deposits aren't
// implemented (see TronDepositVerifier), so its native asset is omitted.
function supportedAssetRows(chain: string, nativeAsset: string, tokens: string[]): { label: string; note: string }[] {
  const standard = TOKEN_STANDARD_LABEL[chain];
  const tokenRows = tokens.map((token) => ({
    label: standard ? `${token} (${standard})` : token,
    note: `токен на этой же сети${standard ? `, стандарт ${standard}` : ''}`,
  }));
  if (chain === 'tron') return tokenRows;
  return [{ label: nativeAsset, note: 'монета этой сети' }, ...tokenRows];
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
          {wallets.map((w) => {
            const assetRows = w.nativeAsset ? supportedAssetRows(w.chain, w.nativeAsset, w.tokens) : [];
            return (
            <div key={w.chain} style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{CHAIN_LABEL[w.chain] ?? w.chain}</div>
                  {!w.nativeAsset && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Сеть не настроена на бэкенде</div>}
                  {assetRows.length === 0 && w.nativeAsset && (
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>нет поддерживаемых активов</div>
                  )}
                  {assetRows.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                      {assetRows.length > 1 && (
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                          Один и тот же адрес принимает {assetRows.length === 2 ? 'оба актива' : 'все активы'} ниже:
                        </div>
                      )}
                      {assetRows.map((row) => (
                        <div key={row.label} style={{ fontSize: 12.5 }}>
                          <span className="mono" style={{ fontWeight: 700 }}>{row.label}</span>
                          <span style={{ color: 'var(--text-tertiary)' }}> — {row.note}</span>
                        </div>
                      ))}
                    </div>
                  )}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
