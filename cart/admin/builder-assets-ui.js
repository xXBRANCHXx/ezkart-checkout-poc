/* Asset browsing stays outside the document. Insertions use the shared editor. */
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fitPreview = frame => {
    const artwork = frame.firstElementChild;
    if (!artwork || !frame.clientWidth) return;
    const scale = Math.min((frame.clientWidth - 30) / Math.max(1,artwork.offsetWidth), (frame.clientHeight - 24) / artwork.scrollHeight);
    artwork.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  const observer = new ResizeObserver(entries => entries.forEach(({target}) => fitPreview(target)));
  const pendingPreviews = new WeakMap();
  const previewObserver = new IntersectionObserver(entries => entries.forEach(({target, isIntersecting}) => {
    if (!isIntersecting) return;
    const make = pendingPreviews.get(target);
    if (make) {
      target.append(make());
      pendingPreviews.delete(target);
      observer.observe(target);
      fitPreview(target);
    }
    previewObserver.unobserve(target);
  }), {rootMargin:'180px'});
  const queuePreview = (frame, make) => { pendingPreviews.set(frame, make); previewObserver.observe(frame); };
  document.fonts?.addEventListener('loadingdone', () => document.querySelectorAll('.sq-asset-preview').forEach(fitPreview));
  const keywords = {code:'snippet syntax terminal',bulletins:'bullets announcement notice checklist',accordions:'faq questions answers expandable',invitations:'call to action cta closing',reviews:'testimonials customer quotes',facts:'stats statistics specifications',people:'about us founder team'};
  function assetCard(item,asSection=false) {
    const button = document.createElement('button');
    button.type='button'; button.draggable=true; button.className='sq-asset-card';
    button.dataset[asSection?'sqAddBlock':'sqAsset']=item.id;
    button.dataset.sqAssetPurpose=item.category;
    button.dataset.search=`${item.name} ${item.category} ${item.description} ${keywords[item.category] || ''}`;
    button.setAttribute('aria-label',`Add ${item.name}${asSection?' section':''}`);
    button.title=item.description;
    button.innerHTML=`<span class="sq-asset-preview" aria-hidden="true"></span><span class="sq-asset-caption"><b>${escape(item.name)}</b><span class="sq-asset-add" aria-hidden="true">+</span></span>`;
    const frame=button.querySelector('.sq-asset-preview');
    queuePreview(frame, () => EzkartAssets.preview(item.assetId || item.id));
    return button;
  }
  function renderCatalog(root) {
    const anchor=root.querySelector('[data-sq-library-group="sections"]');
    EzkartAssets.categories.forEach(category=>{
      const group=document.createElement('div');
      group.className='sq-block-group sq-asset-group';
      group.dataset.sqLibraryGroup='elements'; group.dataset.sqAssetPurpose=category.id;
      const designs=EzkartAssets.definitions.filter(item=>item.category===category.id);
      group.innerHTML=`<h3>${escape(category.name)}<span>${designs.length} designs</span></h3><div class="sq-asset-grid" data-sq-asset-catalog="${category.id}"></div><button type="button" class="sq-asset-view-more" data-sq-view-category="${category.id}" data-sq-view-library="elements" aria-label="View more ${escape(category.name)}">View more <span aria-hidden="true">→</span></button>`;
      designs.forEach(item=>group.querySelector('.sq-asset-grid').append(assetCard(item)));
      root.insertBefore(group,anchor);
    });
  }
  function browse({root,componentCount,syncControls,products}) {
    const search=root.querySelector('[data-sq-block-search]'),purpose=root.querySelector('[data-sq-asset-filter]');
    const purposeRow=root.querySelector('[data-sq-asset-filter-row]');
    const sectionList=root.querySelector('[data-sq-native-component-list]');
    const legacyPurpose={Hero:'hero',Commerce:'commerce',Story:'story',Media:'media',Details:'facts',Footer:'footers',Navigation:'navigation'};
    const specificPurpose={'quote':'reviews','faq-list':'accordions','process':'diagrams','call-to-action':'invitations','announcement':'bulletins','feature-showcase':'features','journey-timeline':'diagrams','support-questions':'accordions','contact-invitation':'contact'};
    const sectionCategories=[{id:'hero',name:'Hero & introductions'},{id:'commerce',name:'Products & collections'},{id:'story',name:'About & story'},{id:'media',name:'Media & galleries'},{id:'navigation',name:'Navigation'},...EzkartAssets.categories];
    EzkartComponents.definitions.forEach(item=>{
      const card=sectionList.querySelector(`[data-sq-add-block="${item.id}"]`);
      if(!card)return;
      card.dataset.sqAssetPurpose=specificPurpose[item.id] || legacyPurpose[item.category] || 'story';
      card.title=item.description; card.setAttribute('aria-label',`Add ${item.name} section`);
      card.querySelector('small')?.remove();
    });
    EzkartAssets.sectionDefinitions.forEach(item=>sectionList.append(assetCard(item,true)));
    // Keep the older presets in the same purpose-based families as new sections.
    sectionCategories.forEach(category=>{
      const cards=[...sectionList.children].filter(card=>card.dataset.sqAssetPurpose===category.id);
      if(!cards.length)return;
      const family=document.createElement('div'); family.className='sq-section-family';
      family.dataset.sqSectionPurpose=category.id;
      family.innerHTML=`<h3>${escape(category.name)}<span>${cards.length} designs</span></h3><div class="sq-asset-grid"></div><button type="button" class="sq-asset-view-more" data-sq-view-category="${category.id}" data-sq-view-library="sections" aria-label="View more ${escape(category.name)} sections">View more <span aria-hidden="true">→</span></button>`;
      cards.forEach(card=>family.querySelector('.sq-asset-grid').append(card));sectionList.append(family);
    });
    let library='elements',choiceFamily='';
    let categoryOpener=null, overviewScroll=0;
    const categoryHeading=document.createElement('div');
    categoryHeading.className='sq-asset-category-heading';categoryHeading.hidden=true;
    categoryHeading.innerHTML='<button type="button" data-sq-category-back aria-label="Back to all elements">←</button><div><h3 data-sq-category-title></h3><p data-sq-category-count role="status"></p></div>';
    purposeRow.after(categoryHeading);
    const focusedCategory=()=>!choiceFamily && ['elements','sections'].includes(library) && purpose.value!=='all' ? purpose.value : '';
    const choiceView=document.createElement('div');choiceView.className='sq-asset-choice-view';choiceView.hidden=true;root.append(choiceView);
    const closeChoices=()=>{choiceFamily='';search.value='';root.classList.remove('sq-asset-choosing');choiceView.hidden=true;search.placeholder='Find something for your page…';};
    const choose=family=>{
      const info=EzkartAssets.choiceFamilies[family];if(!info)return false;
      choiceFamily=family;choiceView.dataset.family=family;search.value='';search.placeholder=`Search ${info.name.toLowerCase()}…`;
      root.classList.add('sq-asset-choosing');choiceView.hidden=false;
      choiceView.querySelectorAll('.sq-asset-preview').forEach(frame=>{observer.unobserve(frame);previewObserver.unobserve(frame);pendingPreviews.delete(frame);});
      choiceView.innerHTML=`<header><button type="button" data-sq-choice-back aria-label="Back to all assets">←</button><h3>${escape(info.name)}</h3></header><p>${escape(info.description)}</p>${family==='image'?'<button type="button" class="sq-choice-uploads" data-sq-choice-uploads>Choose from uploads ↗</button>':''}${family==='commerce'?'<label class="sq-choice-product">Product<select data-sq-choice-product aria-label="Product for this control"></select></label>':''}<div class="sq-asset-grid sq-choice-grid ${family==='icon'?'sq-icon-choices':''}"></div><p data-sq-choice-empty hidden>No matching options.</p>`;
      if(family==='commerce'){
        const catalog=products();const select=choiceView.querySelector('select');
        select.innerHTML=catalog.length?catalog.map(item=>`<option value="${escape(item.id)}">${escape(item.name)}</option>`).join(''):'<option value="">Add a product to your catalog first</option>';
        syncControls();
      }
      const list=choiceView.querySelector('.sq-choice-grid');
      EzkartAssets.choices.filter(item=>item.family===family).forEach(item=>{
        const card=document.createElement('button');card.type='button';card.draggable=true;card.className='sq-asset-card';card.dataset.sqAssetChoice=item.id;card.dataset.search=item.name;
        card.setAttribute('aria-label',`Add ${item.name}`);
        card.innerHTML=`<span class="sq-asset-preview" aria-hidden="true"></span><span class="sq-asset-caption"><b>${escape(item.name)}</b><span class="sq-asset-add" aria-hidden="true">+</span></span>`;
        const frame=card.firstElementChild;queuePreview(frame,()=>EzkartAssets.previewChoice(item.id));list.append(card);
      });
      root.scrollTop=0;filter();return true;
    };
    choiceView.addEventListener('click',event=>{
      if(event.target.closest('[data-sq-choice-back]')){closeChoices();filter();root.querySelector(`[data-sq-add-element="native-${choiceView.dataset.family}"]`)?.focus();}
      if(event.target.closest('[data-sq-choice-uploads]'))root.querySelector('[data-sq-library-category="uploads"]').click();
    });
    root.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&choiceFamily){event.preventDefault();event.stopPropagation();choiceView.querySelector('[data-sq-choice-back]').click();}
      else if(event.key==='Escape'&&focusedCategory()){event.preventDefault();event.stopPropagation();categoryHeading.querySelector('button').click();}
    });
    const rememberedPurpose={elements:'all',sections:'all'};
    const options=()=>{
      const categories=library==='sections'?sectionCategories:[{id:'basics',name:'Essentials'},...EzkartAssets.categories];
      const used=new Set([...root.querySelectorAll(`[data-sq-library-group="${library}"] [data-sq-asset-purpose], [data-sq-library-group="${library}"][data-sq-asset-purpose]`)].map(node=>node.dataset.sqAssetPurpose));
      purpose.innerHTML=`<option value="all">All ${library}</option>`+categories.filter(item=>used.has(item.id)).map(item=>`<option value="${item.id}">${escape(item.name)}</option>`).join('');
      purpose.value=rememberedPurpose[library] || 'all'; syncControls();
    };
    const selector='[data-sq-asset], [data-sq-upload-asset], [data-sq-add-block], [data-sq-add-element], [data-sq-open-products], [data-sq-open-library], [data-sq-component], [data-sq-create-component]';
    const normalize=value=>String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const filter=()=>{
      const query=normalize(search.value.trim()),terms=query.split(/\s+/).filter(Boolean);
      if(choiceFamily){
        categoryHeading.hidden=true;
        let count=0;choiceView.querySelectorAll('[data-sq-asset-choice]').forEach(card=>{card.hidden=!terms.every(term=>normalize(card.dataset.search).includes(term));if(!card.hidden)count++;});
        choiceView.querySelector('[data-sq-choice-empty]').hidden=count>0;return;
      }
      const focused=focusedCategory();
      const categoryInfo=(library==='sections'?sectionCategories:[{id:'basics',name:'Essentials'},...EzkartAssets.categories]).find(item=>item.id===focused);
      categoryHeading.hidden=!focused;
      if(focused){
        categoryHeading.querySelector('[data-sq-category-title]').textContent=categoryInfo?.name || focused;
        categoryHeading.querySelector('button').setAttribute('aria-label',`Back to all ${library}`);
      }
      search.placeholder=focused?`Search ${(categoryInfo?.name || focused).toLowerCase()}…`:'Find something for your page…';
      let matches=0;
      root.querySelectorAll(':scope > .sq-block-group').forEach(group=>{
        let groupMatches=0;
        group.querySelectorAll(selector).forEach(card=>{
          const searchable=normalize(`${card.dataset.search || ''} ${card.textContent}`);
          const category=card.dataset.sqAssetPurpose || group.dataset.sqAssetPurpose;
          const inScope=!focused || (group.dataset.sqLibraryGroup===library && category===focused);
          const show=query?inScope && terms.every(term=>searchable.includes(term)):(group.dataset.sqLibraryGroup===library && (purpose.value==='all' || !['elements','sections'].includes(library) || category===purpose.value));
          card.hidden=!show; if(show)groupMatches++;
        });
        group.hidden=query?groupMatches===0:(group.dataset.sqLibraryGroup!==library || (['elements','sections'].includes(library) && groupMatches===0));
        group.querySelectorAll('.sq-library-more').forEach(detail=>{if(query)detail.open=true;});
        const collections=group.matches('.sq-asset-group')?[group]:[...group.querySelectorAll('.sq-section-family')];
        collections.forEach(collection=>{
          const cards=[...collection.querySelectorAll(selector)].filter(card=>!card.hidden);
          if(collection!==group)collection.hidden=!cards.length;
          const overview=!query && !focused;
          if(overview)cards.slice(3).forEach(card=>card.hidden=true);
          const more=collection.querySelector('[data-sq-view-category]');
          if(more)more.hidden=!overview || !cards.length;
          collection.querySelector(':scope > h3')?.toggleAttribute('hidden',Boolean(focused));
        });
        if(!group.hidden)matches+=groupMatches;
      });
      purposeRow.hidden=Boolean(query) || Boolean(focused) || !['elements','sections'].includes(library);
      if(focused)categoryHeading.querySelector('[data-sq-category-count]').textContent=`${matches} ${matches===1?'design':'designs'}${query?' found':''}`;
      const status=root.querySelector('[data-sq-library-search-status]');
      status.hidden=!query || Boolean(focused);status.textContent=`${matches} ${matches===1?'result':'results'} for “${search.value.trim()}”`;
      root.querySelector('[data-sq-library-search-empty]').hidden=!query || matches>0;
      root.querySelector('[data-sq-asset-count]').textContent=`${matches} pieces`;
      root.querySelector('[data-sq-component-empty]').hidden=Boolean(query) || componentCount()>0;
      root.querySelector('.sq-assets-hint').hidden=library==='saved' || library==='uploads';
    };
    root.addEventListener('click',event=>{
      const more=event.target.closest('[data-sq-view-category]');
      if(!more)return;
      categoryOpener=more;overviewScroll=root.scrollTop;
      library=more.dataset.sqViewLibrary;
      search.value='';purpose.value=more.dataset.sqViewCategory;rememberedPurpose[library]=purpose.value;
      syncControls();filter();root.scrollTop=0;categoryHeading.querySelector('button').focus({preventScroll:true});
    });
    categoryHeading.querySelector('button').addEventListener('click',()=>{
      purpose.value='all';rememberedPurpose[library]='all';search.value='';syncControls();filter();
      root.scrollTop=overviewScroll;
      const target=categoryOpener?.isConnected && !categoryOpener.closest('[hidden]')?categoryOpener:root.querySelector('.sq-assets-filter-row .sq-builder-select-trigger');
      target?.focus({preventScroll:true});categoryOpener=null;
    });
    root.querySelectorAll('[data-sq-library-category]').forEach(button=>button.addEventListener('click',()=>{
      closeChoices();library=button.dataset.sqLibraryCategory;search.value='';
      if(['elements','sections'].includes(library))rememberedPurpose[library]='all';
      root.querySelectorAll('[data-sq-library-category]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
      options();filter();
    }));
    purpose.addEventListener('change',()=>{overviewScroll=root.scrollTop;categoryOpener=null;rememberedPurpose[library]=purpose.value;filter();root.scrollTop=0;});
    search.addEventListener('input',filter);
    root.querySelector('[data-sq-clear-block-search]').addEventListener('click',()=>{search.value='';filter();search.focus();});
    const sidebar=root.closest('.sq-builder-sidebar'),studio=root.closest('.sq-studio'),grip=sidebar.querySelector('[data-sq-assets-resize]');
    let preferredWidth=320,drag=null;
    try{preferredWidth=Number(localStorage.getItem('ezkart-assets-width')) || 320;}catch{}
    const bounds=()=>{const max=Math.max(240,Math.min(720,innerWidth-studio.getBoundingClientRect().left-52-(innerWidth<=720?8:280)));return {min:Math.min(270,max),max};};
    const size=(width=preferredWidth)=>{
      const {min,max}=bounds(),value=Math.round(Math.max(min,Math.min(max,width)));
      studio.style.setProperty('--sq-assets-width',`${value}px`);
      grip.setAttribute('aria-valuemin',String(min));grip.setAttribute('aria-valuemax',String(max));grip.setAttribute('aria-valuenow',String(value));grip.setAttribute('aria-valuetext',`${value} pixels`);
      return value;
    };
    const save=()=>{try{localStorage.setItem('ezkart-assets-width',String(preferredWidth));}catch{}};
    const finish=cancel=>{
      if(!drag)return;const original=drag.width;drag=null;
      if(cancel)preferredWidth=original;
      document.body.classList.remove('sq-assets-resizing');size();save();
    };
    grip.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;event.preventDefault();
      drag={x:event.clientX,width:preferredWidth,start:size()};grip.setPointerCapture(event.pointerId);sidebar.classList.add('sq-panel-pinned');document.body.classList.add('sq-assets-resizing');
    });
    grip.addEventListener('pointermove',event=>{if(drag)preferredWidth=size(drag.start+event.clientX-drag.x);});
    grip.addEventListener('pointerup',()=>finish(false));grip.addEventListener('pointercancel',()=>finish(true));grip.addEventListener('lostpointercapture',()=>finish(false));
    grip.addEventListener('dblclick',()=>{preferredWidth=320;size();save();});
    grip.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();
      const {min,max}=bounds(),step=event.shiftKey?48:16;
      preferredWidth=size(event.key==='Home'?min:event.key==='End'?max:size()+(event.key==='ArrowLeft'?-step:step));save();
    });
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&drag){event.preventDefault();event.stopPropagation();finish(true);}},true);
    window.addEventListener('resize',()=>size());
    size();options();filter();
    return {filter,choose};
  }
  function init({root,insert,beginDrag,endDrag,listUploads,upload,readUpload,filter,toast}) {
    const uploads = new Map();
    let loading = false;
    const status = root.querySelector('[data-sq-assets-upload-status]');
    const uploadInput = root.querySelector('[data-sq-asset-upload]');
    const renderUploads = () => {
      const list = root.querySelector('[data-sq-asset-uploads]');
      list.replaceChildren();
      uploads.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button'; button.draggable = true;
        button.className = 'sq-asset-card sq-upload-card';
        button.dataset.sqUploadAsset = item.id;
        button.dataset.search = `uploads images photo ${item.name} ${item.source || ''}`;
        button.setAttribute('aria-label',`Add ${item.name}`);
        button.innerHTML = `<span class="sq-upload-preview"><img alt="" loading="lazy" decoding="async"></span><span class="sq-asset-caption"><b>${escape(item.name)}</b><small>${escape(item.source || 'Your uploads')}</small><span class="sq-asset-add" aria-hidden="true">+</span></span>`;
        button.querySelector('img').src = item.src;
        list.append(button);
      });
      filter();
    };
    const refresh = async () => {
      if (loading) return;
      loading = true;
      status.textContent = 'Loading your uploads…';
      try {
        const result = await listUploads();
        uploads.clear(); result.forEach(item => uploads.set(item.id,item)); renderUploads();
        status.textContent = uploads.size ? `${uploads.size} ${uploads.size === 1 ? 'file' : 'files'} · Reuse across your pages` : 'Your library is ready. Upload a file to use it across your pages.';
      } catch (error) { status.textContent = `${error.message} Use Refresh to try again.`; }
      finally { loading = false; }
    };
    root.querySelector('[data-sq-assets-refresh]').addEventListener('click',refresh);
    root.querySelector('[data-sq-library-category="uploads"]').addEventListener('click',refresh);
    // Searching includes account uploads even before the Uploads category opens.
    let searchTimer;
    root.querySelector('[data-sq-block-search]').addEventListener('input',() => {
      clearTimeout(searchTimer);
      if (!uploads.size) searchTimer = setTimeout(refresh,250);
    });
    const add = async (asset,section,event) => {
      try {
        const item = asset.uploadId ? uploads.get(asset.uploadId) : null;
        if (asset.uploadId && !item) throw Error('Refresh uploads and choose the file again.');
        const node = asset.choiceId ? EzkartAssets.createChoice(asset.choiceId,{productId:asset.productId || root.querySelector('[data-sq-choice-product]')?.value}) : item ? {id:`asset-image-${crypto.randomUUID().replaceAll('-','').slice(0,12)}`,type:'image',name:item.name,alt:item.name,src:await readUpload(item),props:{display:'block',width:'360px',maxWidth:'100%',height:'auto',objectFit:'contain'}} : EzkartAssets.create(asset.id);
        if(node.type==='commerce'){
          node.productId=asset.productId || root.querySelector('[data-sq-choice-product]')?.value;
          if(!node.productId)throw Error('Choose a catalog product before adding this control.');
        }
        insert(node,section,event);
      } catch(error) { toast(error.message); }
    };
    root.addEventListener('click',event => {
      const card = event.target.closest('[data-sq-asset],[data-sq-upload-asset],[data-sq-asset-choice]');
      if(card) void add({id:card.dataset.sqAsset,uploadId:card.dataset.sqUploadAsset,choiceId:card.dataset.sqAssetChoice});
    });
    root.addEventListener('dragstart',event => {
      const card = event.target.closest('[data-sq-asset],[data-sq-upload-asset],[data-sq-add-block],[data-sq-asset-choice]');
      if (!card) return;
      const drag = {kind:card.dataset.sqAddBlock?'section':'asset',id:card.dataset.sqAsset,uploadId:card.dataset.sqUploadAsset,sectionType:card.dataset.sqAddBlock,choiceId:card.dataset.sqAssetChoice,productId:root.querySelector('[data-sq-choice-product]')?.value,label:card.querySelector('b')?.textContent || 'Asset'};
      beginDrag(drag,event); card.classList.add('sq-library-drag-source');
    });
    root.addEventListener('dragend',event => { event.target.closest('.sq-library-drag-source')?.classList.remove('sq-library-drag-source'); endDrag(); });
    const acceptFiles = async files => {
      if (uploadInput.disabled) return;
      uploadInput.disabled = true;
      let success = 0; const failures = [];
      for (const file of files) {
        status.textContent = `Uploading ${file.name}…`;
        try {
          const item = await upload(file);
          uploads.set(item.id,item); success++; renderUploads();
        } catch(error) { failures.push(`${file.name}: ${error.message}`); }
      }
      status.textContent = `${success ? `${success} ${success === 1 ? 'file' : 'files'} added to your library.` : ''} ${failures.join(' ')}`.trim();
      uploadInput.disabled = false; uploadInput.value = '';
    };
    uploadInput.addEventListener('change',() => void acceptFiles([...uploadInput.files]));
    const uploadGroup = root.querySelector('[data-sq-library-group="uploads"]');
    uploadGroup.addEventListener('dragover',event => { if ([...event.dataTransfer.types].includes('Files')) {event.preventDefault();uploadGroup.classList.add('sq-assets-file-drop');} });
    uploadGroup.addEventListener('dragleave',event => {if (!uploadGroup.contains(event.relatedTarget)) uploadGroup.classList.remove('sq-assets-file-drop');});
    uploadGroup.addEventListener('drop',event => {if (![...event.dataTransfer.types].includes('Files')) return; event.preventDefault(); event.stopPropagation(); uploadGroup.classList.remove('sq-assets-file-drop'); void acceptFiles([...event.dataTransfer.files]);});
    return {add,refresh};
  }
  Object.assign(EzkartAssets,{renderCatalog,browse,init});
})();
