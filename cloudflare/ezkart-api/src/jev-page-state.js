// D1 serializes moderation with ordinary R2 saves. A pending write is never
// cleared merely because time elapsed: the original storage call may still land.
const key = (sellerId, pageId) => `sellers/${sellerId}/landing-pages/${pageId}.json`;
const changed = () => new Response('Page revision changed or a save is still pending; reload before continuing.', {status:409});
const read = (env,sellerId,pageId) => env.DB.prepare('SELECT * FROM jev_page_revisions WHERE seller_id=? AND page_id=?').bind(sellerId,pageId).first();

export async function seedJevPageRevision(env,sellerId,pageId,revision) {
  await env.DB.prepare('INSERT OR IGNORE INTO jev_page_revisions(seller_id,page_id,current_revision) VALUES(?,?,?)').bind(sellerId,pageId,revision||'').run();
  let state=await read(env,sellerId,pageId);
  if(state?.write_token) {
    const object=await env.PRIVATE_ASSETS.head(key(sellerId,pageId));
    if(object?.customMetadata?.jevWriteToken===state.write_token) {
      // Storage committed, but its acknowledgement or D1 finalization was lost.
      await finishJevPageWrite(env,sellerId,pageId,state.write_token,object.etag);
      state=await read(env,sellerId,pageId);
    }
  }
  if(!state || state.write_token || state.current_revision!==(revision||'')) throw changed();
  return state;
}

export async function beginJevPageWrite(env,sellerId,pageId,revision) {
  await seedJevPageRevision(env,sellerId,pageId,revision);
  const token=crypto.randomUUID();
  const result=await env.DB.prepare('UPDATE jev_page_revisions SET write_token=?,write_base_revision=?,write_started_at=? WHERE seller_id=? AND page_id=? AND current_revision=? AND write_token IS NULL')
    .bind(token,revision||'',new Date().toISOString(),sellerId,pageId,revision||'').run();
  if(result.meta.changes!==1) throw changed();
  return token;
}

export async function finishJevPageWrite(env,sellerId,pageId,token,revision) {
  const result=await env.DB.prepare('UPDATE jev_page_revisions SET current_revision=?,write_token=NULL,write_base_revision=NULL,write_started_at=NULL WHERE seller_id=? AND page_id=? AND write_token=?')
    .bind(revision,sellerId,pageId,token).run();
  if(result.meta.changes!==1) {
    const state=await read(env,sellerId,pageId);
    if(state?.write_token || state?.current_revision!==revision) throw changed();
  }
}

export async function putJevPage(env,sellerId,pageId,revision,value,options={}) {
  const token=await beginJevPageWrite(env,sellerId,pageId,revision);
  const object=await env.PRIVATE_ASSETS.put(key(sellerId,pageId),value,{
    ...options,onlyIf:revision?{etagMatches:revision}:{etagDoesNotMatch:'*'},
    customMetadata:{...options.customMetadata,jevWriteToken:token},
  });
  if(!object) {
    // A definite conditional rejection did not write; release only this token.
    // A thrown/unknown R2 result instead leaves the fence for receipt recovery.
    await env.DB.prepare('UPDATE jev_page_revisions SET write_token=NULL,write_base_revision=NULL,write_started_at=NULL WHERE seller_id=? AND page_id=? AND write_token=?').bind(sellerId,pageId,token).run();
    throw changed();
  }
  await finishJevPageWrite(env,sellerId,pageId,token,object.etag);
  return object;
}
