import { canonicalFor, robotsFor } from './site';

function headElement(doc: Document, selector: string, create: () => Element): Element {
  return doc.head.querySelector(selector) ?? doc.head.appendChild(create());
}

/** Canonical, og:url and robots for the address on screen, the same values
 * the build writes into that page's static HTML. A null removes the tag. */
export function applyRouteSeo(doc: Document, pathname: string) {
  const canonical = canonicalFor(pathname);
  const robots = robotsFor(pathname);
  if (canonical) {
    headElement(doc, 'link[rel="canonical"]', () => Object.assign(doc.createElement('link'), { rel: 'canonical' })).setAttribute('href', canonical);
    headElement(doc, 'meta[property="og:url"]', () => {
      const meta = doc.createElement('meta');
      meta.setAttribute('property', 'og:url');
      return meta;
    }).setAttribute('content', canonical);
  } else {
    doc.head.querySelector('link[rel="canonical"]')?.remove();
    doc.head.querySelector('meta[property="og:url"]')?.remove();
  }
  if (robots) headElement(doc, 'meta[name="robots"]', () => Object.assign(doc.createElement('meta'), { name: 'robots' })).setAttribute('content', robots);
  else doc.head.querySelector('meta[name="robots"]')?.remove();
}
