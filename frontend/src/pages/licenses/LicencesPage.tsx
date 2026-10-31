import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, CheckCircle2, FileText, Globe2, Minus, Plus, X } from 'lucide-react';
import { useLanguage, localeOf } from '../../lib/i18n';
import { REGULATORY_DOCUMENTS, publishedDocuments, type RegulatoryDocument } from '../../lib/regulatoryDocuments';
import { HomeHeader } from '../home/HomeHeader';
import { HomeFooter } from '../home/HomeFooter';
import { PRESENTED_JURISDICTIONS } from './licenceJurisdictions';
import './licenses.css';

function DocumentViewer({ document, onClose }: { document: RegulatoryDocument; onClose: () => void }) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    const element = dialog.current;
    const opener = window.document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); opener?.focus(); };
  }, []);
  return <dialog ref={dialog} className="licence-viewer" aria-labelledby="licence-viewer-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="licence-viewer-bar">
      <div><h2 id="licence-viewer-title">{document.legalEntity}</h2><p>{document.documentNumber}</p></div>
      <div className="licence-viewer-tools">
        {document.documentFormat === 'image' && <>
          <button type="button" onClick={() => setZoom(value => Math.max(50, value - 25))} disabled={zoom <= 50} aria-label={t('licenses.zoomOut')}><Minus size={18} /></button>
          <output aria-live="polite">{zoom}%</output>
          <button type="button" onClick={() => setZoom(value => Math.min(300, value + 25))} disabled={zoom >= 300} aria-label={t('licenses.zoomIn')}><Plus size={18} /></button>
        </>}
        <button type="button" autoFocus onClick={onClose} aria-label={t('licenses.close')}><X size={20} /></button>
      </div>
    </div>
    <div className="licence-viewer-body">
      {document.documentFormat === 'pdf' ? <object data={document.documentUrl!} type="application/pdf" aria-label={document.documentType}><a href={document.documentUrl!} target="_blank" rel="noopener noreferrer">{t('licenses.openOriginal')}</a></object>
        : <img src={document.documentUrl!} alt={`${document.regulator} — ${document.legalEntity} — ${document.documentNumber}`} style={{ width: `${zoom}%`, maxWidth: 'none' }} />}
    </div>
    <a className="licence-original" href={document.documentUrl!} target="_blank" rel="noopener noreferrer">{t('licenses.openOriginal')} <ArrowUpRight size={15} aria-hidden="true" /></a>
  </dialog>;
}

