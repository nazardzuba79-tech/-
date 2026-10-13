import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => value.toString().replace(/\r\n/g, '\n');
export const ROOTS = ['services/stocks', 'services/stocks-global', 'services/stocks-simulator'];
export function inventory(root) {
  const rows = []; function walk(path) { for (const e of readdirSync(join(root, path), { withFileTypes: true })) {
    const f = path + '/' + e.name; if (e.isDirectory()) walk(f); else if (e.isFile()) rows.push({ file: f, sha256: hash(readFileSync(join(root, f))) }); else throw Error('SPECIAL_SOURCE_FILE');
  } } for (const r of ROOTS) walk(r); return rows.sort((a, b) => a.file.localeCompare(b.file));
}
export function transform(profile, input) {
  const text = canonical(input);
  if (profile.startsWith('projection')) {
    if (!text.includes('export function projectViewerQuote(view, instrumentId, quote, now) {')
        || !text.includes('const RESPONSE_METADATA') || !text.includes('return projected;')) throw Error('UNREVIEWED_PROJECTION_SOURCE');
    const start = text.indexOf('export function projectViewerQuote(');
    return text.slice(0, start) + 'export function projectViewerQuote(view, instrumentId, quote, now) {\n  return snapshot({ ...view, quotes: { ...view.quotes, [instrumentId]: quote } }, now);\n}\n';
  }
  const from = profile === 'wallet' ? 'quote(id,{includeUsdc:false})'
    : "hub.history(u.searchParams.get('id'),u.searchParams.get('interval')||'15m',u.searchParams.get('before'),{signal:abort.signal})";
  const to = profile === 'wallet' ? 'quote(id,{includeUsdc:true})'
    : "hub.history(u.searchParams.get('id'),u.searchParams.get('interval')||'15m',u.searchParams.get('before'))";
  if (!['wallet', 'history'].includes(profile) || text.split(from).length !== 2) throw Error('UNREVIEWED_TARGET_HUNK');
  return text.replace(from, to);
}
export function prepare(source, destination, profile, variant, sourceSha, reviewed) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || !['control', 'target'].includes(variant)) throw Error('EXACT_SOURCE_REQUIRED');
  const rel = relative(resolve(source), resolve(destination)); if (!rel || (!rel.startsWith('..' + sep) && rel !== '..')) throw Error('SHADOW_MUST_BE_OUTSIDE_SOURCE');
  mkdirSync(destination, { recursive: true }); if (readdirSync(destination).length) throw Error('SHADOW_NOT_EMPTY');
  const original = inventory(source), changes = [];
  if (Object.keys(reviewed).sort().join('|') !== ['services/stocks-global/server.mjs','services/stocks-global/viewer-projection.mjs'].join('|')) throw Error('REVIEWED_SOURCE_SET_INVALID');
  for (const [file, expected] of Object.entries(reviewed)) if (!/^[a-f0-9]{64}$/.test(expected) || hash(canonical(readFileSync(join(source, file)))) !== expected) throw Error('SOURCE_HASH_NOT_REVIEWED');
  for (const r of ROOTS) cpSync(join(source, r), join(destination, r), { recursive: true });
  if (variant === 'control' && profile !== 'identity') {
    const file = profile.startsWith('projection') ? 'services/stocks-global/viewer-projection.mjs' : 'services/stocks-global/server.mjs';
    const input = readFileSync(join(source, file));
    if (hash(canonical(input)) !== reviewed[file]) throw Error('SOURCE_HASH_NOT_REVIEWED');
    const output = transform(profile, input); writeFileSync(join(destination, file), output);
    changes.push({ file, before: hash(input), after: hash(output) });
  }
  const built = inventory(destination), actual = built.filter((row, i) => row.file !== original[i]?.file || row.sha256 !== original[i]?.sha256);
  if (built.length !== original.length || actual.length !== changes.length || actual.some(row => !changes.some(change => change.file === row.file && change.after === row.sha256))) throw Error('UNRELATED_SHADOW_CHANGE');
  return { sourceSha, profile, variant, original, built, changes, measuredTreeHash: hash(JSON.stringify(built)), productionEquivalent: variant === 'target' || profile === 'identity' };
}
