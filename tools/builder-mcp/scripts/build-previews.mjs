// Render the real components, using the same illustrative bottle as Ezkart.id.
// Preview-only catalog data never enters a merchant's projects or catalog.
import {chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Workspace,repoRoot} from '../workspace.mjs';
const directory=await mkdtemp(join(tmpdir(),'ezkart-component-previews-'));
const asset='https://ezkart.id/assets/marketing/form-bottles.webp';
const products=['red','rose'].map((color,i)=>({id:`preview-${color}`,name:i?'Botol harian — Rose':'Botol harian — Red',description:'500 ml · Stainless steel',price:189000,image:asset,images:[asset],media:[{id:`preview-${color}`}],stock:10,weightGrams:350,type:'physical'}));
const ws=await new Workspace(directory).init();await writeFile(join(directory,'catalog.json'),JSON.stringify({products,mediaBase:'https://component-preview.invalid'}));await ws.create({id:'previews',name:'Component previews',productIds:products.map(p=>p.id)});await ws.start();
const browser=await chromium.launch(),editor=await browser.newPage({viewport:{width:1600,height:1000}}),render=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const out=join(repoRoot,'cart/admin/assets/components');await mkdir(out,{recursive:true});
const photo=Buffer.from(await (await fetch(asset)).arrayBuffer());
for(const page of [editor,render])await page.route('https://component-preview.invalid/**',route=>route.fulfill({body:photo,contentType:'image/webp'}));
let html='';await render.route('**/component-preview',route=>route.fulfill({body:html,contentType:'text/html'}));
try{
 await editor.goto(ws.url+'/cart/admin/?page=sites&edit=previews.ezkart.site');await editor.waitForFunction(()=>globalThis.EzkartBuilder);
 const invoke=(method,args={})=>editor.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
 await invoke('theme',{accent:'#f44b34',page:'#ffffff',ink:'#222222',surface:'#ffffff',radius:9,buttonBackground:'#242424',buttonText:'#ffffff'});
 const library=await invoke('components');let previous='blank';
 const capture=async(id,selector)=>{
  html=await invoke('exportHtml');await render.goto(ws.url+'/component-preview');await render.evaluate(()=>document.fonts.ready);
  await render.locator(selector+' img').evaluateAll(images=>Promise.all(images.map(img=>{img.loading='eager';return img.decode().catch(()=>{});})));await render.waitForTimeout(80);
  await render.addStyleTag({content:'.sq-page-preview{min-height:0!important}.sq-page-block{outline:0!important}[data-ezkart-cart-open]{display:none!important}'});
  const file=join(directory,id+'.png');await render.locator(selector).screenshot({path:file});
  execFileSync('magick',[file,'-resize','640x416','-background','#f7f8fa','-gravity','center','-extent','640x416','-quality','88',join(out,id+'.webp')]);console.log(id);
 };
 for(const component of library.sections){
  const content=component.id.includes('showcase')||['brand-navigation','journey-timeline','support-questions','contact-invitation','brand-footer'].includes(component.id)?{}:{title:'Teman setiap hari.',body:'Produk pilihan untuk aktivitasmu. Pilih yang paling pas untuk harimu.',image:asset,imageTwo:asset,alt:'Botol form. dari ilustrasi Ezkart',actionLabel:'Lihat koleksi',actionTarget:'products',brand:'Ezkart',caption:'Dibuat untuk keseharian.',captionTwo:'Temukan pilihanmu.'};
  await invoke('addSection',{component:component.id,id:'preview-'+component.id,content});await invoke('removeSection',{id:previous});previous='preview-'+component.id;
  await capture(component.id,`[data-ezkart-section="${previous}"]`);
 }
 for(const nav of library.navigation){await invoke('navigation',{layout:nav.id,brand:'Ezkart',links:[{label:'Produk',href:'#products'},{label:'Cerita kami',href:'#story'},{label:'Tanya jawab',href:'#questions'}],actionLabel:'Mulai di sini',actionTarget:'#products'});await capture('nav-'+nav.id,'.sq-authored-navigation');}
}finally{await browser.close();await ws.stop();await rm(directory,{recursive:true,force:true});}
