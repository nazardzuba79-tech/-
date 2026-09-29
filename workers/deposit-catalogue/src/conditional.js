/**
 * If-None-Match for the PUBLIC read only (RFC 9110 §13.1.2 and §8.8.3).
 *
 *   If-None-Match = "*" / #entity-tag
 *   entity-tag    = [ weak ] opaque-tag      weak = %s"W/"  (case-sensitive)
 *   opaque-tag    = DQUOTE *etagc DQUOTE     etagc = %x21 / %x23-7E / obs-text
 *
 * If-None-Match uses the WEAK comparison: two tags match when their
 * opaque-tags are identical, whether either is marked W/. This matters
 * because Cloudflare weakens a strong ETag when it compresses the response,
 * so browsers send back W/"…".
 *
 * A malformed header matches nothing (the full catalogue is sent), so a
 * broken or hostile value can never produce a false 304. The private
 * If-Match revision check (CAS) is a different header with its own strict
 * rule and does not use this.
 */

const OWS = /[ \t]/;
const isEtagc = (code) => code === 0x21 || (code >= 0x23 && code <= 0x7e) || code >= 0x80;

/** The opaque-tags listed in an If-None-Match value, `'*'`, or `null` when the value is malformed. */
export function parseIfNoneMatch(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '*') return '*';
  const tags = [];
  let i = 0;
  let expectTag = true;
  while (i < text.length) {
    const ch = text[i];
    if (OWS.test(ch)) { i++; continue; }
    if (ch === ',') { i++; expectTag = true; continue; }       // empty list elements are allowed (#rule)
    if (!expectTag) return null;                                // two tags without a comma
    if (text.startsWith('W/', i)) i += 2;
    if (text[i] !== '"') return null;
    const start = i++;
    while (i < text.length && text[i] !== '"') {
      if (!isEtagc(text.charCodeAt(i))) return null;
      i++;
    }
    if (text[i] !== '"') return null;                           // unterminated tag
    tags.push(text.slice(start, ++i));
    expectTag = false;
  }
  return tags.length ? tags : null;
}

/**
 * True when a GET/HEAD for a representation whose strong ETag is `etag`
 * (e.g. `"abc"`) should get 304 Not Modified.
 */
export function ifNoneMatchHits(headerValue, etag) {
  if (headerValue === null || headerValue === undefined) return false;
  const tags = parseIfNoneMatch(headerValue);
  if (tags === null) return false;
  if (tags === '*') return true;                                // the catalogue always has a current representation
  const opaque = etag.startsWith('W/') ? etag.slice(2) : etag;
  return tags.includes(opaque);
}
