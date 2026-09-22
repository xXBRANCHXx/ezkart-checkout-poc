/* Asset browsing stays outside the document. Insertions use the shared editor. */
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fitPreview = frame => {
    const artwork = frame.firstElementChild;
    if (!artwork || !frame.clientWidth) return;
    const scale = Math.min((frame.clientWidth - 30) / 520, (frame.clientHeight - 24) / artwork.scrollHeight);
    artwork.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  const observer = new ResizeObserver(entries => entries.forEach(({target}) => fitPreview(target)));
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
    frame.append(EzkartAssets.preview(item.assetId || item.id)); observer.observe(frame);
    return button;
  }
  function renderCatalog(root) {
    const anchor=root.querySelector('[data-sq-library-group="sections"]');
    EzkartAssets.categories.forEach(category=>{
      const group=document.createElement('div');
      group.className='sq-block-group sq-asset-group';
      group.dataset.sqLibraryGroup='elements'; group.dataset.sqAssetPurpose=category.id;
      group.innerHTML=`<h3>${escape(category.name)}<span>3 designs</span></h3><div class="sq-asset-grid" data-sq-asset-catalog="${category.id}"></div>`;
      EzkartAssets.definitions.filter(item=>item.category===category.id).forEach(item=>group.lastElementChild.append(assetCard(item)));
      root.insertBefore(group,anchor);
    });
  }
  function browse({root,componentCount,syncControls}) {
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
      family.innerHTML=`<h3>${escape(category.name)}<span>${cards.length} designs</span></h3><div class="sq-asset-grid"></div>`;
      cards.forEach(card=>family.lastElementChild.append(card));sectionList.append(family);
    });
    let library='elements';
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
      let matches=0;
      root.querySelectorAll(':scope > .sq-block-group').forEach(group=>{
        let groupMatches=0;
        group.querySelectorAll(selector).forEach(card=>{
          const searchable=normalize(`${card.dataset.search || ''} ${card.textContent}`);
          const category=card.dataset.sqAssetPurpose || group.dataset.sqAssetPurpose;
          const show=query?terms.every(term=>searchable.includes(term)):(group.dataset.sqLibraryGroup===library && (purpose.value==='all' || !['elements','sections'].includes(library) || category===purpose.value));
          card.hidden=!show; if(show)groupMatches++;
        });
        group.hidden=query?groupMatches===0:(group.dataset.sqLibraryGroup!==library || (['elements','sections'].includes(library) && groupMatches===0));
        group.querySelectorAll('.sq-library-more').forEach(detail=>{if(query)detail.open=true;});
        group.querySelectorAll('.sq-section-family').forEach(family=>family.hidden=![...family.querySelectorAll(selector)].some(card=>!card.hidden));
        if(!group.hidden)matches+=groupMatches;
      });
      purposeRow.hidden=Boolean(query) || !['elements','sections'].includes(library);
      const status=root.querySelector('[data-sq-library-search-status]');
      status.hidden=!query;status.textContent=`${matches} ${matches===1?'result':'results'} for “${search.value.trim()}”`;
      root.querySelector('[data-sq-library-search-empty]').hidden=!query || matches>0;
      root.querySelector('[data-sq-asset-count]').textContent=`${matches} pieces`;
      root.querySelector('[data-sq-component-empty]').hidden=Boolean(query) || componentCount()>0;
      root.querySelector('.sq-assets-hint').hidden=library==='saved' || library==='uploads';
    };
    root.querySelectorAll('[data-sq-library-category]').forEach(button=>button.addEventListener('click',()=>{
      library=button.dataset.sqLibraryCategory;search.value='';
      root.querySelectorAll('[data-sq-library-category]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
      options();filter();
    }));
    purpose.addEventListener('change',()=>{rememberedPurpose[library]=purpose.value;filter();});
    search.addEventListener('input',filter);
    root.querySelector('[data-sq-clear-block-search]').addEventListener('click',()=>{search.value='';filter();search.focus();});
    const sidebar=root.closest('.sq-builder-sidebar'),expand=root.querySelector('[data-sq-assets-expand]');
    let expanded=false;
    try{expanded=localStorage.getItem('ezkart-assets-expanded')==='true';}catch{}
    const size=()=>{
      sidebar.classList.toggle('sq-assets-expanded',expanded);
      expand.setAttribute('aria-expanded',String(expanded));
      expand.setAttribute('aria-label',`${expanded?'Collapse':'Expand'} asset library`);
      expand.title=`${expanded?'Collapse':'Expand'} asset library`;
      expand.querySelector('path').setAttribute('d',expanded?'M4 4l5 5m0-5v5H4m16-5-5 5m0-5v5h5M4 20l5-5m-5 0h5v5m11 0-5-5m0 5v-5h5':'M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4M4 4l5 5m11-5-5 5M4 20l5-5m11 5-5-5');
    };
    expand.addEventListener('click',()=>{expanded=!expanded;size();try{localStorage.setItem('ezkart-assets-expanded',String(expanded));}catch{}});
    size();options();filter();
    return {filter};
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
        const node = item ? {id:`asset-image-${crypto.randomUUID().replaceAll('-','').slice(0,12)}`,type:'image',name:item.name,alt:item.name,src:await readUpload(item),props:{display:'block',width:'360px',maxWidth:'100%',height:'auto',objectFit:'contain'}} : EzkartAssets.create(asset.id);
        insert(node,section,event);
      } catch(error) { toast(error.message); }
    };
    root.addEventListener('click',event => {
      const card = event.target.closest('[data-sq-asset],[data-sq-upload-asset]');
      if(card) void add({id:card.dataset.sqAsset,uploadId:card.dataset.sqUploadAsset});
    });
    root.addEventListener('dragstart',event => {
      const card = event.target.closest('[data-sq-asset],[data-sq-upload-asset],[data-sq-add-block]');
      if (!card) return;
      const drag = {kind:card.dataset.sqAddBlock?'section':'asset',id:card.dataset.sqAsset,uploadId:card.dataset.sqUploadAsset,sectionType:card.dataset.sqAddBlock,label:card.querySelector('b')?.textContent || 'Asset'};
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
