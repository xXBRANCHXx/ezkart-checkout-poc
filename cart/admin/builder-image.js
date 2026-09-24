/* A small upload editor over the same native page, history and commerce model. */
(() => {
  const t = text => EzkartLanguage.t(text);
  const MB = 1024 * 1024;
  const uid = () => 'image-' + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  const native = config => EzkartNative.create(config);
  const section = (id, props) => {
    const node = native({id,type:'container',tag:'section',props});
    node.classList.add('sq-page-block','sq-native-section');
    node.dataset.sqBlock='';node.dataset.sectionId=id;node.removeAttribute('data-sq-element');
    return node;
  };
  function navigationSettings(value={}) {
    const number=(key,fallback,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(value[key]))?Number(value[key]):fallback));
    const color=(key,fallback)=>/^#[\da-f]{6}$/i.test(value[key]||'')?value[key]:fallback;
    return {enabled:value.enabled===true,title:String(value.title||'').slice(0,40),height:number('height',64,48,120),color:color('color','#ffffff'),textColor:color('textColor','#252724'),transparency:number('transparency',10,0,100),blur:number('blur',12,0,32),sticky:['off','on','up'].includes(value.sticky)?value.sticky:'on',links:(Array.isArray(value.links)?value.links:[]).slice(0,8).map(link=>({label:String(link.label||'').slice(0,60),target:String(link.target||'')})),cta:value.cta!==false,ctaLabel:String(value.ctaLabel||t('Shop now')).slice(0,32)};
  }
  function readNavigation(root) {
    let value={};try{value=JSON.parse(root.querySelector('[data-image-page]')?.dataset.imageNavigation||'{}')||{};}catch(_){}
    return navigationSettings(value);
  }
  // Shared by the editable document and its sandboxed preview. Appearance edits
  // keep the existing page, images, navigation handlers and cart alive.
  function paintNavigation(root,settings) {
    const page=root.matches?.('.sq-page-preview')?root:root.querySelector('.sq-page-preview');
    page?.style.setProperty('--ib-nav-height',(settings.enabled?settings.height:0)+'px');
    page?.style.setProperty('--ib-nav-inset',(settings.enabled&&settings.sticky!=='off'?settings.height:0)+'px');
    const header=root.querySelector('.sq-image-navigation');if(!header)return;
    header.style.setProperty('--ib-nav-color',settings.color);
    header.style.setProperty('--ib-nav-ink',settings.textColor);
    header.style.setProperty('--ib-nav-height',settings.height+'px');
    header.style.setProperty('--sq-nav-surface-opacity',(100-settings.transparency)+'%');
    header.style.setProperty('--sq-nav-backdrop-blur',settings.blur+'px');
    const prefix=header.hasAttribute('data-ezkart-nav-position')?'ezkart':'sq';
    header.dataset[prefix+'NavSurface']=settings.blur?'blur':'solid';
    header.dataset[prefix+'NavOpacity']=String(100-settings.transparency);
    header.dataset[prefix+'NavBlur']=String(settings.blur);
    const title=header.querySelector('.ib-nav-title'),cta=header.querySelector('.ib-nav-cta');
    if(title){title.textContent=settings.title;title.hidden=!settings.title;}
    if(cta)cta.textContent=settings.ctaLabel;
  }
  // Installed only in the editor iframe, never in a published page. The iframe
  // keeps its opaque sandbox origin; no same-origin access or HTML messages.
  function installPreviewUpdates(channel,paint) {
    addEventListener('message',event=>{
      if(event.source!==parent||event.data?.type!=='ezkart:image-navigation'||event.data.channel!==channel)return;
      paint(document,event.data.settings);
    });
    parent.postMessage({type:'ezkart:image-preview-ready',channel},'*');
  }
  function makeNavigation(settings,images,productId) {
    const header=section('image-navigation',{display:'flex',width:'100%',maxWidth:'480px',marginLeft:'auto',marginRight:'auto',padding:'0px 16px',fontFamily:'Arial, sans-serif'});
    header.classList.add('sq-navigation-template-section','sq-image-navigation');
    header.setAttribute('role','banner');
    Object.assign(header.dataset,{sqNavPosition:settings.sticky==='off'?'static':'sticky',sqNavSurface:settings.blur?'blur':'solid',sqNavOpacity:String(100-settings.transparency),sqNavBlur:String(settings.blur),sqNavHideScroll:String(settings.sticky==='up'),sqNavShadow:'false',navOpenLabel:t('Open navigation menu'),navCloseLabel:t('Close navigation menu')});
    header.style.setProperty('--ib-nav-color',settings.color);header.style.setProperty('--ib-nav-ink',settings.textColor);header.style.setProperty('--ib-nav-height',settings.height+'px');
    const brand=document.createElement('a');brand.className='ib-nav-title';brand.href='#native-image-page';brand.textContent=settings.title;brand.hidden=!settings.title;
    const navigation=document.createElement('nav');navigation.className='sq-template-navigation';navigation.dataset.sqElementType='navigation';navigation.setAttribute('aria-label',t('Page navigation'));
    settings.links.filter(link=>link.label.trim()&&images.some(image=>image.id===link.target)).forEach(link=>{
      const anchor=document.createElement('a');anchor.textContent=link.label;anchor.href='#native-'+link.target;anchor.dataset.sqLinkType='section';anchor.dataset.sqLink='native-'+link.target;navigation.append(anchor);
    });
    header.toggleAttribute('data-image-menu',Boolean(navigation.children.length));
    const toggle=document.createElement('button');toggle.type='button';toggle.className='sq-nav-menu-toggle';toggle.innerHTML='<span class="sq-nav-menu-icon" aria-hidden="true"><i></i><i></i></span>';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','image-navigation-menu');toggle.setAttribute('aria-label',t('Open navigation menu'));navigation.append(toggle);
    if(settings.cta&&productId){const cta=document.createElement('button');cta.type='button';cta.className='ib-nav-cta';cta.textContent=settings.ctaLabel;cta.dataset.sqLinkType='products';cta.dataset.sqLink='products';navigation.append(cta);}
    const menu=document.createElement('nav');menu.className='sq-nav-mobile-menu';menu.id='image-navigation-menu';menu.hidden=true;menu.setAttribute('aria-label',t('Page navigation'));
    header.append(brand,navigation,menu);return header;
  }
  function makeState(images=[], productId='', previous={}, navigation={}) {
    navigation=navigationSettings(navigation);
    navigation.links=navigation.links.filter(link=>images.some(image=>image.id===link.target));
    const holder=document.createElement('div');
    const page=section('image-page',{display:'block',width:'100%',maxWidth:'480px',marginLeft:'auto',marginRight:'auto',paddingTop:'0px',paddingRight:'0px',paddingBottom:'0px',paddingLeft:'0px',marginBottom:'0px',minHeight:'0px',backgroundColor:'#ffffff'});
    page.dataset.imagePage='';page.dataset.imageNavigation=JSON.stringify(navigation);
    if(navigation.enabled)holder.append(makeNavigation(navigation,images,productId));
    images.forEach((image,index)=>{
      const node=native({id:image.id,type:'image',src:image.src,alt:image.alt||'',loading:index===0?'eager':'lazy',props:{display:'block',width:'100%',height:'auto',maxWidth:'100%',marginTop:'0px',marginBottom:'0px',aspectRatio:`${image.width} / ${image.height}`}});
      node.dataset.imageUpload='';node.dataset.imageName=image.name;
      node.width=image.width;node.height=image.height;node.decoding='async';
      if(index===0)node.setAttribute('fetchpriority','high');
      page.append(node);
    });
    holder.append(page);
    if(productId){
      const checkout=section('image-checkout',{display:'block',width:'100%',maxWidth:'480px',marginLeft:'auto',marginRight:'auto',paddingTop:'24px',paddingBottom:'96px',paddingLeft:'16px',paddingRight:'16px',backgroundColor:'#ffffff',color:'#252724',fontFamily:'Arial, sans-serif',fontSize:'14px'});
      checkout.append(native({id:'image-product',type:'product',productId,props:{...EzkartNative.defaults.product,width:'100%',fontFamily:'Arial, sans-serif'}}));
      holder.append(checkout);
    }
    const state={...previous,version:6,builderMode:'image',template:null,previewClass:'sq-page-preview sq-image-page-preview',previewStyle:`--ib-nav-inset:${navigation.enabled&&navigation.sticky!=='off'?navigation.height:0}px;--ib-nav-height:${navigation.enabled?navigation.height:0}px;--site-page:#ffffff;--site-surface:#ffffff;--site-ink:#252724;--site-body-font:Arial,sans-serif;--site-heading-font:Arial,sans-serif;--button-primary-bg:#ed4639;--button-primary-fg:#ffffff;--button-primary-radius:8px`,preview:holder.innerHTML,products:productId?[productId]:[],selectedSection:'image-page',spacing:'[]',pageSpacing:{gutters:{desktop:0,tablet:0,mobile:0},columnGap:0}};
    // A publication stores both the editable state and the exported HTML in
    // the same 16 MB project. Leave room for that second copy and commerce.
    if(new Blob([JSON.stringify(state)]).size>6*MB)throw Error(t('This page is full. Use smaller images or remove an image first.'));
    return state;
  }
  function read(root) {
    const product=root.querySelector('[data-native-id="image-product"],[data-native-id="image-checkout-add"]');
    return {
      navigation:readNavigation(root),
      images:[...root.querySelectorAll('[data-image-upload]')].map(node=>{
        const config=EzkartNative.read(node);
        return {id:config.id,src:config.src,alt:config.alt||'',name:node.dataset.imageName||'Image',width:Number(node.getAttribute('width'))||1,height:Number(node.getAttribute('height'))||1};
      }),
      productId:product?EzkartNative.read(product).productId:'',
    };
  }
  function upgrade(state) {
    if(!state?.preview?.includes('data-image-page'))return state;
    const root=document.createElement('div');root.innerHTML=state.preview;
    if(!root.querySelector('[data-native-id="image-checkout-add"]'))return state;
    const {images,productId,navigation}=read(root);
    return makeState(images,productId,state,navigation);
  }
  async function prepareImage(file) {
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>15*MB)throw Error(t('Choose a JPG, PNG, or WebP image up to 15 MB.'));
    const url=URL.createObjectURL(file),image=new Image();
    try {
      image.src=url;await image.decode().catch(()=>{throw Error(t('This image could not be opened.'));});
      if(image.naturalWidth*image.naturalHeight>40_000_000||image.naturalHeight>24000)throw Error(t('This image is too large. Split it into smaller images first.'));
      // Preserve long mobile artwork: constrain width, not the longest edge.
      const scale=Math.min(1,1080/image.naturalWidth);
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const context=canvas.getContext('2d');if(!context)throw Error(t('This image could not be opened.'));
      context.drawImage(image,0,0,canvas.width,canvas.height);
      let src=canvas.toDataURL('image/webp',.88);
      if(src.length>2796204)src=canvas.toDataURL('image/webp',.76);
      if(src.length>2796204)throw Error(t('This image is too large. Split it into smaller images first.'));
      return {id:uid(),name:file.name.slice(0,160),src,width:canvas.width,height:canvas.height,alt:''};
    } finally {URL.revokeObjectURL(url);}
  }
  function imageSorter(rows,status,onReorder) {
    const motionPreference=matchMedia('(prefers-reduced-motion: reduce)'),reduced=()=>motionPreference.matches;
    const motions=new Map();
    let drag=null,frame=0,lastTime=0;
    const items=()=>[...rows.children];
    const layout=node=>{const rect=node.getBoundingClientRect();return {top:rect.top-(motions.get(node)?.offset||0),height:rect.height};};
    const announce=text=>{status.textContent=t(text);};
    const position=()=>{status.textContent=t('Image position')+': '+(items().indexOf(drag.row)+1)+' / '+rows.children.length;};
    function schedule(){if(!frame)frame=requestAnimationFrame(tick);}
    function moveTo(index) {
      const list=items(),from=list.indexOf(drag.row);
      if(index===from||index<0||index>=list.length)return;
      const before=new Map(list.map(node=>[node,node.getBoundingClientRect().top]));
      rows.insertBefore(drag.row,index>from?list[index].nextSibling:list[index]);
      if(!reduced())list.forEach(node=>{
        if(node===drag.row)return;
        const motion=motions.get(node)||{offset:0,velocity:0};
        motion.offset=before.get(node)-layout(node).top;
        motions.set(node,motion);node.style.transform=`translate3d(0,${motion.offset}px,0)`;
      });
      position();schedule();
    }
    function track() {
      if(!drag?.lifted||drag.keyboard)return;
      const bounds=rows.getBoundingClientRect();
      drag.inside=drag.x>=bounds.left-48&&drag.x<=bounds.right+48&&drag.y>=Math.max(0,bounds.top-64)&&drag.y<=Math.min(innerHeight,bounds.bottom+64);
      drag.row.classList.toggle('ib-drop-outside',!drag.inside);
      const ghost=drag.ghost;
      ghost.style.transform=`translate3d(${Math.max(8,Math.min(innerWidth-ghost.offsetWidth-8,drag.x+14))}px,${Math.max(8,Math.min(innerHeight-ghost.offsetHeight-8,drag.y-28))}px,0)`;
      if(!drag.inside)return;
      const list=items(),index=list.indexOf(drag.row);
      let target=index;
      while(target<list.length-1){const next=layout(list[target+1]);if(drag.y<next.top+next.height/2)break;target++;}
      if(target===index)while(target>0){const prev=layout(list[target-1]);if(drag.y>prev.top+prev.height/2)break;target--;}
      moveTo(target);
    }
    function autoScroll(dt) {
      if(!drag?.inside||drag.keyboard)return;
      for(const node of drag.scrollers){
        const documentScroll=node===document.scrollingElement;
        const rect=documentScroll?{top:0,bottom:innerHeight}:node.getBoundingClientRect();
        const top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom),edge=Math.min(64,(bottom-top)/4);
        const speed=drag.y<top+edge?-Math.min(1,(top+edge-drag.y)/edge):drag.y>bottom-edge?Math.min(1,(drag.y-bottom+edge)/edge):0;
        const before=node.scrollTop;node.scrollTop+=speed*650*dt;
        if(node.scrollTop!==before)break;
      }
    }
    function tick(time) {
      frame=0;
      const dt=Math.min((time-(lastTime||time-16))/1000,.032);lastTime=time;
      if(drag?.lifted&&!drag.keyboard){autoScroll(dt);track();}
      // A damped spring keeps each card's velocity when the target changes.
      motions.forEach((motion,node)=>{
        const step=dt/2;
        for(let i=0;i<2;i++){motion.velocity+=(-460*motion.offset-34*motion.velocity)*step;motion.offset+=motion.velocity*step;}
        if(reduced()||!node.isConnected||(Math.abs(motion.offset)<.15&&Math.abs(motion.velocity)<1)){
          node.style.removeProperty('transform');motions.delete(node);
        }else node.style.transform=`translate3d(0,${motion.offset}px,0)`;
      });
      if(motions.size||drag?.lifted&&!drag.keyboard)schedule();else lastTime=0;
    }
    function lift() {
      drag.lifted=true;drag.row.classList.add('ib-drop-slot');
      drag.handle.setAttribute('aria-pressed','true');
      rows.classList.add('ib-sorting');
      if(!drag.keyboard){
        const ghost=document.createElement('div');ghost.className='ib-drag-preview';ghost.setAttribute('aria-hidden','true');
        const thumb=drag.row.querySelector('img').cloneNode();thumb.loading='eager';
        const name=drag.row.querySelector('strong').cloneNode(true);ghost.append(thumb,name);document.body.append(ghost);drag.ghost=ghost;
        document.body.classList.add('ib-dragging');track();
        if(!reduced())ghost.animate([{opacity:.7,scale:'1.16'},{opacity:1,scale:'1'}],{duration:200,easing:'cubic-bezier(.2,.8,.2,1)'});
      }
      announce('Image picked up. Use arrow keys to move, Space to drop, or Escape to cancel.');schedule();
    }
    function finish(save=false,focus=true) {
      if(!drag)return;
      const current=drag,order=items().map(node=>node.dataset.imageRow);
      const before=new Map(items().map(node=>[node.dataset.imageRow,{top:node.getBoundingClientRect().top,velocity:motions.get(node)?.velocity||0}]));
      drag=null;current.events.abort();
      if(current.pointerId!==undefined&&rows.hasPointerCapture(current.pointerId))rows.releasePointerCapture(current.pointerId);
      current.ghost?.remove();current.row.classList.remove('ib-drop-slot','ib-drop-outside');current.handle.setAttribute('aria-pressed','false');
      rows.classList.remove('ib-sorting');document.body.classList.remove('ib-dragging');
      cancelAnimationFrame(frame);frame=0;lastTime=0;
      motions.forEach((_,node)=>node.style.removeProperty('transform'));motions.clear();
      if(!save)current.original.forEach(node=>rows.append(node));
      const changed=save&&order.some((id,index)=>id!==current.original[index].dataset.imageRow);
      if(changed)onReorder(order);
      const row=items().find(node=>node.dataset.imageRow===current.row.dataset.imageRow);
      if(current.lifted&&!reduced())items().forEach(node=>{
        const previous=before.get(node.dataset.imageRow),offset=previous.top-node.getBoundingClientRect().top;
        if(Math.abs(offset)>.15){motions.set(node,{offset,velocity:previous.velocity});node.style.transform=`translate3d(0,${offset}px,0)`;schedule();}
      });
      if(focus)row?.querySelector('[data-image-drag]')?.focus({preventScroll:true});
      if(current.lifted){
        announce(save?'Image order updated.':'Reordering canceled.');
        if(save&&!reduced())row?.animate([{scale:'.97'},{scale:'1'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
      }
    }
    function begin(handle,event) {
      if(drag||handle.matches(':disabled')||rows.children.length<2)return;
      const scrollers=[];
      for(let node=rows.parentElement;node;node=node.parentElement){if(node.scrollHeight>node.clientHeight&&/(auto|scroll)/.test(getComputedStyle(node).overflowY))scrollers.push(node);}
      if(!scrollers.includes(document.scrollingElement))scrollers.push(document.scrollingElement);
      drag={handle,row:handle.closest('[data-image-row]'),original:items(),keyboard:!event,inside:true,lifted:false,events:new AbortController(),scrollers};
      const {signal}=drag.events;
      window.addEventListener('blur',()=>finish(false),{signal});
      window.addEventListener('resize',()=>finish(false),{signal});
      window.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(false);return;}
        if(event.key==='Tab'){finish(false);return;}
        if(!drag?.keyboard)return;
        if([' ','Enter','ArrowUp','ArrowDown','Home','End'].includes(event.key)){
          event.preventDefault();event.stopImmediatePropagation();
          if(event.key===' '||event.key==='Enter'){finish(true);return;}
          const index=items().indexOf(drag.row);
          moveTo(event.key==='Home'?0:event.key==='End'?rows.children.length-1:index+(event.key==='ArrowUp'?-1:1));
          drag.row.scrollIntoView({block:'nearest',behavior:'instant'});
        }
      },{signal,capture:true});
      if(!event){lift();return;}
      Object.assign(drag,{pointerId:event.pointerId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY});
      rows.setPointerCapture(event.pointerId);
      window.addEventListener('pointermove',event=>{
        if(event.pointerId!==drag?.pointerId)return;
        drag.x=event.clientX;drag.y=event.clientY;
        if(!drag.lifted&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)>5)lift();
        if(drag.lifted){event.preventDefault();track();}
      },{signal,passive:false});
      window.addEventListener('pointerup',event=>{if(event.pointerId===drag?.pointerId)finish(drag.lifted&&drag.inside);},{signal});
      window.addEventListener('pointercancel',()=>finish(false),{signal});
      rows.addEventListener('lostpointercapture',()=>finish(false),{signal});
    }
    rows.addEventListener('pointerdown',event=>{
      const handle=event.target.closest('[data-image-drag]');
      if(!handle||event.button!==0||!event.isPrimary)return;
      event.preventDefault();handle.focus({preventScroll:true});begin(handle,event);
    });
    rows.addEventListener('keydown',event=>{
      const handle=event.target.closest('[data-image-drag]');
      if(handle&&!drag&&[' ','Enter'].includes(event.key)){event.preventDefault();event.stopPropagation();begin(handle);}
    });
    return {cancel:()=>finish(false,false)};
  }
  function mount({studio,root,capture,apply,remember,changed,products,upload,html,siteKey}) {
    const host=document.createElement('main');host.className='ib-editor';host.hidden=true;
    const controls=document.createElement('fieldset');controls.className='ib-controls';
    const heading=document.createElement('h2');heading.textContent=t('Upload your images');
    const intro=document.createElement('p');intro.textContent=t('Your images become the whole page, top to bottom.');
    const rows=document.createElement('div');rows.className='ib-rows';
    const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.multiple=true;input.hidden=true;input.dataset.imagePageUpload='';
    const add=document.createElement('button');add.type='button';add.className='ib-upload';add.dataset.imagePageAdd='';add.textContent='+ '+t('Upload images');
    const note=document.createElement('p');note.className='ib-note';note.textContent=t('JPG, PNG or WebP · up to 15 MB each');
    const status=document.createElement('p');status.className='ib-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const productHeading=document.createElement('h2');productHeading.textContent=t('Ezkart checkout');productHeading.className='ib-product-heading';
    const label=document.createElement('label');label.className='ib-product-label';label.textContent=t('Choose a product');
    const product=document.createElement('select');product.dataset.imagePageProduct='';label.append(product);
    const help=document.createElement('p');help.textContent=t('Choose the product customers will buy. Its price and options come from your catalog.');
    const manage=document.createElement('a');manage.href='?page=products';manage.textContent=t('Manage products');
    controls.append(heading,intro,rows,input,add,note,status,productHeading,label,help,manage);
    const stage=document.createElement('section');stage.className='ib-stage';stage.setAttribute('aria-label',t('Image page preview'));
    const caption=document.createElement('p');caption.textContent=t('Image-only page, one mobile layout');
    const frame=document.createElement('iframe');frame.className='ib-phone';frame.title=t('Image page preview');frame.setAttribute('sandbox','allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation');
    const empty=document.createElement('button');empty.type='button';empty.className='ib-empty';empty.textContent=t('Add images to get started');empty.onclick=()=>add.click();
    const scroll=document.createElement('p');scroll.textContent=t('Scroll through your page');
    stage.append(caption,frame,empty,scroll);host.append(controls,stage);studio.append(host);
    let busy=false,replaceId='',revision=0;
    let previewChannel='',previewReady=false,paintFrame=0,liveNavigation=null,syncingNavigation=false;
    const sendNavigation=()=>{
      paintFrame=0;
      if(previewReady)frame.contentWindow?.postMessage({type:'ezkart:image-navigation',channel:previewChannel,settings:liveNavigation||readNavigation(root)},'*');
    };
    const previewNavigation=settings=>{
      liveNavigation=settings;
      if(!paintFrame)paintFrame=requestAnimationFrame(sendNavigation);
    };
    window.addEventListener('message',event=>{
      if(event.source!==frame.contentWindow||event.data?.type!=='ezkart:image-preview-ready'||event.data.channel!==previewChannel)return;
      previewReady=true;sendNavigation();
    });
    const active=()=>Boolean(root.querySelector('[data-image-page]'));
    const translateChrome=()=>{
      studio.querySelectorAll('.sq-command-actions,.sq-history-tools,[data-open-page-creator]').forEach(EzkartLanguage.apply);
    };
    const saveStatus=studio.querySelector('[data-sq-save-state]');
    if(saveStatus)new MutationObserver(()=>{if(active())EzkartLanguage.apply(saveStatus);}).observe(saveStatus,{childList:true,characterData:true,subtree:true});
    function commit(images,productId,navigation=read(root).navigation){apply(makeState(images,productId,capture(),navigation));}
    const sorter=imageSorter(rows,status,order=>{
      const current=read(root),images=new Map(current.images.map(image=>[image.id,image]));
      commit(order.map(id=>images.get(id)),current.productId);
    });
    const actionIcons={
      'Remove':'<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/>',
    };
    function button(text,action,disabled=false){const node=document.createElement('button');node.type='button';node.title=t(text);node.setAttribute('aria-label',t(text));node.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${actionIcons[text]}</svg>`;node.disabled=disabled;node.addEventListener('click',action);return node;}
    const navSettings=document.createElement('section');navSettings.className='ib-nav-settings';
    const navHeading=document.createElement('h2');navHeading.textContent=t('Navigation bar');
    const navBody=document.createElement('div');navBody.className='ib-nav-body';
    const navFields=new Map();
    const appearanceKeys=new Set(['title','height','color','textColor','transparency','blur','ctaLabel']);
    const updateNavigation=change=>{
      const previous=readNavigation(root),next=navigationSettings({...previous,...change});
      if(Object.keys(change).every(key=>appearanceKeys.has(key))){
        if(JSON.stringify(previous)!==JSON.stringify(next)){
          remember();
          root.querySelector('[data-image-page]').dataset.imageNavigation=JSON.stringify(next);
          paintNavigation(root,next);
          changed();
        }
        previewNavigation(next);
        Object.keys(change).forEach(key=>{
          const field=navFields.get(key);
          if(field){field.input.value=next[key];field.show();}
        });
        return;
      }
      const current=read(root);commit(current.images,current.productId,next);
    };
    function navField(parent,key,text,type,{min,max,unit,options}={}) {
      const label=document.createElement('label');label.className='ib-nav-field'+(type==='checkbox'?' ib-nav-check':'');
      const caption=document.createElement('span');caption.textContent=t(text);
      const input=document.createElement(options?'select':'input');input.dataset.imageNav=key;input.setAttribute('aria-label',t(text));
      if(options)options.forEach(([value,name])=>input.add(new Option(t(name),value)));
      else input.type=type;
      if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;
      if(type==='text')input.maxLength=key==='title'?40:32;
      const value=document.createElement('output');value.className='ib-nav-unit';
      const show=()=>{value.textContent=(type==='range'?input.value:'')+(unit?' '+unit:'');};
      const control=document.createElement('div');control.className='ib-nav-input';control.append(input);if(unit)control.append(value);
      if(type==='checkbox')label.append(input,caption);else label.append(caption,control);
      const valueOf=()=>type==='checkbox'?input.checked:['number','range'].includes(type)?Number(input.value):input.value;
      input.addEventListener('input',()=>{
        show();
        if(!syncingNavigation&&appearanceKeys.has(key))previewNavigation(navigationSettings({...readNavigation(root),[key]:valueOf()}));
      });
      input.addEventListener('change',()=>updateNavigation({[key]:valueOf()}));
      parent.append(label);navFields.set(key,{input,show});return input;
    }
    navSettings.append(navHeading);navField(navSettings,'enabled','Show navigation bar','checkbox');navSettings.append(navBody);
    navField(navBody,'title','Name in the bar','text');
    const navGrid=document.createElement('div');navGrid.className='ib-nav-grid';navBody.append(navGrid);
    navField(navGrid,'height','Height','number',{min:48,max:120,unit:'px'});
    navField(navGrid,'sticky','Sticky behavior','select',{options:[['off','Off'],['on','On'],['up','Appear on scroll up']]});
    navField(navGrid,'color','Background color','color');navField(navGrid,'textColor','Text color','color');
    navField(navBody,'transparency','Background transparency','range',{min:0,max:100,unit:'%'});
    navField(navBody,'blur','Backdrop blur','range',{min:0,max:32,unit:'px'});
    const linksHeading=document.createElement('h3');linksHeading.textContent=t('Menu links');
    const linksHelp=document.createElement('p');linksHelp.textContent=t('Each link jumps to the start of an image.');
    const navLinks=document.createElement('div');navLinks.className='ib-nav-links';
    const addLink=document.createElement('button');addLink.type='button';addLink.className='ib-nav-add';addLink.dataset.imageNavAdd='';addLink.textContent='+ '+t('Add menu link');
    addLink.onclick=()=>{const {images,navigation}=read(root);if(!images.length||navigation.links.length>=8)return;const image=images.find(image=>!navigation.links.some(link=>link.target===image.id))||images[0];updateNavigation({links:[...navigation.links,{label:t('Image')+' '+(images.indexOf(image)+1),target:image.id}]});navLinks.lastElementChild?.querySelector('input')?.focus();};
    navBody.append(linksHeading,linksHelp,navLinks,addLink);
    navField(navBody,'cta','Show product button','checkbox');
    const ctaField=navField(navBody,'ctaLabel','Button text','text');
    const ctaHelp=document.createElement('p');ctaHelp.textContent=t('The button jumps to your connected product.');navBody.append(ctaHelp);
    controls.insertBefore(navSettings,productHeading);
    function syncNavigation(images,productId,navigation) {
      navBody.hidden=!navigation.enabled;
      syncingNavigation=true;
      navFields.forEach(({input,show},key)=>{if(input.type==='checkbox')input.checked=navigation[key];else input.value=navigation[key];input.dispatchEvent(new Event('input',{bubbles:true}));show();});
      syncingNavigation=false;
      ctaField.closest('label').hidden=!navigation.cta;
      ctaHelp.textContent=t(productId?'The button jumps to your connected product.':'Choose a product below to show this button.');
      navLinks.replaceChildren();
      navigation.links.forEach((link,index)=>{
        const row=document.createElement('div');row.className='ib-nav-link';
        const name=document.createElement('input');name.type='text';name.maxLength=60;name.value=link.label;name.setAttribute('aria-label',t('Link text')+' '+(index+1));name.placeholder=t('Link text');
        const target=document.createElement('select');target.setAttribute('aria-label',t('Jump to image')+' '+(index+1));images.forEach((image,i)=>target.add(new Option(`${i+1}. ${image.name}`,image.id)));target.value=link.target;
        const update=()=>{const links=read(root).navigation.links;links[index]={label:name.value,target:target.value};updateNavigation({links});};
        name.onchange=target.onchange=update;
        const remove=button('Remove',()=>{updateNavigation({links:read(root).navigation.links.filter((_,i)=>i!==index)});(navLinks.children[index]?.querySelector('input')||addLink).focus();});remove.setAttribute('aria-label',t('Remove menu link')+' '+(index+1));
        row.append(name,remove,target);navLinks.append(row);
      });
      addLink.disabled=!images.length||navigation.links.length>=8;
    }
    function sync() {
      sorter.cancel();
      liveNavigation=null;previewReady=false;previewChannel='';
      cancelAnimationFrame(paintFrame);paintFrame=0;
      const enabled=active();host.hidden=!enabled;studio.classList.toggle('sq-image-editor',enabled);document.body.classList.toggle('page-image-editor',enabled);
      const pageMenu=studio.querySelector('.sq-page-identity [data-sq-open-panel="pages"]');
      if(pageMenu)pageMenu.disabled=enabled;
      if(!enabled){frame.removeAttribute('srcdoc');return;}
      translateChrome();
      const {images,productId,navigation}=read(root);rows.replaceChildren();
      syncNavigation(images,productId,navigation);
      images.forEach((image,index)=>{
        const row=document.createElement('article');row.className='ib-row';row.dataset.imageRow=image.id;
        const handle=document.createElement('button');handle.type='button';handle.className='ib-drag-handle';handle.dataset.imageDrag='';handle.disabled=images.length<2;handle.title=t('Drag to reorder');handle.setAttribute('aria-label',t('Reorder image')+': '+image.name);handle.setAttribute('aria-pressed','false');handle.setAttribute('aria-description',t('Press Space to pick up, arrow keys to move, and Space to drop.'));
        handle.innerHTML='<svg viewBox="0 0 16 24" aria-hidden="true"><circle cx="5" cy="6" r="1.6"/><circle cx="11" cy="6" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="11" cy="12" r="1.6"/><circle cx="5" cy="18" r="1.6"/><circle cx="11" cy="18" r="1.6"/></svg>';
        const thumb=new Image();thumb.src=image.src;thumb.alt='';thumb.loading='lazy';thumb.draggable=false;
        const replace=document.createElement('button');replace.type='button';replace.className='ib-thumbnail';replace.dataset.imageReplace='';replace.setAttribute('aria-label',t('Replace')+': '+image.name);replace.title=t('Replace image');
        const overlay=document.createElement('span');overlay.textContent=t('Replace');replace.append(thumb,overlay);
        replace.onclick=()=>{replaceId=image.id;input.multiple=false;input.click();};
        const meta=document.createElement('div');meta.className='ib-row-meta';
        const name=document.createElement('strong');name.textContent=`${index+1}. ${image.name}`;
        const remove=button('Remove',()=>{const current=read(root);commit(current.images.filter(item=>item.id!==image.id),current.productId);status.textContent=t('Image removed. Use Undo to restore it.');add.focus();});remove.dataset.imageRemove='';remove.setAttribute('aria-label',t('Remove')+': '+image.name);
        remove.className='ib-remove';meta.append(name,remove);
        const description=document.createElement('details');description.className='ib-description';
        const summary=document.createElement('summary');summary.textContent=t('Image description (optional)');description.append(summary);
        const alt=document.createElement('textarea');alt.rows=2;alt.maxLength=2000;alt.value=image.alt;alt.setAttribute('aria-label',t('Image description'));alt.placeholder=t('Describe the important text and product details in this image.');
        alt.addEventListener('change',()=>{const current=read(root),target=current.images.find(item=>item.id===image.id);if(target){target.alt=alt.value;commit(current.images,current.productId);}});
        description.append(alt);row.append(handle,replace,meta,description);rows.append(row);
      });
      product.replaceChildren(new Option(t('No product connected'),''));
      products().filter(item=>[undefined,'active'].includes(item.status)).forEach(item=>product.add(new Option(item.name,item.id)));
      if(productId && ![...product.options].some(option=>option.value===productId)){const option=new Option(t('Choose another product'),productId);option.disabled=true;product.add(option);}
      product.value=productId;
      frame.hidden=!images.length;empty.hidden=Boolean(images.length);scroll.hidden=!images.length;
      if(images.length){
        previewChannel=crypto.randomUUID();
        const bridge=`<script>(${installPreviewUpdates.toString()})(${JSON.stringify(previewChannel)},${paintNavigation.toString()})<\/script>`;
        frame.srcdoc=html().replace('</body>',bridge+'</body>');
      }
      controls.disabled=busy;
    }
    add.onclick=()=>{replaceId='';input.multiple=true;input.click();};
    product.addEventListener('change',()=>{const current=read(root);commit(current.images,product.value);});
    input.addEventListener('change',async()=>{
      const files=[...input.files],targetId=replaceId,startSite=siteKey(),generation=++revision;input.value='';
      if(!files.length||busy)return;
      if(read(root).images.length+files.length-(targetId?1:0)>20){status.textContent=t('You can add up to 20 images.');return;}
      busy=true;controls.disabled=true;status.textContent=t('Uploading…');
      try {
        const additions=[];
        for(const file of files){const image=await prepareImage(file);await upload(image.src,image.name);additions.push(image);}
        if(generation!==revision||siteKey()!==startSite||!active())throw Error(t('The page changed while uploading. Please try again.'));
        const current=read(root);
        if(targetId){const index=current.images.findIndex(item=>item.id===targetId);if(index<0)throw Error(t('The page changed while uploading. Please try again.'));additions[0].id=targetId;additions[0].alt=current.images[index].alt;current.images.splice(index,1,additions[0]);}
        else current.images.push(...additions);
        commit(current.images,current.productId);status.textContent=t(targetId?'Image replaced':'Images added');
      } catch(error){status.textContent=error.message||t('Upload failed. Please try again.');}
      finally {busy=false;controls.disabled=false;add.focus();}
    });
    sync();
    return {sync,busy:()=>busy,active};
  }
  globalThis.EzkartImageBuilder={blank:()=>makeState(),mount,read,upgrade};
})();
