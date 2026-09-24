import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {packLandingEditor, landingPageSaveReceipt} from '../src/landing-page-transfer.js';

test('save receipts retain the authoritative version without returning submitted artwork', () => {
  const page={id:'launch',name:'Launch',url:'launch.ezkart.site',status:'published',products:['coffee'],createdAt:'first',updatedAt:'saved',publishedAt:'saved',publicPath:'/coffee/shop/launch',previewPath:'/coffee/shop/launch/preview',state:{preview:'image'.repeat(500000)},publishedHtml:'artwork'.repeat(300000),customProducts:[{image:'image'.repeat(200000)}]};
  const receipt=landingPageSaveReceipt(page);
  assert.equal(receipt.status,'published');
  assert.equal(receipt.updatedAt,'saved');
  assert.equal(receipt.publishedAt,'saved');
  assert.deepEqual(receipt.products,['coffee']);
  assert.equal(receipt.publicPath,page.publicPath);
  assert.ok(JSON.stringify(receipt).length<1000);
  assert.equal(receipt.state,undefined);
  assert.equal(receipt.publishedHtml,undefined);
  assert.equal(receipt.customProducts,undefined);
  assert.equal(page.state.preview.length,2500000,'Stored content remains intact');
});

test('editor transfer removes duplicate images losslessly and leaves the publication in storage', () => {
  const image = 'data:image/webp;base64,' + randomBytes(180000).toString('base64');
  const page = {id: 'coffee', name: 'Kopi “Senja” ☕', state: {
    preview: `<img src="${image}" data-native='{"src":"${image}"}'>`,
    catalog: [{image}], caption: '\\n " &quot; <script> 0 __EZKART_IMAGE_0',
  }, publishedHtml: `<img src="${image}">`};
  const packed = packLandingEditor(page);
  assert.equal(packed.images.length, 1);
  const decoded = JSON.parse(packed.parts.map(part => typeof part === 'string' ? part : packed.images[part]).join(''));
  const {publishedHtml, ...expected} = page;
  assert.deepEqual(decoded, expected);
  assert.equal(page.publishedHtml, publishedHtml);
  assert.ok(gzipSync(JSON.stringify(packed)).length < gzipSync(JSON.stringify(page)).length * .4);
  const blank = {id:'blank', state:{preview:'<p>Hello</p>'}};
  assert.deepEqual(packLandingEditor(blank), {format:'images-v1', parts:[JSON.stringify(blank)], images:[]});
});
