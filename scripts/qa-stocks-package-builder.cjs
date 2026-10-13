// Offline runtime closure proof. TypeScript is a producer-only AST parser.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ts=require('typescript');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function closure(root,entrypoints=['services/stocks-global/server.mjs','services/stocks-global/local-proxy.mjs']){
  const seen=new Set(),files=[],edges=[],builtins=new Set();
  const allowed=f=>f.startsWith('services/stocks-global/')&&f.endsWith('.mjs')&&!/\.test\.mjs$/.test(f)||f==='services/stocks-simulator/engine.mjs';
  function visit(relative){
    assert.ok(allowed(relative),'Module outside reviewed Stocks runtime: '+relative);if(seen.has(relative))return;seen.add(relative);
    const source=fs.readFileSync(path.join(root,relative),'utf8'),ast=ts.createSourceFile(relative,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length,0,'Invalid runtime syntax: '+relative);
    files.push({path:relative,sha256:sha(fs.readFileSync(path.join(root,relative))),canonicalLfSha256:sha(Buffer.from(source.replace(/\r\n/g,'\n'))),bytes:fs.statSync(path.join(root,relative)).size});
    function dependency(specifier,kind){
      assert.equal(typeof specifier,'string');
      if(specifier.startsWith('node:')){assert.ok(require('node:module').isBuiltin(specifier),'Unknown builtin');builtins.add(specifier);return;}
      assert.ok(specifier.startsWith('./')||specifier.startsWith('../'),'External dependency is not admitted: '+specifier);
      const next=path.posix.normalize(path.posix.join(path.posix.dirname(relative),specifier));
      edges.push({from:relative,to:next,kind});visit(next);
    }
    function walk(node){
      if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)&&node.moduleSpecifier){assert.ok(ts.isStringLiteral(node.moduleSpecifier));dependency(node.moduleSpecifier.text,'module');}
      if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')){
        assert.ok(node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments.length===1&&ts.isStringLiteral(node.arguments[0]),'Nonliteral or CommonJS runtime dependency');dependency(node.arguments[0].text,'dynamic-import');
      }
      if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='Worker'){
        const url=node.arguments?.[0];assert.ok(url&&ts.isNewExpression(url)&&ts.isIdentifier(url.expression)&&url.expression.text==='URL','Unreviewed worker target');
        assert.ok(url.arguments?.length===2&&ts.isStringLiteral(url.arguments[0])&&url.arguments[1].getText(ast)==='import.meta.url','Unreviewed worker URL');dependency(url.arguments[0].text,'worker-url');
      }
      ts.forEachChild(node,walk);
    }walk(ast);
  }entrypoints.forEach(visit);
  return {schema:1,fixturePackagingProof:true,hashMeaning:{sha256:'actual working-copy/package bytes',canonicalLfSha256:'UTF-8 with CRLF converted to LF; separate canonical content comparison, not substituted for copied-byte validation'},entrypoints,files:files.sort((a,b)=>a.path.localeCompare(b.path)),edges,builtins:[...builtins].sort(),npmDependencies:[],parser:{name:'typescript',version:ts.version},node:{version:process.version,executableSha256:sha(fs.readFileSync(process.execPath)),platform:process.platform,arch:process.arch}};
}
function build(root,destination){
  assert.ok(!fs.existsSync(destination),'New runtime package only');const manifest=closure(root);
  fs.mkdirSync(destination,{mode:0o700});for(const file of manifest.files){const target=path.join(destination,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file.path),target,fs.constants.COPYFILE_EXCL);assert.equal(sha(fs.readFileSync(target)),file.sha256);}
  fs.writeFileSync(path.join(destination,'runtime-manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});return manifest;
}
module.exports={closure,build,sha};
