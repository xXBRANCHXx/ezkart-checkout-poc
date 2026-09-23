const assets = '../../../cart/admin/templates/sela/preview/assets/';
const icon = name => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
const preview = document.querySelector('#preview-dialog');
const checkout = document.querySelector('#checkout-dialog');
const content = document.querySelector('#demo-content');
let activeBuilder = 'image';
let imageList = [];
let uploadedUrls = [];
const originals = () => [
  { name: 'sambal-nusa.png', src: 'images/sambal-nusa-sales-page.png', alt: 'Sambal Nusa. Lauk sederhana, rasa luar biasa. Paket tiga rasa: Bawang, Ijo, Terasi. Tiga botol isi 150 gram, Rp89.000. Tinggal buka, langsung makan. Cocok buat nasi, ayam, tahu, dan tempe. Contoh produk.' },
];
const products = {
  image: {name: 'Sambal Nusa · Paket 3 Rasa', price: 'Rp89.000', details: 'Bawang · Ijo · Terasi · 3 × 150 g', src: 'images/sambal-nusa-sales-page.png', alt: 'Sambal Nusa, paket tiga rasa'},
  visual: {name: 'Sela Desk Stand', price: 'Rp349.000', details: 'Natural oak · 1 item', src: `${assets}riser-360.webp`, alt: 'Sela wooden desk stand'},
};
function productCard(builder) {
  const p = products[builder];
  return `<div class="product-connected"><img src="${p.src}" alt=""><div><strong>${p.name}</strong><small>Example product · ${p.price}</small></div>${icon('check')}</div>`;
}
function purchaseBar(builder) {
  const p = products[builder];
  return `<div class="purchase-bar"><div><small>${p.name}</small><strong>${p.price}</strong></div><button class="buy-demo" data-checkout>Beli sekarang ↗</button></div>`;
}

function renderImages(focusAt) {
  const rows = content.querySelector('.image-rows');
  const page = content.querySelector('.image-page');
  rows.replaceChildren(); page.replaceChildren();
  imageList.forEach((item, index) => {
    const row = document.createElement('div');row.className = 'image-row';
    const thumb = document.createElement('img');thumb.src = item.src;thumb.alt = '';
    const description = document.createElement('div');
    const name = document.createElement('strong');name.textContent = `${String(index + 1).padStart(2,'0')} · ${item.name}`;
    const status = document.createElement('small');status.textContent = 'Image';description.append(name,status);
    const actions = document.createElement('div');actions.className = 'row-buttons';
    for (const direction of [-1,1]) {
      const button = document.createElement('button');button.innerHTML = icon(direction < 0 ? 'up' : 'down');
      button.setAttribute('aria-label',`Move ${item.name} ${direction < 0 ? 'up' : 'down'}`);
      button.disabled = index + direction < 0 || index + direction >= imageList.length;
      button.addEventListener('click',() => {
        [imageList[index],imageList[index + direction]] = [imageList[index + direction],imageList[index]];
        renderImages({index:index+direction,direction});
      });actions.append(button);
    }
    row.append(thumb,description,actions);rows.append(row);
    const img = document.createElement('img');img.src=item.src;img.alt=item.alt;page.append(img);
  });
  if(focusAt){const row=rows.children[focusAt.index];const buttons=row.querySelectorAll('button');const wanted=buttons[focusAt.direction<0?0:1];(wanted.disabled?[...buttons].find(b=>!b.disabled):wanted)?.focus();}
  page.scrollTop = 0;
  content.querySelector('#image-count').textContent = `${imageList.length} image${imageList.length===1?'':'s'}`;
  window.EzkartBuilderChoice.applyLanguage(content);
}

function resetUploads(){uploadedUrls.forEach(url=>URL.revokeObjectURL(url));uploadedUrls=[];imageList=originals();}

