(() => {
  'use strict';
  const ui=window.EzkartReviewDisplay,{el,button}=ui,base='/v1/commerce/reviews',fields=['q','product','state','rating','reply','photos','sort'];
  const key=()=>crypto.randomUUID().replaceAll('-','');
  function mount({request}){
    const root=document.querySelector('[data-commerce-reviews]');if(!root||root.dataset.mounted)return;root.dataset.mounted='1';
    const q=s=>root.querySelector(s),form=q('[data-reviews-filters]'),list=q('[data-reviews-list]'),detail=q('[data-reviews-detail]'),content=q('[data-reviews-detail-content]'),drafts=new Map();
    let filters={},cursor=null,shown=0,listVersion=0,detailVersion=0,loading=false,writing=false,ended=false,selected='',current=null,canWrite=false,pending=null,listMedia=ui.scope(),detailMedia=ui.scope(),lastUrl=location.href;
    const api=path=>request('GET',path,undefined,{timeoutMs:20000});
    const message=(selector,text)=>{const node=q(selector);node.textContent=text;node.hidden=!text;};
    const values=()=>Object.fromEntries(fields.map(k=>[k,form.elements[k].value.trim()]));
    const filtered=value=>Object.fromEntries(Object.entries(value).filter(([,v])=>v!==''));
    function setValues(values={}){for(const name of fields){const input=form.elements[name],value=values[name]||({state:'all',reply:'all',sort:'newest'}[name]||'');if(name==='product'&&value&&![...input.options].some(o=>o.value===value)){const option=el('option','Product from link');option.value=value;input.append(option);}input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));}}
    function updateUrl(push=false){const url=new URL(location.href);for(const name of fields){const value=filters[name];if(value&&value!=='all'&&!(name==='sort'&&value==='newest'))url.searchParams.set(name,value);else url.searchParams.delete(name);}url.searchParams.delete('cursor');if(selected)url.searchParams.set('review',selected);else url.searchParams.delete('review');history[push?'pushState':'replaceState']({},'',url);lastUrl=url.href;}
    function end(messageText){ended=true;listVersion++;detailVersion++;pending=null;drafts.clear();listMedia.dispose();detailMedia.dispose();list.replaceChildren();content.replaceChildren();q('[data-reviews-summary]').replaceChildren();detail.hidden=true;message('[data-reviews-list-error]',messageText||'Your sign-in changed. Reload this page.');q('[data-reviews-refresh]').textContent='Reload sign-in';controls();}
    function failure(error){if(error.status===401||error.code==='review_session_changed'){end(error.message);return true;}return false;}
    const photo=(id,image)=>ui.imageRequest('./?cloud='+encodeURIComponent(base+'/'+id+'/media/'+image),{'X-Ezkart-Review-Account':document.body.dataset.adminReviewAccount||'','X-Ezkart-Csrf':document.body.dataset.adminCsrfToken||''}).catch(error=>{failure(error);throw error;});
    function controls(){
      const locked=writing||Boolean(pending)||ended;
      form.querySelectorAll('input,select,button').forEach(n=>n.disabled=locked||loading);q('[data-reviews-refresh]').disabled=!ended&&(locked||loading);q('[data-reviews-more]').disabled=locked||loading;
      list.querySelectorAll('button').forEach(n=>n.disabled=locked);q('[data-reviews-detail-refresh]').disabled=locked;q('[data-reviews-detail-close]').disabled=locked;
      content.querySelectorAll('button,input,select,textarea').forEach(n=>n.disabled=locked);
      content.querySelectorAll('input,select,textarea').forEach(n=>n.disabled=locked||!canWrite);
      content.querySelectorAll('[data-review-save]').forEach(n=>n.disabled=locked||!canWrite||Boolean(drafts.get(selected)?.conflict));
      content.querySelectorAll('[data-review-retry]').forEach(n=>{n.hidden=pending?.id!==selected;n.disabled=writing||ended;});
      list.setAttribute('aria-busy',String(loading));
    }
    async function load(append=false,next=filters,push=false){
      if(writing||pending||ended)return false;const version=++listVersion;loading=true;controls();message('[data-reviews-list-error]','');message('[data-reviews-list-status]',append?'Loading more reviews…':'Loading reviews…');
      try{const data=await api(base+'?'+new URLSearchParams({...filtered(next),...(append?{cursor}:{})}));if(ended||version!==listVersion)return false;
        if(!Array.isArray(data.items)||!data.summary)throw Error('The review list was incomplete.');
        if(!append){listMedia.dispose();listMedia=ui.scope();list.replaceChildren();shown=0;filters={...next};updateUrl(push);}
        canWrite=data.canWrite&&root.dataset.preview!=='1';q('[data-reviews-summary]').replaceChildren(ui.summary(data.summary));
        message('[data-reviews-availability]',!data.enabled||root.dataset.preview==='1'?'Review replies and moderation are not enabled for this store yet. You can read saved reviews here.':!data.canWrite?'You can read reviews. Your store role does not allow replies or moderation.':'');
        for(const item of data.items){const card=ui.article(item,ids=>listMedia.photos(ids,id=>photo(item.id,id)),{merchant:true}),open=button('Manage review',()=>void show(item.id));open.dataset.reviewManage=item.id;card.append(open);list.append(card);}
        shown+=data.items.length;cursor=data.nextCursor;q('[data-reviews-more]').hidden=!cursor;q('[data-reviews-more]').textContent='Load more reviews';q('[data-reviews-count]').textContent=`${shown.toLocaleString()} of ${data.matching.toLocaleString()} matching reviews`;
        message('[data-reviews-list-status]',data.matching?'Reviews are up to date.':'No reviews match these filters.');return true;
      }catch(error){if(version===listVersion&&!failure(error)){message('[data-reviews-list-error]',error.message+' Retry with the same filters or refresh.');message('[data-reviews-list-status]',shown?'Previously loaded reviews remain below.':'Reviews are unavailable.');if(append)q('[data-reviews-more]').textContent='Retry more reviews';}return false;}
      finally{if(version===listVersion){loading=false;controls();}}
    }
    function historyView(reviewId){
      const section=el('section'),heading=el('h3','Review history','reviews-history-heading'),status=el('p','Loading history…'),rows=el('ol',undefined,'reviews-history'),more=button('Load older changes',()=>void loadHistory(loaded));let loaded=false,busy=false,next=null;more.hidden=true;section.append(heading,status,rows,more);
      async function loadHistory(append=false){if(busy||ended)return;busy=true;more.disabled=true;
        try{const data=await api(base+'/'+reviewId+'/history'+(append?'?cursor='+encodeURIComponent(next):''));if(!section.isConnected||ended)return;
          if(!append)rows.replaceChildren();for(const change of data.items){const row=el('li');row.append(el('b',`${change.actor==='buyer'?'Buyer':'Store'} · ${ui.actionLabels[change.kind]||'Updated review'}`),el('time',ui.date(change.createdAt)),el('p',`${change.content.rating} / 5 · ${change.content.title}`),el('p',change.content.body));if(change.content.moderationNote)row.append(el('p','Moderation: '+change.content.moderationNote));if(change.kind==='reply')row.append(el('p','Reply: '+(change.content.reply||'Reply removed')));
            if(change.content.media.length){const details=el('details'),photos=el('div');details.append(el('summary',`Photos (${change.content.media.length})`),photos);details.addEventListener('toggle',()=>{if(details.open&&!photos.children.length)photos.append(detailMedia.photos(change.content.media,id=>photo(reviewId,id)));});row.append(details);}rows.append(row);}
          loaded=true;next=data.nextCursor;more.hidden=!next;more.textContent='Load older changes';status.textContent=rows.children.length?'':'No recorded changes yet.';
        }catch(error){if(section.isConnected&&!failure(error)){status.textContent=error.message;more.hidden=false;more.textContent=loaded?'Retry older changes':'Retry history';}}
        finally{busy=false;more.disabled=false;}
      }
      queueMicrotask(()=>void loadHistory());return section;
    }
    function renderDetail(row){
      detailMedia.dispose();detailMedia=ui.scope();content.replaceChildren(ui.article(row,ids=>detailMedia.photos(ids,id=>photo(row.id,id)),{merchant:true}));q('[data-reviews-detail-reference]').textContent=row.productName+(row.option?' · '+row.option:'');
      if(row.orderId){const link=el('a','View original order');link.href='?'+new URLSearchParams({page:'orders',order:row.orderId,...(root.dataset.preview==='1'?{'order-preview':'1'}:{})});content.append(link);}
      const existing=drafts.get(row.id),draft=existing?.dirty||existing?.pending?existing:{reply:row.savedReply.body,reason:'personal_information',note:'',revision:row.revision,dirty:false,replyDirty:false,moderationDirty:false,conflict:false};drafts.set(row.id,draft);
      if(draft.revision!==row.revision)draft.conflict=true;
      if(draft.conflict){const notice=el('div',undefined,'reviews-current-version');notice.append(el('p','The latest saved review is shown above. Your draft is unchanged. Compare them before saving.'),button('Use this saved review',()=>{draft.revision=row.revision;draft.conflict=false;notice.remove();controls();}));content.append(notice);}
      if(row.buyerState==='withdrawn')content.append(el('p','The buyer withdrew this review. Store actions cannot make it public.','reviews-notice'));
      if(row.moderation.state==='hidden')content.append(el('p','Moderation explanation: '+row.moderation.note,'reviews-notice'));
      if(row.savedReply.body&&!row.savedReply.current)content.append(el('p','The buyer edited this review after your earlier reply. Check the updated review before publishing a current reply.','reviews-notice'));
      const replyForm=el('form',undefined,'reviews-editor'),replyLabel=el('label','Store reply'),reply=el('textarea');reply.name='reply';reply.rows=4;reply.maxLength=2000;reply.value=draft.reply;replyLabel.append(reply);replyForm.append(replyLabel,el('small','Your reply is public while this version of the review is published. Clear the text and save to remove your reply.'));
      const saveReply=el('button','Save reply','reviews-button primary');saveReply.type='submit';saveReply.dataset.reviewSave='';replyForm.append(saveReply);replyForm.addEventListener('input',()=>{draft.reply=reply.value;draft.dirty=true;draft.replyDirty=true;});replyForm.addEventListener('submit',event=>{event.preventDefault();if(!saveReply.disabled)void send(row.id,{kind:'reply',body:draft.reply,revision:draft.revision,requestKey:key()});});content.append(replyForm);
      const moderation=el('section',undefined,'reviews-moderation');moderation.append(el('h3','Review visibility'),el('p','Hide content only for the reasons below. A low rating or criticism alone is not a moderation reason. The buyer can see your explanation.'));
      const hideForm=el('form',undefined,'reviews-editor'),reasonLabel=el('label','Reason'),reason=el('select');reason.name='reason';for(const [value,text] of Object.entries({personal_information:'Personal information',abuse:'Abusive content',spam:'Spam',unrelated:'Unrelated content',duplicate:'Duplicate content'})){const option=el('option',text);option.value=value;reason.append(option);}reason.value=draft.reason;reasonLabel.append(reason);
      const noteLabel=el('label','Explanation for the buyer'),note=el('textarea');note.rows=3;note.maxLength=1000;note.minLength=10;note.required=true;note.value=draft.note;noteLabel.append(note);hideForm.append(reasonLabel,noteLabel);
      const hide=el('button',row.moderation.state==='hidden'?'Update explanation':'Hide review','reviews-button');hide.type='submit';hide.dataset.reviewSave='';hideForm.append(hide);hideForm.addEventListener('input',()=>{draft.reason=reason.value;draft.note=note.value;draft.dirty=true;draft.moderationDirty=true;});hideForm.addEventListener('change',()=>{draft.reason=reason.value;draft.dirty=true;draft.moderationDirty=true;});hideForm.addEventListener('submit',event=>{event.preventDefault();if(!hide.disabled&&hideForm.reportValidity())void send(row.id,{kind:'hide',reason:draft.reason,note:draft.note,revision:draft.revision,requestKey:key()});});moderation.append(hideForm);
      if(['pending','hidden'].includes(row.moderation.state)){const kind=row.moderation.state==='hidden'?'restore':'approve',restore=button(kind==='restore'?'Restore visibility':'Approve historical review',()=>void send(row.id,{kind,revision:draft.revision,requestKey:key()}));restore.dataset.reviewSave='';moderation.append(restore);}
      content.append(moderation,button('Discard unsaved changes',()=>{drafts.delete(row.id);renderDetail(current);message('[data-reviews-detail-status]','Your unsaved changes were discarded.');}));if(!canWrite){replyForm.querySelectorAll('textarea,button').forEach(n=>n.disabled=true);hideForm.querySelectorAll('textarea,select,button').forEach(n=>n.disabled=true);content.append(el('p','Your current store access allows reading reviews only.','reviews-help'));}
      const retry=button('Retry confirmation',()=>{if(pending?.id===row.id)void send(pending.id,pending.body);});retry.dataset.reviewRetry='';retry.hidden=!pending;content.append(retry,historyView(row.id));controls();
    }
    async function show(id,update=true){
      if(writing||pending||ended)return;const version=++detailVersion;selected=id;current=null;detail.hidden=false;detailMedia.dispose();message('[data-reviews-detail-status]','Loading review…');content.replaceChildren();if(update)updateUrl();
      try{const data=await api(base+'/'+encodeURIComponent(id));if(ended||version!==detailVersion)return;current=data.review;canWrite=data.canWrite&&root.dataset.preview!=='1';renderDetail(current);message('[data-reviews-detail-status]','');q('#review-detail-heading').focus({preventScroll:true});detail.scrollIntoView({block:'start',behavior:'smooth'});}
      catch(error){if(version===detailVersion&&!failure(error))message('[data-reviews-detail-status]',error.message+' Reload saved review to try again.');}
      finally{if(version===detailVersion)controls();}
    }
    async function send(id,body){
      if(writing||ended)return;writing=true;pending={id,body};const draft=drafts.get(id);draft.pending=true;controls();message('[data-reviews-detail-status]','Saving review change…');
      let result;
      try{result=await request('POST',base+'/'+id,body,{timeoutMs:25000});if(ended)return;pending=null;draft.pending=false;draft.conflict=false;current=result.review;draft.revision=current.revision;
        if(body.kind==='reply'){draft.replyDirty=false;draft.reply=current.savedReply.body;}else if(body.kind==='hide'){draft.moderationDirty=false;draft.note='';}
        draft.dirty=Boolean(draft.replyDirty||draft.moderationDirty);if(!draft.dirty)drafts.delete(id);renderDetail(current);message('[data-reviews-detail-status]','Saved. The current review is shown below.');}
      catch(error){if(failure(error))return;if(!error.status||error.status>=500){message('[data-reviews-detail-status]',error.message+' Retry confirmation to check the same request.');}
        else{pending=null;draft.pending=false;draft.dirty=true;if(error.status===409)draft.conflict=true;message('[data-reviews-detail-status]',error.message+' Reload saved review to compare it with your retained draft.');}}
      finally{writing=false;controls();}
      if(result&&!ended){await load(false);if(selected===id)message('[data-reviews-detail-status]','Saved. The current review is shown below.');}
    }
    form.addEventListener('submit',event=>{event.preventDefault();void load(false,values(),true);});q('[data-reviews-clear]').addEventListener('click',()=>{setValues();void load(false,values(),true);});q('[data-reviews-more]').addEventListener('click',()=>void load(true));q('[data-reviews-refresh]').addEventListener('click',()=>{if(ended)location.reload();else void load(false);});
    q('[data-reviews-detail-refresh]').addEventListener('click',()=>void show(selected));q('[data-reviews-detail-close]').addEventListener('click',()=>{if(writing||pending)return;const previous=selected;detailVersion++;selected='';detail.hidden=true;detailMedia.dispose();content.replaceChildren();updateUrl();const opener=[...list.querySelectorAll('[data-review-manage]')].find(n=>n.dataset.reviewManage===previous);(opener||q('[data-reviews-refresh]')).focus();});
    function fromUrl(){const url=new URL(location.href);setValues(Object.fromEntries(fields.map(k=>[k,url.searchParams.get(k)||''])));filters=values();const id=url.searchParams.get('review');void load(false);if(id&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(id))void show(id,false);}
    window.addEventListener('popstate',()=>{if(pending||writing){history.pushState({},'',lastUrl);message('[data-reviews-detail-status]','Confirm the pending review change before leaving this view.');return;}detailVersion++;detail.hidden=true;selected='';fromUrl();});
    window.addEventListener('beforeunload',event=>{if(writing||pending||[...drafts.values()].some(d=>d.dirty)){event.preventDefault();event.returnValue='';}});
    window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});fromUrl();
  }
  window.EzkartCommerceReviews={mount};
})();
