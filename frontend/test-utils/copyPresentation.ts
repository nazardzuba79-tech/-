import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '..');
const req = createRequire(resolve(frontend, 'package.json'));
const source = readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/components.tsx'), 'utf8');
const ast = ts.createSourceFile('components.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Execute selected production components without importing unrelated account
 * transports. Every helper and JSX body comes from the current source tree;
 * callers supply only explicit hook/provider or unrelated widget fixtures. */
export function copyFunctions(names: string[], dependencies: Record<string, unknown>) {
  const declarations = names.map(name => {
    const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
    if (!node) throw new Error(`Missing production component ${name}`);
    return node.getText(ast);
  });
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(`${declarations.join('\n')}\n${names.map(name => `exports.${name} = ${name};`).join('\n')}`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'exports', ...Object.keys(dependencies), code)(req, exports, ...Object.values(dependencies));
  return exports;
}

/** Use the real pending context and metric markup, including its distinction
 * between in-flight skeletons and a settled, unavailable figure. */
export function liveMetricModule() {
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/LiveMetric.tsx'), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'exports', code)(req, exports);
  return exports;
}
