import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import help from 'virtual:voltex-help';
import { API_BASE } from '../../lib/api';
import { browserFetch } from '../../lib/browserActivity';
import { localeOf, useLanguage } from '../../lib/i18n';
import { MARKET_EDGE_BASE } from '../../lib/marketEdge';
import { openSupportWidget } from '../../lib/supportWidget';
import { faqGroups, pickLang } from '../../lib/content/academy';
import { PROBES, apiHealthUrl, edgeHealthUrl, probe, type ProbeId, type ProbeResult } from '../../lib/content/systemStatus';
import type { FeeRow, HelpContent } from '../../lib/content/types';
import { usePageMeta } from '../../lib/content/usePageMeta';
import { KnowledgeShell } from './KnowledgeShell';

/** «Помощь»: FAQ, fees, trading rules and system status. Everything but the
 * status check is static text compiled at build time. There is no «legal»
 * tab: the existing /legal/* pages stay where they are (owner, 2026-10-01). */
const TABS = ['faq', 'fees', 'rules', 'status'] as const;
type Tab = (typeof TABS)[number];
const TITLE = 'Помощь VOLTEX';

export function HelpPage() {
  const { tab } = useParams();
  const { t, lang } = useLanguage();
  const { content, fallback } = pickLang(help, lang);
  if (!TABS.includes(tab as Tab)) return <Navigate to="/help/faq" replace />;
  const current = tab as Tab;
  return (
    <KnowledgeShell active="help" fallback={fallback}>
      <header className="vx-kb-intro">
        <h1 className="vx-kb-title">{t('nav.help')}</h1>
      </header>
      <nav className="vx-kb-tabs" aria-label={t('nav.help')}>
        {TABS.map((id) => (
          <Link key={id} to={`/help/${id}`} aria-current={current === id ? 'page' : undefined} data-help-tab={id}>{t(`help.tab.${id}`)}</Link>
        ))}
      </nav>
      <div className="vx-kb-panel" data-help-panel={current}>
        {current === 'faq' && <Faq content={content} />}
        {current === 'fees' && <Fees content={content} lang={lang} />}
        {current === 'rules' && <Rules content={content} />}
        {current === 'status' && <Status content={content} />}
      </div>
      <p className="vx-kb-support">
        <span>{t('help.notFound')}</span>
        <button type="button" className="vx-kb-link-button" onClick={openSupportWidget} data-help-support>{t('help.writeSupport')}</button>
      </p>
    </KnowledgeShell>
  );
}

