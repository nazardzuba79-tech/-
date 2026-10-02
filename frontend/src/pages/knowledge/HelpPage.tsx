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
import { AcademyHubNav } from './AcademyHubNav';
import { KnowledgeShell } from './KnowledgeShell';

type HelpView = 'faq' | 'knowledge' | 'status';
const TITLE = 'Академия VOLTEX';

export function HelpPage({ view }: { view?: HelpView } = {}) {
  const { tab } = useParams();
  const { t, lang } = useLanguage();
  const { content, fallback } = pickLang(help, lang);

  const legacyRedirect = !view
    ? tab === 'faq' ? '/academy/faq'
      : tab === 'fees' || tab === 'rules' ? '/academy/knowledge'
        : tab && tab !== 'status' ? '/academy/faq'
          : null
    : null;
  const current: HelpView = view ?? (tab === 'status' ? 'status' : 'faq');
  const title = current === 'faq' ? t('help.tab.faq')
    : current === 'knowledge' ? t('academy.hub.knowledge')
      : t('help.tab.status');
  usePageMeta(`${title} — ${TITLE}`, current === 'faq'
    ? 'Ответы на частые вопросы об аккаунте, пополнении, торговле и выводе на VOLTEX.'
    : current === 'knowledge'
      ? 'Практическая информация о комиссиях и правилах торговли на VOLTEX.'
      : 'Отвечают ли сервер VOLTEX и рыночные данные; опубликованные сообщения о сбоях.');

  if (legacyRedirect) return <Navigate to={legacyRedirect} replace />;

  return (
    <KnowledgeShell active={current === 'status' ? 'help' : 'academy'} fallback={fallback}>
      {current !== 'status' && <AcademyHubNav active={current === 'faq' ? 'faq' : 'knowledge'} />}
      <header className="vx-kb-intro">
        <h1 className="vx-kb-title">{title}</h1>
        {current === 'knowledge' && <p className="vx-kb-lead">{t('help.tab.fees')} · {t('help.tab.rules')}</p>}
      </header>
      <div className="vx-kb-panel" data-help-panel={current}>
        {current === 'faq' && <Faq content={content} />}
        {current === 'knowledge' && <KnowledgeBase content={content} lang={lang} />}
        {current === 'status' && <Status content={content} />}
      </div>
      <p className="vx-kb-support">
        <span>{t('help.notFound')}</span>
        <button type="button" className="vx-kb-link-button" onClick={openSupportWidget} data-help-support>{t('help.writeSupport')}</button>
      </p>
    </KnowledgeShell>
  );
}

export function Faq({ content, meta = true }: { content: HelpContent; meta?: boolean }) {
  const { t } = useLanguage();
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

function KnowledgeBase({ content, lang }: { content: HelpContent; lang: string }) {
  const { t } = useLanguage();
  return (
    <>
      <div className="vx-kb-grid vx-kb-grid-tight">
        <a href="#knowledge-fees" className="vx-kb-card">
          <span className="vx-kb-card-title">{t('help.tab.fees')}</span>
          <span className="vx-kb-card-text">{t('help.fees.trading')} · {t('help.fees.deposits')} · {t('help.fees.withdrawals')}</span>
        </a>
        <a href="#knowledge-rules" className="vx-kb-card">
          <span className="vx-kb-card-title">{t('help.tab.rules')}</span>
          <span className="vx-kb-card-text">{t('help.rules.toc')}</span>
        </a>
        <Link to="/academy/faq" className="vx-kb-card">
          <span className="vx-kb-card-title">{t('help.tab.faq')}</span>
          <span className="vx-kb-card-text">{t('help.faqSearch')}</span>
        </Link>
      </div>
      <section id="knowledge-fees" className="vx-kb-block">
        <h2 className="vx-kb-h2">{t('help.tab.fees')}</h2>
        <Fees content={content} lang={lang} />
      </section>
      <section id="knowledge-rules" className="vx-kb-block">
        <h2 className="vx-kb-h2">{t('help.tab.rules')}</h2>
        <Rules content={content} />
      </section>
    </>
  );
}

export function Fees({ content, lang, meta = true }: { content: HelpContent; lang: string; meta?: boolean }) {
  const { t } = useLanguage();
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

export function Rules({ content, meta = true }: { content: HelpContent; meta?: boolean }) {
  const { t } = useLanguage();
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
