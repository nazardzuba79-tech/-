import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const root = resolve(__dirname, '../../..');
const req = createRequire(resolve(root, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const source = readFileSync(resolve(root, 'src/components/ReviewDisclosure.tsx'), 'utf8');
function render(mode: string, neutral?: unknown) {
  const out: any = {};
  const code = ts.transpileModule(source.replace('import.meta.env.MODE', JSON.stringify(mode)), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('exports', code)(out);
  return renderToStaticMarkup(React.createElement(out.ReviewDisclosure, { neutral }, React.createElement('p', null, 'synthetic disclosure')));
}
test('review removes the entire duplicate paragraph with no empty DOM or spacing node', () => {
  expect(render('review')).toBe('');
  expect(render('review', React.createElement('p', null, 'Neutral methodology'))).toBe('<p>Neutral methodology</p>');
});
test.each(['production', 'development'])('%s keeps disclosure outside explicitly labelled isolated review', mode => {
  expect(render(mode)).toBe('<p>synthetic disclosure</p>');
});
test('all seven homepage translations are behind the same removed review element; global notice preserved', () => {
  const homepage = readFileSync(resolve(root, 'src/pages/home/HomeCopyTrading.tsx'), 'utf8');
  expect(homepage).toMatch(/<ReviewDisclosure><p[^>]*>\{t\('home.copy.disclaimer'\)\}<\/p><\/ReviewDisclosure>/);
  const dictionaries = readFileSync(resolve(root, 'src/lib/i18n.tsx'), 'utf8');
  expect(dictionaries.match(/'home.copy.disclaimer':/g)).toHaveLength(7);
  const shell = readFileSync(resolve(root, 'src/review/main.tsx'), 'utf8');
  expect(shell).toContain('Copy Trading figures are synthetic');
});
