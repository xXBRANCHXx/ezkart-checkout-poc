(() => {
  'use strict';
  const root=document.querySelector('[data-customer-reviews]');if(!root)return;
  const q=s=>root.querySelector(s),list=q('[data-review-items]'),refresh=q('[data-review-refresh]'),endpoint='/cart/admin/customer-reviews.php';
  const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  const button=(text,fn)=>{const n=el('button',text,'copy-button');n.type='button';n.addEventListener('click',fn);return n;};
  const key=()=>crypto.randomUUID().replaceAll('-',''),date=value=>new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(value))+' WIB';
  const states={published:'Published',hidden:'Hidden by the store',pending:'Awaiting moderation',withdrawn:'Withdrawn by you'};
  const actions={publish:'published a review',withdraw:'withdrew the review',reply:'updated the store reply',hide:'hid the review',restore:'restored review visibility',approve:'approved the review'};
  const cards=new Map(),urls=new Set();let busy=false,ended=false,generation=0,pending=null;
  const error=text=>{q('[data-review-error]').textContent=text;q('[data-review-error]').hidden=!text;};
  const revoke=()=>{urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();};
  function controls(){
    root.querySelectorAll('button,input,textarea').forEach(n=>n.disabled=busy||Boolean(pending)||ended);
    refresh.disabled=!ended&&(busy||Boolean(pending)||[...cards.values()].some(c=>c.dirty));
    for(const c of cards.values()){
      c.retry.hidden=pending?.card!==c;c.retry.disabled=busy||ended;
      c.save.disabled=busy||Boolean(pending)||ended||c.conflict||!c.item.canPublish;
      c.addPhoto.disabled=busy||Boolean(pending)||ended||c.conflict||c.photos.length>=6;
    }
  }
  function changed(message){ended=true;generation++;pending=null;cards.clear();list.replaceChildren();revoke();q('[data-review-status]').textContent='Sign-in needs to be checked.';refresh.textContent='Reload sign-in';error(message||'Your sign-in changed. Reload this page.');controls();}
  async function api(query,body,binary=false){
    const response=await fetch(endpoint+'?'+new URLSearchParams(query),{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(35000),
      headers:{'Content-Type':'application/json','X-Ezkart-CSRF':root.dataset.csrf,'X-Ezkart-Customer-Session':root.dataset.version},...(body?{body:JSON.stringify(body)}:{})});
    if(binary&&response.ok&&/^image\/(jpeg|png|webp)$/.test(response.headers.get('content-type')||''))return response.blob();
    let data;try{data=await response.json();}catch{throw Error('The response was interrupted.');}
    if(!response.ok||data.ok!==true){const e=Error(data.error||'The review could not be confirmed.');e.status=response.status;if(data.code==='customer_session_changed'||response.status===401)changed(e.message);throw e;}
    return data;
  }
  function photo(id,remove){
    const figure=el('figure',undefined,'review-photo'),image=el('img'),message=el('small','Loading photo…'),dialog=el('dialog',undefined,'review-lightbox'),large=el('img');
    const open=button('',()=>dialog.showModal());open.className='review-photo-open';open.setAttribute('aria-label','Enlarge review photo');open.hidden=true;image.alt='Your review photo';large.alt='Your review photo, enlarged';open.append(image);
    dialog.append(button('Close photo',()=>dialog.close()),large);figure.append(open,message,dialog);
    const retry=button('Retry photo',()=>void load());retry.hidden=true;figure.append(retry);
    if(remove)figure.append(button('Remove photo',remove));
    async function load(){retry.hidden=true;try{const blob=await api({photo:id},null,true);if(!figure.isConnected||ended)return;const url=URL.createObjectURL(blob);urls.add(url);image.src=url;large.src=url;open.hidden=false;message.hidden=true;}catch(e){if(figure.isConnected&&!ended){message.textContent='Photo unavailable.';retry.hidden=false;}}}
    queueMicrotask(()=>void load());return figure;
  }
  function saved(c){
    const r=c.item.review;c.current.replaceChildren();
    if(!r){c.current.append(el('p',c.item.reason||'You have not reviewed this item yet.'));return;}
    c.current.append(el('b',`${r.rating} / 5 · ${states[r.state]||r.state}`),el('p',r.title),el('p',r.body),el('p',`${r.publicName} · ${date(r.updatedAt)}${r.verifiedPurchase?' · Verified purchase':''}`,'review-meta'));
    if(r.photos.length){const photos=el('div',undefined,'review-photos');photos.append(...r.photos.map(id=>photo(id)));c.current.append(photos);}
    if(r.moderation.state==='hidden')c.current.append(el('p','Store explanation: '+r.moderation.note));
    if(r.reply)c.current.append(el('b','Store reply'),el('p',r.reply.body));
    if(r.savedReply.body&&!r.savedReply.current)c.current.append(el('p','The store’s earlier reply refers to an older version of your review.','review-help'));
  }
  function history(c){
    const details=el('details',undefined,'review-history'),heading=el('summary','Review history'),status=el('p',''),rows=el('ol'),more=button('Load older changes',()=>void load(loaded));
    let loaded=false,loading=false,cursor=null;more.hidden=true;details.append(heading,status,rows,more);
    async function load(append=false){
      if(loading||ended||!c.item.review)return;loading=true;more.disabled=true;
      try{const data=await api({order:root.dataset.order,review:c.item.review.id,...(append?{cursor}:{})});if(!details.isConnected||ended)return;
        if(!append)rows.replaceChildren();for(const item of data.items){const row=el('li');row.append(el('b',`${item.actor==='buyer'?'You':'Store'} ${actions[item.kind]||'updated the review'}`),el('time',date(item.createdAt)),el('p',`${item.content.rating} / 5 · ${item.content.title}`),el('p',item.content.body));if(item.content.moderationNote)row.append(el('p',item.content.moderationNote));if(item.kind==='reply')row.append(el('p',item.content.reply));
          if(item.content.media.length){const images=el('details'),label=el('summary',`Photos (${item.content.media.length})`),photos=el('div',undefined,'review-photos');images.append(label,photos);images.addEventListener('toggle',()=>{if(images.open&&!photos.children.length)photos.append(...item.content.media.map(id=>photo(id)));});row.append(images);}rows.append(row);}
        cursor=data.nextCursor;loaded=true;status.textContent=rows.children.length?'':'No changes recorded.';more.hidden=!cursor;more.textContent='Load older changes';
      }catch(e){if(!ended){status.textContent=e.message;more.hidden=false;more.textContent=loaded?'Retry older changes':'Retry history';}}
      finally{loading=false;more.disabled=false;}
    }
    details.addEventListener('toggle',()=>{if(details.open&&!loaded)void load();});return details;
  }
  function renderPhotos(c){c.photoList.replaceChildren(...c.photos.map(id=>photo(id,()=>{c.photos=c.photos.filter(value=>value!==id);c.dirty=true;renderPhotos(c);controls();})));}
  async function checkLatest(c){
    if(busy||pending||ended)return;busy=true;controls();
    try{const data=await api({order:root.dataset.order});if(ended)return;const item=data.items.find(i=>i.orderItemId===c.item.orderItemId);if(!item)throw Error('Purchase item is unavailable.');c.item=item;saved(c);
      c.notice.replaceChildren(el('p','The saved review is shown above. Your draft is unchanged. Compare them before continuing.'));
      c.notice.append(button('Use this saved revision',()=>{c.conflict=false;c.notice.replaceChildren(el('p','Your draft is ready to save against the displayed version.'));controls();}));
    }catch(e){if(!ended)c.notice.replaceChildren(el('p',e.message),button('Check saved review',()=>void checkLatest(c)));}
    finally{busy=false;controls();}
  }
  async function send(operation){
    if(busy||ended)return;busy=true;pending=operation;controls();error('');const c=operation.card;
    try{const data=await api({order:root.dataset.order,...(operation.upload?{upload:'1'}:{})},operation.body);if(ended)return;
      pending=null;if(operation.upload){c.photos.push(data.photo.id);c.dirty=true;renderPhotos(c);c.notice.replaceChildren(el('p','Photo uploaded. Publish the review to make it visible to shoppers.'));}
      else{c.item.review=data.review;c.item.canWithdraw=data.review.buyerState==='published';c.dirty=false;c.form.hidden=true;c.withdraw.hidden=true;c.conflict=false;c.edit.textContent='Edit review';saved(c);c.history.replaceChildren(history(c));c.notice.replaceChildren(el('p',data.review.state==='withdrawn'?'Your review is withdrawn. It is no longer visible to shoppers.':'Your review was saved.'));c.withdrawButton.hidden=!c.item.canWithdraw;}
    }catch(e){if(ended)return;if(!e.status||e.status>=500){c.notice.replaceChildren(el('p',e.message+' Retry confirmation to check the same request.'));}
      else{pending=null;c.notice.replaceChildren(el('p',e.message));if(e.status===409){c.conflict=true;c.notice.append(button('Check saved review',()=>void checkLatest(c)));}}}
    finally{busy=false;controls();}
  }
  async function preparePhoto(file){
    if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw Error('Choose a JPEG, PNG or WebP photo up to 15 MB.');
    const bitmap=await createImageBitmap(file);
    try{if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>50000000)throw Error('This photo is too large to process. Choose a smaller image.');
      const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      for(const quality of [.86,.72,.55,.38]){const value=canvas.toDataURL('image/jpeg',quality);if(value.length<1398100)return value;}throw Error('This photo could not be reduced to 1 MB. Choose a smaller image.');
    }finally{bitmap.close();}
  }
  function card(item){
    const c={item,dirty:false,conflict:false,photos:item.review?.photos.slice()||[]},node=el('article',undefined,'review-card');node.dataset.reviewItem=item.orderItemId;c.node=node;
    c.current=el('div',undefined,'review-saved');c.notice=el('div');c.notice.setAttribute('role','status');c.form=el('form',undefined,'review-editor');c.form.hidden=true;c.history=el('div');
    node.append(el('h3',item.title),el('small',item.option),c.current);saved(c);
    const actions=el('div',undefined,'review-actions'),edit=button(item.review?'Edit review':'Write a review',()=>{c.form.hidden=false;c.withdraw.hidden=true;c.form.querySelector('input')?.focus();});edit.hidden=!item.canPublish;c.edit=edit;
    c.withdraw=el('div',undefined,'review-saved');c.withdraw.hidden=true;c.withdraw.append(el('p','Withdraw your review? Your rating, text and photos will no longer be public. The change history will remain available to you and the store.'),button('Keep review',()=>{c.withdraw.hidden=true;}),button('Confirm withdrawal',()=>void send({card:c,body:{kind:'withdraw',orderItemId:c.item.orderItemId,revision:c.item.review.revision,requestKey:key()}})));
    c.withdrawButton=button('Withdraw review',()=>{c.withdraw.hidden=false;c.form.hidden=true;});c.withdrawButton.hidden=!item.canWithdraw;actions.append(edit,c.withdrawButton);node.append(actions,c.withdraw);
    const rating=el('fieldset'),legend=el('legend','Your rating'),choices=el('div',undefined,'review-rating');rating.append(legend,choices);
    for(let n=1;n<=5;n++){const label=el('label'),input=el('input');input.type='radio';input.name='rating';input.value=String(n);input.required=true;input.checked=n===item.review?.rating;label.append(input,el('span',String(n)+' ★'));choices.append(label);}
    c.form.append(rating);
    for(const [name,title,max,multiline] of [['publicName','Public name',50,false],['title','Title (optional)',120,false],['body','Your experience (optional)',3000,true]]){
      const label=el('label',title),input=el(multiline?'textarea':'input');if(!multiline)input.type='text';else input.rows=4;input.name=name;input.maxLength=max;input.required=name==='publicName';input.value=item.review?.[name]??(name==='publicName'?'Buyer':'');label.append(input);c.form.append(label);
    }
    c.form.append(el('p','Use a public name you are comfortable sharing. Keep phone numbers, addresses and payment details out of your review and photos.','review-help'));
    c.photoList=el('div',undefined,'review-photos');const fileLabel=el('label','Photos (optional, up to 6)'),file=el('input');file.type='file';file.accept='image/jpeg,image/png,image/webp';c.addPhoto=file;fileLabel.append(file);c.form.append(fileLabel,c.photoList,el('p','Photos are resized and metadata is removed before publication.','review-help'));
    file.addEventListener('change',async()=>{if(!file.files?.[0]||busy||pending||ended)return;busy=true;controls();try{const dataUrl=await preparePhoto(file.files[0]);if(ended)return;busy=false;void send({card:c,upload:true,body:{orderItemId:c.item.orderItemId,requestKey:key(),dataUrl}});}catch(e){busy=false;c.notice.replaceChildren(el('p',e.message));controls();}finally{file.value='';}});
    const formActions=el('div',undefined,'review-actions');c.save=el('button','Publish review','copy-button review-primary');c.save.type='submit';formActions.append(c.save,button('Discard draft',()=>{
      for(const name of ['title','body','publicName'])c.form.elements[name].value=c.item.review?.[name]??(name==='publicName'?'Buyer':'');
      for(const input of c.form.querySelectorAll('[name=rating]'))input.checked=Number(input.value)===c.item.review?.rating;
      c.photos=c.item.review?.photos.slice()||[];c.dirty=false;c.form.hidden=true;c.conflict=false;c.notice.replaceChildren();renderPhotos(c);controls();
    }));c.form.append(formActions);
    c.form.addEventListener('input',()=>{c.dirty=true;controls();});c.form.addEventListener('submit',event=>{event.preventDefault();if(c.save.disabled||!c.form.reportValidity())return;const fields=Object.fromEntries(new FormData(c.form));void send({card:c,body:{kind:'publish',orderItemId:c.item.orderItemId,revision:c.item.review?.revision||0,requestKey:key(),rating:Number(fields.rating),publicName:fields.publicName,title:fields.title,body:fields.body,photos:c.photos.slice()}});});
    c.retry=button('Retry confirmation',()=>{if(pending?.card===c)void send(pending);});c.retry.hidden=true;node.append(c.form,c.notice,c.retry,c.history);if(item.review)c.history.append(history(c));cards.set(item.orderItemId,c);renderPhotos(c);return node;
  }
  async function load(){
    if(busy||pending||ended||[...cards.values()].some(c=>c.dirty))return;busy=true;const version=++generation;controls();error('');
    try{const data=await api({order:root.dataset.order});if(ended||version!==generation)return;cards.clear();revoke();list.replaceChildren(...data.items.map(card));q('[data-review-status]').textContent='Your reviews are up to date.';}
    catch(e){if(!ended)error(e.message+' Use Refresh reviews to try again.');}
    finally{busy=false;controls();}
  }
  refresh.addEventListener('click',()=>{if(ended)location.reload();else void load();});
  window.addEventListener('beforeunload',event=>{if(busy||pending||[...cards.values()].some(c=>c.dirty)){event.preventDefault();event.returnValue='';}});
  async function checkSession(){if(ended||document.visibilityState==='hidden')return;try{const response=await fetch('/cart/api/customer-session.php',{cache:'no-store',signal:AbortSignal.timeout(10000)}),data=await response.json();if(response.ok&&(!data.authenticated||data.version!==root.dataset.version))changed();}catch{/* A read failure cannot authorize a write; the proxy verifies every operation. */}}
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  window.addEventListener('focus',()=>void checkSession());document.addEventListener('visibilitychange',()=>void checkSession());window.addEventListener('pagehide',revoke);void load();
})();
