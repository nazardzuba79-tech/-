'use strict';
// Offline source/recipe check. Does not import modules, open storage or contact providers.
const fs = require('node:fs');
const path = require('node:path');
const { isBuiltin, createRequire } = require('node:module');
const ts = require('typescript');

function verifyClosure(root, recipe = fs.readFileSync(path.join(root, 'services/stocks-global/Dockerfile.release'), 'utf8')) {
  root = path.resolve(root);
  const copies = { build: [], runtime: [] };
  let stage;
  for (const line of recipe.split(/\r?\n/)) {
    const from = line.match(/^FROM \S+ AS (\w+)$/);
    if (from) stage = from[1];
    if (!copies[stage] || !line.startsWith('COPY ')) continue;
    const copy = line.match(/^COPY (?:--from=build )?(?:\/app\/)?(services\/\S+) (\.\/)?(services\/\S+)$/);
    if (copy) {
      const src = copy[1].replace(/\/$/, ''), dest = copy[3].replace(/\/$/, '');
      if (src !== dest) throw Error('RUNTIME_COPY_RELOCATION_UNSUPPORTED ' + line);
      copies[stage].push(src);
    }
  }
  const visited = new Set(), edges = [], packages = new Set();
  function visit(file, parent = 'entrypoint') {
    file = path.posix.normalize(file);
    if (!file.startsWith('services/') || file.includes('../')) throw Error('RUNTIME_PATH_ESCAPE ' + file);
    if (!fs.existsSync(path.join(root, file))) throw Error(`RUNTIME_MODULE_MISSING ${parent} -> ${file}`);
    for (const stage of ['build', 'runtime']) {
      if (!copies[stage].some(src => file === src || file.startsWith(src + '/')))
        throw Error(`RUNTIME_MODULE_NOT_PACKAGED ${stage}: ${parent} -> ${file}`);
    }
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (source.parseDiagnostics.length) throw Error('RUNTIME_MODULE_PARSE_FAILED ' + file);
    function dependency(arg) {
      if (!arg || !ts.isStringLiteralLike(arg)) throw Error('RUNTIME_DYNAMIC_IMPORT_UNREVIEWED ' + file);
      const spec = arg.text;
      if (isBuiltin(spec)) return;
      if (!spec.startsWith('.')) {
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
        if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name) ||
            !lock.packages?.['node_modules/' + name]?.integrity ||
            !fs.existsSync(path.join(root, 'node_modules', name, 'package.json')) ||
            !/^RUN npm ci --ignore-scripts /m.test(recipe) ||
            !/^COPY --from=build \/app\/node_modules \.\/node_modules$/m.test(recipe))
          throw Error(`RUNTIME_EXTERNAL_IMPORT_UNPACKAGED ${file}: ${spec}`);
        createRequire(path.join(root, 'package.json')).resolve(spec);
        packages.add(name);
        return;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      edges.push({ from: file, to: target });
      visit(target, file);
    }
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) dependency(node.moduleSpecifier);
      if (ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
           ts.isIdentifier(node.expression) && node.expression.text === 'require')) dependency(node.arguments[0]);
      // Include worker modules addressed through new URL(..., import.meta.url).
      // Directory URL('../../', ...) is used only to compute the source root.
      if (ts.isNewExpression(node) && node.expression.getText(source) === 'URL' &&
          node.arguments?.[1]?.getText(source) === 'import.meta.url') {
        const arg = node.arguments[0];
        if (!ts.isStringLiteralLike(arg)) throw Error('RUNTIME_DYNAMIC_URL_UNREVIEWED ' + file);
        if (!arg.text.endsWith('/')) dependency(arg);
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  visit('services/stocks-global/release-entrypoint.mjs');
  return { status: 'PASS_SOURCE_CLOSURE_ONLY', modules: [...visited].sort(),
    packages: [...packages].sort(), edges, imageSmoke: 'NOT_RUN' };
}
module.exports = { verifyClosure };
if (require.main === module) {
  try { console.log(JSON.stringify(verifyClosure(path.resolve(process.argv[2] || '.')), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
