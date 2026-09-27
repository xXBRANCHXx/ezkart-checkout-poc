(() => {
  'use strict';
  const root=document.querySelector('[data-customer-downloads]');if(!root)return;
  const q=s=>root.querySelector(s),list=q('[data-download-list]'),status=q('[data-download-status]'),refresh=q('[data-download-refresh]');
  const endpoint='/cart/admin/customer-downloads.php',cards=new Map(),urls=new Set();let active=null,ended=false;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,fn)=>{const n=el('button',text,'download-secondary');n.type='button';n.addEventListener('click',fn);return n;};
  const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const date=value=>new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  const size=value=>value<1048576?Math.ceil(value/1024)+' KB':new Intl.NumberFormat('en',{maximumFractionDigits:1}).format(value/1048576)+' MB';
  const unavailable={creating:'Waiting for payment',pending:'Waiting for payment',cancelled:'Payment cancelled',expired:'Payment expired',failed:'Payment was not completed',
    payment_review:'Payment is being reviewed. Contact the store for help.',refund_review:'Downloads are on hold while the refunded items are reviewed. Contact support.',refunded:'This purchase was refunded.',unavailable:'This file is temporarily unavailable. Contact support.'};
  function controls(){refresh.disabled=Boolean(active)||ended;for(const c of cards.values()){
    c.start.disabled=Boolean(active)||ended||!c.item.canDownload;c.remove.disabled=Boolean(active)||ended;c.pause.hidden=active?.card!==c||!active?.downloading;c.pause.disabled=Boolean(active?.paused)||ended;
  }}
  function sessionChanged(message){ended=true;active?.controller.abort();active?.worker.close();active=null;urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();cards.clear();list.replaceChildren();
    status.textContent=message||'Your sign-in changed. Reload this page.';refresh.textContent='Reload sign-in';refresh.disabled=false;}
  async function api(query,body,signal,binary=false){
    const response=await fetch(endpoint+'?'+new URLSearchParams({order:root.dataset.order,...query}),{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',signal,
      headers:{'Content-Type':'application/json','X-Ezkart-CSRF':root.dataset.csrf,'X-Ezkart-Customer-Session':root.dataset.version},...(body?{body:JSON.stringify(body)}:{})});
    if(binary&&response.ok&&response.headers.get('content-type')==='application/octet-stream')return {bytes:await response.arrayBuffer(),nonce:response.headers.get('x-ezkart-file-challenge'),checksum:response.headers.get('x-ezkart-file-sha256'),part:response.headers.get('x-ezkart-file-part')};
    let value;try{value=await response.json();}catch{throw Error('The connection was interrupted. Resume to check the saved download.');}
    if(!response.ok||value.ok!==true){const error=Error(value.error||'Your download could not be confirmed.');error.status=response.status;
      if(response.status===401||value.code==='customer_session_changed')sessionChanged(error.message);throw error;}
    return value;
  }
  function storage(){
    const worker=new Worker(root.dataset.worker),pending=new Map();let sequence=0,closed=false;
    const stop=()=>{closed=true;worker.terminate();for(const p of pending.values())p.reject(Error('Download storage closed. Resume to continue.'));pending.clear();};
    worker.addEventListener('message',({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.ok?p.resolve(data):p.reject(Error(data.error));});
    worker.addEventListener('error',()=>{for(const p of pending.values())p.reject(Error('Your browser could not prepare download storage. Free some space and retry.'));pending.clear();stop();});
    return {call(data,transfer=[]){if(closed)return Promise.reject(Error('Download storage is closed.'));return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,...data},transfer);});},close:stop};
  }
  function validJournal(c,j){
    return j&&j.v===1&&j.account===root.dataset.account&&j.order===root.dataset.order&&j.item===c.item.orderItemId&&j.file===c.item.file.id
      &&typeof j.requestKey==='string'&&/^[a-f0-9]{32}$/.test(j.requestKey)&&(j.grant===null||typeof j.grant==='string'&&/^dgrant_[a-f0-9]{32}$/.test(j.grant));
  }
  async function download(c){
    if(active||ended||!c.item.canDownload)return;
    let worker;try{worker=storage();}catch{c.notice.textContent='Your browser could not prepare download storage. Reload and try again.';return;}
    const controller=new AbortController(),operation={card:c,worker,controller,paused:false,downloading:true};active=operation;controls();c.save.hidden=true;
    if(c.url){URL.revokeObjectURL(c.url);urls.delete(c.url);c.url=null;}
    c.notice.textContent='Preparing your download…';c.progress.hidden=false;c.progress.value=0;
    try{
      if(!navigator.storage?.getDirectory)throw Error('This browser cannot save a verified download. Use a current browser with device storage available.');
      c.scope=await sha(JSON.stringify([root.dataset.account,root.dataset.order,c.item.orderItemId,c.item.file.id]));
      c.remove.hidden=false;const saved=await worker.call({kind:'init',scope:c.scope});let journal=saved.journal;
      if(journal&&!validJournal(c,journal))throw Error('The saved download reference is damaged or belongs to another purchase. Remove the browser copy before starting again.');
      if(!journal){journal={v:1,account:root.dataset.account,order:root.dataset.order,item:c.item.orderItemId,file:c.item.file.id,requestKey:crypto.randomUUID().replaceAll('-',''),grant:null};
        await worker.call({kind:'journal',value:journal});}
      const query={item:c.item.orderItemId},signal=controller.signal;
      if(!journal.grant){const data=await api(query,{requestKey:journal.requestKey},signal);journal.grant=data.grant.id;await worker.call({kind:'journal',value:journal});}
      let info;
      try{info=await api({...query,grant:journal.grant},null,signal);}catch(error){
        if(error.status!==410)throw error;
        journal={...journal,requestKey:crypto.randomUUID().replaceAll('-',''),grant:null};await worker.call({kind:'journal',value:journal});
        journal.grant=(await api(query,{requestKey:journal.requestKey},signal)).grant.id;await worker.call({kind:'journal',value:journal});info=await api({...query,grant:journal.grant},null,signal);
      }
      const file=info.file;if(file.size!==c.item.file.size||file.filename!==c.item.file.filename||file.partSize!==5242880||!Array.isArray(file.manifest)
        ||file.manifest.length!==Math.ceil(file.size/5242880)||file.manifest.some(hash=>!/^[a-f0-9]{64}$/.test(hash)))throw Error('The purchased file details could not be verified. Reload this page.');
      let received=0;
      for(let number=1;number<=file.manifest.length;number++){
        if(operation.paused)throw new DOMException('Paused','AbortError');
        const prior=info.parts.find(p=>p.number===number),length=Math.min(file.partSize,file.size-(number-1)*file.partSize),checksum=file.manifest[number-1];
        const details={kind:'part',number,length,checksum,grant:journal.grant,nonce:prior?.nonce||null};
        let checked=await worker.call(details);
        if(!checked.present||!prior){
          c.notice.textContent=`Downloading ${size(received)} of ${size(file.size)}…`;
          const part=await api({...query,grant:journal.grant,part:number},null,signal,true);
          if(part.part!==String(number)||part.checksum!==checksum||!/^[a-f0-9]{64}$/.test(part.nonce||'')||part.bytes.byteLength!==length)throw Error('This file part is incomplete. Resume to retry it.');
          checked=await worker.call({...details,nonce:part.nonce,bytes:part.bytes},[part.bytes]);
        }
        if(!checked.present||!checked.proof)throw Error('Your browser could not verify the saved file part. Resume to retry it.');
        // Only bytes flushed to device storage can reach this acknowledgement.
        if(!prior?.verifiedAt)info=await api({...query,grant:journal.grant,part:number,receipt:1},{proof:checked.proof},signal);
        received+=length;c.progress.value=Math.round(received/file.size*100);c.notice.textContent=`Verified ${size(received)} of ${size(file.size)}.`;
      }
      if(operation.paused)throw new DOMException('Paused','AbortError');
      const finished=await worker.call({kind:'finish',size:file.size});if(ended)return;
      c.url=URL.createObjectURL(finished.file);urls.add(c.url);c.save.href=c.url;c.save.download=file.filename;c.save.hidden=false;
      c.notice.textContent='Download verified. Save your file below.';c.start.hidden=true;
      c.delivery.textContent=info.deliveryConfirmed?'Delivery verified · '+date(info.deliveredAt):'Verification is being confirmed.';
    }catch(error){if(!ended){c.notice.textContent=operation.paused?'Paused. Resume to continue from the parts saved on this device.':error.message||'The download was interrupted. Resume to continue.';c.start.hidden=false;c.start.textContent='Resume download';}}
    finally{try{await worker.call({kind:'close'});}catch{}worker.close();if(active===operation)active=null;if(!ended)controls();}
  }
  async function remove(c){
    if(active||ended)return;let worker;try{worker=storage();}catch{c.notice.textContent='Your browser could not open download storage.';return;}const controller=new AbortController(),operation={card:c,worker,controller};active=operation;controls();
    try{c.scope??=await sha(JSON.stringify([root.dataset.account,root.dataset.order,c.item.orderItemId,c.item.file.id]));await worker.call({kind:'remove',scope:c.scope});
      if(c.url){URL.revokeObjectURL(c.url);urls.delete(c.url);c.url=null;}c.save.hidden=true;c.remove.hidden=true;c.progress.hidden=true;c.start.hidden=false;c.start.textContent='Download file';c.notice.textContent='Browser copy removed. You can download this purchase again.';
    }catch(e){c.notice.textContent=e.message;}finally{worker.close();active=null;controls();}
  }
  function render(items){
    list.replaceChildren();cards.clear();urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();
    for(const item of items){
      const c={item},card=el('article',undefined,'download-card'),heading=el('div',undefined,'download-heading'),copy=el('div');copy.append(el('h2',item.title),el('p',[item.variantName,item.file.filename].filter(Boolean).join(' · ')));
      heading.append(copy,el('span',size(item.file.size),'download-size'));c.delivery=el('p',item.deliveryConfirmed?'Delivery verified · '+date(item.deliveredAt):item.canDownload?'Ready to download':unavailable[item.state]||'This download is unavailable.','download-state');
      c.notice=el('p','');c.notice.setAttribute('role','status');c.progress=el('progress');c.progress.max=100;c.progress.value=0;c.progress.hidden=true;c.progress.setAttribute('aria-label','Verified download progress');
      const actions=el('div',undefined,'download-actions');c.start=button('Download file',()=>void download(c));c.start.className='download-primary';c.start.disabled=!item.canDownload;
      c.pause=button('Pause',()=>{if(active?.card===c){active.paused=true;active.controller.abort();c.notice.textContent='Pausing…';c.pause.disabled=true;}});c.pause.hidden=true;
      c.save=el('a','Save file','download-primary');c.save.hidden=true;c.save.addEventListener('click',()=>{c.notice.textContent='Your browser is saving the verified file. You can save it again from here.';});
      c.remove=button('Remove browser copy',()=>void remove(c));c.remove.hidden=true;
      actions.append(c.start,c.pause,c.save,c.remove);card.append(heading,c.delivery,c.progress,c.notice,actions);list.append(card);cards.set(item.orderItemId,c);
    }
  }
  async function load(){
    if(ended){location.reload();return;}if(active)return;refresh.disabled=true;status.textContent='Loading your purchased files…';
    try{const data=await api({},null,AbortSignal.timeout(35000));if(ended)return;render(data.items);status.textContent=data.items.length?'Your purchased files are up to date.':'This order has no digital files.';}
    catch(e){if(!ended)status.textContent=e.message;}finally{if(!ended)refresh.disabled=false;}
  }
  refresh.addEventListener('click',()=>void load());window.addEventListener('pagehide',()=>{active?.controller.abort();active?.worker.close();urls.forEach(url=>URL.revokeObjectURL(url));});
  void load();
})();
