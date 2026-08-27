import { useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { Panel, PanelHeader } from './Panel';
import { StatusBadge } from './StatusBadge';

// Ported from the archive's components/voltex/api-section.tsx. The
// archive's "Create API key" always shows a fake toast and an empty
// state — this lists, creates and revokes real keys through the HMAC
// key-management endpoints.
export function ApiSection() {
  const { t } = useLanguage();
  const [keys, setKeys] = useState<Awaited<ReturnType<typeof api.getApiKeys>>>([]);
  const [label, setLabel] = useState('');
  const [canTrade, setCanTrade] = useState(false);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<Awaited<ReturnType<typeof api.createApiKey>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.getApiKeys().then(setKeys).catch(() => {});
  }
  useEffect(reload, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const created = await api.createApiKey(label, canTrade);
      setJustCreated(created);
      setLabel('');
      setCanTrade(false);
      toast.success(t('settings.createKey'));
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.createKeyError'));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm(t('settings.revokeConfirm'))) return;
    await api.revokeApiKey(id).catch(() => {});
    reload();
  }

  function copy(text: string, label2: string) {
    navigator.clipboard?.writeText(text);
    toast.success(`${label2} ${t('deposit.copied').toLowerCase()}`);
  }

  return (
    <>
      <Panel>
        <PanelHeader
          title={t('settings.apiKeys')}
          subtitle={t('settings.apiKeysDesc')}
          action={
            <button
              onClick={() => document.getElementById('api-key-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-primary-foreground transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
            >
              <Plus className="size-4" />
              {t('settings.createKey')}
            </button>
          }
        />

        {justCreated && (
          <div className="mx-5 mt-5 rounded-xl border border-danger/40 bg-danger-soft/60 p-4 sm:mx-6">
            <div className="mb-2 text-[12px] font-bold text-danger">{t('settings.secretShownOnce')}</div>
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="text-muted-foreground">{t('settings.apiKey')}</span>
              <span className="font-mono">{justCreated.apiKey}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="flex-1 break-all font-mono text-[12px]">{justCreated.apiSecret}</span>
              <button
                onClick={() => copy(justCreated.apiSecret, t('settings.apiKey'))}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-primary-foreground"
              >
                <Copy className="size-3.5" />
                {t('deposit.copy')}
              </button>
            </div>
          </div>
        )}

        {keys.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
              <KeyRound className="size-6" />
            </span>
            <p className="mt-4 text-[15px] font-semibold text-foreground">{t('settings.noKeysYet')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-5 py-2 sm:px-6">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.keyName')}</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.keyValue')}</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.keyRights')}</th>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">{t('settings.keyLastUsed')}</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-t border-border">
                    <td className="px-2 py-3">{k.label}</td>
                    <td className="px-2 py-3 font-mono">{k.apiKey}</td>
                    <td className="px-2 py-3">
                      {k.canTrade ? (
                        <StatusBadge tone="success">{t('settings.readWrite')}</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">{t('settings.readOnly')}</StatusBadge>
                      )}
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : t('settings.neverUsed')}</td>
                    <td className="px-2 py-3 text-right">
                      <button onClick={() => handleRevoke(k.id)} className="rounded-lg border border-danger px-3 py-1.5 text-[11px] font-medium text-danger hover:bg-danger-soft">
                        {t('settings.revoke')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form id="api-key-form" onSubmit={handleCreate} className="flex flex-col gap-3 border-t border-border px-5 py-5 sm:px-6">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.keyNameLabel')}</label>
            <input
              type="text"
              required
              placeholder={t('settings.keyNamePlaceholder')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-11 rounded-xl border border-border bg-card px-3.5 text-[13.5px] text-foreground outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input type="checkbox" checked={canTrade} onChange={(e) => setCanTrade(e.target.checked)} />
            {t('settings.allowTrading')}
          </label>
          {error && <div className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-foreground px-5 py-2.5 text-[13px] font-medium text-primary-foreground transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
          >
            {creating ? t('settings.creating') : t('settings.createKey')}
          </button>
        </form>
      </Panel>

      <Panel className="mt-4">
        <PanelHeader title={t('settings.howToConnectBot')} />
        <div className="px-5 py-5 sm:px-6">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {t('settings.hmacExplainer1')} <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">X-API-KEY</code>,{' '}
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">X-API-TIMESTAMP</code> {t('settings.hmacExplainer2')}{' '}
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">X-API-SIGNATURE</code> {t('settings.hmacExplainer3')}{' '}
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">timestamp + method + path + JSON body</code> {t('settings.hmacExplainer4')}{' '}
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">{'{}'}</code> {t('settings.hmacExplainer5')}
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-secondary p-4 font-mono text-[11px] leading-relaxed text-foreground">
{`import hmac, hashlib, time, json, requests

api_key = "ak_..."
api_secret = "..."
timestamp = str(int(time.time() * 1000))
method = "POST"
path = "/api/v1/orders"
body = {"pair": "BTC/USDT", "side": "BUY", "price": "60000", "quantity": "0.01"}

message = timestamp + method + path + json.dumps(body)
signature = hmac.new(api_secret.encode(), message.encode(), hashlib.sha256).hexdigest()

requests.post(
    "https://yourdomain.com" + path,
    json=body,
    headers={
        "X-API-KEY": api_key,
        "X-API-TIMESTAMP": timestamp,
        "X-API-SIGNATURE": signature,
    },
)`}
          </pre>
        </div>
      </Panel>
    </>
  );
}
