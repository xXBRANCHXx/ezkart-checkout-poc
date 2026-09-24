import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {packLandingEditor} from '../src/landing-page-transfer.js';

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
