import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { compileContent, seoPages, withPageHead, type CompiledContent } from './src/lib/content/compile';

/**
 * Academy and Help are static: frontend/content/ is read and compiled while
 * the site is built, and the pages import the result as two virtual modules.
 * No API request, no database table, no server code shows an article.
 *
 * The build also writes one small HTML file per Academy/Help address — the
 * same index.html with that page's <title> and description — so a search
 * engine sees them before any script runs. Cloudflare Pages serves
 * /academy/x/y from academy/x/y.html; everything else still falls back to
 * index.html as before.
 */

const MODULES = { 'virtual:voltex-academy': 'academy', 'virtual:voltex-help': 'help' } as const;
type VirtualId = keyof typeof MODULES;

function readContent(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|json)$/.test(entry.name)) files[path.relative(dir, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return files;
}

export function voltexContent(): Plugin[] {
  let dir = '';
  let compiled: CompiledContent | null = null;
  const compile = () => (compiled ??= compileContent(readContent(dir)));

  const content: Plugin = {
    name: 'voltex-content',
    configResolved(config: ResolvedConfig) {
      dir = path.resolve(config.root, 'content');
    },
    buildStart() {
      compiled = null;
      const { problems } = compile();
      if (problems.length) this.warn(`Academy/Help content problems:\n- ${problems.join('\n- ')}`);
    },
    resolveId(id) {
      return id in MODULES ? `\0${id}` : null;
    },
    load(id) {
      if (!id.startsWith('\0virtual:voltex-')) return null;
      const key = MODULES[id.slice(1) as VirtualId];
      if (!key) return null;
      for (const file of Object.keys(readContent(dir))) this.addWatchFile(path.join(dir, file));
      return `export default ${JSON.stringify(compile()[key])};`;
    },
    configureServer(server) {
      server.watcher.add(dir);
      server.watcher.on('all', (_event, file) => {
        if (!file.startsWith(dir)) return;
        compiled = null;
        for (const id of Object.keys(MODULES)) {
          const mod = server.moduleGraph.getModuleById(`\0${id}`);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
  // A separate late plugin: index.html only exists in the bundle once Vite's
  // own HTML step has run.
  const pageHeads: Plugin = {
    name: 'voltex-content-page-heads',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const index = bundle['index.html'];
      if (!index || index.type !== 'asset') return;
      const html = String(index.source);
      for (const page of seoPages(compile())) {
        this.emitFile({ type: 'asset', fileName: `${page.path}.html`, source: withPageHead(html, page) });
      }
    },
  };
  return [content, pageHeads];
}
