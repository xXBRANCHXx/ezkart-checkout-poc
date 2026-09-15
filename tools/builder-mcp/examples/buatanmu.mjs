// A page authored exclusively through public builder tools. No HTML, CSS, or custom components.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {join} from 'node:path';
import {writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {repoRoot} from '../workspace.mjs';
const id=process.argv[2]||'ezkart-buatanmu',directory=process.env.EZKART_WORKSPACE||join(homedir(),'.local/share/ezkart-builder');
const client=new Client({name:'native-page-author',version:'1.0.0'}),log=[];
const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0]?.text);log.push({tool:name,arguments:args});return JSON.parse(r.content[0].text);};
const box=a=>({x:a[0],y:a[1],width:a[2],height:a[3]});
async function element(section,type,id,text,desktop,mobile,style={},extra={},tablet=mobile){
 await call('element_add',{section,type,id});
 await call('element_update',{id,...(text!==null?{text}:{}),style:{alignItems:'flex-start',...style},layout:box(desktop),device:'desktop',...extra});
 for(const [device,layout] of [['tablet',tablet],['mobile',mobile]])await call('element_update',{id,layout:box(layout),device});
}
async function size(id,desktop,mobile,tablet=mobile){for(const [device,value] of [['desktop',desktop],['tablet',tablet],['mobile',mobile]])await call('element_update',{id,style:{fontSize:`${value}px`},device});}
async function section(id,name,background,pad=72){await call('section_add',{component:'blank',id});await call('section_update',{id,name,background});for(const [device,p,g] of [['desktop',pad,64],['tablet',48,36],['mobile',40,24]])await call('section_update',{id,device,spacing:{top:p,right:g,bottom:p,left:g}});}
const ink='#272724',muted='#686860',paper='#faf8f3',red='#f14b35';
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[join(repoRoot,'tools/builder-mcp/server.mjs')],env:{...process.env,EZKART_WORKSPACE:directory}}));
 await call('project_create',{id,name:'Ezkart — Buatanmu. Punya tempat.',productIds:[]});
 await call('theme_update',{accent:red,page:paper,ink,surface:paper,radius:4,buttonBackground:ink,buttonText:'#ffffff',headingFont:'Poppins, sans-serif',bodyFont:'Poppins, sans-serif'});
 await call('navigation_set',{layout:'studio',brand:'ezkart',links:[{label:'Untuk bisnismu',href:'#ruang'},{label:'Cara mulai',href:'#langkah'}],actionLabel:'Bicara dengan kami ↗',actionTarget:'mulai'});
 await section('top','Buatanmu — introduction',paper,64);
 await element('top','heading','hero-title','Buatanmu.\nPunya tempat.',[1,1,7,10],[1,1,12,6],{color:ink,lineHeight:'1.05',letterSpacing:'-2.5px'},{headingLevel:'h1'},[1,1,12,6]);await size('hero-title',92,48,72);
 await element('top','text','hero-body','Kamu sudah membuat sesuatu yang berarti.\nSekarang, beri produkmu halaman yang pantas.',[1,12,6,3],[1,8,12,4],{color:muted,lineHeight:'1.65'});await size('hero-body',18,16,18);
 await element('top','button','hero-cta','Mulai dari halaman pertamamu ↗',[1,16,6,2],[1,13,12,2],{}, {action:{type:'section',target:'mulai'}});
 await element('top','text','hero-note','Halaman pertama gratis. Dibantu tim Ezkart.',[1,19,6,1],[1,16,12,2],{color:muted});await size('hero-note',12,12);
 await element('top','image','hero-image',null,[8,1,5,20],[1,19,12,11],{borderRadius:'4px',objectFit:'cover'},{src:'https://ezkart.id/assets/marketing/form-bottles.webp',alt:'Dua botol merah form. — ilustrasi produk dari Ezkart'},[1,18,12,16]);
 await section('ruang','A place for your work',paper,64);
 await element('ruang','divider','story-rule',null,[1,1,12,1],[1,1,12,1],{color:ink});
 await element('ruang','heading','story-title','Bukan sekadar\nlink di bio.',[1,3,6,6],[1,3,12,4],{lineHeight:'1.13',letterSpacing:'-2px',color:ink});await size('story-title',54,36,48);
 await element('ruang','text','story-copy','Ini tempat ceritamu bertemu produkmu. Foto yang kamu pilih. Kata-kata yang terasa seperti kamu. Dan satu halaman yang bisa kamu bagikan ke siapa saja.',[8,3,5,6],[1,8,12,6],{color:muted,lineHeight:'1.8'});await size('story-copy',18,16,18);
 await section('langkah','Three steps to your first page',ink,80);
 await element('langkah','heading','steps-title','Dari idemu,\nke halaman pertamamu.',[1,1,10,5],[1,1,12,5],{color:paper,lineHeight:'1.1',letterSpacing:'-2px'});await size('steps-title',56,36,48);
 const steps=[['01','Mulai dengan ceritamu.','Apa yang kamu buat? Untuk siapa? Ceritakan produk dan arah brand-mu kepada kami.'],['02','Beri bentuk bersama.','Kita susun foto, tulisan, dan detail produk menjadi halaman yang terasa milikmu.'],['03','Bagikan ke duniamu.','Setelah kamu merasa pas, bagikan halamanmu. Dari bio Instagram, chat, sampai pelanggan berikutnya.']];
 for(let i=0;i<steps.length;i++){
  const x=1+i*4,y=8+i*11;const [n,title,body]=steps[i];
  await element('langkah','text',`step-${i}-number`,n,[x,8,4,2],[1,y,12,2],{color:'#fc846e',fontWeight:'500'});await size(`step-${i}-number`,34,28);
  await element('langkah','heading',`step-${i}-title`,title,[x,11,4,3],[1,y+3,12,2],{color:paper,lineHeight:'1.3',letterSpacing:'-.7px'},{headingLevel:'h3'});await size(`step-${i}-title`,24,23,26);
  await element('langkah','text',`step-${i}-body`,body,[x,15,4,5],[1,y+6,12,4],{color:'#c8c7bd',lineHeight:'1.8'});await size(`step-${i}-body`,16,15,17);
 }
 await section('mulai','Start a conversation',paper,88);
 await call('section_update',{id:'mulai',gradient:{kind:'linear',from:'#faf8f3',to:'#f2d6c8',base:paper,angle:115,opacity:100}});
 await element('mulai','heading','contact-title','Bisnis kecil.\nMimpi boleh besar.',[1,1,8,6],[1,1,12,5],{color:ink,lineHeight:'1.1',letterSpacing:'-2.5px'});await size('contact-title',64,39,54);
 await element('mulai','text','contact-copy','Bawa produkmu. Kita mulai dari satu halaman yang kamu banggakan.',[1,8,7,3],[1,7,12,4],{color:muted,lineHeight:'1.65'});await size('contact-copy',20,17,19);
 await element('mulai','button','contact-whatsapp','Ceritakan idemu lewat WhatsApp ↗',[1,12,6,2],[1,12,12,2],{}, {action:{type:'url',target:'https://wa.me/62895710860502',newTab:true}});
 await element('mulai','text','contact-note','Halaman pertama gratis · Untuk bisnis di Indonesia',[1,15,8,2],[1,15,12,3],{color:muted});await size('contact-note',13,12);
 await section('footer','Ezkart footer',paper,32);
 await element('footer','text','footer-brand','ezkart',[1,1,3,2],[1,1,12,2],{color:ink,fontWeight:'600',letterSpacing:'-1px'});await size('footer-brand',30,28);
 await element('footer','text','footer-description','Produkmu. Ceritamu. Halamanmu.',[1,4,6,2],[1,4,12,2],{color:muted});await size('footer-description',13,12);
 await element('footer','button','footer-email','orders@ezkart.id ↗',[8,1,5,2],[1,7,12,2],{}, {action:{type:'email',target:'orders@ezkart.id'}});
 await element('footer','text','footer-copyright','© 2026 Ezkart. Dibuat untuk Indonesia.',[8,4,5,2],[1,10,12,2],{color:muted});await size('footer-copyright',12,11);
 await call('section_remove',{id:'blank'});
 await call('element_update',{id:'footer-email',buttonRole:'tertiary'});
 const state=await call('page_inspect');const logo=state.sections.flatMap(s=>s.elements).find(e=>e.type==='logo');if(logo)await call('element_update',{id:logo.id,src:'https://ezkart.id/assets/marketing/ezkart-logo.svg',alt:'Ezkart'});for(const section of state.sections)for(const el of section.elements)if(['heading','text','button'].includes(el.type))await call('element_update',{id:el.id,autoHeight:true});
 for(const section of state.sections)for(const device of ['desktop','tablet','mobile'])await call('section_update',{id:section.id,device,fitHeight:true});
 await call('device_set',{device:'desktop'});console.log(JSON.stringify(await call('page_audit')));await call('project_save');console.log(JSON.stringify(await call('page_export')));
 await mkdir(join(directory,'logs'),{recursive:true});await writeFile(join(directory,'logs',`${id}.json`),JSON.stringify(log,null,2));
}finally{await client.close();}