function showImageDemo() {
  resetUploads();
  content.innerHTML = `<div class="demo-layout image-demo-layout"><aside class="demo-controls"><h3>Upload your images <span id="image-count"></span></h3><p>Your images become the whole page, top to bottom.</p><div class="image-rows"></div><input class="upload-input" type="file" id="upload-images" accept="image/png,image/jpeg,image/webp" multiple><button class="upload-action image-upload-box" id="add-images">${icon('plus')}<strong>Add another image</strong><span>One long image or several in a row.</span></button><p class="upload-note" id="upload-note" role="status">JPG, PNG or WebP. Images stay in this browser preview.</p><p class="image-order-help">Use the arrows to change the order.</p><div class="connected-checkout"><h3>Ezkart checkout</h3>${productCard('image')}</div><button class="reset-demo" id="reset-images">Reset example</button></aside><section class="demo-stage" aria-label="Mobile page preview"><div class="stage-label">${icon('phone')} Image-only page, one mobile layout</div><div class="sample-phone"><div class="sample-address">sambalnusa.ezkart.site</div><div class="image-page" tabindex="0" aria-label="Scroll the image page"></div>${purchaseBar('image')}</div><p class="preview-scroll-hint">Scroll to see the whole page</p></section></div>`;
  renderImages();
  const input=content.querySelector('#upload-images');
  content.querySelector('#add-images').addEventListener('click',()=>input.click());
  input.addEventListener('change',async()=>{
    let added=0,rejected=0;
    for(const file of input.files){
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024){rejected++;continue;}
      const url=URL.createObjectURL(file);const probe=new Image();probe.src=url;
      try{await probe.decode();if(!content.contains(input)||!preview.open){URL.revokeObjectURL(url);continue;}uploadedUrls.push(url);imageList.push({name:file.name,src:url,alt:file.name});added++;}catch{URL.revokeObjectURL(url);rejected++;}
    }
    if(!content.contains(input)||!preview.open)return;
    renderImages();input.value='';
    content.querySelector('#upload-note').textContent=`${added} image${added===1?'':'s'} added.${rejected?' Some files could not be added. Use JPG, PNG or WebP up to 15 MB.':''}`;
    window.EzkartBuilderChoice.applyLanguage(content);
  });
  content.querySelector('#reset-images').addEventListener('click',()=>{resetUploads();renderImages();content.querySelector('#upload-note').textContent='Example restored. Images stay in this browser preview.';window.EzkartBuilderChoice.applyLanguage(content);});
}

