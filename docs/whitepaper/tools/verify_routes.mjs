import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(new URL('../../../Part2_Infrastructure/web/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const routes=JSON.parse(fs.readFileSync('docs/whitepaper/evidence/view-manifest.json','utf8'));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await page.route('**/api/oracle/**',route=>route.abort());
const errors=[];page.on('pageerror',e=>errors.push({route:page.url(),message:e.message}));
const results=[];
try {
 await page.goto('http://127.0.0.1:3107/dashboard',{waitUntil:'domcontentloaded'});
 if(!await page.locator('.workspace-header__utility').count()){
  await page.getByRole('button',{name:/continue as guest|open the workspace|guest workspace/i}).first().click();
 }
 await page.locator('.workspace-header__utility').waitFor({state:'visible'});
 for(const r of routes){
  try{
   await page.evaluate(hash=>location.hash=hash,r.hash);
   const desk=r.desk;
   const panel=page.locator('#panel-'+desk);
   await panel.waitFor({state:'visible',timeout:10000});
   if(r.hash==='portfolio/overview')await panel.getByRole('button',{name:'Explore the sandbox book',exact:true}).click();
   await panel.locator('[id$="-subpanel-'+r.section+'"]').waitFor({state:'visible',timeout:15000});
   await page.waitForTimeout(140);
   const data=await panel.evaluate(el=>({textLength:el.innerText.trim().length,subpanels:[...el.querySelectorAll('[role="tabpanel"]')].filter(x=>x.getClientRects().length).map(x=>x.id),controls:[...el.querySelectorAll('button,input,select,textarea,a,summary')].filter(x=>x.getClientRects().length).length}));
   if(!data.subpanels.some(x=>x.endsWith('-subpanel-'+r.section)))throw Error('Expected section not visible: '+r.section);
   if(data.textLength<20)throw Error('Panel did not contain meaningful visible content');
   results.push({hash:r.hash,status:'passed',...data});
  }catch(e){results.push({hash:r.hash,status:'failed',error:e.message})}
  if(results.length%20===0)console.log('Checked',results.length,'routes');
 }
}finally{await browser.close()}
const report={date:'2026-10-05',origin:'local frontend with paid credentials blank and Oracle paths blocked; Portfolio and Risk use explicitly selected generated Sandbox',checks:'Hash navigation, expected visible workspace, non-empty visible content, uncaught page errors; not individual button or live-service success',passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,pageErrors:errors,results};
fs.writeFileSync('docs/whitepaper/evidence/route-verification.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failed:report.failed,pageErrors:errors.length}));
if(report.failed||errors.length)process.exitCode=1;
