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
  function thumbnail(type) {
    const shapes = {
      split:'<rect x="100" y="10" width="70" height="94" fill="#e4b49a"/><path d="M106 88 132 36 168 88" fill="#bb8264"/><path d="M12 22h69m-69 12h58m-58 24h67m-67 7h53"/><rect x="12" y="82" width="43" height="12" fill="#d64639"/>',
      poster:'<path d="M12 14h148m-148 13h131"/><rect x="12" y="46" width="156" height="59" fill="#b8c8b4"/><path d="M30 99 94 51l55 48" fill="#7e9479"/>',
      product:'<rect x="12" y="12" width="72" height="92" fill="#f0d3af"/><rect x="35" y="35" width="26" height="51" rx="4" fill="#b88046"/><path d="M104 27h62m-62 12h51m-51 26h58"/><rect x="104" y="85" width="52" height="13" fill="#d64639"/>',
      catalog:'<path d="M12 17h88"/><rect x="12" y="34" width="46" height="58" fill="#b8c8b4"/><rect x="67" y="34" width="46" height="58" fill="#e4b49a"/><rect x="122" y="34" width="46" height="58" fill="#d8c7a4"/><path d="M12 103h38m17 0h38m17 0h38"/>',
      story:'<rect x="12" y="10" width="74" height="94" fill="#b8c8b4"/><path d="M104 22h60m-60 12h48m-48 23h59m-59 9h61m-61 9h48m-48 18h33"/>',
      pair:'<rect x="12" y="12" width="74" height="76" fill="#c1c9b9"/><rect x="94" y="12" width="74" height="76" fill="#e4b49a"/><path d="M12 101h57m25 0h57"/>',
      wide:'<rect x="12" y="10" width="156" height="82" fill="#c1c9b9"/><path d="m26 83 39-48 28 27 26-34 40 55" fill="#869c80"/><path d="M12 104h95"/>',
      specs:'<path d="M12 16h83m-83 24h51m27 0h72M12 63h51m27 0h72M12 87h51m27 0h72"/><path d="M12 49h156M12 74h156M12 98h156" stroke="#d9dcdf"/>',
      steps:'<path d="M12 17h106M12 42h13m12 0h124M12 69h13m12 0h124M12 96h13m12 0h124"/>',
      table:'<path d="M12 18h82M12 44h154M12 66h154M12 88h154M70 35v68m48-68v68"/><path d="M20 54h30m32 0h24m24 0h22M20 78h30m32 0h24m24 0h22" stroke="#a0a7a6"/>',
      faq:'<path d="M12 16h84M12 40h122m20 0h12m-6-6v12M12 66h122m20 0h12m-6-6v12M12 92h122m20 0h12m-6-6v12"/>',
      quote:'<path d="M22 30h135M22 46h119M22 62h91M22 92h57"/><path d="M12 22v56" stroke="#d64639"/>',
      cta:'<path d="M29 32h123M43 46h95"/><rect x="62" y="72" width="57" height="16" fill="#d64639"/>',
      footer:'<path d="M12 24h51m31 0h28m17 0h28M94 42h27m18 0h27M94 58h23m22 0h22M12 95h156"/>',
      notice:'<rect x="10" y="42" width="160" height="32" fill="#f1e2d6"/><path d="M37 58h107"/>',
      'nav-studio':'<path d="M12 50h37m27 0h17m13 0h17"/><rect x="138" y="42" width="31" height="16" fill="#d64639"/><path d="M12 76h157" stroke="#d9dcdf"/>',
      'nav-masthead':'<path d="M12 28h104m-104 13h82M12 72h22m14 0h22m14 0h22m14 0h22"/><path d="M12 57h157M12 89h157" stroke="#d9dcdf"/>',
      'nav-split':'<path d="M12 57h16m10 0h16M73 57h34m25 0h16m10 0h11"/><path d="M12 76h157" stroke="#d9dcdf"/>',
      'nav-shop':'<path d="M12 31h63m-63 45h24m11 0h24m11 0h24m11 0h24"/><rect x="127" y="23" width="42" height="16" fill="#d64639"/><path d="M12 57h157M12 93h157" stroke="#d9dcdf"/>',
      'nav-compact':'<path d="M12 55h29m62 0h22m17 0h27"/><path d="M12 76h157" stroke="#d9dcdf"/>',
    };
    return `<svg viewBox="0 0 180 116" aria-hidden="true" class="sq-composition-thumbnail"><rect width="180" height="116" fill="#faf8f5"/><g stroke="#444841" stroke-width="3" stroke-linecap="round" fill="none">${shapes[type] || shapes.split}</g></svg>`;
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
