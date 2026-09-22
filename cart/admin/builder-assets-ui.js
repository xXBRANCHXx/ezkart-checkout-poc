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
  function renderCatalog(root) {
    EzkartAssets.definitions.forEach(item => {
      const list = root.querySelector(`[data-sq-asset-catalog="${item.category}"]`);
      if (!list) return;
      const button = document.createElement('button');
      button.type = 'button'; button.draggable = true;
      button.className = 'sq-asset-card'; button.dataset.sqAsset = item.id;
      button.dataset.search = `${item.name} ${item.category} ${item.description} ${item.category === 'code' ? 'snippet syntax terminal' : ''} ${item.category === 'bulletins' ? 'bullets announcement notice checklist' : ''} ${item.category === 'accordions' ? 'faq questions answers expandable' : ''}`;
      button.setAttribute('aria-label', `Add ${item.name}`);
      button.innerHTML = `<span class="sq-asset-preview" aria-hidden="true"></span><span class="sq-asset-caption"><b>${escape(item.name)}</b><small>${escape(item.description)}</small><span class="sq-asset-add" aria-hidden="true">+</span></span>`;
      const frame = button.querySelector('.sq-asset-preview');
      frame.append(EzkartAssets.preview(item.id));
      list.append(button); observer.observe(frame);
    });
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
  Object.assign(EzkartAssets,{renderCatalog,init});
})();
