(() => {
  'use strict';
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
  const button=(text,fn)=>{const node=el('button',text,'reviews-button');node.type='button';node.addEventListener('click',fn);return node;};
  const date=value=>window.EzkartAdminFormat?window.EzkartAdminFormat.date(value,{time:false}):value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:'Asia/Jakarta'}).format(new Date(value)):'Date unavailable';
  const actionLabels={publish:'Published a review',withdraw:'Withdrew the review',reply:'Updated the store reply',hide:'Hid the review',restore:'Restored review visibility',approve:'Approved the review'};
  const stateLabels={published:'Published',hidden:'Hidden by store',pending:'Awaiting moderation',withdrawn:'Withdrawn by buyer'};
  function scope(){
    const urls=new Set(),observers=new Set(),dialogs=new Set();let active=true;
    const url=blob=>{const value=URL.createObjectURL(blob);urls.add(value);return value;};
    const revoke=value=>{if(value){URL.revokeObjectURL(value);urls.delete(value);}};
    function photos(ids,load){
      const row=el('div',undefined,'reviews-photos');
      ids.forEach((id,index)=>{
        const figure=el('figure'),image=el('img'),message=el('small','Loading photo…'),dialog=el('dialog',undefined,'reviews-photo-dialog');image.alt=`Review photo ${index+1}`;
        let photoVersion=0,largeUrl='';dialogs.add(dialog);dialog.setAttribute('aria-label',`Review photo ${index+1}`);
        const close=button('Close photo',()=>dialog.close()),large=el('img'),opening=el('p','Loading photo…');large.alt=`Review photo ${index+1}, enlarged`;large.hidden=true;dialog.append(close,opening,large);
        dialog.addEventListener('close',()=>{photoVersion++;revoke(largeUrl);largeUrl='';large.removeAttribute('src');large.hidden=true;});
        const open=button('',async()=>{const version=++photoVersion;dialog.showModal();large.hidden=true;opening.hidden=false;opening.textContent='Loading photo…';try{const blob=await load(id);if(!active||!dialog.isConnected||!dialog.open||version!==photoVersion)return;revoke(largeUrl);large.src=largeUrl=url(blob);large.hidden=false;opening.hidden=true;}catch(e){if(active&&dialog.open&&version===photoVersion)opening.textContent=e.message||'This photo is unavailable.';}});
        open.className='reviews-photo-open';open.setAttribute('aria-label',`Enlarge review photo ${index+1}`);open.hidden=true;open.append(image);
        const retry=button('Retry photo',()=>void thumbnail());retry.hidden=true;figure.append(open,message,retry,dialog);row.append(figure);
        async function thumbnail(){retry.hidden=true;try{const blob=await load(id);if(!active||!figure.isConnected)return;image.src=url(blob);open.hidden=false;message.hidden=true;}catch(e){if(active&&figure.isConnected){message.textContent='Photo unavailable.';retry.hidden=false;}}}
        if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();observers.delete(observer);void thumbnail();}},{rootMargin:'150px'});observers.add(observer);observer.observe(figure);}
        else queueMicrotask(()=>void thumbnail());
      });return row;
    }
    return {photos,dispose(){active=false;observers.forEach(o=>o.disconnect());observers.clear();dialogs.forEach(d=>{if(d.open)d.close();});dialogs.clear();urls.forEach(value=>URL.revokeObjectURL(value));urls.clear();}};
  }
  function article(item,media,{merchant=false}={}){
    const node=el('article',undefined,'reviews-card');node.dataset.reviewId=item.id;
    const header=el('header'),identity=el('div');identity.append(el('b',item.publicName),el('span',item.verifiedPurchase?'Verified purchase':'Historical review','reviews-badge'));
    header.append(identity,el('time',date(item.createdAt)));node.append(header,el('p',`${item.rating} / 5 · ${'★'.repeat(item.rating)}${'☆'.repeat(5-item.rating)}`,'reviews-score'));
    if(merchant)node.append(el('p',[item.productName,item.option,stateLabels[item.state]||item.state].filter(Boolean).join(' · '),'reviews-meta'));
    else if(item.option)node.append(el('p',item.option,'reviews-meta'));
    if(item.title)node.append(el('h3',item.title));if(item.body)node.append(el('p',item.body,'reviews-body'));if(item.photos.length)node.append(media(item.photos));
    if(item.reply){const reply=el('blockquote',undefined,'reviews-reply');reply.append(el('b','Store reply'),el('p',item.reply.body),el('time',date(item.reply.createdAt)));node.append(reply);}
    return node;
  }
  function summary(data,choose){
    const node=el('div',undefined,'reviews-summary'),score=el('div',undefined,'reviews-average');score.append(el('strong',data.count?Number(data.average).toFixed(1):'—'),el('span',data.count?`${data.count.toLocaleString()} published ${data.count===1?'review':'reviews'}`:'No published reviews yet'));
    node.append(score);const distribution=el('div',undefined,'reviews-distribution');distribution.setAttribute('aria-label','Published rating distribution');
    for(let rating=5;rating>=1;rating--){const count=data.stars[rating]||0,row=choose?button('',()=>choose(String(rating))):el('div');row.className='reviews-star-row';if(choose)row.setAttribute('aria-label',`${rating} stars, ${count} reviews`);const meter=el('meter');meter.min=0;meter.max=Math.max(1,data.count);meter.value=count;meter.setAttribute('aria-label',`${rating} star reviews`);row.append(el('span',rating+' ★'),meter,el('span',count));distribution.append(row);}node.append(distribution);return node;
  }
  async function imageRequest(path,headers={}){const response=await fetch(path,{cache:'no-store',credentials:'same-origin',headers,signal:AbortSignal.timeout(20000)});if(!response.ok||!/^image\/(jpeg|png|webp)(?:;|$)/.test(response.headers.get('content-type')||'')){const error=Error('This review photo is unavailable.');error.status=response.status;throw error;}return response.blob();}
  window.EzkartReviewDisplay={el,button,date,scope,article,summary,actionLabels,stateLabels,imageRequest};
})();
