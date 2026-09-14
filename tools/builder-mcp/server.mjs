import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {chromium} from 'playwright';
import {z} from 'zod';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {Workspace} from './workspace.mjs';
const workspace=await new Workspace(process.env.EZKART_WORKSPACE||join(homedir(),'.local/share/ezkart-builder')).init();
const server=new McpServer({name:'ezkart-builder',version:'1.0.0'});
let browser,page,activeProject;
let commandQueue=Promise.resolve();
const enqueue=fn=>{const next=commandQueue.catch(()=>{}).then(fn);commandQueue=next;return next;};
async function open(id){
 await workspace.read(id);
 if(page && activeProject)await call('save');
 if(!workspace.url)await workspace.start(Number(process.env.EZKART_PORT)||0);
 if(!browser)browser=await chromium.launch({headless:process.env.EZKART_HEADED!=='true'});
 if(!page)page=await browser.newPage({viewport:{width:1600,height:1000}});
 await page.goto(`${workspace.url}/cart/admin/?page=sites&edit=${encodeURIComponent(id+'.ezkart.site')}`);
 await page.waitForFunction(()=>Boolean(globalThis.EzkartBuilder),null,{timeout:30000});
 activeProject=id;return page.evaluate(()=>globalThis.EzkartBuilder.settle());
}
async function call(method,args={}){if(!page)throw new Error('Open or create a project first.');return page.evaluate(async({method,args})=>globalThis.EzkartBuilder[method](args),{method,args});}
const result=data=>({content:[{type:'text',text:JSON.stringify(data)}]});
function tool(name,description,inputSchema,fn,readOnly=false){
 server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:false}},args=>enqueue(async()=>{try{return result(await fn(args));}catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}}));
}
const identifier=z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(48);
const device=z.enum(['desktop','tablet','mobile']);
const record=z.record(z.string(),z.unknown());
tool('catalog_list','Read the real product catalog configured for this workspace.',{},()=>workspace.catalog(),true);
tool('project_list','List editable local landing-page projects.',{},async()=> (await workspace.list()).map(({id,name,url,updatedAt})=>({id,name,url,updatedAt})),true);
tool('project_create','Create an editable blank project, connect real catalog products, and open it in the actual Ezkart builder.',{id:identifier,name:z.string().min(1).max(60),productIds:z.array(z.string()).default([])},async args=>{await workspace.create(args);return open(args.id);});
tool('project_open','Open an existing workspace project in the Ezkart editor.',{id:identifier},args=>open(args.id),true);
tool('component_list','List native section components and navigation compositions available in the same library merchants use.',{},()=>call('components'),true);
tool('page_inspect','Read the section hierarchy, editable text fields, images, current spacing, and layout coordinates.',{},()=>call('inspect'),true);
tool('section_add','Insert an editable component using native Ezkart elements. Content fields vary by component: title, body, image, alt, actionLabel, actionTarget, items, etc.',{component:z.string(),id:identifier,content:record.optional(),productId:z.string().optional(),after:z.string().optional()},args=>call('addSection',args));
tool('element_update','Edit a native element. Choose a text field index from page_inspect. Layout coordinates follow page_inspect: grid units for grid elements; pixel offsets and optional pixel width/height for flow elements.',{id:z.string(),text:z.string().optional(),field:z.number().int().min(0).optional(),src:z.string().optional(),alt:z.string().optional(),autoHeight:z.boolean().optional(),style:z.record(z.string(),z.union([z.string(),z.number()])).optional(),layout:z.object({x:z.number().optional(),y:z.number().optional(),width:z.number().optional(),height:z.number().optional()}).optional(),device:device.optional()},args=>call('updateElement',args));
tool('product_grid_update','Set catalog columns and product density for a device using the native grid controls.',{id:z.string(),columns:z.enum(['auto','1','2','3','4','5','6']).optional(),density:z.enum(['compact','balanced','showcase']).optional(),device:device.optional()},args=>call('productGrid',args));
tool('section_update','Adjust a section background, label, exact device padding, or fit its height to content.',{id:z.string(),spacing:z.object({top:z.number().min(0).max(240).optional(),right:z.number().min(0).max(240).optional(),bottom:z.number().min(0).max(240).optional(),left:z.number().min(0).max(240).optional()}).optional(),device:device.optional(),background:z.string().optional(),color:z.string().optional(),name:z.string().optional(),fitHeight:z.boolean().optional()},args=>call('updateSection',args));
tool('navigation_set','Create or replace native navigation with a distinct composition and editable brand, links, and purchase action.',{layout:z.enum(['studio','masthead','split','shop','compact']),brand:z.string().optional(),links:z.array(z.object({label:z.string(),href:z.string()})).max(8).optional(),actionLabel:z.string().optional(),actionTarget:z.string().optional(),sticky:z.boolean().optional()},args=>call('navigation',args));
tool('theme_update','Set the shared page palette, typography, and primary button style.',{accent:z.string().optional(),page:z.string().optional(),ink:z.string().optional(),surface:z.string().optional(),headingFont:z.string().optional(),bodyFont:z.string().optional(),radius:z.number().optional(),buttonBackground:z.string().optional(),buttonText:z.string().optional()},args=>call('theme',args));
tool('section_move','Move a section before another section, or to the end.',{id:z.string(),before:z.string().optional()},args=>call('moveSection',args));
tool('section_remove','Remove one section. Undo can restore it.',{id:z.string()},args=>call('removeSection',args));
tool('device_set','Switch the real editor to desktop, tablet, or mobile layout.',{device},async args=>{await call('setDevice',args);return call('settle');},true);
tool('page_audit','Check the rendered page for overflow, missing images, main-heading structure, and broken section links.',{},()=>call('audit'),true);
tool('undo','Undo the last edit through the builder history.',{},()=>call('undo'));
tool('redo','Redo the last undone edit through the builder history.',{},()=>call('redo'));
tool('project_save','Persist the edited project atomically in the workspace.',{},()=>call('save'));
tool('page_export','Generate standalone storefront HTML from the same export path as the editor and save it alongside the editable project.',{},async()=>{const html=await call('exportHtml');const path=join(workspace.directory,'exports',`${activeProject}.html`);await writeFile(path,html);await call('save');return {path,bytes:Buffer.byteLength(html),project:join(workspace.directory,'projects',`${activeProject}.json`)};});
server.registerTool('page_screenshot',{description:'Inspect the actual rendered editor canvas.',inputSchema:{fullPage:z.boolean().default(false)},annotations:{readOnlyHint:true}},args=>enqueue(async()=>{try{await call('settle');const data=await (args.fullPage?page.locator('[data-sq-preview-root]'):page).screenshot();return {content:[{type:'image',data:data.toString('base64'),mimeType:'image/png'}]};}catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}}));
const cleanup=async()=>{await browser?.close();await workspace.stop();};
process.once('SIGINT',()=>{void cleanup().finally(()=>process.exit(0));});
process.once('SIGTERM',()=>{void cleanup().finally(()=>process.exit(0));});
server.server.onclose=()=>{void cleanup();};
await server.connect(new StdioServerTransport());
