import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, relative, resolve } from 'path';

/**
 * INVARIANT 12 — IF A CHANGE CAN BREAK COPY TRADING, CI MUST RUN.
 *
 * The Copy Trading regression workflow is a `paths:` filter, which means its
 * protection is exactly as good as that list — and a list maintained by hand
 * goes stale the first time someone adds an import. That is not theoretical:
 * `frontend/src/lib/api.ts` owns `getToken`, `clearToken` and the
 * `onSessionChange` broadcast that every session invariant in
 * `copyTradingCriticalPath.test.ts` depends on, and it was not in the filter.
 * A change to it could not have run a single Copy Trading test.
 *
 * So the list stops being maintained by hand. This case walks the REAL import
 * graph out of the page, the hook, the nav that prefetches it and the route
 * that serves it, and requires every file it reaches to be matched by one of
 * the workflow's own globs. Add an import, and either CI covers it or this
 * turns red with the line to add.
 *
 * It is a coverage rule, not a taste rule: it never objects to a file being
 * in the filter that the graph does not reach, so a deliberately broad glob
 * is always allowed. It only objects to a hole.
 */

const ROOT = resolve(__dirname, '../../../..');
const WORKFLOW = resolve(ROOT, '.github/workflows/copy-trading-card-regression.yml');

/**
 * The entry points a viewer actually exercises: the page itself, the store
 * behind it, the nav that prefetches it and renders on it, and the endpoint
 * that answers.
 *
 * `App.tsx` is deliberately NOT here even though it is in the workflow's
 * filter on its own merits (it owns the route and the lazy prefetch). It
 * imports every route in the product, so walking through it would make this
 * rule demand that a Copy Trading workflow run on essentially every pull
 * request — a filter that fires on everything protects nothing and only
 * teaches people to ignore it. The graph below is what the Copy Trading page
 * RENDERS, which is the honest boundary.
 */
const ENTRIES = [
  'frontend/src/pages/CopyTradingPage.tsx',
  'frontend/src/lib/useCopyMarketplace.ts',
  'frontend/src/components/Nav.tsx',
  'src/api/routes/copyPerformance.ts',
];

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;   // packages are not ours to guard
  const base = resolve(dirname(from), spec);
  for (const ext of ['.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx']) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return existsSync(base) && statSync(base).isFile() ? base : null;
}

/** Static and dynamic imports alike — the page is behind `React.lazy`, so the
 *  dynamic form is the one that reaches most of this graph. */
function importClosure(entries: string[]): string[] {
  const seen = new Set<string>();
  const queue = entries.map(entry => resolve(ROOT, entry));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try { source = readFileSync(file, 'utf8'); } catch { continue; }
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const resolved = resolveImport(file, match[1]);
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen].map(file => relative(ROOT, file)).sort();
}

/** The workflow's `paths:` entries, both triggers, as written. */
function workflowPaths(): string[] {
  return readFileSync(WORKFLOW, 'utf8').split('\n')
    .map(line => line.match(/^\s+- '(.+)'$/)?.[1])
    .filter((value): value is string => !!value);
}

function globToRegExp(glob: string): RegExp {
  const source = glob
    .split('**').map(part => part.split('*')
      .map(literal => literal.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*'))
    .join('.*');
  return new RegExp(`^${source}$`);
}

it('every file the Copy Trading page depends on triggers its regression workflow', () => {
  const globs = workflowPaths().map(globToRegExp);
  const uncovered = importClosure(ENTRIES).filter(file => !globs.some(glob => glob.test(file)));
  expect({
    hint: 'Add a paths: entry for each of these to BOTH triggers in '
      + '.github/workflows/copy-trading-card-regression.yml, or this change can break '
      + 'Nazar and Ksenia with no Copy Trading test having run.',
    uncovered,
  }).toEqual({ hint: expect.any(String), uncovered: [] });
});

it('the workflow actually runs the golden suite and the endpoint contract', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8');
  // A trigger that fires a workflow which does not run these proves nothing.
  for (const suite of [
    'frontend/src/lib/__tests__/copyTradingCriticalPath.test.ts',
    'frontend/src/lib/__tests__/copyTradingCiCoverage.test.ts',
    'src/services/copyTrading/__tests__/copyMarketplaceEndpointContract.test.ts',
  ]) expect(workflow).toContain(suite);
});