function Faq({ content }: { content: HelpContent }) {
  const { t } = useLanguage();
  usePageMeta(`${t('help.tab.faq')} — ${TITLE}`, 'Ответы на частые вопросы об аккаунте, пополнении, торговле и выводе на VOLTEX.');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const groups = faqGroups(content.faq, query);
  const searching = query.trim() !== '';
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <>
      <div className="vx-kb-toolbar">
        <input type="search" className="vx-kb-search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={t('help.faqSearch')} aria-label={t('help.faqSearch')} data-faq-search />
      </div>
      {groups.length === 0 && <p className="vx-kb-empty-text">{t('academy.nothingFound')}</p>}
      {groups.map((group, g) => (
        <section key={group.group} className="vx-kb-faq-group">
          <h2 className="vx-kb-h2">{group.group}</h2>
          {group.items.map((item, i) => {
            const id = `faq-${g}-${i}`;
            const expanded = searching || open.has(item.q);
            return (
              <div key={item.q} className="vx-kb-faq-item" data-faq-item>
                <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => toggle(item.q)}>
                  <span>{item.q}</span><span className="vx-kb-faq-mark" aria-hidden="true">{expanded ? '−' : '+'}</span>
                </button>
                <div id={id} className="vx-kb-faq-answer" hidden={!expanded}>{item.a}</div>
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}

function formatDate(value: string | undefined, lang: string): string {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(localeOf(lang as Parameters<typeof localeOf>[0]), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : value;
}

function FeeTable({ title, rows }: { title: string; rows: FeeRow[] }) {
  const { t } = useLanguage();
  if (!rows.length) return null;
  const confirmations = rows.some((r) => r.confirmations);
  return (
    <section className="vx-kb-block">
      <h2 className="vx-kb-h2">{title}</h2>
      <div className="vx-kb-table-wrap">
        <table className="vx-kb-table">
          <thead>
            <tr>
              <th scope="col">{t('help.fees.coin')}</th>
              <th scope="col">{t('help.fees.network')}</th>
              <th scope="col">{t('help.fees.fee')}</th>
              <th scope="col">{t('help.fees.min')}</th>
              {confirmations && <th scope="col">{t('help.fees.confirmations')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.coin}-${row.network}-${i}`}>
                <td>{row.coin}</td><td>{row.network}</td><td>{row.fee}</td><td>{row.min}</td>
                {confirmations && <td>{row.confirmations ?? '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Fees({ content, lang }: { content: HelpContent; lang: string }) {
  const { t } = useLanguage();
  usePageMeta(`${t('help.tab.fees')} — ${TITLE}`, 'Торговые комиссии, пополнение и вывод на VOLTEX.');
  const { fees } = content;
  const markets: [string, { maker: string; taker: string } | undefined][] = [
    [t('help.fees.futures'), fees.futures],
    [t('help.fees.spot'), fees.spot],
  ];
  return (
    <>
      {content.feesHtml && <div className="vx-kb-prose" dangerouslySetInnerHTML={{ __html: content.feesHtml }} />}
      {markets.some(([, m]) => m) && (
        <section className="vx-kb-block">
          <h2 className="vx-kb-h2">{t('help.fees.trading')}</h2>
          <div className="vx-kb-table-wrap">
            <table className="vx-kb-table" data-fees-trading>
              <thead><tr><th scope="col">{t('help.fees.market')}</th><th scope="col">{t('trade.makerFee')}</th><th scope="col">{t('trade.takerFee')}</th></tr></thead>
              <tbody>
                {markets.filter(([, m]) => m).map(([name, m]) => (
                  <tr key={name}><td>{name}</td><td>{m!.maker}</td><td>{m!.taker}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {fees.funding && (
        <section className="vx-kb-block">
          <h2 className="vx-kb-h2">{t('help.fees.funding')}</h2>
          <p className="vx-kb-text"><strong>{t('help.fees.interval')}:</strong> {fees.funding.interval}</p>
          {fees.funding.note && <p className="vx-kb-text">{fees.funding.note}</p>}
        </section>
      )}
      <FeeTable title={t('help.fees.deposits')} rows={fees.deposits ?? []} />
      <FeeTable title={t('help.fees.withdrawals')} rows={fees.withdrawals ?? []} />
      {fees.updated && <p className="vx-kb-updated">{t('help.updated', { date: formatDate(fees.updated, lang) })}</p>}
    </>
  );
}

function Rules({ content }: { content: HelpContent }) {
  const { t } = useLanguage();
  usePageMeta(`${t('help.tab.rules')} — ${TITLE}`, 'Как работают ордера, маржа, ликвидация и ставка финансирования на VOLTEX.');
  return (
    <div className="vx-kb-rules">
      {content.rulesToc.length > 0 && (
        <nav className="vx-kb-toc" aria-label={t('help.rules.toc')}>
          <p className="vx-kb-sidebar-title">{t('help.rules.toc')}</p>
          <ol>
            {content.rulesToc.map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(entry.id)?.scrollIntoView({ block: 'start' }); }}>{entry.title}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="vx-kb-prose" dangerouslySetInnerHTML={{ __html: content.rulesHtml }} />
    </div>
  );
}

function Status({ content }: { content: HelpContent }) {
  const { t } = useLanguage();
  usePageMeta(`${t('help.tab.status')} — ${TITLE}`, 'Отвечают ли сервер VOLTEX и рыночные данные; опубликованные сообщения о сбоях.');
  const [results, setResults] = useState<Partial<Record<ProbeId, ProbeResult>>>({});
  useEffect(() => {
    // One check each, only now that the page is open; never repeated on a timer.
    const controller = new AbortController();
    const urls: Record<ProbeId, string> = { api: apiHealthUrl(API_BASE, window.location.origin), market: edgeHealthUrl(MARKET_EDGE_BASE) };
    for (const id of PROBES) {
      void probe(urls[id], browserFetch, controller.signal).then((result) => setResults((prev) => ({ ...prev, [id]: result })), () => {});
    }
    return () => controller.abort();
  }, []);
  const label: Record<ProbeResult, string> = { ok: t('help.status.ok'), error: t('help.status.error'), unreachable: t('help.status.unreachable') };
  const names = new Map(content.components.map((c) => [c.id, c.name]));
  return (
    <>
      <section className="vx-kb-block">
        <h2 className="vx-kb-h2">{t('help.status.checks')}</h2>
        <ul className="vx-kb-status">
          {PROBES.map((id) => {
            const result = results[id];
            return (
              <li key={id} data-status-probe={id}>
                <span>{t(`help.status.${id}`)}</span>
                {result && <span className={`vx-kb-pill is-${result}`} data-status={result}>{label[result]}</span>}
              </li>
            );
          })}
        </ul>
        <p className="vx-kb-text vx-kb-status-note">{t('help.status.note')}</p>
      </section>
      <section className="vx-kb-block">
        <h2 className="vx-kb-h2">{t('help.status.incidents')}</h2>
        {content.incidents.length === 0 ? (
          <p className="vx-kb-text" data-no-incidents>{t('help.status.noIncidents')}</p>
        ) : (
          <ul className="vx-kb-incidents">
            {content.incidents.map((incident, i) => (
              <li key={`${incident.date ?? ''}-${i}`}>
                <p className="vx-kb-meta">{[incident.date, incident.status, ...(incident.components ?? []).map((id) => names.get(id) ?? id)].filter(Boolean).join(' · ')}</p>
                {incident.title && <p className="vx-kb-card-title">{incident.title}</p>}
                {incident.text && <p className="vx-kb-text">{incident.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
