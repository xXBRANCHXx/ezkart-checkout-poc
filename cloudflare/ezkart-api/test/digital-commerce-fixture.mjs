import {randomBytes} from 'node:crypto';
import {digest} from './commerce-fixture.mjs';
import {beginDigitalUpload,uploadDigitalPart,completeDigitalUpload,digitalVersionStatements,digitalPartBytes} from '../src/digital-files.js';
const actor={sellerId:'seller_alice',id:'alice',role:'owner'},key=()=>randomBytes(16).toString('hex');
const environment=async f=>({DB:f.db,PRIVATE_ASSETS:await f.mf.getR2Bucket('PRIVATE_ASSETS'),APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1'});
export async function digitalFixtureFile(f,{id='guide',bytes=Buffer.from('Private guide — original complete bytes'),price=25000,replace=false}={}){
  const env=await environment(f),now=new Date().toISOString();
  const parts=Array.from({length:Math.ceil(bytes.length/digitalPartBytes)},(_,i)=>bytes.subarray(i*digitalPartBytes,(i+1)*digitalPartBytes));
  const upload=await beginDigitalUpload(env,actor,{requestKey:key(),filename:'Panduan café.pdf',size:bytes.length,parts:parts.map(digest)});
  for(let i=0;i<parts.length;i++)await uploadDigitalPart(env,actor,upload.id,i+1,new Request('https://fixture.test',{method:'PUT',body:parts[i],headers:{'content-type':'application/octet-stream'}}));
  await completeDigitalUpload(env,actor,upload.id);
  if(!replace)await f.db.prepare(`INSERT INTO products(id,seller_id,type,status,title,sku,price_amount,weight_grams,digital_filename,created_at,updated_at)
    VALUES (?,'seller_alice','digital','active','Private guide','BOOK',?,NULL,'Panduan café.pdf',?,?)`).bind(id,price,now,now).run();
  await f.db.batch(digitalVersionStatements(env,'seller_alice','alice',id,{id:upload.id},now));
  const version=await f.db.prepare('SELECT version_id FROM digital_product_files WHERE product_id=?').bind(id).first();
  return {id,bytes,uploadId:upload.id,version:version.version_id,item:{productId:id,quantity:1,expectedPrice:price,expectedFileVersion:version.version_id,expectedWeightGrams:0}};
}
