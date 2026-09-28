import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceFetchAllowed,evidenceHash,loadJevImage} from '../src/jev-evidence.js';
import {jevRequest,jevReservation,normalizeJevOutcome,jevDecision,JEV_POLICY} from '../src/jev-provider.js';
test('collector never fetches private hosts, account paths, credentials or insecure resource URLs',()=>{
 for(const url of ['http://images.unsplash.com/a','https://127.0.0.1/a','https://[::1]/a','https://169.254.169.254/a','https://test.ezkart.id/cart/admin/','https://test.ezkart.id/assets/a?token=x','https://user:pass@images.unsplash.com/a','https://images.unsplash.com.evil.test/a','https://images.unsplash.com:444/a'])assert.equal(evidenceFetchAllowed(new URL(url)),false,url);
 for(const url of ['https://images.unsplash.com/a','https://test.ezkart.id/assets/a.png','https://cdn.jsdelivr.net/a.css'])assert.equal(evidenceFetchAllowed(new URL(url)),true,url);
});
test('saved pixels cannot silently change before model submission or reviewer display',async()=>{
 const original=new Uint8Array([1,2,3]),im={id:'image:1',key:'private',bytes:3,mimeType:'image/png',sha256:await evidenceHash(original)},snap={images:[im]};
 const env={PRIVATE_ASSETS:{get:async()=>({size:3,arrayBuffer:async()=>new Uint8Array([1,2,4]).buffer})}};
 await assert.rejects(loadJevImage(env,snap,'image:1'),/jev_image_changed/);
 await assert.rejects(loadJevImage(env,snap,'image:2'),/jev_image_missing/);
});
test('visual evidence reserves the displayed ceiling and never gains exact-text archive authority',()=>{
 const snap={evidenceVersion:2,reportReason:'other',sources:[{id:'page:1',kind:'visible_text',text:'See image'}],images:[{id:'image:1',sha256:'fixture',dataUrl:'data:image/png;base64,AQID'}],coverage:{truncated:false,unreviewedMedia:false,missing:[]}};
 const p=jevRequest(snap,'Other: ASCII in the image',JEV_POLICY);assert.equal(jevReservation(p),540000);assert.match(p.messages[0].content,/Image findings/);
 const outcome={verdict:'needs_change',confidence:1,summary:'Visual finding.',findings:[{code:'credential_request',sourceId:'image:1',quote:'',explanation:'Visible credential request.'}],uncertainties:[]};
 assert.equal(normalizeJevOutcome(outcome,snap),outcome);assert.equal(jevDecision(outcome,snap).decisionVerdict,'escalate');
 assert.throws(()=>normalizeJevOutcome({...outcome,findings:[{...outcome.findings[0],quote:'invented OCR'}]},snap),/jev_image_quote/);
});
