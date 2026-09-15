/* Shared responsive compositions: normal DOM, native editing, no iframe renderer. */
(() => {
 const data=globalThis.EzkartShowcaseData;
 if(!data||!globalThis.EzkartComponents)return;
 const baseCreate=EzkartComponents.create;
 EzkartComponents.definitions.unshift(...data.definitions);
 EzkartComponents.create=(id,options={})=>{
  if(!data.templates[id])return baseCreate(id,options);
  const wrapper=document.createElement('template');wrapper.innerHTML=data.templates[id];const section=wrapper.content.firstElementChild;
  const oldId=section.id,newId=options.sectionId;
  if(!/^[a-zA-Z0-9_-]+$/.test(newId||''))throw new Error('A valid section ID is required.');
  section.id=newId;section.dataset.sectionId=newId;
  section.querySelectorAll('[data-sq-element]').forEach((element,i)=>element.dataset.sqElementId=`${newId}-${i+1}`);
  const ids=new Map();section.querySelectorAll('[id]').forEach(n=>{ids.set(n.id,`${newId}--${n.id}`);n.id=ids.get(n.id)});
  section.querySelectorAll('[href^="#"],[aria-controls],[aria-describedby]').forEach(n=>{
   for(const attr of ['href','aria-controls','aria-describedby']){const value=n.getAttribute(attr);if(!value)continue;const key=value.replace(/^#/,'');if(key===oldId)n.setAttribute(attr,(attr==='href'?'#':'')+newId);else if(ids.has(key))n.setAttribute(attr,(attr==='href'?'#':'')+ids.get(key));}
  });
  const content=options.content||{};
  if(content.title){const heading=section.querySelector('h1,h2');if(heading){heading.textContent=content.title;heading.dataset.sqFlowText='';}}
  if(content.body){const paragraph=section.querySelector('.ezm-hero-description,.ezm-section-copy>p:not(.ezm-eyebrow),.ezm-section-heading>p');if(paragraph){paragraph.textContent=content.body;paragraph.dataset.sqFlowText='';}}
  if(content.image){const img=section.querySelector('img');if(img&&/^https?:\/\//.test(content.image))img.src=content.image;}
  return section.outerHTML;
 };
 function mount(root){
  if(!root||root.dataset.ezmMounted==='true')return;root.dataset.ezmMounted='true';
  const localWidth=()=>root.clientWidth;
  const menus=()=>root.querySelectorAll('.ezm-menu-toggle').forEach(toggle=>{
   const menu=root.querySelector(`[id="${toggle.getAttribute('aria-controls')}"]`);if(!menu)return;
   const close=()=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Buka navigasi')};
   toggle.onclick=event=>{event.stopPropagation();const open=menu.hidden;menu.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Tutup navigasi':'Buka navigasi')};
   menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));
  });
  function resize(){root.querySelectorAll('.ezm-hero-stage').forEach(stage=>{const builder=stage.querySelector('.ezm-hero-builder');if(!builder)return;if(localWidth()<=580){const scale=stage.clientWidth/650;builder.style.transform=`scale(${scale})`;stage.style.height=`${370*scale+66}px`;}else{builder.style.transform='none';stage.style.height='';}});}
  const playFilm=film=>{const source=film.querySelector('source');if(source&&!source.hasAttribute('src')){source.src=source.dataset.src;film.load();}void film.play().catch(()=>{});};
  const preparedTracks=new WeakSet();
  const bindFilms=()=>root.querySelectorAll('.ezm-film-shell').forEach(shell=>{
    const film=shell.querySelector('video'),toggle=shell.querySelector('.ezm-film-toggle');if(!film||!toggle)return;
    const sync=()=>{toggle.setAttribute('aria-label',film.paused?'Putar video produk':'Jeda video produk');toggle.innerHTML='<svg class="ezm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="'+(film.paused?'m9 5 11 7-11 7Z':'M9 5v14M15 5v14')+'"/></svg>';};film.onplay=sync;film.onpause=sync;sync();
    const dialog=shell.closest('.sq-reference')?.querySelector('.ezm-film-dialog');if(dialog){dialog.querySelector('.ezm-dialog-close').onclick=()=>dialog.close();dialog.onclose=()=>dialog.querySelector('video')?.pause();}
  });
  root.addEventListener('click',event=>{
   const device=event.target.closest('[data-device]');if(device?.closest('.ezm-device-switch')){const section=device.closest('.sq-reference'),preview=section?.querySelector('.ezm-responsive-preview');if(preview)preview.dataset.previewDevice=device.dataset.device;section?.querySelectorAll('[data-device]').forEach(button=>{button.classList.toggle('ezm-active',button===device);button.setAttribute('aria-pressed',String(button===device));});}
   const play=event.target.closest('.ezm-film-toggle,[data-open-film]');if(play&&!root.closest('.sq-studio')){
    const section=play.closest('.sq-reference');
    if(play.matches('[data-open-film]')){const dialog=root.querySelector('.ezm-film-dialog');if(dialog){root.querySelector('.ezm-film-shell video')?.pause();dialog.showModal();playFilm(dialog.querySelector('video'));return;}}
    const film=section?.querySelector('.ezm-film-shell video');if(film){if(film.paused)playFilm(film);else film.pause();}
   }
  },true);
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){root.querySelectorAll('.ezm-menu-toggle[aria-expanded=true]').forEach(toggle=>{root.querySelector(`[id="${toggle.getAttribute('aria-controls')}"]`)?.setAttribute('hidden','');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Buka navigasi');toggle.focus();});}});
  const refresh=()=>{menus();bindFilms();root.querySelectorAll('track[data-ezm-captions]').forEach(track=>{if(preparedTracks.has(track))return;preparedTracks.add(track);track.src=URL.createObjectURL(new Blob([track.dataset.ezmCaptions],{type:'text/vtt'}));});root.querySelectorAll('[data-open-film],.ezm-film-toggle').forEach(button=>button.hidden=false);root.querySelectorAll('.ezm-reveal').forEach(node=>node.classList.add('ezm-is-visible'));resize();};
  new ResizeObserver(resize).observe(root);
  new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&n.matches?.('.sq-reference'))))refresh();}).observe(root,{childList:true});
  refresh();
 }
 globalThis.EzkartShowcase={mount};
})();