/** Shared presentation. The production wrapper only passes gated records. */
export function LicencesContent({ documents, review = false, portfolio = false }: { documents: readonly RegulatoryDocument[]; review?: boolean; portfolio?: boolean }) {
  const { t, lang } = useLanguage();
  const [selected, setSelected] = useState<RegulatoryDocument | null>(null);
  useEffect(() => {
    if (selected && !documents.some(document => document.id === selected.id)) setSelected(null);
  }, [documents, selected]);
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(localeOf(lang), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : t('licenses.notSpecified');
  return <main className="licences-main" lang={lang}>
    <Link className="licences-back" to="/legal/about"><ArrowLeft size={15} aria-hidden="true" />{t('footer.about')}</Link>
    {review && <p className="licences-review" role="status">{t('licenses.reviewNotice')}</p>}
    <header className="licences-heading">
      <span className="licences-eyebrow">VOLTEX · {t('licenses.eyebrow')}</span>
      <h1>{t('licenses.pageTitle')}</h1>
      <p>{t('licenses.intro')}</p>
    </header>
    {portfolio && <>
      <section className="licences-jurisdictions" aria-labelledby="licences-jurisdictions-title">
        <h2 id="licences-jurisdictions-title">{t('licenses.jurisdictions')}</h2>
        <ul>{PRESENTED_JURISDICTIONS.map(jurisdiction => <li key={jurisdiction.id}>{t(jurisdiction.name)}</li>)}</ul>
      </section>
      <section className="licences-portfolio" aria-labelledby="licences-materials-title">
      <div className="licences-section-head"><h2 id="licences-materials-title">{t('licenses.presentedDocuments')}</h2><span><FileText size={16} aria-hidden="true" />{(1).toLocaleString(localeOf(lang))}</span></div>
      <p className="licences-materials-note">{t('licenses.materialsNote')}</p>
      <a className="licences-portfolio-image" href="/regulatory-documents/voltex-portfolio.png" target="_blank" rel="noopener noreferrer" aria-label={t('licenses.openImage')}>
        <img src="/regulatory-documents/voltex-portfolio.png" alt={t('licenses.portfolioAlt')} width="1536" height="1024" />
      </a>
      <a className="licences-portfolio-open" href="/regulatory-documents/voltex-portfolio.png" target="_blank" rel="noopener noreferrer">{t('licenses.openImage')} <ArrowUpRight size={15} aria-hidden="true" /></a>
      </section>
      <section className="licences-explanations" aria-labelledby="licences-explanations-title">
        <h2 id="licences-explanations-title">{t('licenses.explanationsTitle')}</h2>
        <div className="licences-jurisdiction-grid">{PRESENTED_JURISDICTIONS.map(jurisdiction => <article className="licences-jurisdiction-info" key={jurisdiction.id}>
          <h3>{t(jurisdiction.name)}</h3>
          <p className="licences-regulator-label"><CheckCircle2 size={14} aria-hidden="true" />{t('licenses.regulatorLabel')}: {jurisdiction.regulator}</p>
          <dl>
            <div><dt>{t('licenses.imageDocumentLabel')}</dt><dd>{t(jurisdiction.description)}</dd></div>
          </dl>
        </article>)}</div>
      </section>
    </>}
    {(!portfolio || documents.length > 0) && <>
    <div className="licences-section-head"><h2>{t('licenses.documents')}</h2><span><Globe2 size={16} aria-hidden="true" />{documents.length.toLocaleString(localeOf(lang))}</span></div>
    {documents.length === 0 ? <section className="licences-empty"><FileText size={32} strokeWidth={1.2} aria-hidden="true" /><h3>{t('licenses.empty')}</h3></section>
      : <div className="licences-grid">{documents.map(document => {
        const translated = document.translations[lang];
        return <article className="licence-card" key={document.id}>
          <div className="licence-card-top"><span className="licence-regulator">{document.regulator}</span><span className={`licence-status${review ? ' is-review' : ''}`}>{t(review ? 'licenses.reviewStatus' : 'licenses.active')}</span></div>
          <p className="licence-jurisdiction">{translated?.jurisdiction ?? document.jurisdiction}</p>
          <h3>{document.legalEntity}</h3>
          <p className="licence-type">{translated?.documentType ?? document.documentType}</p>
          <dl className="licence-details">
            <div className="licence-number"><dt>{t('licenses.number')}</dt><dd>{document.documentNumber}</dd></div>
            <div><dt>{t('licenses.issueDate')}</dt><dd>{date(document.issueDate)}</dd></div>
            <div><dt>{t('licenses.expiryDate')}</dt><dd>{date(document.expiryDate)}</dd></div>
          </dl>
          <div className="licence-activities"><h4>{t('licenses.activities')}</h4><ul>{(translated?.permittedActivities ?? document.permittedActivities).map(activity => <li key={activity}>{activity}</li>)}</ul></div>
          {(translated?.restrictions ?? document.restrictions) && <p className="licence-restrictions">{translated?.restrictions ?? document.restrictions}</p>}
          <button className="licence-document-button" type="button" disabled={!document.documentUrl} onClick={() => setSelected(document)}><FileText size={17} aria-hidden="true" />{t('licenses.viewDocument')}<ArrowUpRight size={17} aria-hidden="true" /></button>
        </article>;
      })}</div>}
    </>}
    {selected && <DocumentViewer document={selected} onClose={() => setSelected(null)} />}
  </main>;
}

export function LicencesPage() {
  const { t } = useLanguage();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  useEffect(() => {
    const refresh = () => setDay(new Date().toISOString().slice(0, 10));
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    const originalTitle = document.title;
    document.title = `${t('licenses.pageTitle')} | VOLTEX`;
    // The global RouteSeo already places this directive on /legal/licenses.
    // When this component is mounted outside the route shell, supply it here.
    // Never duplicate or remove a tag owned by RouteSeo.
    const existing = document.head.querySelector<HTMLMetaElement>('meta[name="robots"][content="noindex, nofollow"]');
    const robots = existing ?? document.createElement('meta');
    if (!existing) {
      robots.name = 'robots'; robots.content = 'noindex, nofollow';
      document.head.append(robots);
    }
    return () => { document.title = originalTitle; if (!existing) robots.remove(); };
  }, [t]);
  return <div className="licences-page"><div className="vx-home"><HomeHeader /></div><LicencesContent documents={publishedDocuments(REGULATORY_DOCUMENTS, new Date(`${day}T00:00:00Z`))} portfolio /><div className="vx-home"><HomeFooter /></div></div>;
}
