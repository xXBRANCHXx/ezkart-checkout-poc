(() => {
  'use strict';
  function mount({product,request}){
    const root=document.querySelector('[data-product-live-reviews]'),rating=document.querySelector('[data-product-live-rating]');if(!root||!rating)return;
    const ui=window.EzkartReviewDisplay,{el,button}=ui;root.classList.add('reviews-view');root.replaceChildren();
    const header=el('header'),title=el('div');title.append(el('span','Product reviews'));const count=el('b',product?'Loading reviews…':'No reviews yet');title.append(count);header.append(title);root.append(header);
    const status=el('p','', 'reviews-help');status.setAttribute('role','status');root.append(status);
    function summary(data){const score=rating.querySelector('b');score.textContent=data.count?Number(data.average).toFixed(1):'—';rating.setAttribute('aria-label',data.count?`Rating ${Number(data.average).toFixed(1)} out of 5 from ${data.count} reviews`:'No published reviews');count.textContent=data.count?`${data.count} published ${data.count===1?'review':'reviews'}`:'No reviews yet';}
    if(!product){summary({count:0});status.textContent='Buyer reviews will appear after this product is purchased and delivered.';return;}
    let viewer=null,ended=false;
    function failure(error){if(error.status===401){ended=true;viewer?.close();browse.hidden=true;retry.hidden=true;rating.querySelector('b').textContent='—';rating.setAttribute('aria-label','Ratings unavailable');count.textContent='Reviews unavailable';status.textContent='Your sign-in changed. Reload this page to read reviews.';}throw error;}
    const read=async query=>{try{const data=await request('GET','/v1/commerce/reviews?'+new URLSearchParams({...query,state:'published'}),undefined,{timeoutMs:20000});if(!data.productSummary)throw Error('Product ratings could not be loaded.');return {...data,summary:data.productSummary};}catch(error){return failure(error);}};
    const photo=(review,id)=>ui.imageRequest('./?cloud='+encodeURIComponent('/v1/commerce/reviews/'+review+'/media/'+id),{'X-Ezkart-Review-Account':document.body.dataset.adminReviewAccount||'','X-Ezkart-Csrf':document.body.dataset.adminCsrfToken||''}).catch(failure);
    const browse=button('Read product reviews',()=>{viewer?.close();viewer=window.EzkartPublicReviews.show({productId:product.id,productName:product.name,read,photo,onSummary:summary,onClose:()=>{viewer=null;}});});browse.hidden=true;root.append(browse);
    const retry=button('Retry product reviews',()=>void load());retry.hidden=true;root.append(retry);
    async function load(){retry.hidden=true;try{const data=await read({product:product.id,limit:'1'});if(ended)return;summary(data.summary);browse.hidden=!data.summary.count;status.textContent=product.status==='archived'?'This product is archived. These reviews remain in its history.':data.summary.count?'Ratings come from the currently published reviews.':'No buyers have published a review for this product yet.';}catch(error){if(ended)return;rating.querySelector('b').textContent='—';rating.setAttribute('aria-label','Ratings unavailable');count.textContent='Reviews unavailable';status.textContent=error.message;retry.hidden=false;}}
    void load();
  }
  window.EzkartProductReviews={mount};
})();
