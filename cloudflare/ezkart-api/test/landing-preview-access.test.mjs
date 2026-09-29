import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unlockPreview, validPreviewSession} from '../src/landing-preview-access.js';

test('preview sessions reject expired, altered, cross-page, cross-seller and rotated credentials', async () => {
  const record = {key:'12345678-12345678-12345678-12345678',secret:'fixture-secret'};
  const now = 1800000000000;
  assert.equal(await unlockPreview(record,'seller','page','wrong',now),null);
  const token = await unlockPreview(record,'seller','page',record.key,now);
  assert.ok(await validPreviewSession(record,'seller','page',token,now));
  assert.ok(await validPreviewSession(record,'seller','page',token,now+3599000));
  assert.equal(await validPreviewSession(record,'seller','page',token,now+3600000),false);
  assert.equal(await validPreviewSession(record,'other','page',token,now),false);
  assert.equal(await validPreviewSession(record,'seller','other',token,now),false);
  assert.equal(await validPreviewSession({...record,secret:'replaced'},'seller','page',token,now),false);
  assert.equal(await validPreviewSession(null,'seller','page',token,now),false);
  assert.equal(await validPreviewSession(record,'seller','page',token.replace(/^\d+/, '1800007200'),now),false);
  assert.equal(await validPreviewSession(record,'seller','page',token.slice(0,-1)+(token.endsWith('a')?'b':'a'),now),false);
});
