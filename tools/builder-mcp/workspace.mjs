import {createServer} from 'node:http';
import {readFile,writeFile,rename,mkdir,readdir} from 'node:fs/promises';
import {dirname,resolve,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
export const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug=value=>{if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)||value.length>48)throw new Error('Use a project ID of up to 48 lowercase letters, numbers, and hyphens.');return value;};
export class Workspace {
 constructor(directory){this.directory=resolve(directory);this.csrf=randomBytes(24).toString('hex');}
 async init(){await mkdir(join(this.directory,'projects'),{recursive:true});await mkdir(join(this.directory,'exports'),{recursive:true});await mkdir(join(this.directory,'previews'),{recursive:true});await mkdir(join(this.directory,'uploads'),{recursive:true});return this;}
 async catalog(){try{return JSON.parse(await readFile(join(this.directory,'catalog.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return {products:[],storageScope:'ezkart-local',mediaBase:''};throw error;}}
 async read(id){
  const page=JSON.parse(await readFile(join(this.directory,'projects',`${slug(id)}.json`),'utf8'));
  try { return {...page,...JSON.parse(await readFile(join(this.directory,'previews',`${slug(id)}.json`),'utf8'))}; }
  catch(error){if(error.code==='ENOENT')return page;throw error;}
 }
 async list(){const files=(await readdir(join(this.directory,'projects'))).filter(file=>file.endsWith('.json'));return Promise.all(files.map(file=>this.read(file.slice(0,-5))));}
 async write(id,page){const target=join(this.directory,'projects',`${slug(id)}.json`);const data=JSON.stringify(page,null,2);if(Buffer.byteLength(data)>12*1024*1024)throw new Error('Project exceeds 12 MB.');const temp=`${target}.${randomBytes(5).toString('hex')}.tmp`;await writeFile(temp,data,{mode:0o600});await rename(temp,target);return page;}
 async create({id,name,productIds=[]}){
  slug(id);if((await this.list()).some(page=>page.id===id))throw new Error('A project with that ID already exists.');
  const {products=[]}=await this.catalog();if(productIds.some(id=>!products.some(product=>product.id===id)))throw new Error('Use product IDs from the connected catalog.');
  const now=new Date().toISOString();
  return this.write(id,{id,name,url:`${id}.ezkart.site`,status:'draft',products:productIds,customProducts:[],createdAt:now,updatedAt:now,state:{version:6,previewClass:'sq-page-preview theme-coral radius-soft layout-rich',previewStyle:'',products:productIds,spacing:'[]',selectedSection:'blank',preview:'<section class="sq-page-block sq-generated-blank" data-sq-block data-sq-fluid data-sq-min-rows="1" data-sq-rows="12" data-section-id="blank" draggable="true"></section>'}});
 }
 async markup(library=false){
  let view=await readFile(join(repoRoot,library?'cart/admin/sites-library.php':'cart/admin/sites-builder.php'),'utf8');
  view=view.replace(/<\?= ez_admin_icon\('([^']+)'\) \?>/g,(_,name)=>`<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`)
   .replace(/<\?= ez_admin_product_art\('([^']+)'\) \?>/g,'<span class="product-art"></span>').replace(/<\?[\s\S]*?\?>/g,'');
  const index=await readFile(join(repoRoot,'cart/admin/index.php'),'utf8');const icons=(index.match(/<symbol\b[\s\S]*?<\/symbol>/g)||[]).join('');
  const catalog=await this.catalog();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ezkart builder workspace</title><link rel="stylesheet" href="admin.css"><link rel="stylesheet" href="builder-templates.css"><link rel="stylesheet" href="builder-native.css"><link rel="stylesheet" href="builder-help.css"><link rel="stylesheet" href="builder-fonts.css"><link rel="stylesheet" href="builder-components.css"><link rel="stylesheet" href="builder-flow.css"><link rel="stylesheet" href="builder-showcase.css"><link rel="stylesheet" href="builder-chrome.css"><link rel="stylesheet" href="builder-assets.css"><link rel="stylesheet" href="admin-ui.css"><link rel="stylesheet" href="../select.css"></head><body class="dashboard-page page-sites ${library ? 'page-sites-library' : 'page-site-editor'}" data-admin-cloud-enabled="true" data-admin-local-workspace="true" data-admin-demo-checkout="${catalog.demoCheckout===true}" data-admin-currency="${htmlEscape(catalog.currency||'IDR')}" data-admin-locale="${htmlEscape(catalog.locale||'id-ID')}" data-admin-storage-scope="${htmlEscape(catalog.storageScope||'ezkart-local')}" data-admin-cloud-media-base="${htmlEscape(catalog.mediaBase||'')}" data-admin-public-base="${htmlEscape(catalog.publicBase||'')}" data-admin-csrf-token="${this.csrf}"><svg style="display:none">${icons}</svg>${view}<script src="builder-native-icons.js"></script><script src="builder-commerce.js"></script><script src="builder-help.js"></script><script src="builder-fonts.js"></script><script src="builder-native.js"></script><script src="builder-publish.js"></script><script src="builder-site-settings.js"></script><script src="builder-templates.js"></script><script src="builder-backgrounds.js"></script><script src="builder-components.js"></script><script src="builder-asset-packs.js"></script><script src="builder-assets.js"></script><script src="builder-assets-ui.js"></script><script src="builder-showcase-data.js"></script><script src="builder-showcase.js"></script><script src="admin.js"></script><script src="../select.js"></script></body></html>`;
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
      if(path==='/v1/assets'){
       const files=(await readdir(join(this.directory,'uploads'))).filter(file=>file.endsWith('.json'));
       const assets=await Promise.all(files.map(async file=>{const {dataUrl,...item}=JSON.parse(await readFile(join(this.directory,'uploads',file),'utf8'));return item;}));
       return send(200,{ok:true,assets});
      }
      const assetMatch=/^\/v1\/assets\/(asset_[a-f0-9]{32})$/.exec(path);
      if(assetMatch){
       const item=JSON.parse(await readFile(join(this.directory,'uploads',assetMatch[1]+'.json'),'utf8'));
       return send(200,Buffer.from(item.dataUrl.split(',')[1],'base64'),item.mimeType);
      }

      if(path==='/v1/landing-pages')return send(200,{ok:true,pages:await this.list()});
      const previewMatch=/^\/v1\/landing-pages\/([a-z0-9-]+)\/preview$/.exec(path);
      if(previewMatch){res.setHeader('Content-Security-Policy',"default-src 'none'; img-src data: http: https:; style-src 'unsafe-inline'; font-src data:; sandbox");return send(200,await readFile(join(this.directory,'previews',`${slug(previewMatch[1])}.html`)),'text/html; charset=utf-8');}
      const match=/^\/v1\/landing-pages\/([a-z0-9-]+)$/.exec(path);
      if(match)return send(200,{ok:true,page:await this.read(match[1])});
     }
     if(req.method==='POST' && path==='/v1/assets'){
      if(req.headers['x-ezkart-csrf']!==this.csrf)return send(403,{ok:false,error:'Invalid editor request.'});
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2900000)return send(413,{ok:false,error:'Image exceeds 2 MB.'});}
      const payload=JSON.parse(body),match=/^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([a-zA-Z0-9+/=]+)$/.exec(payload.dataUrl||'');
      if(!match || Buffer.from(match[2],'base64').length>2097152)return send(400,{ok:false,error:'Choose an image up to 2 MB.'});
      const asset={id:'asset_'+randomBytes(16).toString('hex'),name:String(payload.name||'Uploaded image').slice(0,160),mimeType:match[1],sizeBytes:Buffer.from(match[2],'base64').length,createdAt:new Date().toISOString(),source:'Your uploads',sha256:createHash('sha256').update(Buffer.from(match[2],'base64')).digest('hex')};
      await writeFile(join(this.directory,'uploads',asset.id+'.json'),JSON.stringify({...asset,dataUrl:payload.dataUrl}),{mode:0o600});
      return send(201,{ok:true,asset});
     }
     if(req.method==='POST' && /^\/v1\/landing-pages\/[a-z0-9-]+\/export$/.test(path)){
      if(req.headers['x-ezkart-csrf']!==this.csrf)return send(403,{ok:false,error:'Invalid editor request.'});
      return send(200,{ok:true});
     }
     if(req.method==='PUT'){
      if(req.headers['x-ezkart-csrf']!==this.csrf)return send(403,{ok:false,error:'Invalid editor request.'});
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>12*1024*1024)return send(413,{ok:false,error:'Project exceeds 12 MB.'});}
      const data=JSON.parse(body),match=/^\/v1\/landing-pages\/([a-z0-9-]+)(\/preview)?$/.exec(path);
      if(match){
       let page;
       try { page=await this.read(match[1]); } catch(error) {
        if(error.code!=='ENOENT'||match[2])throw error;
        if((await this.list()).length>=6)throw Error('Delete a project before creating another.');
        page=await this.create({id:match[1],name:String(data.name||match[1]).slice(0,60),productIds:data.products||[]});
       }
       if(match[2]){
        if(data.sourceUpdatedAt&&data.sourceUpdatedAt!==page.updatedAt)return send(409,{ok:false,error:'The page changed. Refresh its preview.'});
        const preview={updatedAt:new Date().toISOString(),sourceUpdatedAt:page.updatedAt,version:'2',bytes:Buffer.byteLength(data.html||'')};
        await writeFile(join(this.directory,'previews',`${page.id}.html`),String(data.html||''),{mode:0o600});
        await writeFile(join(this.directory,'previews',`${page.id}.json`),JSON.stringify({previewUpdatedAt:preview.updatedAt,previewSourceUpdatedAt:preview.sourceUpdatedAt,previewVersion:preview.version,previewBytes:preview.bytes}),{mode:0o600});
        return send(200,{ok:true,preview});
       }
       const saved=await this.write(match[1],{...page,...data,id:page.id,url:page.url,updatedAt:new Date().toISOString()});return send(200,{ok:true,page:saved});
      }
     }
     return send(404,{ok:false,error:'This local workspace does not implement that cloud operation.'});
    }
    if(url.pathname==='/cart/admin/'||url.pathname==='/cart/admin/index.php')return send(200,await this.markup(!url.searchParams.has('edit')),'text/html; charset=utf-8');
    if(url.pathname==='/cart/api/health.php')return send(200,{ok:true,commerce_environment:'test'});
    if(url.pathname==='/cart/admin/page-preview.php'){
     // Use the hosted editor's message-driven renderer so Preview always shows
     // the current canvas, including edits that have not been saved/exported.
     const shell=await readFile(join(repoRoot,'cart/admin/page-preview.php'),'utf8');
     let mediaSource='';
     try{
      const mediaBase=(await this.catalog()).mediaBase;
      const mediaUrl=mediaBase?new URL(mediaBase,this.url):null;
      if(mediaUrl&&['http:','https:'].includes(mediaUrl.protocol))mediaSource=` ${mediaUrl.origin}`;
     }catch{/* An absent media base needs no additional source. */}
     // Keep the preview isolated; explicitly allow the configured local media
     // server as well as the HTTPS assets supported by the hosted preview.
     res.setHeader('Content-Security-Policy',`default-src 'none'; img-src 'self' data: https:${mediaSource}; media-src 'self' data: https:${mediaSource}; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' https:; font-src 'self' data: https:; connect-src 'self' https:; form-action 'self' https:; frame-ancestors 'self'; base-uri 'none'; sandbox allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation`);
     return send(200,shell.replace(/<\?[\s\S]*?\?>/g,''),'text/html; charset=utf-8');
    }
    if(['/cart/select.css','/cart/select.js'].includes(url.pathname))return send(200,await readFile(join(repoRoot,url.pathname.slice(1))),url.pathname.endsWith('.css')?'text/css':'text/javascript');
    if(url.pathname.startsWith('/cart/admin/')){
     const file=resolve(repoRoot,`.${decodeURIComponent(url.pathname)}`);
     const fontMetadata=file===join(repoRoot,'cart/admin/assets/fonts/builder-fonts.json') || (file.startsWith(join(repoRoot,'cart/admin/assets/fonts/')) && /\/(?:[a-z0-9-]+-)?OFL\.txt$/.test(file));
     if(!file.startsWith(join(repoRoot,'cart/admin/') )||(!/\.(js|css|woff2|webp|png|svg|jpg)$/.test(file)&&!fontMetadata&&!(file.startsWith(join(repoRoot,'cart/admin/templates/'))&&file.endsWith('.json'))))return send(404,{ok:false,error:'File not found.'});
     const types={'.txt':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg'};
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
