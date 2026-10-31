import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as policy from '../../../../src/shared/copyStrategySocials';
import { marketplaceTraders } from '../../pages/copy-trading-bolt/traders';
import { lockedCatalogueTraders } from '../../pages/copy-trading-bolt/lockedCatalogue';
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const compiled = ts.transpileModule(readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/StrategySocials.tsx'),'utf8'), {compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
const output: any = {};
new Function('require','exports',compiled)((name:string)=>name.endsWith('.css')?{}:name.endsWith('copyStrategySocials')?policy:name.endsWith('/api')?{getToken:()=>null,onSessionChange:()=>()=>{}}:req(name),output);
const render = (id:string, links:unknown) => renderToStaticMarkup(React.createElement(output.StrategySocialProvider,{identities:[{traderId:id,...links as object}]},React.createElement(output.StrategySocialLinks,{traderId:id})));
test.each(['VX-001','VX-KSENIA'])('%s publishes independently validated links only',id=>{
  let html=render(id,{xUrl:'https://twitter.com/Owner',telegramUrl:null});
  expect(html).toContain('href="https://x.com/owner"');expect(html).toContain('target="_blank"');expect(html).toContain('rel="noopener noreferrer"');expect(html.match(/disabled=""/g)).toHaveLength(1);
  html=render(id,{xUrl:'javascript:alert(1)',telegramUrl:'https://t.me/owner_test'});
  expect(html).not.toContain('javascript:');expect(html).toContain('href="https://t.me/owner_test"');expect(html.match(/disabled=""/g)).toHaveLength(1);
});
test('every catalogue/extra VIP remains disabled even with deliberately injected valid URLs',()=>{
  for(const id of [...marketplaceTraders,...lockedCatalogueTraders].map(t=>t.id).filter(id=>!policy.canPublishStrategySocials(id)).concat(['VX-VIP-3','VX-VIP-4'])) {
    const html=render(id,{xUrl:'https://x.com/owner',telegramUrl:'https://t.me/owner_test'});
    expect(html).not.toContain('href=');expect(html).not.toContain('<a ');expect(html.match(/disabled=""/g)).toHaveLength(2);expect(html).toContain('X (Twitter)');expect(html).toContain('Telegram');
  }
});
test('both empty icons remain visible; no generic profile links or editor for others',()=>{
  const html=render('VX-001',{});expect(html.match(/<svg /g)).toHaveLength(2);expect(html).not.toContain('href=');
  expect(renderToStaticMarkup(React.createElement(output.StrategySocialEditor,{traderId:'VX-VIP-3'}))).toBe('');
});
