/* Shared, native building blocks. The UI and MCP use this same catalog. */
(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => {
    const url = String(value || '').trim();
    return /^(https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i.test(url) ? url : '';
  };
  const definitions = [
    {id:'hero-split',name:'Split hero',category:'Hero',description:'A strong headline beside a full-height photograph.',preview:'split'},
    {id:'hero-poster',name:'Poster hero',category:'Hero',description:'Oversized type, a wide image, and one clear action.',preview:'poster'},
    {id:'product-feature',name:'Product feature',category:'Commerce',description:'A real product, image, details, and purchase action.',preview:'product'},
    {id:'product-collection',name:'Product collection',category:'Commerce',description:'Your connected catalog with variants and checkout.',preview:'catalog'},
    {id:'story-split',name:'Editorial story',category:'Story',description:'A photograph and a considered column of copy.',preview:'story'},
    {id:'image-pair',name:'Image pair',category:'Media',description:'Two independent images with editable captions.',preview:'pair'},
    {id:'image-wide',name:'Wide photograph',category:'Media',description:'One generous image, with an optional caption.',preview:'wide'},
    {id:'specifications',name:'Specifications',category:'Details',description:'Clear, editable rows for product facts and contents.',preview:'specs'},
    {id:'process',name:'How it works',category:'Details',description:'An ordered sequence with useful explanations.',preview:'steps'},
    {id:'comparison',name:'Comparison',category:'Details',description:'Compare named options with factual detail.',preview:'table'},
    {id:'faq-list',name:'Questions & answers',category:'Details',description:'Accessible disclosures that grow with their answers.',preview:'faq'},
    {id:'quote',name:'Customer quote',category:'Story',description:'An honest empty state until you add a real quote.',preview:'quote'},
    {id:'call-to-action',name:'Closing invitation',category:'Footer',description:'A focused final heading and a direct next step.',preview:'cta'},
    {id:'footer',name:'Site footer',category:'Footer',description:'Brand, practical links, and a contact destination.',preview:'footer'},
    {id:'announcement',name:'Announcement',category:'Navigation',description:'A compact, editable notice without invented offers.',preview:'notice'},
  ];
  const navDefinitions = [
    {id:'studio',name:'Studio',description:'Wordmark left. Links and a single action right.',preview:'nav-studio'},
    {id:'masthead',name:'Masthead',description:'Large brand above a separate navigation row.',preview:'nav-masthead'},
    {id:'split',name:'Centered brand',description:'A central wordmark with links on either side.',preview:'nav-split'},
    {id:'shop',name:'Shop index',description:'Brand and checkout above collection links.',preview:'nav-shop'},
    {id:'compact',name:'Essential',description:'A quiet wordmark and a short set of text links.',preview:'nav-compact'},
  ];
  function thumbnail(id) {
    const known = definitions.some(item => item.id === id) || navDefinitions.some(item => `nav-${item.id}` === id);
    return known ? `<img src="assets/components/${id}.webp" alt="" loading="lazy" decoding="async" class="sq-composition-thumbnail">` : '';
  }
  function create(id, {sectionId, content = {}, product = null, products = []} = {}) {
    const definition = definitions.find(item => item.id === id);
    if (!definition) throw new Error(`Unknown component: ${id}`);
    if (!/^[a-zA-Z0-9_-]+$/.test(sectionId || '')) throw new Error('A valid section ID is required.');
    const c = content, e = escape;
    const productImage = product?.image || product?.images?.[0] || '';
    const attrs = (key, type, desktop, mobile, tablet = mobile) => `data-sq-element data-sq-element-id="${e(sectionId)}-${key}" data-sq-element-type="${type}" data-layout-desktop="${desktop}" data-layout-tablet="${tablet}" data-layout-mobile="${mobile}"`;
    const heading = (key, text, desktop, mobile, level = 2, tablet) => `<div class="sq-free-element sq-free-heading sq-composition-heading" ${attrs(key,'heading',desktop,mobile,tablet)} data-sq-auto-height="true"><h${level}>${e(text)}</h${level}></div>`;
    const text = (key, value, desktop, mobile, tablet) => `<div class="sq-free-element sq-free-text sq-composition-copy" ${attrs(key,'text',desktop,mobile,tablet)} data-sq-auto-height="true"><p>${e(value)}</p></div>`;
    const photo = (key, src, alt, desktop, mobile, tablet) => `<div class="sq-free-element sq-free-image sq-composition-image" ${attrs(key,'image',desktop,mobile,tablet)}>${safeUrl(src) ? `<img src="${e(safeUrl(src))}" alt="${e(alt || '')}" loading="${id.startsWith('hero-')?'eager':'lazy'}" decoding="async">` : '<img alt=""><div class="sq-image-placeholder">Choose an image</div>'}</div>`;
    const button = (key,label,target,desktop,mobile,tablet) => `<div class="sq-free-element sq-free-button button-primary sq-composition-action" ${attrs(key,'button',desktop,mobile,tablet)} data-sq-button-role="primary"><button type="button" data-sq-link-type="${target === 'checkout' ? 'checkout' : 'section'}" data-sq-link="${e(target === 'checkout' ? '' : String(target || 'products').replace(/^#/,''))}">${e(label || 'Shop the collection')}</button></div>`;
    const title = c.title || product?.name || 'Make room for something good.';
    const body = c.body || product?.description || 'Tell people what you make, who it is for, and what makes it worth their time.';
    const image = c.image || productImage;
    let elements = '', rows = 1;
    const itemList = (fallback) => Array.isArray(c.items) && c.items.length ? c.items.slice(0,12) : fallback;
    if (id === 'hero-split' || id === 'product-feature') {
      elements = heading('title',title,'1,2,5,5','1,1,12,5',id==='hero-split'?1:2)
        + text('body',body,'1,8,5,4','1,7,12,4')
        + button('action',c.actionLabel || (id==='product-feature'?'View product':'Shop the collection'),c.actionTarget || 'products','1,13,4,2','1,12,8,2')
        + photo('image',image,c.alt || product?.name,'7,1,6,16','1,16,12,12');
      rows = 16;
    } else if (id === 'hero-poster') {
      elements = heading('title',title,'1,1,9,5','1,1,12,5',1)+text('body',body,'10,1,3,4','1,7,12,4')+photo('image',image,c.alt,'1,7,12,15','1,12,12,12')+button('action',c.actionLabel,c.actionTarget,'1,23,4,2','1,25,10,2'); rows=24;
    } else if (id === 'story-split') {
      elements=photo('image',image,c.alt,'1,1,6,15','1,1,12,12')+heading('title',c.title || 'A story worth telling.','8,2,5,4','1,15,12,4')+text('body',body,'8,7,5,7','1,20,12,7');rows=15;
    } else if (id === 'image-pair') {
      elements=photo('image',image,c.alt,'1,1,6,13','1,1,12,12')+photo('image-two',c.imageTwo || products[1]?.image,c.altTwo,'7,1,6,13','1,16,12,12')+text('caption',c.caption || 'Add a caption.','1,14,6,2','1,13,12,2')+text('caption-two',c.captionTwo || 'Add a second caption.','7,14,6,2','1,28,12,2');rows=15;
    } else if (id === 'image-wide') {
      elements=photo('image',image,c.alt,'1,1,12,16','1,1,12,11')+text('caption',c.caption || '','1,17,12,2','1,12,12,2');rows=18;
    } else if (id === 'specifications' || id === 'process') {
      const items=itemList(id==='specifications'?[{title:'Format',body:'Add the product format.'},{title:'Contents',body:'Add verified contents.'},{title:'Care',body:'Add care or storage instructions.'}]:[{title:'Choose',body:'Describe the first step.'},{title:'Prepare',body:'Explain what happens next.'},{title:'Enjoy',body:'Finish with the useful outcome.'}]);
      elements=heading('title',c.title || (id==='specifications'?'The details.':'Make it part of your day.'),'1,1,4,4','1,1,12,4');
      items.forEach((item,i)=>{const y=1+i*4;elements+=`<div class="sq-composition-detail" ${attrs(`item-${i+1}`,'copy',`6,${y},7,4`,`1,${6+i*5},12,5`)} data-sq-auto-height="true">${id==='process'?`<span class="sq-step-number">${String(i+1).padStart(2,'0')}</span>`:''}<h3>${e(item.title)}</h3><p>${e(item.body)}</p></div>`;});rows=Math.max(4,items.length*4);
    } else if (id === 'faq-list') {
      const items=itemList([{title:'What would you like customers to know?',body:'Add a clear, factual answer to a common question.'},{title:'How can customers contact you?',body:'Add your real contact details and availability.'}]);
      elements=heading('title',c.title || 'Good questions. Clear answers.','1,1,4,5','1,1,12,4');
      elements+=`<div class="sq-composition-faq" ${attrs('questions','faq',`6,1,7,${items.length*4}`,`1,6,12,${items.length*5}`)} data-sq-auto-height="true">${items.map(item=>`<details><summary>${e(item.title)}</summary><p>${e(item.body)}</p></details>`).join('')}</div>`;rows=Math.max(5,items.length*4);
    } else if (id === 'comparison') {
      const items=itemList([{title:'Format',left:'Add a fact.',right:'Add a fact.'},{title:'Best for',left:'Add a use case.',right:'Add a use case.'}]);
      elements=heading('title',c.title || 'Find your fit.','1,1,12,3','1,1,12,4');
      elements+=`<div class="sq-composition-comparison" ${attrs('comparison','comparison',`1,5,12,${items.length*3+3}`,`1,6,12,${items.length*4+4}`)} data-sq-auto-height="true"><table><thead><tr><th scope="col">${e(c.dimensionLabel || 'Detail')}</th><th scope="col">${e(c.leftLabel || 'First option')}</th><th scope="col">${e(c.rightLabel || 'Second option')}</th></tr></thead><tbody>${items.map(item=>`<tr><th scope="row">${e(item.title)}</th><td>${e(item.left)}</td><td>${e(item.right)}</td></tr>`).join('')}</tbody></table></div>`;rows=items.length*3+7;
    } else if (id === 'quote') {
      elements=`<div class="sq-composition-quote" ${attrs('quote','quote','2,1,10,6','1,1,12,8')} data-sq-auto-height="true"><blockquote>${e(c.quote || 'Add a real customer quote when you have permission to share it.')}</blockquote><p>${e(c.attribution || 'No customer quote added yet.')}</p></div>`;rows=6;
    } else if (id === 'call-to-action') {
      elements=heading('title',c.title || 'Ready when you are.','1,1,8,4','1,1,12,4')+text('body',c.body || 'Choose what works for you.','1,6,7,2','1,6,12,3')+button('action',c.actionLabel,c.actionTarget,'10,3,3,2','1,10,10,2');rows=7;
    } else if (id === 'footer') {
      elements=heading('brand',c.brand || 'Your brand','1,1,5,3','1,1,12,3')+text('body',c.body || 'Tell people how to reach you.','1,5,5,3','1,5,12,3');
      const links=itemList([{title:'Shop',href:'#products'},{title:'Our story',href:'#story'},{title:'Questions',href:'#questions'}]);
      elements+=`<nav class="sq-composition-footer-links" ${attrs('links','navigation','8,1,5,6','1,9,12,6')} aria-label="Footer navigation">${links.map(item=>`<a href="${e(safeUrl(item.href) || '#')}" data-sq-link-type="${String(item.href).startsWith('#')?'section':'url'}" data-sq-link="${e(String(item.href || '').replace(/^#/,''))}">${e(item.title)}</a>`).join('')}</nav>`+text('copyright',c.copyright || c.brand || 'Your brand','1,10,12,2','1,17,12,2');rows=11;
    } else if (id === 'announcement') {
      elements=text('notice',c.body || 'Add an announcement.','1,1,12,1','1,1,12,2');rows=1;
    } else if (id === 'product-collection') {
      elements=heading('title',c.title || 'Shop the collection.','1,1,8,4','1,1,12,4')+text('body',c.body || 'Choose from the products in our catalog.','9,1,4,4','1,6,12,3')+`<div class="sq-product-grid" ${attrs('products','product-grid','1,6,12,18','1,10,12,24')} data-sq-product-grid data-sq-product-columns-desktop="2" data-sq-product-columns-mobile="1"></div>`;rows=23;
    }
    return `<section class="sq-page-block sq-composition sq-composition-${id}${id==='product-collection'?' sq-product-section':''}" data-sq-block data-sq-fluid data-sq-composition="${id}" data-sq-section-name="${e(definition.name)}" data-sq-min-rows="1" data-sq-rows="${rows}" data-section-id="${e(sectionId)}" id="${e(sectionId)}" draggable="true">${elements}</section>`;
  }
  // Keep content-sized elements on the same grid as manually sized elements.
  // Moving following elements by the height delta preserves the authored gap.
  function fitContent(section, readLayout, writeLayout, rowHeight) {
    const elements = [...section.querySelectorAll(':scope > [data-sq-element], :scope > .ez-fluid-element')];
    let changed = false;
    for (const element of elements) {
      if (element.dataset.sqAutoHeight !== 'true' && element.dataset.ezkartAutoHeight !== 'true') continue;
      if (!element.getClientRects().length) continue;
      const rect = element.getBoundingClientRect();
      const scale = element.offsetWidth ? rect.width / element.offsetWidth : 1;
      const children = [...element.children].filter(child => child.getClientRects().length);
      if (!children.length || scale <= 0) continue;
      const style = getComputedStyle(element);
      const bottom = Math.max(...children.map(child => child.getBoundingClientRect().bottom));
      const height = (bottom - rect.top) / scale + (parseFloat(style.paddingBottom) || 0);
      const layout = readLayout(element);
      const rows = Math.max(1, Math.min(80, Math.ceil((height + (parseFloat(getComputedStyle(section).rowGap) || 0) - .5) / rowHeight)));
      const delta = rows - layout.height;
      if (!delta) continue;
      for (const sibling of elements) {
        if (sibling === element) continue;
        const next = readLayout(sibling);
        if (next.y >= layout.y + layout.height && next.x < layout.x + layout.width && next.x + next.width > layout.x) writeLayout(sibling, {...next,y:Math.max(1,next.y+delta)});
      }
      writeLayout(element,{...layout,height:rows});
      changed = true;
    }
    return changed;
  }
  globalThis.EzkartComponents = {definitions,navDefinitions,thumbnail,create,fitContent};
})();
