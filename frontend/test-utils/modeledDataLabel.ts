import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

// Evaluate the actual TSX label for source-based card/profile SSR without
// changing the root Jest JSX configuration or replacing the boolean guard.
const frontend = resolve(__dirname, '..');
const requireFrontend = createRequire(resolve(frontend, 'package.json'));
const source = readFileSync(resolve(frontend, 'src/components/ModeledDataLabel.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const output: Record<string, any> = {};
new Function('require', 'exports', compiled)((name: string) => {
  if (name.endsWith('.css')) return {};
  if (name === '../lib/i18n') return { useLanguage: () => ({ lang: 'ru' }) };
  return requireFrontend(name);
}, output);
export const ModeledDataLabel = output.ModeledDataLabel;
