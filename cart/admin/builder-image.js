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
  function makeState(images=[], productId='', previous={}) {
    const holder=document.createElement('div');
    const page=section('image-page',{display:'block',width:'100%',maxWidth:'480px',marginLeft:'auto',marginRight:'auto',paddingTop:'0px',paddingRight:'0px',paddingBottom:'0px',paddingLeft:'0px',marginBottom:'0px',minHeight:'0px',backgroundColor:'#ffffff'});
    page.dataset.imagePage='';
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
    const state={...previous,version:6,builderMode:'image',template:null,previewClass:'sq-page-preview sq-image-page-preview',previewStyle:'--site-page:#ffffff;--site-surface:#ffffff;--site-ink:#252724;--site-body-font:Arial,sans-serif;--site-heading-font:Arial,sans-serif;--button-primary-bg:#ed4639;--button-primary-fg:#ffffff;--button-primary-radius:8px',preview:holder.innerHTML,products:productId?[productId]:[],selectedSection:'image-page',spacing:'[]',pageSpacing:{gutters:{desktop:0,tablet:0,mobile:0},columnGap:0}};
    // A publication stores both the editable state and the exported HTML in
    // the same 16 MB project. Leave room for that second copy and commerce.
    if(new Blob([JSON.stringify(state)]).size>6*MB)throw Error(t('This page is full. Use smaller images or remove an image first.'));
    return state;
  }
  function read(root) {
    const product=root.querySelector('[data-native-id="image-product"],[data-native-id="image-checkout-add"]');
    return {
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
    const {images,productId}=read(root);
    return makeState(images,productId,state);
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
  function mount({studio,root,capture,apply,products,upload,html,siteKey}) {
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
    const active=()=>Boolean(root.querySelector('[data-image-page]'));
    const translateChrome=()=>{
      studio.querySelectorAll('.sq-command-actions,.sq-history-tools,[data-open-page-creator]').forEach(EzkartLanguage.apply);
    };
    const saveStatus=studio.querySelector('[data-sq-save-state]');
    if(saveStatus)new MutationObserver(()=>{if(active())EzkartLanguage.apply(saveStatus);}).observe(saveStatus,{childList:true,characterData:true,subtree:true});
    function commit(images,productId){apply(makeState(images,productId,capture()));}
    const actionIcons={
      'Move up':'<path d="M12 19V5m-6 6 6-6 6 6"/>',
      'Move down':'<path d="M12 5v14m-6-6 6 6 6-6"/>',
      'Replace':'<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
      'Remove':'<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/>',
    };
    function button(text,action,disabled=false){const node=document.createElement('button');node.type='button';node.title=t(text);node.setAttribute('aria-label',t(text));node.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${actionIcons[text]}</svg>`;node.disabled=disabled;node.addEventListener('click',action);return node;}
    function sync() {
      const enabled=active();host.hidden=!enabled;studio.classList.toggle('sq-image-editor',enabled);document.body.classList.toggle('page-image-editor',enabled);
      const pageMenu=studio.querySelector('.sq-page-identity [data-sq-open-panel="pages"]');
      if(pageMenu)pageMenu.disabled=enabled;
      if(!enabled){frame.removeAttribute('srcdoc');return;}
      translateChrome();
      const {images,productId}=read(root);rows.replaceChildren();
      images.forEach((image,index)=>{
        const row=document.createElement('article');row.className='ib-row';row.dataset.imageRow=image.id;
        const thumb=new Image();thumb.src=image.src;thumb.alt='';thumb.loading='lazy';
        const meta=document.createElement('div');meta.className='ib-row-meta';
        const name=document.createElement('strong');name.textContent=`${index+1}. ${image.name}`;
        const actions=document.createElement('div');actions.className='ib-row-actions';
        for(const direction of [-1,1]){
          const move=button(direction<0?'Move up':'Move down',()=>{
            const current=read(root);const from=current.images.findIndex(item=>item.id===image.id),to=from+direction;
            if(from<0||to<0||to>=current.images.length)return;
            [current.images[from],current.images[to]]=[current.images[to],current.images[from]];
            commit(current.images,current.productId);
            rows.querySelector(`[data-image-row="${image.id}"] button`)?.focus();
          },index+direction<0||index+direction>=images.length);
          move.setAttribute('aria-label',t(direction<0?'Move up':'Move down')+': '+image.name);actions.append(move);
        }
        const replace=button('Replace',()=>{replaceId=image.id;input.multiple=false;input.click();});replace.dataset.imageReplace='';replace.setAttribute('aria-label',t('Replace')+': '+image.name);
        const remove=button('Remove',()=>{const current=read(root);commit(current.images.filter(item=>item.id!==image.id),current.productId);status.textContent=t('Image removed. Use Undo to restore it.');add.focus();});remove.dataset.imageRemove='';remove.setAttribute('aria-label',t('Remove')+': '+image.name);
        actions.append(replace,remove);meta.append(name,actions);
        const description=document.createElement('details');description.className='ib-description';
        const summary=document.createElement('summary');summary.textContent=t('Image description (optional)');description.append(summary);
        const alt=document.createElement('textarea');alt.rows=2;alt.maxLength=2000;alt.value=image.alt;alt.setAttribute('aria-label',t('Image description'));alt.placeholder=t('Describe the important text and product details in this image.');
        alt.addEventListener('change',()=>{const current=read(root),target=current.images.find(item=>item.id===image.id);if(target){target.alt=alt.value;commit(current.images,current.productId);}});
        description.append(alt);row.append(thumb,meta,description);rows.append(row);
      });
      product.replaceChildren(new Option(t('No product connected'),''));
      products().filter(item=>[undefined,'active'].includes(item.status)).forEach(item=>product.add(new Option(item.name,item.id)));
      if(productId && ![...product.options].some(option=>option.value===productId)){const option=new Option(t('Choose another product'),productId);option.disabled=true;product.add(option);}
      product.value=productId;
      frame.hidden=!images.length;empty.hidden=Boolean(images.length);scroll.hidden=!images.length;
      if(images.length)frame.srcdoc=html();
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
