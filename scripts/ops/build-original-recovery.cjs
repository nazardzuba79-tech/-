'use strict';
// During rollback, old clients must neither reclassify an original listing nor
// silently turn a new original-mode draft into a legacy market. Keep the
// existing decoder, candle engine and financial guards, and freeze just these
// listings at the storage boundary. Other listings retain their normal path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [before, candidate, out] = process.argv.slice(2);
const manifest = require('./original-release-manifest.json');
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const restored = new Set(['api/api/routes/adminListings.js','api/services/listings/store.js']);
const hashes = {};
for (const [name, expected] of Object.entries(manifest.files)) {
  let bytes = fs.readFileSync(path.join(candidate, name));
  assert.equal(digest(bytes), expected, name);
  if (restored.has(name)) {
    const source = name.replace(/^api\//, 'dist/');
    bytes = fs.readFileSync(path.join(before, source));
    assert.equal(digest(bytes), manifest.inputs[source], source);
  } else if (name === 'worker.js') {
    const anchor = 'if (body.error) return body.error;';
    const code = bytes.toString();
    assert.equal(code.split(anchor).length, 2);
    const freeze = `
      // Only this Durable Object mutates the listing. Do the check inside its
      // request handler, without yielding between the read and the mutation.
      const recoveryRow = this.sql.exec("SELECT draft,active_version FROM listing WHERE id = ?", match[1]).toArray()[0];
      const activeConfig = recoveryRow && recoveryRow.active_version !== null
        ? JSON.parse(String(this.version(match[1], Number(recoveryRow.active_version)).config)) : null;
      if (body.value?.originalRegimeConfig || body.value?.config?.originalRegime ||
          (recoveryRow && JSON.parse(String(recoveryRow.draft)).originalRegime) || activeConfig?.originalRegime)
        return reply({error:"original_listing_read_only"},409);
    `;
    bytes = Buffer.from(code.replace(anchor, anchor + freeze));
  }
  const target = path.join(out, name);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.writeFileSync(target, bytes);
  hashes[name] = digest(bytes);
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({...manifest,files:hashes},null,2)+'\n');
