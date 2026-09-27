(() => {
  'use strict';
  const partBytes=5*1024*1024,maximumBytes=100*partBytes;
  const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');
  const bytesLabel=n=>n<1024*1024?`${Math.max(1,Math.ceil(n/1024))} KiB`:`${(n/1024/1024).toLocaleString(undefined,{maximumFractionDigits:1})} MiB`;
  const validId=id=>/^dupl_[a-f0-9]{40}$/.test(id||'');
  const states=['preparing','uploading','completing','ready','deleting','deleted'];
  const validInput=input=>input&&/^[A-Za-z0-9_-]{16,100}$/.test(input.requestKey||'')&&typeof input.filename==='string'
    &&Number.isSafeInteger(input.size)&&input.size>0&&input.size<=maximumBytes&&Array.isArray(input.parts)
    &&input.parts.length===Math.ceil(input.size/partBytes)&&input.parts.every(p=>/^[a-f0-9]{64}$/.test(p));
  const validRecord=r=>r&&typeof r==='object'&&!Array.isArray(r)&&(!r.input||validInput(r.input))
    &&(!r.upload||(validId(r.upload.id)&&states.includes(r.upload.state)))&&(r.input||r.upload)&&typeof r.cancelling==='boolean';

  function mount({root,enabled,draftKey,product,onChange}){
    if(!root)return null;
    const store=document.body.dataset.adminFileStore||'',account=document.body.dataset.adminReviewAccount||'',csrf=document.body.dataset.adminCsrfToken||'';
    const storageKey=`ezkart.digital-file.v1:${account}:${store}:${draftKey}`;
    const q=s=>root.querySelector(s),picker=q('[data-digital-pick]'),progress=q('progress'),status=q('[data-digital-status]'),error=q('[data-digital-error]');
    const saved=product?.digitalFile?{id:product.digitalFile.uploadId,filename:product.digitalFile.filename,size:product.digitalFile.size,state:'ready',retained:true}:null;
    let record=null,file=null,busy=false,locked=false,sessionLost=false,abort=null,initialized=false,historyCursor=null,historyLoading=false,restoring=Promise.resolve(),externalBusy=false,canEdit=root.dataset.canEdit==='true';
    const text=(selector,value)=>{q(selector).textContent=value;};
    const report=message=>{error.textContent=message;error.hidden=!message;};
    const url=path=>'./?cloud='+encodeURIComponent('/v1/digital-files'+path);
    const headers={'X-Ezkart-CSRF':csrf,'X-Ezkart-File-Account':account,'X-Ezkart-File-Store':store};
    const checkUpload=upload=>{
      if(!upload||!validId(upload.id)||upload.sellerId!==store||!states.includes(upload.state)||upload.partSize!==partBytes
        ||!Array.isArray(upload.manifest)||!Array.isArray(upload.parts)||record?.upload&&upload.id!==record.upload.id
        ||record?.input&&(upload.filename!==record.input.filename||upload.size!==record.input.size||JSON.stringify(upload.manifest)!==JSON.stringify(record.input.parts)))
        throw Error('The upload receipt did not match this file. Keep the original upload reference and reload.');
      return upload;
    };
    async function request(path,{method='GET',body}={}){
      const response=await fetch(url(path),{method,credentials:'same-origin',cache:'no-store',headers:{...headers,
        ...(body===undefined?{}:{'Content-Type':body instanceof Blob?'application/octet-stream':'application/json'})},
        ...(body===undefined?{}:{body:body instanceof Blob?body:JSON.stringify(body)}),signal:abort?.signal});
      const result=await response.json().catch(()=>null);
      if(!response.ok||!result?.ok){
        if(response.status===401||result?.code==='digital_store_changed'||result?.code==='digital_membership_changed'){locked=true;sessionLost=true;file=null;}
        const e=Error(result?.error||'The result was not confirmed. Resume the same upload to check progress.');e.code=result?.code;throw e;
      }
      return result;
    }
    async function persist(changed=false){
      try{
        if(record){const data=JSON.stringify(record),checksum=await hash(new TextEncoder().encode(data));sessionStorage.setItem(storageKey,JSON.stringify({data,checksum}));}
        else sessionStorage.removeItem(storageKey);
      }catch{locked=true;throw Error('Upload recovery could not be saved in this browser. Keep this tab open and allow browser storage before uploading.');}
      if(changed)onChange?.();
    }
    function render(){
      const upload=record?.upload,input=record?.input,name=upload?.filename||input?.filename||saved?.filename;
      text('[data-digital-name]',name||'No private file selected');
      text('[data-digital-size]',name?bytesLabel(upload?.size||input?.size||saved?.size):'One file for every variant · up to 500 MiB');
      const ready=upload?.state==='ready'&&!upload.expired,pending=Boolean(record?.input&&!ready),stopped=['deleted','deleting'].includes(upload?.state)||upload?.expired;
      text('[data-digital-choose]',pending&&!stopped?'Select the same file':name?'Replace file':'Choose file');
      q('[data-digital-choose]').disabled=!enabled||!canEdit||locked||busy||externalBusy||record?.cancelling;
      picker.disabled=!enabled||!canEdit||locked||busy||externalBusy||record?.cancelling;
      q('[data-digital-resume]').hidden=!record?.input||ready||stopped||record?.cancelling;
      q('[data-digital-resume]').disabled=busy||locked||externalBusy||!canEdit;
      q('[data-digital-pause]').hidden=!busy;
      q('[data-digital-discard]').hidden=!record?.input||upload?.retained===true;
      q('[data-digital-discard]').disabled=busy||locked||externalBusy||!canEdit;
      text('[data-digital-discard]',record?.cancelling?'Retry discarding upload':'Discard selected upload');
      q('[data-digital-download]').hidden=!ready;q('[data-digital-download]').disabled=busy||locked||externalBusy;
      progress.hidden=!busy&&!pending;progress.setAttribute('aria-label','Private file upload progress');
      if(!busy){
        status.textContent=!enabled?'Sign in to upload a private file.':record?.cancelling?'Discard is awaiting confirmation. Retry to check the original upload.'
          :ready?upload.retained?'Published file retained. Replacements create a new version.':'File verified. Publish the product to use this file.'
          :stopped?'This upload was cancelled or expired. Choose a file to start again.'
          :pending?`${upload?.parts?.length||0} of ${input.parts.length} parts confirmed. ${file?'Resume the upload.':'Select the same file to resume.'}`
          :'Upload the file customers will receive. The file stays private.';
      }
      const note=q('[data-digital-expiry]');note.textContent=upload?.expiresAt?`Unpublished file ${ready?'retained':'upload can resume'} until ${new Date(upload.expiresAt).toLocaleString()}.`:'Published versions remain available in file history.';note.hidden=!upload;
      const field=root.querySelector('[name="digital_name"]');if(field)field.value=upload?.filename||input?.filename||saved?.filename||'';
      if(sessionLost){
        text('[data-digital-name]','Reload to verify your sign-in');text('[data-digital-size]','');status.textContent='Private file details are hidden until your account is verified.';
        q('[data-digital-history-items]').replaceChildren();q('[data-digital-history]').hidden=true;q('[data-digital-download]').hidden=true;note.hidden=true;progress.hidden=true;
        if(field)field.value='';
      }
    }
    async function accept(upload,changed=false){record.upload=checkUpload(upload);canEdit=upload.canEdit===true;await persist(changed);render();}
    async function refresh(){
      if(record?.upload)await accept((await request('/uploads/'+record.upload.id)).upload);
      else if(record?.input)await accept((await request('/uploads',{method:'POST',body:record.input})).upload,true);
    }
    async function run(operation){
      if(busy||locked||externalBusy||!enabled||!canEdit)return;
      await restoring;if(locked||busy||externalBusy||!canEdit)return;busy=true;abort=new AbortController();report('');render();
      try{await operation();}catch(e){report(e?.name==='AbortError'?'Paused. Resume to check which parts were saved.':e.message||'The upload could not be confirmed.');}
      finally{busy=false;abort=null;render();}
    }
    async function send(){
      if(!record?.input)throw Error('Choose a private file first.');
      await refresh();
      if(record.upload.state==='ready')return;
      if(['deleted','deleting'].includes(record.upload.state)||record.upload.expired)throw Error('This upload expired or was cancelled. Choose the file to start a new upload.');
      if(!file&&record.upload.parts.length!==record.input.parts.length)throw Error('Select the same file to resume its saved parts.');
      for(let i=0;i<record.input.parts.length;i++){
        abort.signal.throwIfAborted();
        if(record.upload.parts.some(p=>p.number===i+1&&p.sha256===record.input.parts[i]))continue;
        status.textContent=`Uploading part ${i+1} of ${record.input.parts.length}…`;
        await accept((await request(`/uploads/${record.upload.id}/parts/${i+1}`,{method:'PUT',body:file.slice(i*partBytes,(i+1)*partBytes)})).upload);
        progress.value=Math.round(100*record.upload.parts.length/record.input.parts.length);
      }
      status.textContent='Verifying the complete private file…';
      await accept((await request('/uploads/'+record.upload.id+'/complete',{method:'POST',body:{}})).upload,true);
      file=null;
    }
    async function choose(selected){
      if(!selected||selected.size<1||selected.size>maximumBytes)throw Error('Choose a non-empty file up to 500 MiB.');
      const filename=selected.name.normalize('NFC').trim();
      if([...filename].length>180||!filename||/[\x00-\x1f\x7f-\x9f/\\\u202a-\u202e\u2066-\u2069]/u.test(filename)||/^\.+$/.test(filename))throw Error('Rename this file without path separators or control characters, using at most 180 characters.');
      const parts=[];const count=Math.ceil(selected.size/partBytes);
      for(let i=0;i<count;i++){
        abort.signal.throwIfAborted();status.textContent=`Checking file part ${i+1} of ${count}…`;progress.value=Math.round(100*i/count);
        parts.push(await hash(await selected.slice(i*partBytes,(i+1)*partBytes).arrayBuffer()));
      }
      abort.signal.throwIfAborted();
      const pending=record?.input&&!record.upload?.expired&&!['ready','deleted','deleting'].includes(record.upload?.state);
      if(pending){
        if(record.input.filename!==filename||record.input.size!==selected.size||JSON.stringify(record.input.parts)!==JSON.stringify(parts))
          throw Error('This is a different file. Select the original file to resume, or discard the selected upload before replacing it.');
      }else record={input:{requestKey:crypto.randomUUID(),filename,size:selected.size,parts},upload:null,cancelling:false};
      file=selected;await persist(true);await send();
    }
    async function download(uploadId){
      if(!validId(uploadId)||locked)return;
      report('');
      try{
        const response=await fetch(url('/uploads/'+uploadId+'/file'),{method:'HEAD',credentials:'same-origin',cache:'no-store',headers});
        if(!response.ok||response.headers.get('content-type')!=='application/octet-stream'){
          if(response.status===401||response.status===403){locked=true;sessionLost=true;file=null;render();}
          throw Error('The file download could not start. Reload to check your sign-in and file access.');
        }
      }catch(e){report(e.message||'The file download could not start. Try again.');return;}
      let frame=document.querySelector('[data-digital-download-frame]');
      if(!frame){frame=document.createElement('iframe');frame.hidden=true;frame.name='digital-file-download-'+crypto.randomUUID();frame.dataset.digitalDownloadFrame='';document.body.append(frame);
        frame.addEventListener('load',()=>{try{const body=JSON.parse(frame.contentDocument.body.textContent);if(body?.error)report(body.error);}catch{}});}
      const form=document.createElement('form');form.method='POST';form.action=url('/uploads/'+uploadId+'/file');form.target=frame.name;form.hidden=true;
      for(const [name,value] of Object.entries({account,csrf,store})){const field=document.createElement('input');field.type='hidden';field.name=name;field.value=value;form.append(field);}
      document.body.append(form);form.submit();form.remove();status.textContent='Download requested.';
    }
    async function history(reset=false){
      const container=q('[data-digital-history-items]');
      if(!product?.id||historyLoading||locked)return;
      historyLoading=true;
      try{
        const result=await request('/products/'+encodeURIComponent(product.id)+(reset||!historyCursor?'':'?before='+historyCursor));
        if(reset)container.replaceChildren();
        for(const item of result.items){const row=document.createElement('li'),copy=document.createElement('span'),button=document.createElement('button');
          copy.textContent=`Version ${item.version}${item.current?' · Current':''} — ${item.filename} · ${bytesLabel(item.size)} · ${new Date(item.createdAt).toLocaleString()} · ${item.actorName}`;
          button.type='button';button.className='action-button';button.textContent='Download version '+item.version;button.addEventListener('click',()=>download(item.uploadId));row.append(copy,button);container.append(row);}
        historyCursor=result.nextCursor;q('[data-digital-history-more]').hidden=!historyCursor;
        q('[data-digital-history-empty]').hidden=Boolean(container.children.length);
      }catch(e){report(e.message);render();}finally{historyLoading=false;}
    }
    q('[data-digital-choose]').addEventListener('click',()=>picker.click());
    picker.addEventListener('change',()=>{const selected=picker.files[0];picker.value='';if(selected)void run(()=>choose(selected));});
    q('[data-digital-pause]').addEventListener('click',()=>abort?.abort());
    q('[data-digital-resume]').addEventListener('click',()=>{if(file||record?.upload?.parts?.length===record?.input?.parts?.length)void run(send);else picker.click();});
    q('[data-digital-discard]').addEventListener('click',()=>void run(async()=>{
      record.cancelling=true;await persist(true);await refresh();
      const response=await request('/uploads/'+record.upload.id+'/cancel',{method:'POST',body:{}});
      const result=checkUpload(response.upload);if(result.state!=='deleted')throw Error('Discard was not confirmed. Retry the original upload.');
      record=saved?{input:null,upload:saved,cancelling:false}:null;file=null;await persist(true);
    }));
    q('[data-digital-download]').addEventListener('click',()=>download(record?.upload?.id));
    q('[data-digital-history]').hidden=!product?.id;
    q('[data-digital-history]').addEventListener('toggle',event=>{if(event.target.open)void history(true);});
    q('[data-digital-history-more]').addEventListener('click',()=>void history());
    render();
    return {
      snapshot:()=>record?structuredClone(record):null,
      restore(snapshot){
        restoring=(async()=>{
          report('');
          try{
            let restored=snapshot||null;
            if(!initialized){
              const stored=sessionStorage.getItem(storageKey);
              if(stored){const envelope=JSON.parse(stored);if(typeof envelope.data!=='string'||await hash(new TextEncoder().encode(envelope.data))!==envelope.checksum)throw Error('recovery checksum');restored=JSON.parse(envelope.data);}
            }
            if(restored&&!validRecord(restored))throw Error('invalid recovery record');
            record=restored|| (saved?{input:null,upload:saved,cancelling:false}:null);initialized=true;
            // Verify storage before allowing the first network mutation.
            await persist();
            if(record?.upload){try{await refresh();}catch(e){report(e.message);}}
          }catch{locked=true;report('The saved upload reference could not be verified. Keep this tab open and preserve its recovery record before clearing browser storage.');}
          render();
        })();return restoring;
      },
      async ready(){
        await restoring;if(locked)throw Error('Resolve the file recovery notice before publishing.');if(!canEdit)throw Error('Your store access does not allow publishing.');if(busy||record?.cancelling)throw Error('Finish the private file upload before publishing.');
        if(!record?.upload)throw Error('Upload a private product file before publishing.');
        await refresh();if(record.upload.state!=='ready')throw Error('Finish uploading and verifying the private file before publishing.');
        if(record.upload.expiresAt&&Date.parse(record.upload.expiresAt)<=Date.now())throw Error('The unpublished file expired. Replace it with a new upload before publishing.');
        return {id:record.upload.id,filename:record.upload.filename,size:record.upload.size};
      },
      suspend(value){externalBusy=Boolean(value);render();},
      async published(){sessionStorage.removeItem(storageKey);},
    };
  }
  globalThis.EzkartDigitalFiles={mount};
})();
