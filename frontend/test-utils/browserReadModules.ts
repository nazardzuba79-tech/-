import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';

/** Existing component harnesses compile TSX with explicit dependency seams.
 * Run the real shared read hooks too, using their fake React/API/document.
 */
export function browserReadModules(react: any, api: any, doc: any = typeof document === 'undefined' ? undefined : document) {
  doc ??= { hidden: false, addEventListener() {}, removeEventListener() {} };
  const compile = (name: string, imports: Record<string, any>) => {
    const source = readFileSync(resolve(__dirname, '../src/lib', name + '.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const result: any = {};
    new Function('require', 'exports', 'document', code)((key: string) => {
      if (!(key in imports)) throw new Error(`Unexpected read-hook dependency: ${key}`);
      return imports[key];
    }, result, doc);
    return result;
  };
  const visible = compile('visibleRead', {});
  const mark = compile('useFuturesMark', { react, './api': { api }, './visibleRead': visible });
  return { visible, mark };
}