function showVisualDemo() {
  content.innerHTML=`<div class="demo-layout"><aside class="demo-controls"><h3>Your product</h3>${productCard('visual')}<h3>Edit individual elements</h3><p>Try changing the heading or color. The rest of your page stays in place.</p><label class="field"><span>Heading</span><input id="demo-heading" value="Make room for better." maxlength="100"></label><div class="field"><span>Button color</span><div class="swatches"><button style="--swatch:#af513e" aria-label="Terracotta" aria-pressed="true" data-color="#af513e"></button><button style="--swatch:#3f6656" aria-label="Forest green" aria-pressed="false" data-color="#3f6656"></button><button style="--swatch:#303b53" aria-label="Ink blue" aria-pressed="false" data-color="#303b53"></button></div></div><button class="upload-action" id="add-section">${icon('plus')} Add a text section</button><div class="control-tip">This example shows a few controls. The visual builder also lets you move, resize, and style your page.</div><button class="reset-demo" id="reset-visual">Reset example</button></aside><section class="demo-stage visual-stage" aria-label="Editable page preview"><div class="devices" role="group" aria-label="Preview screen size"><button data-device="desktop" aria-pressed="true">Desktop</button><button data-device="tablet" aria-pressed="false">Tablet</button><button data-device="mobile" aria-pressed="false">Mobile</button></div><div class="sample-site" data-device="desktop"><header class="site-header"><strong>sela.</strong><span>Collection &nbsp;&nbsp;&nbsp; Our story</span></header><section class="site-hero"><div><h3 id="sample-heading">Make room for better.</h3><p>A little more space. A calmer everyday.<br>Considered essentials for your desk.</p><button class="buy-demo" data-checkout>Shop the desk stand ↗</button></div><img src="${assets}hero-720.webp" alt="Sela wooden stand on a neatly arranged desk"></section><section class="site-story"><h4>Good things,<br>well considered.</h4><p>Made for the things you reach for every day. A place for your screen, and room for everything underneath.</p></section><div id="extra-sections"></div></div>${purchaseBar('visual')}</section></div>`;
  const site=content.querySelector('.sample-site');
  content.querySelector('#demo-heading').addEventListener('input',event=>content.querySelector('#sample-heading').textContent=event.target.value);
  content.querySelectorAll('[data-color]').forEach(button=>button.addEventListener('click',()=>{
    site.style.setProperty('--site-accent',button.dataset.color);content.querySelector('.visual-stage').style.setProperty('--preview-accent',button.dataset.color);
    content.querySelectorAll('[data-color]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  }));
  content.querySelectorAll('button[data-device]').forEach(button=>button.addEventListener('click',()=>{
    site.dataset.device=button.dataset.device;site.scrollTop=0;content.querySelectorAll('button[data-device]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  }));
  content.querySelector('#add-section').addEventListener('click',()=>{
    const section=document.createElement('section');section.className='site-extra';section.textContent='A space that works for you. Keep your everyday essentials close, and give each one a place.';
    content.querySelector('#extra-sections').append(section);site.scrollTop=site.scrollHeight;
  });
  content.querySelector('#reset-visual').addEventListener('click',showVisualDemo);
  window.EzkartBuilderChoice.applyLanguage(content);
}

document.querySelectorAll('[data-preview]').forEach(button=>button.addEventListener('click',()=>{
  activeBuilder=button.dataset.preview;
  document.querySelector('#preview-title').textContent=activeBuilder==='image'?'Try the image builder':'Try the visual builder';
  document.querySelector('#preview-description').textContent=activeBuilder==='image'?'All the design is in your images. Upload, arrange, and connect your product.':'Change the text and styling, then see your page at different screen sizes.';
  (activeBuilder==='image'?showImageDemo:showVisualDemo)();
  document.querySelector('#preview-choose').firstChild.textContent=`Use ${activeBuilder} builder `;
  window.EzkartBuilderChoice.applyLanguage(preview);
  preview.showModal();preview.scrollTop=0;
}));
document.querySelector('.close-dialog').addEventListener('click',()=>preview.close());
preview.addEventListener('close',resetUploads);
content.addEventListener('click',event=>{
  if(!event.target.closest('[data-checkout]'))return;
  const p=products[activeBuilder];
  checkout.querySelector('.checkout-product img').src=p.src;
  checkout.querySelector('.checkout-product img').alt=p.alt;
  checkout.querySelector('.checkout-product h3').textContent=p.name;
  checkout.querySelector('.checkout-product p').textContent=p.details;
  checkout.querySelector('.checkout-total strong').textContent=p.price;
  window.EzkartBuilderChoice.applyLanguage(checkout);
  checkout.showModal();
});
document.querySelectorAll('[data-close-checkout]').forEach(button=>button.addEventListener('click',()=>checkout.close()));
for(const dialog of [preview,checkout])dialog.addEventListener('click',event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();}});
function choose(builder){
  if(preview.open)preview.close();
  const status=document.querySelector('.selection-status');status.querySelector('span').textContent=`${builder==='image'?'Image':'Visual'} builder selected. This preview does not create a page.`;status.hidden=false;
  window.EzkartBuilderChoice.applyLanguage(status);
  document.querySelectorAll('.choice').forEach((card,index)=>card.dataset.selected=String(index===(builder==='image'?0:1)));
}
document.querySelectorAll('[data-choose]').forEach(button=>button.addEventListener('click',()=>choose(button.dataset.choose)));
document.querySelector('#preview-choose').addEventListener('click',()=>choose(activeBuilder));
document.querySelector('.selection-status button').addEventListener('click',()=>document.querySelector('.selection-status').hidden=true);
