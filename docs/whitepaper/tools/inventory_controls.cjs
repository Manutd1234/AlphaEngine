const ts=require('../../../Part2_Infrastructure/web/node_modules/typescript');
const fs=require('fs'),path=require('path');
const root=path.resolve('Part2_Infrastructure/web');
const files=[];function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const q=path.join(p,e.name);if(e.isDirectory())walk(q);else if(/\.tsx?$/.test(q))files.push(q)}}
for(const dir of ['app','components','lib'])walk(path.join(root,dir));
const controls=[],listeners=[];
const norm=s=>s.replace(/\s+/g,' ').trim();
for(const file of files){const raw=fs.readFileSync(file,'utf8'),sf=ts.createSourceFile(file,raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);function visit(n){
 if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){
 const tag=n.tagName.getText(sf),attrs={};for(const a of n.attributes.properties)if(ts.isJsxAttribute(a))attrs[a.name.getText(sf)]=a.initializer?norm(a.initializer.getText(sf)):'true';
 const events=Object.keys(attrs).filter(k=>/^on[A-Z]/.test(k));
 if(['button','a','input','select','textarea','summary','Button','Select','Slider','Switch','Checkbox','TabsTrigger'].includes(tag)||events.length){
 const parent=ts.isJsxOpeningElement(n)?n.parent:null;
 const children=parent&&ts.isJsxElement(parent)?parent.children.map(c=>ts.isJsxText(c)?norm(c.text):ts.isJsxExpression(c)?norm(c.getText(sf)):ts.isJsxElement(c)?norm(c.children.filter(ts.isJsxText).map(x=>x.text).join(' ')):'').filter(Boolean).join(' '):'';
 controls.push({file:path.relative(root,file),line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,tag,label:attrs['aria-label']||attrs.title||attrs.placeholder||children||attrs.name||attrs.id||tag,attributes:attrs,events:Object.fromEntries(events.map(k=>[k,attrs[k]]))});
 }
 }
 if(ts.isCallExpression(n)&&/addEventListener$/.test(n.expression.getText(sf)))listeners.push({file:path.relative(root,file),line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,call:n.getText(sf)});
 ts.forEachChild(n,visit);
 }visit(sf)}
fs.writeFileSync('docs/whitepaper/evidence/source-controls.json',JSON.stringify({revision:require('child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:files.length,controls,listeners},null,2));
console.log(JSON.stringify({files:files.length,controls:controls.length,listeners:listeners.length}));
