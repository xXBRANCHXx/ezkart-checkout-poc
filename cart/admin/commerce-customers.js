(() => {
  const base='/v1/commerce/customers',fields=['q','activity','minSpend','minOrders','maxOrders','lastFrom','lastTo','location','tag'];
  const customerId=/^customer_[A-Za-z0-9_-]{1,85}$/;
  const money=value=>value==null?'—':new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(BigInt(value));
  const date=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(value))+' WIB':'—';
  const key=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
  const el=(tag,text,className='')=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
  const button=(text,action)=>{const node=el('button',text,'ui-button');node.type='button';node.addEventListener('click',action);return node;};
  const groups={all:'All customers',high_value:'High value',one_order:'One checkout',repeat:'Repeat paid buyers',no_paid:'No paid order'};
  const rules=filters=>fields.flatMap(field=>{
    const value=filters[field];if(!value||(field==='activity'&&value==='all'))return [];
    const labels={q:'Search',activity:'Group',minSpend:'Minimum value (Rp)',minOrders:'Minimum orders',maxOrders:'Maximum orders',lastFrom:'Last order from',lastTo:'Last order through',location:'Location',tag:'Tag'};
    return labels[field]+': '+(field==='activity'?groups[value]:value);
  }).join(' · ')||'All customer profiles';
  function csvCell(value){let text=value==null?'':String(value);if(typeof value==='string'&&/^(?:[\p{White_Space}\p{Cf}\u0000-\u001f]*[=+@-]|[\t\r\n])/u.test(text.normalize('NFKC')))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
  const csvRow=cells=>cells.map(csvCell).join(',')+'\r\n';
  function mount({request}){
    const root=document.querySelector('[data-commerce-customers]');if(!root||root.dataset.mounted)return;root.dataset.mounted='1';
    const q=s=>root.querySelector(s),form=q('[data-customers-filters]'),rows=q('[data-customers-rows]'),detail=q('[data-customers-detail]'),globalSearch=document.getElementById('global-search');
    const api=path=>request('GET',path,undefined,{timeoutMs:15000}),write=(method,path,body)=>request(method,path,body,{timeoutMs:20000});
    const drafts=new Map();
    let filters={},cursor=null,next=null,previous=null,selected='',cohort='',listVersion=0,detailVersion=0,loading=false,loaded=false,canEdit=false;
    let exportVersion=0,exportInput=null,exportSnapshot=null,exportBusy=false;
    let segmentVersion=0,segmentsNext=null,segmentsBusy=false,editor=null,editorVersion=0;
    const message=(selector,text)=>{q(selector).textContent=text;q(selector).hidden=!text;};
    const formFilters=()=>Object.fromEntries(fields.map(field=>[field,form.elements[field].value.trim()]));
    function setFilters(value={}){for(const field of fields){form.elements[field].value=value[field]||(field==='activity'?'all':'');form.elements[field].dispatchEvent(new Event('change',{bubbles:true}));}if(globalSearch)globalSearch.value=form.elements.q.value;}
    function controls(){q('[data-customers-next]').disabled=loading||!next;q('[data-customers-previous]').disabled=loading||!previous;q('[data-customers-export]').disabled=!loaded||loading||exportBusy;q('[data-customers-create-segment]').disabled=!loaded||loading||!canEdit;q('[data-customers-segment-filters]').disabled=!loaded||loading||q('[data-customers-segment-form]').elements.name.disabled;rows.setAttribute('aria-busy',String(loading));}
    function resetExport(){exportVersion++;exportInput=null;exportSnapshot=null;exportBusy=false;q('[data-customers-export]').textContent='Export matching customers';message('[data-customers-export-status]','');}
    function urlUpdate(push=false){
      const url=new URL(location.href);
      for(const field of fields){const value=filters[field];if(value&&!(field==='activity'&&value==='all'))url.searchParams.set(field,value);else url.searchParams.delete(field);}
      if(cursor)url.searchParams.set('cursor',cursor);else url.searchParams.delete('cursor');
      if(selected)url.searchParams.set('customer',selected);else url.searchParams.delete('customer');
      history[push?'pushState':'replaceState']({},'',url);
    }
    function clearList(){rows.replaceChildren();loaded=false;q('[data-customers-count]').textContent='';for(const node of root.querySelectorAll('[data-customers-total]'))node.textContent='—';message('[data-customers-unassigned]','');}
    function readUrl(){const url=new URL(location.href);setFilters(Object.fromEntries(fields.map(field=>[field,url.searchParams.get(field)])));filters=formFilters();cursor=url.searchParams.get('cursor');next=null;previous=null;clearList();resetExport();return url.searchParams.get('customer');}
    function closeDetail(update=true){detailVersion++;selected='';detail.hidden=true;q('[data-customers-detail-content]').replaceChildren();rows.querySelectorAll('[data-customer-open]').forEach(n=>n.setAttribute('aria-expanded','false'));if(update)urlUpdate();}
    function renderRows(items){
      rows.replaceChildren();
      for(const item of items){
        const row=el('tr'),contact=el('td'),open=button(item.name||'Customer',()=>void loadDetail(item.id,true));open.className='order-link';open.dataset.customerOpen=item.id;open.setAttribute('aria-controls','commerce-customer-detail');open.setAttribute('aria-expanded',String(selected===item.id));
        contact.append(open,el('small',item.email),el('small',item.phone));const location=el('td',item.location||'Not recorded'),tags=el('div',undefined,'commerce-customer-tags');for(const tag of item.tags)tags.append(el('span',tag));location.append(tags);
        const orders=el('td');orders.append(el('b',item.orders+(item.orders===1?' order':' orders')),el('small',item.paidOrders+' verified paid'));
        const spend=el('td');spend.append(el('b',money(item.gross)));if(BigInt(item.additional)>0n)spend.append(el('small',money(item.additional)+' additional'));
        row.append(contact,location,orders,spend,el('td',date(item.lastAt)));rows.append(row);
      }
    }
    async function loadList({reset=false,apply=false,push=false,targetCursor=cursor}={}){
      const version=++listVersion;
      if(reset){if(apply)filters=formFilters();cursor=null;targetCursor=null;next=null;previous=null;clearList();resetExport();}
      loading=true;controls();message('[data-customers-list-status]',loaded?'Updating customers…':'Loading customers…');
      const query=new URLSearchParams({limit:'25'});for(const field of fields)if(filters[field])query.set(field,filters[field]);if(targetCursor)query.set('cursor',targetCursor);
      try{
        const data=await api(base+'?'+query);if(version!==listVersion)return;
        if(!Array.isArray(data.items)||!data.summary||typeof data.pageCursor!=='string'||typeof data.cohort!=='string')throw Error('The customer response was incomplete.');
        for(const node of root.querySelectorAll('[data-customers-total]')){const name=node.dataset.customersTotal,isMoney=['gross','average'].includes(name);node.textContent=isMoney?money(data.summary[name]):data.summary[name].toLocaleString();if(isMoney)node.closest('article').dataset.wideMoney=String(String(data.summary[name]||'').length>12);}
        message('[data-customers-unassigned]',data.summary.unassignedOrders?`${data.summary.unassignedOrders} orders are not linked to a customer profile and are excluded from these customer totals.`:'');
        message('[data-customers-availability]',data.enabled&&root.dataset.preview!=='1'?'':'Order processing is not enabled for this store yet.');
        canEdit=data.canEdit;next=data.nextCursor;previous=data.previousCursor;cursor=data.pageCursor;cohort=data.cohort;renderRows(data.items);loaded=true;
        q('[data-customers-count]').textContent=`${data.items.length} shown · ${data.matching.toLocaleString()} matching customers`;
        message('[data-customers-list-status]',data.items.length?'':data.matching===0?'No customers match these filters.':'No more profiles in this view. Refresh to include changes.');urlUpdate(push);
      }catch(error){if(version===listVersion)message('[data-customers-list-status]',(error.message||'Customers could not be loaded.')+' Use Refresh customers to try again.'+(loaded?' Previously loaded customers are still shown.':''));}
      finally{if(version===listVersion){loading=false;controls();}}
    }
    function card(title,lines){const node=el('article',undefined,'commerce-order-card');node.append(el('h3',title));for(const line of lines)if(line)node.append(el('p',line));return node;}
    function orderLink(id){const link=el('a',id,'order-link'),query=new URLSearchParams({page:'orders',order:id});if(root.dataset.preview==='1')query.set('order-preview','1');link.href='?'+query;return link;}
    function historySection(title,id,kind,data,version){
      const section=el(kind==='changes'?'details':'section',undefined,kind==='changes'?'commerce-customer-history':''),list=el('ol',undefined,'commerce-order-history');section.dataset.customerHistory=kind;
      section.append(el(kind==='changes'?'summary':'h3',title),list);
      let nextCursor=data?.nextCursor,busy=false,started=!!data;
      const append=items=>{for(const item of items){const row=el('li');if(kind==='orders')row.append(orderLink(item.id),el('small',`${item.state.replaceAll('_',' ')} · Order total ${money(item.total)} · Verified ${money(item.confirmed)}`),el('time',date(item.createdAt)));
        else row.append(el('b',`Revision ${item.revision} · ${item.byYou?'You':item.actor}`),el('time',date(item.createdAt)),el('small',item.note||'No private note'),el('small',item.tags.length?'Tags: '+item.tags.join(', '):'No tags'));
        list.append(row);
      }};
      if(data)append(data.items);
      const status=el('p','', 'commerce-customer-muted');status.setAttribute('role','status');
      const more=button('Load older entries',()=>void load());more.hidden=!!data&&!nextCursor;
      async function load(){if(busy||version!==detailVersion||(started&&!nextCursor))return;busy=true;more.disabled=true;status.textContent='Loading history…';
        try{const response=await api(base+'/'+id+'/'+kind+'?'+new URLSearchParams({limit:'20',...(nextCursor?{cursor:nextCursor}:{})}));if(version!==detailVersion)return;if(!Array.isArray(response.items))throw Error('History was incomplete.');append(response.items);nextCursor=response.nextCursor;started=true;more.hidden=!nextCursor;status.textContent=list.children.length?'':'No saved changes yet.';}
        catch(error){if(version===detailVersion)status.textContent=(error.message||'History could not be loaded.')+' Try Load older entries again.';}
        finally{busy=false;more.disabled=false;}
      }
      if(kind==='changes')section.addEventListener('toggle',()=>{if(section.open&&!started)void load();});section.append(status,more);return section;
    }
    function profileEditor(customer,editable,version,rebase){
      const form=el('form'),fieldset=el('fieldset',undefined,'commerce-customer-editor'),draft=drafts.get(customer.id);
      if(draft&&rebase){draft.revision=customer.profile.revision;draft.pending=null;}
      const current=draft||{note:customer.profile.note,tags:customer.profile.tags.join('\n'),revision:customer.profile.revision,pending:null};
      const note=el('textarea'),tags=el('textarea');note.name='note';note.rows=5;note.maxLength=2000;note.value=current.note;tags.name='tags';tags.rows=2;tags.value=current.tags;tags.maxLength=329;
      for(const [name,node] of [['Private note',note],['Tags, one per line',tags]]){const label=el('label');label.append(el('span',name),node);fieldset.append(label);}
      fieldset.append(el('small','Notes are visible to your store team. Use up to 10 tags, 32 characters each.'));
      const status=el('p',draft&&rebase?'Saved version reloaded. Your draft was kept; review it before saving.':'','commerce-customer-muted');status.setAttribute('role','status');status.dataset.customerSaveStatus='';
      const save=el('button','Save note and tags','ui-button primary');save.type='submit';fieldset.append(save,status);fieldset.disabled=!editable;form.append(el('h3','Store notes and tags'));
      if(draft&&rebase)form.append(card('Current saved version',[customer.profile.note||'No private note','Tags: '+(customer.profile.tags.join(', ')||'None')]));form.append(fieldset);
      if(!editable)form.append(el('p','Your account can view this profile but cannot change it.','commerce-customer-muted'));
      const remember=()=>{current.note=note.value;current.tags=tags.value;current.pending=null;
        if(current.note===customer.profile.note&&current.tags===customer.profile.tags.join('\n'))drafts.delete(customer.id);else drafts.set(customer.id,current);
      };
      note.addEventListener('input',remember);tags.addEventListener('input',remember);
      form.addEventListener('submit',async event=>{event.preventDefault();if(fieldset.disabled)return;
        current.pending||={revision:current.revision,requestKey:key(),note:note.value,tags:tags.value.split('\n').map(t=>t.trim()).filter(Boolean)};
        drafts.set(customer.id,current);const payload=current.pending;fieldset.disabled=true;status.textContent='Saving…';
        try{await write('PUT',base+'/'+customer.id+'/profile',payload);if(drafts.get(customer.id)?.pending===payload)drafts.delete(customer.id);
          if(version!==detailVersion)return;const refreshed=detailVersion+1,ready=await loadDetail(customer.id,false,false);if(ready&&detailVersion===refreshed&&selected===customer.id)message('[data-customers-detail-status]','Saved. Showing the current profile.');void loadList();
        }catch(error){if(version===detailVersion)status.textContent=(error.message||'The profile could not be saved.')+' Your draft is kept. Retry the save, or reload the saved profile to review a conflict.';}
        finally{fieldset.disabled=!editable;}
      });
      return form;
    }
    async function loadDetail(id,focus=false,rebase=false){
      if(!customerId.test(id||''))return;const version=++detailVersion;selected=id;detail.hidden=false;q('[data-customers-detail-content]').replaceChildren();q('#commerce-customer-detail-title').textContent='Customer profile';q('[data-customers-reference]').textContent=id;message('[data-customers-detail-status]','Loading profile…');urlUpdate(focus);
      rows.querySelectorAll('[data-customer-open]').forEach(n=>n.setAttribute('aria-expanded',String(n.dataset.customerOpen===id)));
      if(focus){q('#commerce-customer-detail-title').focus({preventScroll:true});detail.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}
      try{const data=await api(base+'/'+id);if(version!==detailVersion)return;const c=data.customer;if(!c||!c.profile||!Array.isArray(data.orders?.items))throw Error('The profile response was incomplete.');
        const content=q('[data-customers-detail-content]'),columns=el('div',undefined,'commerce-order-columns');q('#commerce-customer-detail-title').textContent=c.name||'Customer profile';
        columns.append(card('Latest checkout contact',[c.name,c.email,c.phone]),card('Latest delivery address',[c.address.address,c.address.location,c.address.postalCode||(!c.address.address?'No delivery address recorded.':'')]),card('Customer history',['First order '+date(c.firstAt),'Last order '+date(c.lastAt),c.orders+(c.orders===1?' order':' orders')+' · '+c.paidOrders+' verified paid']));content.append(columns);
        const totals=el('dl',undefined,'commerce-order-totals');for(const [name,amount] of [['Verified customer value',c.gross],['Additional payments',c.additional]]){const row=el('div');if(String(amount).length>12)row.dataset.wideMoney='true';row.append(el('dt',name),el('dd',money(amount)));totals.append(row);}content.append(totals);
        content.append(el('p','Marketing consent is not recorded. A checkout email or phone number is not permission to send promotions.','commerce-customer-muted'),profileEditor(c,data.canEdit,version,rebase),historySection('Purchase history',id,'orders',data.orders,version),historySection('Note and tag history',id,'changes',null,version));message('[data-customers-detail-status]','');return true;
      }catch(error){if(version===detailVersion){q('[data-customers-detail-content]').replaceChildren();message('[data-customers-detail-status]',(error.message||'The profile could not be loaded.')+' Use Reload saved profile to try again.');}}
    }
    function closeSegment(){editorVersion++;editor=null;q('[data-customers-segment-editor]').hidden=true;}
    function openSegment(segment=null){
      editorVersion++;editor={id:segment?.id||'',revision:segment?.revision||0,name:segment?.name||'',filters:{...(segment?.filters||filters)},archived:segment?.archived||false,pending:null};
      const section=q('[data-customers-segment-editor]');section.hidden=false;q('[data-customers-segment-form]').elements.name.value=editor.name;
      q('[data-customers-segment-form]').elements.name.disabled=false;q('[data-customers-segment-form] [type=submit]').disabled=false;
      q('[data-customers-segment-filters]').disabled=!loaded||loading;q('[data-customers-segment-cancel]').disabled=false;
      q('#commerce-segment-editor-title').textContent=segment?'Edit customer segment':'Save customer segment';q('[data-customers-segment-rules]').textContent=rules(editor.filters);message('[data-customers-segment-status]','');
      q('#commerce-segment-editor-title').focus({preventScroll:true});section.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
    }
    function renderSegment(item,editable){
      const card=el('article');card.dataset.customerSegment=item.id;card.append(el('h3',item.name),el('p',rules(item.filters),'commerce-customer-muted'));
      const actions=el('div',undefined,'commerce-order-buttons');actions.append(button('View customers',()=>{setFilters(item.filters);closeDetail(false);void loadList({reset:true,apply:true,push:true});q('#commerce-customer-list-title').scrollIntoView({block:'center',behavior:'instant'});}));
      const edit=button('Edit segment',async()=>{const version=++editorVersion;edit.disabled=true;try{const data=await api(base+'/segments/'+item.id);if(version===editorVersion)openSegment(data.segment);}catch(error){status.textContent=error.message||'Segment could not be loaded.';}finally{edit.disabled=!editable;}});edit.disabled=!editable;actions.append(edit);
      const status=el('p','','commerce-customer-muted');status.setAttribute('role','status');let pending=null;
      const archive=button(item.archived?'Restore':'Archive',async()=>{
        archive.disabled=true;pending||={requestKey:key(),revision:item.revision,name:item.name,filters:item.filters,archived:!item.archived};status.textContent='Saving segment…';
        try{await write('PUT',base+'/segments/'+item.id,pending);void loadSegments();}
        catch(error){status.textContent=(error.message||'Segment could not be saved.')+' Retry, or reload segments to review a conflict.';archive.disabled=!editable;}
      });archive.disabled=!editable;actions.append(archive);card.append(actions,status);return card;
    }
    async function loadSegments(more=false){
      if(more&&(segmentsBusy||!segmentsNext))return;
      const version=++segmentVersion,query=new URLSearchParams({state:q('[data-customers-segment-state]').value,limit:'25'});
      if(more)query.set('cursor',segmentsNext);else{segmentsNext=null;q('[data-customers-segments]').replaceChildren();q('[data-customers-segments-more]').hidden=true;}
      segmentsBusy=true;q('[data-customers-segments-more]').disabled=true;message('[data-customers-segments-status]','Loading saved segments…');
      try{const data=await api(base+'/segments?'+query);if(version!==segmentVersion)return;if(!Array.isArray(data.items))throw Error('Segments were incomplete.');
        for(const item of data.items)q('[data-customers-segments]').append(renderSegment(item,data.canEdit));segmentsNext=data.nextCursor;q('[data-customers-segments-more]').hidden=!segmentsNext;
        message('[data-customers-segments-status]',q('[data-customers-segments]').children.length?'':'No '+q('[data-customers-segment-state]').value+' segments. Save directory filters to create a group.');
      }catch(error){if(version===segmentVersion)message('[data-customers-segments-status]',(error.message||'Segments could not be loaded.')+' Use Reload segments to try again.');}
      finally{if(version===segmentVersion){segmentsBusy=false;q('[data-customers-segments-more]').disabled=false;}}
    }
    q('[data-customers-segment-form]').addEventListener('submit',async event=>{
      event.preventDefault();if(!editor||!canEdit)return;const active=editor,version=editorVersion,name=event.currentTarget.elements.name.value.trim();
      if(active.pending?.name!==name)active.pending=null;active.pending||={revision:active.revision,requestKey:key(),name,filters:active.filters,archived:active.archived};
      const submit=event.currentTarget.querySelector('[type=submit]'),nameInput=event.currentTarget.elements.name;if(submit.disabled)return;submit.disabled=true;nameInput.disabled=true;q('[data-customers-segment-filters]').disabled=true;q('[data-customers-segment-cancel]').disabled=true;message('[data-customers-segment-status]','Saving segment…');
      try{await write(active.id?'PUT':'POST',base+'/segments'+(active.id?'/'+active.id:''),active.pending);if(version!==editorVersion)return;closeSegment();void loadSegments();}
      catch(error){if(version===editorVersion)message('[data-customers-segment-status]',(error.message||'Segment could not be saved.')+' Your name and filters are kept. Retry, or cancel and reopen the saved segment to review a conflict.');}
      finally{if(version===editorVersion){submit.disabled=false;nameInput.disabled=false;q('[data-customers-segment-filters]').disabled=!loaded||loading;q('[data-customers-segment-cancel]').disabled=false;}}
    });
    q('[data-customers-export]').addEventListener('click',async()=>{
      if(exportBusy||!loaded)return;const version=exportVersion;exportBusy=true;controls();message('[data-customers-export-status]','Preparing matching customer profiles…');
      exportInput||={requestKey:key(),filters:{...filters},cohort};
      try{
        if(!exportSnapshot){const data=await write('POST',base+'/exports',exportInput);if(version!==exportVersion)return;exportSnapshot=data.export;}
        const snapshot=exportSnapshot;if(!snapshot||!/^cex_[a-f0-9]{40}$/.test(snapshot.id)||!Number.isSafeInteger(snapshot.rowCount)||snapshot.rowCount<0||!Array.isArray(snapshot.headers))throw Error('The export receipt was incomplete. Retry the download.');
        const parts=['\uFEFF',csvRow(['Customer export','Ezkart']),csvRow(['Snapshot created (UTC)',snapshot.createdAt]),csvRow(['Filters',rules(snapshot.filters)]),csvRow(['Currency','IDR']),'\r\n',csvRow(snapshot.headers)];let after=0;
        do{const data=await api(base+'/exports/'+snapshot.id+'?after='+after+'&limit=500');if(version!==exportVersion)return;
          if(data.export?.id!==snapshot.id||data.export?.rowCount!==snapshot.rowCount||!Array.isArray(data.rows)||data.rows.some((r,i)=>r.ordinal!==after+i+1||!Array.isArray(r.cells)))throw Error('The export was incomplete. Retry the download.');
          for(const row of data.rows)parts.push(csvRow(row.cells));after+=data.rows.length;
          if(after>snapshot.rowCount||(data.nextAfter!==null&&(data.nextAfter!==after||!data.rows.length))||(data.nextAfter===null&&after!==snapshot.rowCount))throw Error('The export was incomplete. Retry the download.');
          message('[data-customers-export-status]',`Preparing ${after.toLocaleString()} of ${snapshot.rowCount.toLocaleString()} customers…`);
        }while(after<snapshot.rowCount);
        const href=URL.createObjectURL(new Blob(parts,{type:'text/csv;charset=utf-8'})),link=el('a');link.href=href;link.download=snapshot.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);
        q('[data-customers-export]').textContent='Download customer export again';message('[data-customers-export-status]',`Downloaded ${snapshot.rowCount.toLocaleString()} customers from the ${date(snapshot.createdAt)} snapshot. Refresh customers for a new export.`);
      }catch(error){if(version===exportVersion){q('[data-customers-export]').textContent='Retry customer export';message('[data-customers-export-status]',(error.message||'The export could not be downloaded.')+' No partial file was saved.');}}
      finally{if(version===exportVersion){exportBusy=false;controls();}}
    });
    form.addEventListener('submit',event=>{event.preventDefault();if(globalSearch)globalSearch.value=form.elements.q.value;closeDetail(false);void loadList({reset:true,apply:true,push:true});});
    q('[data-customers-clear]').addEventListener('click',()=>{setFilters();closeDetail(false);void loadList({reset:true,apply:true,push:true});});
    q('[data-customers-refresh]').addEventListener('click',()=>{void loadList({reset:true});if(selected)void loadDetail(selected);});
    q('[data-customers-next]').addEventListener('click',()=>{if(!loading&&next)void loadList({targetCursor:next,push:true});});
    q('[data-customers-previous]').addEventListener('click',()=>{if(!loading&&previous)void loadList({targetCursor:previous,push:true});});
    q('[data-customers-detail-close]').addEventListener('click',()=>{const id=selected;closeDetail();(rows.querySelector(`[data-customer-open="${id}"]`)||q('[data-customers-refresh]')).focus();});
    q('[data-customers-detail-reload]').addEventListener('click',()=>void loadDetail(selected,false,true));
    q('[data-customers-create-segment]').addEventListener('click',()=>openSegment());q('[data-customers-segment-cancel]').addEventListener('click',()=>closeSegment());
    q('[data-customers-segment-filters]').addEventListener('click',()=>{if(!editor||!loaded||loading)return;editor.filters={...filters};editor.pending=null;q('[data-customers-segment-rules]').textContent=rules(editor.filters);message('[data-customers-segment-status]','Directory filters copied. Save the segment to keep these rules.');});
    q('[data-customers-segments-refresh]').addEventListener('click',()=>void loadSegments());q('[data-customers-segment-state]').addEventListener('change',()=>void loadSegments());q('[data-customers-segments-more]').addEventListener('click',()=>void loadSegments(true));
    for(const node of root.querySelectorAll('[data-customers-group]'))node.addEventListener('click',()=>{setFilters({activity:node.dataset.customersGroup});closeDetail(false);void loadList({reset:true,apply:true,push:true});});
    addEventListener('popstate',()=>{closeDetail(false);const id=readUrl();void loadList();if(customerId.test(id||''))void loadDetail(id);});
    addEventListener('beforeunload',event=>{if(drafts.size){event.preventDefault();event.returnValue='';}});
    const id=readUrl();if(globalSearch){globalSearch.placeholder='Search customers · press Enter';globalSearch.value=form.elements.q.value;globalSearch.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();form.elements.q.value=globalSearch.value;form.requestSubmit();}});}
    void loadList();void loadSegments();if(customerId.test(id||''))void loadDetail(id);
  }
  globalThis.EzkartCommerceCustomers={mount};
})();
