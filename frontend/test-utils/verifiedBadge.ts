import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

// Evaluate the real shared TSX without adding JSX settings to the root Jest
// project. This is the same source-based SSR pattern used by the Copy tests;
// the verification SVG and its boolean guard are never replaced by a stub.
const frontend = resolve(__dirname, '..');
const requireFrontend = createRequire(resolve(frontend, 'package.json'));
const source = readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/VerifiedBadge.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const output: Record<string, any> = {};
new Function('require', 'exports', compiled)(requireFrontend, output);
export const VerifiedBadge = output.VerifiedBadge;
