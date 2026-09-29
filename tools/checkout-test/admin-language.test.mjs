import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {seedDeclaredOnboarding} from '../../cloudflare/ezkart-api/test/onboarding-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';

const languageScripts=await Promise.all(['admin-language-id.js','admin-language.js'].map(file=>readFile(new URL('../../cart/admin/'+file,import.meta.url),'utf8')));

test('Indonesian translates dynamic interface text and attributes, preserving authored content and values',async t=>{
 const b=await browser(t),p=await b.newPage();
 await p.setContent('<html><head><title>Dashboard · Ezkart</title></head><body data-admin-language="id"><h1>Dashboard</h1><input placeholder="Search conversations" value="Orders"><p translate="no">Orders</p><div class="sq-page-preview"><h2>Orders</h2></div><textarea>Orders</textarea></body></html>');
 for(const content of languageScripts)await p.addScriptTag({content});
 assert.equal(await p.locator('h1').textContent(),'Dasbor');
 assert.equal(await p.title(),'Dasbor · Ezkart');
 assert.equal(await p.locator('input').getAttribute('placeholder'),'Cari percakapan');
 assert.equal(await p.locator('input').inputValue(),'Orders');
 for(const selector of ['[translate=no]','.sq-page-preview h2','textarea'])assert.equal(await p.locator(selector).textContent(),'Orders');
 await p.evaluate(()=>{const n=document.createElement('button');n.id='dynamic';n.textContent='Refresh';document.body.append(n);});
 await p.waitForFunction(()=>document.querySelector('#dynamic').textContent==='Muat ulang');
 await p.evaluate(()=>{document.querySelector('#dynamic').firstChild.data='Apply filters';document.querySelector('input').setAttribute('placeholder','Product name');});
 await p.waitForFunction(()=>document.querySelector('#dynamic').textContent==='Terapkan filter');
 assert.equal(await p.locator('input').getAttribute('placeholder'),'Nama produk');
 assert.deepEqual(await p.evaluate(()=>['Active products','Paying customers','2 products','0 shown · 0 matching orders'].map(EzkartLanguage.t)),['Produk aktif','Pelanggan yang membayar','2 produk','0 ditampilkan · 0 pesanan sesuai']);
});

test('seller pages render Indonesian beyond navigation and retain language through reloads',async t=>{
 const f=await setupCentralFixture(t);await seedDeclaredOnboarding(f.db);
 await f.db.prepare("UPDATE products SET title='Orders' WHERE id='tea'").run();
 const b=await browser(t),token=await f.merchantToken('alice','alice@example.test');
 await writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({user:{id:'alice',email:'alice@example.test'},wallet_tokens:{access_token:token,refresh_token:'fixture-refresh',expires_in:3600}}));
 const cookie=f.app.adminCookie({supabase_access_token:token,admin_user:{id:'alice',email:'alice@example.test'}}),p=await pageFor(b,f,1360,cookie);
 await p.context().addCookies([{name:'ezkart_language',value:'id',url:f.app.base}]);
 const pages={dashboard:'Kinerja penjualan',orders:'Semua pesanan tersimpan',products:'Produk aktif', 'product-new':'Detail produk',inventory:'Riwayat stok',sites:'Buat',customers:'Nilai pelanggan',analytics:'Pendapatan dari waktu ke waktu',marketing:'Tulis email',payments:'Rata-rata pembayaran',messages:'Pilih percakapan untuk membaca dan membalas.',wallet:'Verifikasi untuk membuka Dompet',settings:'Bahasa akun','shipping-settings':'Pin tersimpan',fulfillment:'Tidak ada pesanan',returns:'Tidak ada pengembalian',refunds:'Permintaan pengembalian dana',notifications:'Semua sudah dibaca',advanced:'Lebih banyak ruang',onboarding:'Tentang kamu'};
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 for(const [route,expected] of Object.entries(pages)){
  await p.goto(f.app.base+'/cart/admin/?page='+route);
  await p.waitForFunction(expected=>document.body.innerText.includes(expected),expected).catch(async error=>{throw new Error(route+': '+expected+'\n'+await p.locator('main').innerText(),{cause:error});});
  assert.equal(await p.locator('html').getAttribute('lang'),'id',route);
  if(route==='products')assert.equal(await p.getByRole('heading',{name:'Orders',exact:true}).textContent(),'Orders');
 }
 await p.goto(f.app.base+'/cart/admin/?page=dashboard');
 await p.getByRole('button',{name:'Muat ulang',exact:true}).click();
 await p.waitForFunction(()=>document.body.innerText.includes('Tidak ada pesanan pada periode ini.'));
 assert.ok(!(await p.locator('main').innerText()).includes('Sales performance'));
 await p.setViewportSize({width:390,height:844});
 await p.waitForTimeout(350);await p.screenshot({path:'/tmp/ezkart-language-phone.png'});
 await p.goto(f.app.base+'/cart/admin/?page=settings');
 await Promise.all([p.waitForEvent('load'),p.locator('[data-admin-language-setting]').selectOption('en')]);
 await p.goto(f.app.base+'/cart/admin/?page=dashboard');
 await p.waitForFunction(()=>document.documentElement.lang==='en');
 assert.ok((await p.locator('main').innerText()).includes('Sales performance'));
 assert.deepEqual(errors,[]);
});
