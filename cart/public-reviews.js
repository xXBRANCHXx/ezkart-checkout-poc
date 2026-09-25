(() => {
  'use strict';
  const ui=window.EzkartReviewDisplay,{el,button}=ui;
  const endpoint='/cart/api/reviews.php';
  async function request(query){const response=await fetch(endpoint+'?'+new URLSearchParams(query),{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(20000)}),data=await response.json();if(!response.ok||data.ok!==true){const error=Error(data.error||'Reviews could not be loaded.');error.status=response.status;throw error;}return data;}
  const publicPhoto=(review,id)=>ui.imageRequest(endpoint+'?'+new URLSearchParams({review,photo:id}));
  function show({productId,productName,initial={},read=request,photo=publicPhoto,onSummary=()=>{},onFilters=()=>{},onClose=()=>{}}){
    const dialog=el('dialog',undefined,'reviews-dialog reviews-view'),header=el('header'),heading=el('div');dialog.setAttribute('aria-label','Product reviews for '+productName);heading.append(el('h2','Product reviews'),el('p',productName));header.append(heading,button('Close reviews',close));
    const overview=el('div'),form=el('form',undefined,'reviews-filters'),status=el('p','Loading reviews…'),error=el('p','', 'reviews-error'),rows=el('div'),footer=el('div',undefined,'reviews-footer');status.setAttribute('role','status');error.setAttribute('role','alert');
    const fields={rating:[['','All ratings'],['5','5 stars'],['4','4 stars'],['3','3 stars'],['2','2 stars'],['1','1 star']],photos:[['','All reviews'],['1','With photos'],['0','Without photos']],sort:[['newest','Newest first'],['oldest','Oldest first']]};
    for(const [name,options] of Object.entries(fields)){const label=el('label',{rating:'Rating',photos:'Photos',sort:'Order'}[name]),select=el('select');select.name=name;for(const [value,text] of options){const option=el('option',text);option.value=value;select.append(option);}select.value=options.some(([v])=>v===initial[name])?initial[name]:options[0][0];label.append(select);form.append(label);}
    const apply=el('button','Apply filters','reviews-button');apply.type='submit';form.append(apply);
    const more=button('Load more reviews',()=>void load(true)),refresh=button('Refresh reviews',()=>void load(false)),retry=button('Retry reviews',()=>void load(false,failedFilters||filters));more.hidden=true;retry.hidden=true;footer.append(refresh,more);dialog.append(header,overview,form,status,error,retry,rows,footer);document.body.append(dialog);dialog.showModal();
    let active=true,busy=false,generation=0,cursor=null,filters=values(),failedFilters=null,media=ui.scope(),displayed=0;
    function values(){return Object.fromEntries(Object.keys(fields).map(k=>[k,form.elements[k].value]));}
    function controls(){more.disabled=busy;refresh.disabled=busy;form.querySelectorAll('select,button').forEach(n=>n.disabled=busy);overview.querySelectorAll('button').forEach(n=>n.disabled=busy);rows.setAttribute('aria-busy',String(busy));}
    async function load(append=false,next=filters){
      if(!active||busy)return;const version=++generation;busy=true;error.textContent='';retry.hidden=true;controls();status.textContent=append?'Loading more reviews…':'Loading reviews…';
      try{const data=await read({product:productId,...next,...(append?{cursor}:{})});if(!active||version!==generation)return;
        if(!Array.isArray(data.items)||!data.summary||!Number.isInteger(data.matching))throw Error('The review response was incomplete.');
        if(!append){media.dispose();media=ui.scope();rows.replaceChildren();displayed=0;filters={...next};onFilters(filters);}
        overview.replaceChildren(ui.summary(data.summary,rating=>{form.elements.rating.value=rating;form.elements.rating.dispatchEvent(new Event('change',{bubbles:true}));void load(false,values());}));onSummary(data.summary);
        rows.append(...data.items.map(item=>ui.article(item,ids=>media.photos(ids,id=>photo(item.id,id)))));displayed+=data.items.length;cursor=data.nextCursor;more.hidden=!cursor;more.textContent='Load more reviews';failedFilters=null;
        status.textContent=data.matching?`${displayed.toLocaleString()} of ${data.matching.toLocaleString()} matching reviews`:'No reviews match these filters.';
      }catch(e){if(active&&version===generation){error.textContent=e.message;status.textContent=displayed?'Previously loaded reviews remain below.':'Reviews are unavailable.';if(append){more.hidden=false;more.textContent='Retry more reviews';}else{failedFilters={...next};retry.hidden=false;}}}
      finally{if(version===generation){busy=false;controls();}}
    }
    form.addEventListener('submit',event=>{event.preventDefault();void load(false,values());});
    function cleanup(){if(!active)return;active=false;generation++;media.dispose();window.removeEventListener('focus',focus);dialog.remove();onClose();}
    function close(){dialog.close();cleanup();}
    dialog.addEventListener('close',cleanup);
    const focus=()=>{if(active&&!document.hidden&&!busy)void load(false);};window.addEventListener('focus',focus);
    void load(false);return {dialog,close};
  }
  window.EzkartPublicReviews={show,request,photo:publicPhoto};
})();
