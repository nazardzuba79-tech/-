// @ts-nocheck
import {readFileSync} from 'fs';
import {resolve} from 'path';
const ts=require('typescript'),crypto=require('node:crypto');
function semantic(source){
 const sf=ts.createSourceFile('component.tsx',source.replace(/\r\n/g,'\n'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const transformed=ts.transform(sf,[context=>root=>{
  const visit=node=>{
   if(ts.isJsxAttribute(node)&&['className','style','aria-pressed'].includes(node.name.getText(sf)))return undefined;
   if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(sf)==='styles'))return undefined;
   if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text.endsWith('.css'))return undefined;
   return ts.visitEachChild(node,visit,context);
  };return ts.visitNode(root,visit);
 }]);
 const result=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed}).printFile(transformed.transformed[0]);
 transformed.dispose();return crypto.createHash('sha256').update(result).digest('hex');
}

const read = name => readFileSync(resolve(__dirname, '../..',name),'utf8');
function restoreFormPresentation(source) {
 // Reverse only the approved details wrapper and repeated price-pick signal.
 // The original complete order payload, calculations and controls remain frozen.
 return source.replace(/\r\n/g,'\n')
  .replace('  pickedPriceSequence,\n','')
  .replace('  pickedPriceSequence?: number;\n','')
  .replace('[pickedPrice, pickedPriceSequence]', '[pickedPrice]')
  .replace('<details className="fo-tiersBox">','<div className="fo-tiersBox">')
  .replace('<summary className="fo-tiersTitle">', '<div className="fo-tiersTitle">')
  .replace('</summary>', '</div>').replace('</details>', '</div>');
}
describe('Futures UI-only reconciliation',()=>{
// Frozen from main 00c6dc3; exclude only CSS imports, style declarations and visual attributes.
// All render conditions, labels, callbacks, effects, API payloads and calculations are included.
test.each([
  [
    "components/FuturesOrderForm.tsx",
    // The ceiling now mirrors resulting position + active-order exposure;
    // backend FuturesPositionService remains authoritative.
    "7f76f8eb7bd189ece3aa433dbf7497c5d3845955c7be0838a1993cc2cc24ca33"
  ],
  [
    "components/FuturesAccountSummary.tsx",
    "2f43b406127e674d5df05e3a365a410e15be1d0a86057b89e48aa2dacd8c249e"
  ],
  [
    "components/LeverageSlider.tsx",
    "4672879e4ede8605fb09cc86bdd0240617ff4334074228bd39bfb4250bcecae2"
  ],
  [
    "components/MarginTypeToggle.tsx",
    "4623ca56d2987f7d215bbb5be76db9293f2d6aba92de64b063f3f97105fa1a0d"
  ],
  [
    "pages/FuturesPage.tsx",
    // Final pass: dynamic book opt-in, symbol-bound read lifecycle and repeat picks.
    // futuresFinalPolish covers exact selection and stale-response rejection.
    // Explicit Futures wallet source; other terminal wiring remains unchanged.
    "b2a5559b1856ff968f4ec5a180c4d157594a5c2f9808d60dd64fa98dc8eedde6"
  ],
  [
    "components/FuturesPairList.tsx",
    "d39e712a86da6055fd33316dad65c6d7a439dad15b897bf7bf300d6869cc7c3a"
  ],
  [
    "components/OrderBookPanel.tsx",
    "3554f48fa2bd9bad0cd2ceac2897e75ca204da597980726967d3adb012c100db"
  ],
  [
    "lib/futuresMath.ts",
    "886f8e135f998bf2bd7a0f9379bfe173eddcc1f7d898362c737b97ab5cf2a026"
  ]
])('%s preserves non-visual semantics',(name,hash)=>expect(semantic(name === 'components/FuturesOrderForm.tsx' ? restoreFormPresentation(read(name)) : read(name))).toBe(hash));
test('every new stylesheet selector is Futures-scoped',()=>{
 const css=read('pages/trade-terminal/FuturesTerminal.css');
 const selectors=[]; require('postcss').parse(css).walkRules(rule=>selectors.push(...rule.selectors));
 expect(selectors.length).toBeGreaterThan(40);
 expect(selectors.every(selector=>selector.startsWith('.futures-terminal ')||selector.startsWith('.trade-terminal.futures-terminal '))).toBe(true);
 expect(css).toContain('clamp(280px, 15vw, 290px)');
 expect(css).toContain('clamp(240px, 13vw, 250px)');
 expect(css).toContain('clamp(300px, 16vw, 310px)');
});
test('form uses styled real inputs and accessible selected-side/type state',()=>{
 const source=read('components/FuturesOrderForm.tsx');
 expect(source.match(/className="mono fo-input"/g)).toHaveLength(2);
 expect(source).not.toContain('styles.');
 expect(source).toContain("aria-pressed={side === 'BUY'}");
 expect(source).toContain("aria-pressed={type === 'MARKET'}");
 expect(source).toContain('disabled={submitting}');
});
});
