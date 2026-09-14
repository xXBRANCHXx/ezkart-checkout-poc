import {createServer} from 'node:http';
import {readFile,writeFile,rename,mkdir,readdir} from 'node:fs/promises';
import {dirname,resolve,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
export const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug=value=>{if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)||value.length>48)throw new Error('Use a project ID of up to 48 lowercase letters, numbers, and hyphens.');return value;};
export class Workspace {
 constructor(directory){this.directory=resolve(directory);this.csrf=randomBytes(24).toString('hex');}
 async init(){await mkdir(join(this.directory,'projects'),{recursive:true});await mkdir(join(this.directory,'exports'),{recursive:true});return this;}
 async catalog(){try{return JSON.parse(await readFile(join(this.directory,'catalog.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return {products:[],storageScope:'ezkart-local',mediaBase:''};throw error;}}
 async read(id){return JSON.parse(await readFile(join(this.directory,'projects',`${slug(id)}.json`),'utf8'));}
 async list(){const files=(await readdir(join(this.directory,'projects'))).filter(file=>file.endsWith('.json'));return Promise.all(files.map(file=>this.read(file.slice(0,-5))));}
 async write(id,page){const target=join(this.directory,'projects',`${slug(id)}.json`);const data=JSON.stringify(page,null,2);if(Buffer.byteLength(data)>12*1024*1024)throw new Error('Project exceeds 12 MB.');const temp=`${target}.${randomBytes(5).toString('hex')}.tmp`;await writeFile(temp,data,{mode:0o600});await rename(temp,target);return page;}
 async create({id,name,productIds=[]}){
  slug(id);if((await this.list()).some(page=>page.id===id))throw new Error('A project with that ID already exists.');
  const {products=[]}=await this.catalog();if(productIds.some(id=>!products.some(product=>product.id===id)))throw new Error('Use product IDs from the connected catalog.');
  const now=new Date().toISOString();
  return this.write(id,{id,name,url:`${id}.ezkart.site`,status:'draft',products:productIds,customProducts:[],createdAt:now,updatedAt:now,state:{version:6,previewClass:'sq-page-preview theme-coral radius-soft layout-rich',previewStyle:'',products:productIds,spacing:'[]',selectedSection:'blank',preview:'<section class="sq-page-block sq-generated-blank" data-sq-block data-sq-fluid data-sq-min-rows="1" data-sq-rows="12" data-section-id="blank" draggable="true"></section>'}});
 }
 async markup(){
  let view=await readFile(join(repoRoot,'cart/admin/sites-builder.php'),'utf8');
  view=view.replace(/<\?= ez_admin_icon\('([^']+)'\) \?>/g,(_,name)=>`<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`)
   .replace(/<\?= ez_admin_product_art\('([^']+)'\) \?>/g,'<span class="product-art"></span>').replace(/<\?[\s\S]*?\?>/g,'');
  const index=await readFile(join(repoRoot,'cart/admin/index.php'),'utf8');const icons=(index.match(/<symbol\b[\s\S]*?<\/symbol>/g)||[]).join('');
  const catalog=await this.catalog();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ezkart builder workspace</title><link rel="stylesheet" href="admin.css"><link rel="stylesheet" href="builder-components.css"></head><body class="dashboard-page page-sites page-site-editor" data-admin-cloud-enabled="true" data-admin-storage-scope="${htmlEscape(catalog.storageScope||'ezkart-local')}" data-admin-cloud-media-base="${htmlEscape(catalog.mediaBase||'')}" data-admin-public-base="${htmlEscape(catalog.publicBase||'')}" data-admin-csrf-token="${this.csrf}"><svg style="display:none">${icons}</svg>${view}<script src="builder-components.js"></script><script src="admin.js"></script></body></html>`;
 }
 async start(port=0){
  await this.init();
  this.server=createServer(async(req,res)=>{
   const send=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type==='application/json'?JSON.stringify(data):data);};
   try{
    const host=`127.0.0.1:${this.server.address().port}`;
    if(req.headers.host!==host)return send(403,{ok:false,error:'Invalid host.'});
    if(req.headers.origin && req.headers.origin!==`http://${host}`)return send(403,{ok:false,error:'Invalid origin.'});
    const url=new URL(req.url,`http://${host}`),path=url.searchParams.get('cloud');
    if(path){
     if(req.method==='GET'){
      if(path==='/v1/catalog')return send(200,{ok:true,...await this.catalog(),drafts:[]});
      if(path==='/v1/components')return send(200,{ok:true,components:[]});
      if(path==='/v1/landing-pages')return send(200,{ok:true,pages:await this.list()});
      const match=/^\/v1\/landing-pages\/([a-z0-9-]+)$/.exec(path);
      if(match)return send(200,{ok:true,page:await this.read(match[1])});
     }
     if(req.method==='PUT'){
      if(req.headers['x-ezkart-csrf']!==this.csrf)return send(403,{ok:false,error:'Invalid editor request.'});
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>12*1024*1024)return send(413,{ok:false,error:'Project exceeds 12 MB.'});}
      const data=JSON.parse(body),match=/^\/v1\/landing-pages\/([a-z0-9-]+)(\/preview)?$/.exec(path);
      if(match){
       const page=await this.read(match[1]);
       if(match[2])return send(200,{ok:true,preview:{updatedAt:page.updatedAt,sourceUpdatedAt:page.updatedAt,version:'2',bytes:Buffer.byteLength(data.html||'')}});
       const saved=await this.write(match[1],{...page,...data,id:page.id,url:page.url,updatedAt:new Date().toISOString()});return send(200,{ok:true,page:saved});
      }
     }
     return send(404,{ok:false,error:'This local workspace does not implement that cloud operation.'});
    }
    if(url.pathname==='/cart/admin/'||url.pathname==='/cart/admin/index.php')return send(200,await this.markup(),'text/html; charset=utf-8');
    if(url.pathname==='/cart/api/health.php')return send(200,{ok:true,commerce_environment:'test'});
    if(url.pathname.startsWith('/cart/admin/')){
     const file=resolve(repoRoot,`.${decodeURIComponent(url.pathname)}`);
     if(!file.startsWith(join(repoRoot,'cart/admin/') )||!/\.(js|css|woff2|webp|png|svg|jpg)$/.test(file))return send(404,{ok:false,error:'File not found.'});
     const types={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg'};
     return send(200,await readFile(file),types[extname(file)]);
    }
    return send(404,{ok:false,error:'File not found.'});
   }catch(error){send(error.code==='ENOENT'?404:400,{ok:false,error:error.message});}
  });
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(port,'127.0.0.1',resolve);});
  this.url=`http://127.0.0.1:${this.server.address().port}`;return this.url;
 }
 async stop(){if(this.server)await new Promise(resolve=>this.server.close(resolve));}
}
