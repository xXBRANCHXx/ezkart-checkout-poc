import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {join} from 'node:path';
import {repoRoot} from '../workspace.mjs';
const projectId=process.argv[2] || 'zero-studio';
const client=new Client({name:'zero-designer',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[join(repoRoot,'tools/builder-mcp/server.mjs')],stderr:'pipe'});
transport.stderr?.on('data',chunk=>process.stderr.write(chunk));
const base='https://ezkart-api-test.vincentbranch23.workers.dev/v1/public/media/';
const image=base+'media_947d66a098684b14ad188d7cfaed447a';
async function call(name,args={}){const r=await client.callTool({name,arguments:args});if(r.isError)throw new Error(name+': '+JSON.stringify(r));const data=r.content.find(c=>c.type==='text');console.log(name, data?.text.slice(0,130)||'image');return data?JSON.parse(data.text):r;}
try{
 await client.connect(transport); await call('project_create',{id:projectId,name:'ZERO — Sweetness, your way',productIds:['custom-84ebac2889','custom-84cd443982']});
 await call('theme_update',{accent:'#bd3d28',page:'#f8f3e9',ink:'#242822',surface:'#f8f3e9',radius:2,buttonBackground:'#bd3d28',buttonText:'#ffffff'});
 await call('navigation_set',{layout:'split',brand:'ZERO',links:[{label:'Shop ZERO',href:'#products'},{label:'Syrup & drops',href:'#formats'},{label:'How to use',href:'#ritual'},{label:'Questions',href:'#questions'}],actionLabel:'Find your flavor',actionTarget:'products',sticky:true});
 await call('section_remove',{id:'blank'});
 const sections=[
 ['hero-split','hero',{title:'Your favorite drink.\nMinus the sugar.',body:'Coffee at home. A cold drink in the afternoon. Make it yours with ZERO sugar-free syrup and drops.',image,alt:'ZERO sugar-free syrup',actionLabel:'Shop ZERO',actionTarget:'products'}],
 ['product-collection','products',{title:'Two ways to make it sweet.',body:'Choose your format, flavor, and size. Prices and availability follow your selection.'}],
 ['comparison','formats',{title:'A pour or a few drops?',leftLabel:'ZERO Syrup',rightLabel:'ZERO Drops',items:[{title:'The format',left:'A syrup made for mixing into your drink.',right:'Concentrated sweetness in a small bottle.'},{title:'Make it yours',left:'Explore coffee and fruit flavors.',right:'Choose plain or a flavored option.'},{title:'Where it fits',left:'Your coffee corner at home.',right:'Your bag, desk, or kitchen.'}]}],
 ['story-split','story',{title:'Keep the coffee.\nChange the sweetener.',body:'You already know how you like your drink. ZERO gives you another way to sweeten it.\n\nChoose plain to keep the original flavor, or try something different with your next cup.',image:base+'media_c3fd9e6f0f634834ad7bc70874b781c2',alt:'ZERO Drops concentrated sweetener'}],
 ['process','ritual',{title:'A small change\nto your daily cup.',items:[{title:'Make your usual drink.',body:'Start with the coffee, tea, or cold drink you enjoy.'},{title:'Add a little ZERO.',body:'Follow the directions on your bottle. Start small and adjust to taste.'},{title:'Stir, taste, make it yours.',body:'Find the sweetness that works for your cup.'}]}],
 ['faq-list','questions',{title:'Before your first sip.',items:[{title:'What is the difference between syrup and drops?',body:'Syrup is made for pouring and mixing. Drops are concentrated and come in smaller bottles. Choose the format that suits your routine, and follow the directions on the label.'},{title:'How do I choose a flavor and size?',body:'Select the options on either product above. The price and availability update for that selection before you add it to your cart.'},{title:'Can I order both products together?',body:'Yes. Add syrup and drops to the same cart, then review your selection before continuing to checkout.'},{title:'Where can I see delivery costs?',body:'Enter your delivery address at checkout to see the available shipping options and their cost.'}]}],
 ['call-to-action','last-sip',{title:'Make your next cup\na ZERO cup.',body:'Find your format. Pick a flavor. Start with your next drink.',actionLabel:'Choose your ZERO',actionTarget:'products'}],
 ['footer','contact',{brand:'ZERO',body:'Sweetness, your way.\nSugar-free syrup and concentrated drops.',items:[{title:'Shop ZERO',href:'#products'},{title:'Compare formats',href:'#formats'},{title:'How to use',href:'#ritual'},{title:'Questions',href:'#questions'}],copyright:'ZERO · Sugar-free sweetness'}]
 ];
 for(const [component,id,content] of sections)await call('section_add',{component,id,content});
 for(const [id,background,color] of [['hero','#e8eddf','#242822'],['formats','#e9e4d8','#242822'],['last-sip','#bd3d28','#ffffff'],['contact','#242822','#f8f3e9']])await call('section_update',{id,background,color});
 await call('element_update',{id:'hero-image',style:{objectFit:'contain'},layout:{height:19},device:'desktop'});
 await call('element_update',{id:'story-image',style:{objectFit:'contain'}});
 for(const id of ['hero','products','formats','story','ritual','questions','last-sip','contact']){
  await call('section_update',{id,spacing:{top:64,bottom:64,left:64,right:64},device:'desktop'});
  await call('section_update',{id,spacing:{top:48,bottom:48,left:32,right:32},device:'tablet'});
  await call('section_update',{id,spacing:{top:36,bottom:36,left:20,right:20},device:'mobile'});
 }
 for(const device of ['mobile','tablet','desktop']){await call('product_grid_update',{id:'products-products',columns:device==='mobile'?'1':'2',density:'showcase',device});await call('device_set',{device});await call('page_audit');}
 await call('project_save');await call('page_export');
}finally{await client.close();}
