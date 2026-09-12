import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';

const code=ts.transpileModule(readFileSync(resolve(__dirname,'../../pages/home/HomeSapphireHero.tsx'),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const output:any={};new Function('require','exports',code)(()=>({}),output);
test.each([[1600,800,false],[390,252,true]])('real DOM display follows all four artwork corners at %s px',(width,height,mobile)=>{
  const w=Number(width),h=Number(height),m=Boolean(mobile),values=output.sapphireProjection(w,h,m).slice(9,-1).split(',').map(Number);
  expect(values.every(Number.isFinite)).toBe(true);
  const scale=Math.max(w/1672,h/941),ox=(w-1672*scale)*(m?1:.5),oy=(h-941*scale)/2;
  [[0,0],[1000,0],[1000,600],[0,600]].forEach(([x,y],i)=>{
    const divisor=values[3]*x+values[7]*y+1;
    expect((values[0]*x+values[4]*y+values[12])/divisor).toBeCloseTo(output.SAPPHIRE_SCREEN[i][0]*scale+ox,4);
    expect((values[1]*x+values[5]*y+values[13])/divisor).toBeCloseTo(output.SAPPHIRE_SCREEN[i][1]*scale+oy,4);
  });
});
