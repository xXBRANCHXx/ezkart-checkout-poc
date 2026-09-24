import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readLandingPageJson} from '../src/landing-page-storage.js';

const object = page => ({body: new Response(JSON.stringify(page)).body});

test('a stalled R2 open retries once and cancels the late body', async () => {
  let calls = 0, release, cancelled = false;
  const late = new Promise(resolve => { release = resolve; });
  const bucket = {get: () => ++calls === 1 ? late : Promise.resolve(object({state: 'Kopi senja ☕'}))};
  assert.deepEqual(await readLandingPageJson(bucket, 'page', {timeoutMs: 20}), {state: 'Kopi senja ☕'});
  assert.equal(calls, 2);
  release({body: new ReadableStream({cancel() { cancelled = true; }})});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});

test('a stalled body is cancelled and retried without mutating storage', async () => {
  let calls = 0, cancelled = false;
  const bucket = {get: async () => ++calls === 1
    ? {body: new ReadableStream({cancel() { cancelled = true; }})}
    : object({publishedHtml: '<h1>Saved</h1>'})};
  assert.deepEqual(await readLandingPageJson(bucket, 'page', {timeoutMs: 20}), {publishedHtml: '<h1>Saved</h1>'});
  assert.equal(cancelled, true);
  assert.equal(calls, 2);
});

test('persistent storage stalls stop after two attempts; missing and corrupt pages do not retry', async () => {
  let calls = 0;
  await assert.rejects(readLandingPageJson({get: () => { calls++; return new Promise(() => {}); }}, 'page', {timeoutMs: 20}), /timed out/);
  assert.equal(calls, 2);
  calls = 0;
  assert.equal(await readLandingPageJson({get: async () => { calls++; return null; }}, 'page'), null);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(readLandingPageJson({get: async () => { calls++; return {body: new Response('broken JSON').body}; }}, 'page'), SyntaxError);
  assert.equal(calls, 1);
});
