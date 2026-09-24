/* A shared entry point for both library creation and the editor's New page action. */
(() => {
  const base = new URL('.', document.currentScript.src);
  const templateUrl = new URL('builder-choice.html', base);
  templateUrl.search = new URL(document.currentScript.src).search;
  const template = fetch(templateUrl).then(response => {
    if (!response.ok) throw Error('Builder choices could not load.');
    return response.text();
  }).catch(() => null);
  const forms = new WeakMap();
  const t = text => EzkartLanguage.t(text);
  function translate(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, text = node.textContent.trim();
      if (text) node.textContent = node.textContent.replace(text, t(text));
    }
    root.querySelectorAll('[aria-label]').forEach(node => node.setAttribute('aria-label', t(node.getAttribute('aria-label'))));
  }
  function example(mode, opener) {
    const dialog = document.createElement('dialog');
    dialog.className = 'bc-example';
    const title = document.createElement('h2');title.textContent=t(mode==='image'?'Image builder':'Visual builder');title.id='bc-example-title';
    dialog.setAttribute('aria-labelledby',title.id);
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label',t('Close'));
    const header=document.createElement('header');header.append(title,close);
    const frame=document.createElement('div');frame.className='bc-example-frame '+mode;
    const sources=mode==='image'
      ? [1,2,3,4].map(index=>`assets/builder-choice/kopi-senja-0${index}.webp`)
      : ['templates/sela/preview/desktop.png'];
    sources.forEach((source,index)=>{
      const image=new Image();image.alt=t('Example design')+(mode==='image'?` ${index+1} / 4`:'');image.src=new URL(source,base);image.decoding='async';
      if(mode==='image'){image.width=800;image.height=1200;}
      frame.append(image);
    });
    dialog.append(header,frame);document.body.append(dialog);
    close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{dialog.remove();opener.focus();},{once:true});
    dialog.showModal();
  }
  function attach(form) {
    if (!form || forms.has(form)) return;
    const dialog=form.closest('dialog'),section=form.querySelector(':scope > section');
    const details=document.createElement('div');details.className='bc-page-details';
    details.append(...section.childNodes);
    const choices=document.createElement('div');choices.className='bc-choice-view';
    choices.textContent=t('Choose your builder');
    const back=document.createElement('button');back.type='button';back.className='bc-back';back.textContent='← '+t('Choose a different builder');
    section.append(choices,back,details);
    const submit=form.querySelector('footer button:not([data-creator-close])');
    const title=dialog.querySelector('header h2'),subtitle=dialog.querySelector('header p');
    const originalTitle=title.textContent,originalSubtitle=subtitle.textContent;
    const state={mode:'',open(){select('');dialog.showModal();}};
    forms.set(form,state);
    function select(mode) {
      state.mode=mode;form.dataset.builderMode=mode;
      choices.hidden=Boolean(mode);back.hidden=!mode;details.hidden=!mode;details.inert=!mode;submit.hidden=!mode;
      dialog.classList.toggle('bc-choosing',!mode);
      dialog.classList.toggle('bc-image-details',mode==='image');
      title.textContent=t(!mode?'Choose your builder':mode==='image'?'Create an image page':originalTitle);
      subtitle.textContent=mode?t(mode==='image'?'Give your page a name. Add images and a product next.':originalSubtitle):'';
      details.querySelector('[data-template-picker]').hidden=mode==='image';
      const settings=details.querySelector('[data-template-settings]');
      settings.hidden=mode==='image';settings.querySelectorAll('input,select,textarea').forEach(input=>input.disabled=mode==='image');
      details.querySelector('.sq-creator-optional').hidden=mode==='image';
      if(mode==='image')details.querySelectorAll('[name="starter_products[]"]').forEach(input=>input.checked=false);
      if(mode)form.elements.page_name.focus();
      dialog.scrollTop=0;
    }
    back.onclick=()=>select('');
    choices.addEventListener('click',event=>{
      const choose=event.target.closest('[data-bc-choose]');
      if(choose)select(choose.dataset.bcChoose);
      const preview=event.target.closest('[data-bc-preview]');
      if(preview)example(preview.dataset.bcPreview,preview);
    });
    template.then(html=>{if(!html)throw Error('Choices unavailable');choices.innerHTML=html;translate(choices);}).catch(()=>{
      choices.replaceChildren();
      for(const mode of ['image','visual']){const button=document.createElement('button');button.type='button';button.dataset.bcChoose=mode;button.className='ui-button';button.textContent=t(mode==='image'?'Image builder':'Visual builder');choices.append(button);}
    });
    translate(details);translate(form.querySelector('footer'));
    select('');
  }
  globalThis.EzkartBuilderChoice={
    attach,
    open(form){attach(form);forms.get(form)?.open();},
    mode:form=>forms.get(form)?.mode||'',
    async prepare(form,products){
      const mode=forms.get(form)?.mode;
      if(!mode)throw Error(t('Choose your builder'));
      return mode==='image'?{state:EzkartImageBuilder.blank()}:EzkartTemplates.fromForm(form,products);
    },
  };
})();
