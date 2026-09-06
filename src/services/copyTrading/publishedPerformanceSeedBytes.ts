import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import publishedKsenia from './canonical/fixtures/kseniaPublishedSeed.json';

export const PUBLISHED_KSENIA_STATE_SHA256 = 'b6d8ba649be521b9a4c3cab725a42b48c80b07988344c7ae19dc4e78436c0380';
export const PUBLISHED_KSENIA_RESPONSE_SHA256 = 'ae1998b7cd06366eb2fb5e3d7c1df3a8b542ffe96d8e50c05a33e91fbea30ef4';
export const PUBLISHED_KSENIA_DATE = '2026-09-06T23:59:59.999Z';
const EXPORTED_BYTES = 7_635_435;

/** Lossless package reader only: no model construction, response projection or
 * external I/O. Text stays unchanged, including existing numeric tail digits. */
export function publishedKseniaSeedBytes(): Buffer {
  if (publishedKsenia.format !== 'gzip-base64'
      || publishedKsenia.stateSha256 !== PUBLISHED_KSENIA_STATE_SHA256
      || publishedKsenia.responseSha256 !== PUBLISHED_KSENIA_RESPONSE_SHA256
      || publishedKsenia.simulatedAt !== PUBLISHED_KSENIA_DATE
      || publishedKsenia.uncompressedBytes !== EXPORTED_BYTES) {
    throw new Error('Published Ksenia seed metadata mismatch');
  }
  const bytes = gunzipSync(Buffer.from(publishedKsenia.parts.join(''), 'base64'), { maxOutputLength: EXPORTED_BYTES });
  if (bytes.length !== EXPORTED_BYTES
      || createHash('sha256').update(bytes).digest('hex') !== PUBLISHED_KSENIA_STATE_SHA256) {
    throw new Error('Published Ksenia state integrity mismatch');
  }
  return bytes;
}
