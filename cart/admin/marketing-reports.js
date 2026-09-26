(() => {
  'use strict';
  window.EzkartCampaignReports=(root,host)=>{
    const panel=root.querySelector('[data-campaign-reports]'),q=s=>panel.querySelector(s),form=q('form'),status=q('[data-report-status]'),exportStatus=q('[data-report-export-status]');
    const labels={recipients:'Recipients',submitted:'Submitted',delivered:'Delivered',queued:'Queued',sending:'Sending',retry:'Retry scheduled',cancelled:'Cancelled recipients',notSent:'Not sent',unconfirmed:'Unconfirmed submissions',needsReview:'Needs review',delayed:'Delivery delayed',failed:'Delivery failed',bounced:'Bounced',complained:'Complaints',suppressed:'Suppressed',unsubscribed:'Unsubscribed through this email'};
    const headers=['Publication ID','Campaign ID','Campaign','Subject','Published (UTC)','Scheduled send (UTC)','Campaign cancelled',...Object.values(labels)];
    const integer=n=>Number.isSafeInteger(n)&&n>=0,token=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,1600}$/.test(s),key=s=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
    const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&host.iso(s+'T00:00:00.000Z');
    const clone=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),count=n=>n.toLocaleString('en-GB'),plural=(n,word)=>count(n)+' '+word+(n===1?'':'s');
    const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
    const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
    const period=p=>host.exactKeys(p,['range','from','to','timeZone','group','previousFrom','previousTo'])&&['7','30','90','180','all','custom'].includes(p.range)
      &&day(p.from)&&day(p.to)&&p.from<=p.to&&['Asia/Jakarta','Asia/Makassar','Asia/Jayapura'].includes(p.timeZone)&&['daily','weekly','monthly','yearly'].includes(p.group)
      &&(p.range==='all'?p.previousFrom===null&&p.previousTo===null:day(p.previousFrom)&&day(p.previousTo)&&p.previousFrom<=p.previousTo&&p.previousTo<p.from);
    const totals=(v,aggregate=false)=>host.exactKeys(v,[...Object.keys(labels),...(aggregate?['campaigns']:[])])&&Object.values(v).every(integer)
      &&Object.keys(labels).every(k=>k==='recipients'||v[k]<=v.recipients);
    const validRow=v=>host.exactKeys(v,['id','campaignId','name','subject','publishedAt','scheduledAt','cancelled','totals'])&&/^cpub_[a-f0-9]{32}$/.test(v.id)&&/^cmp_[a-f0-9]{32}$/.test(v.campaignId)
      &&typeof v.name==='string'&&v.name.length<=120&&typeof v.subject==='string'&&v.subject.length<=160&&host.iso(v.publishedAt)&&host.iso(v.scheduledAt)&&typeof v.cancelled==='boolean'&&totals(v.totals);
    let environment=null,scope=null,dead=false,version=0,busy=false,data=null,items=[],params=null,pending=null,exportBusy=false,storageLoaded=false,storageError='',loadError=false,failedReplace=true;
    const alive=()=>!dead&&host.alive(),selected=()=>{const p={range:form.elements.range.value};if(p.range==='custom'){p.from=form.elements.from.value;p.to=form.elements.to.value;}return p;};
    const dirty=()=>!same(selected(),params),stamp=(v,zone)=>new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:zone}).format(new Date(v));
    function cohort(value){
      if(!token(value))throw Error('The report reference could not be verified.');
      const c=JSON.parse(atob(value.replaceAll('-','+').replaceAll('_','/')));
      if(!host.exactKeys(c,['v','scope','cap','at','range','from','to','timeZone'])||c.v!==1||!integer(c.cap)||!host.iso(c.at)||typeof c.scope!=='string'||!/^[a-f0-9]{64}$/.test(c.scope)||!day(c.from)||!day(c.to)||c.from>c.to||!['7','30','90','180','all','custom'].includes(c.range)||!['Asia/Jakarta','Asia/Makassar','Asia/Jayapura'].includes(c.timeZone))throw Error('The report reference could not be verified.');
      return c;
    }
    function matchesPeriod(p,c){return ['range','from','to','timeZone'].every(k=>p[k]===c[k]);}
    function validReport(r,original){
      if(r.storeId!==host.store||r.environment!==environment||!token(r.cohort)||!period(r.period)||!host.iso(r.publicationCutoff)||!host.iso(r.observedAt)
        ||!totals(r.totals,true)||(r.period.range==='all'?r.previous!==null:!totals(r.previous,true))||!Array.isArray(r.series)||!r.series.every(s=>host.exactKeys(s,['date','totals'])&&day(s.date)&&totals(s.totals,true))
        ||!Array.isArray(r.items)||r.items.length>20||!r.items.every(validRow)||(r.nextCursor!==null&&!token(r.nextCursor))||r.nextCursor&&!r.items.length)throw Error('The campaign report could not be verified. Refresh the report.');
      const c=cohort(r.cohort);if(!matchesPeriod(r.period,c)||r.publicationCutoff!==c.at||original&&r.cohort!==original)throw Error('The campaign report reference changed. Refresh the report.');
      if(new Set(r.items.map(x=>x.id)).size!==r.items.length)throw Error('The campaign report contains a repeated row. Refresh the report.');
    }
    function validReceipt(r,request){
      return host.exactKeys(r,['id','storeId','environment','requestKey','cohort','period','createdAt','expiresAt','rowCount','headers','filename'])&&/^crex_[a-f0-9]{32}$/.test(r.id)
        &&r.storeId===host.store&&r.environment===environment&&r.requestKey===request.requestKey&&r.cohort===request.cohort&&period(r.period)&&matchesPeriod(r.period,cohort(request.cohort))
        &&host.iso(r.createdAt)&&host.iso(r.expiresAt)&&Date.parse(r.expiresAt)-Date.parse(r.createdAt)===86400000&&integer(r.rowCount)&&same(r.headers,headers)
        &&r.filename===`ezkart-campaign-delivery-${r.period.from}-${r.period.to}.csv`;
    }
    function restore(){
      let raw;try{raw=sessionStorage.getItem(scope);}catch{throw Error('Allow session storage, then retry browser storage before exporting.');}
      if(!raw){pending=null;storageLoaded=true;storageError='';return;}
      try{
        const p=JSON.parse(raw);
        if(!host.exactKeys(p,['version','account','store','environment','request','receipt','complete','expired'])||p.version!==1||p.account!==host.account||p.store!==host.store||p.environment!==environment
          ||!host.exactKeys(p.request,['cohort','requestKey'])||!key(p.request.requestKey)||!token(p.request.cohort)||typeof p.complete!=='boolean'||typeof p.expired!=='boolean'
          ||p.receipt!==null&&!validReceipt(p.receipt,p.request)||p.complete&&p.receipt===null)throw Error();cohort(p.request.cohort);
        pending=p;storageLoaded=true;storageError='';
      }catch{throw Error('The saved export reference could not be verified. Its browser record has been kept. Check that record before retrying browser storage.');}
    }
    function persist(){
      if(!storageLoaded||!alive())return false;
      try{const text=JSON.stringify(pending);sessionStorage.setItem(scope,text);if(sessionStorage.getItem(scope)!==text)throw Error();storageError='';return true;}
      catch{storageError='This browser could not preserve the export reference. Allow session storage, then retry browser storage. Keep this tab open.';return false;}
    }
    function controls(){
      if(!alive())return;
      const custom=form.elements.range.value==='custom';for(const n of panel.querySelectorAll('[data-report-custom]'))n.hidden=!custom;
      form.elements.from.required=custom;form.elements.to.required=custom;
      q('[data-report-pending-filters]').hidden=!data||!dirty();q('[data-report-refresh]').disabled=!environment||busy;
      q('[data-report-more]').hidden=!data?.nextCursor;q('[data-report-more]').disabled=busy;q('[data-report-retry]').hidden=!loadError;
      const download=q('[data-report-export]');download.disabled=!environment||exportBusy||Boolean(storageError)||Boolean(pending?.expired)||(!pending&&(!data||busy||dirty()));
      download.textContent=exportBusy?'Preparing complete CSV…':pending?.expired?'Saved export expired':pending?.complete?'Download saved CSV again':pending?'Retry original export':'Export complete CSV';
      q('[data-report-new-export]').hidden=!pending?.complete&&!pending?.expired;q('[data-report-new-export]').disabled=exportBusy||Boolean(storageError)||!data||busy||dirty();
      q('[data-report-storage]').hidden=!storageError;q('[data-report-storage]').textContent=storageError;q('[data-report-storage-retry]').hidden=!storageError;
      q('[data-report-storage-retry]').disabled=exportBusy;
      if(pending){const c=cohort(pending.request.cohort);q('[data-report-export-note]').textContent=`Saved export: ${c.from} to ${c.to} · ${c.timeZone}. `+(pending.expired?'This snapshot has expired. Create a fresh export from the report currently shown.':pending.receipt?'Captured '+stamp(pending.receipt.createdAt,c.timeZone)+'. The original snapshot remains available for 24 hours.':'Its result needs confirmation. Retry this original export to recover it.');}
      else q('[data-report-export-note]').textContent='Download every campaign in this reporting period. A saved snapshot can be recovered for 24 hours.';
    }
    function render(){
      const p=data.period;q('[data-report-content]').hidden=false;
      q('[data-report-period]').textContent=`Published ${p.from} to ${p.to} · ${p.timeZone} · ${plural(data.totals.campaigns,'campaign')} · ${plural(data.totals.recipients,'recipient')} across those campaigns.`;
      q('[data-report-observed]').textContent=`Outcomes checked ${stamp(data.observedAt,p.timeZone)}. `+(p.previousFrom?`Comparison: ${p.previousFrom} to ${p.previousTo}.`:'All available publication history.');
      const cards=q('[data-report-totals]'),all=q('[data-report-all-totals]');cards.replaceChildren();all.replaceChildren();
      for(const [k,label] of Object.entries(labels)){
        const card=el('article');card.dataset.reportMetric=k;card.append(el('span',k==='unsubscribed'?'Email unsubscribes':label),el('strong',count(data.totals[k])));
        const delta=data.previous?data.totals[k]-data.previous[k]:null;
        card.append(el('small',delta===null?'Across this period':`${delta>0?'+':''}${count(delta)} vs previous (${count(data.previous[k])})`));
        (['submitted','delivered','needsReview','unsubscribed'].includes(k)?cards:all).append(card);
      }
      const series=q('[data-report-series]');series.replaceChildren();
      const max=Math.max(1,...data.series.map(s=>s.totals.recipients));
      for(const s of data.series){const li=el('li'),label=el('span',s.date),track=el('span',undefined,'marketing-report-track'),recipients=el('span',undefined,'marketing-report-audience'),delivered=el('span',undefined,'marketing-report-delivered');
        recipients.style.width=(100*s.totals.recipients/max)+'%';delivered.style.width=(100*s.totals.delivered/max)+'%';track.setAttribute('aria-hidden','true');track.append(recipients,delivered);
        li.append(label,track,el('span',`${count(s.totals.delivered)} delivered / ${plural(s.totals.recipients,'recipient')}`));series.append(li);}
      q('[data-report-series-note]').textContent=data.series.length?`${p.group[0].toUpperCase()+p.group.slice(1)} groups by publication date. Light bars show recipients; dark bars show confirmed delivery. Outcomes can arrive after the publication date.`:'No published campaigns in this period.';
      renderRows();
    }
    function renderRows(){
      const body=q('tbody');body.replaceChildren();
      for(const item of items){const tr=el('tr'),cell=el('th');cell.scope='row';const button=el('button',item.name,'marketing-report-link');button.type='button';button.setAttribute('aria-label','Open campaign '+item.name);button.addEventListener('click',()=>void host.open(item.campaignId));
        cell.append(button,el('small',item.subject),el('small','Published '+stamp(item.publishedAt,data.period.timeZone)),el('small',(item.cancelled?'Cancelled · Scheduled ':'Scheduled ')+stamp(item.scheduledAt,data.period.timeZone)));tr.append(cell);
        for(const metric of ['recipients','submitted','delivered','needsReview','unsubscribed'])tr.append(el('td',count(item.totals[metric])));body.append(tr);}
      q('[data-report-table]').hidden=!items.length;q('[data-report-empty]').hidden=Boolean(items.length);
    }
    async function load(replace=true){
      if(!alive()||!environment||!replace&&(busy||!data?.nextCursor))return;
      const n=++version,selection=replace?selected():params,query=new URLSearchParams(replace?selection:{cohort:data.cohort,cursor:data.nextCursor}),original=replace?null:data.cohort;
      busy=true;loadError=false;status.textContent='Loading campaign report…';controls();
      try{
        const r=await host.api('/reports?'+query);if(!alive()||n!==version)return;validReport(r,original);
        if(replace&&(!Object.entries(selection).every(([k,v])=>r.period[k]===v)))throw Error('The reporting dates changed. Apply the filters again.');
        if(!replace&&r.items.some(x=>items.some(old=>old.id===x.id)))throw Error('The report page repeated a campaign. Refresh the report.');
        if(replace){data=r;params=clone(selection);items=[...r.items];render();}
        else{items.push(...r.items);data.nextCursor=r.nextCursor;renderRows();}
        status.textContent=items.length?`${count(items.length)} of ${plural(data.totals.campaigns,'campaign')} shown.`:'No published campaigns in this period.';
      }catch(error){if(alive()&&n===version){loadError=true;failedReplace=replace;status.textContent=error.message||'The report could not be loaded.';}}
      finally{if(alive()&&n===version){busy=false;controls();}}
    }
    function csvCell(value){let text=value==null?'':String(value);if(typeof value==='string'&&/^(?:[\p{White_Space}\p{Cf}\u0000-\u001f]*[=+@-]|[\t\r\n])/u.test(text.normalize('NFKC')))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
    const csvRow=cells=>cells.map(csvCell).join(',')+'\r\n';
    async function download(fresh=false){
      if(!alive()||!environment||exportBusy||storageError)return;
      if(!pending||fresh){
        if(!data||busy||dirty()||fresh&&!pending?.complete&&!pending?.expired)return;
        pending={version:1,account:host.account,store:host.store,environment,request:{cohort:data.cohort,requestKey:random()},receipt:null,complete:false,expired:false};
        if(!persist()){controls();return;}
      }
      if(pending.expired)return;const p=pending;exportBusy=true;exportStatus.textContent='Preparing your complete campaign report…';controls();
      try{
        if(!p.receipt){const result=await host.api('/report-exports',p.request);if(!alive())return;
          if(typeof result.replayed!=='boolean'||!validReceipt(result.export,p.request))throw Error('The export receipt could not be verified. Retry the original export.');
          p.receipt=result.export;if(!persist())throw Error(storageError);
        }
        const receipt=p.receipt,parts=['\uFEFF',csvRow(['Report','Campaign delivery and email permissions']),csvRow(['Store',host.store]),csvRow(['Environment',environment]),csvRow(['Publication dates ('+receipt.period.timeZone+')',receipt.period.from,receipt.period.to]),csvRow(['Outcomes captured (UTC)',receipt.createdAt]),csvRow(['Notes','Recipients are counted per campaign. Delivery and complaint totals may overlap. Link withdrawals are counted once per recipient per campaign.']), '\r\n',csvRow(headers)];
        let after=0;const seen=new Set();
        do{
          const page=await host.api('/report-exports/'+receipt.id+'?after='+after+'&limit=250');if(!alive())return;
          if(!validReceipt(page.export,p.request)||!same(page.export,receipt)||!Array.isArray(page.rows)||page.rows.length>250||page.rows.some((r,i)=>!host.exactKeys(r,['ordinal','cells'])||r.ordinal!==after+i+1||!Array.isArray(r.cells)||r.cells.length!==headers.length
            ||!/^cpub_[a-f0-9]{32}$/.test(r.cells[0])||!/^cmp_[a-f0-9]{32}$/.test(r.cells[1])||r.cells.slice(0,7).some(v=>typeof v!=='string')||!host.iso(r.cells[4])||!host.iso(r.cells[5])||!['Yes','No'].includes(r.cells[6])||!r.cells.slice(7).every(integer)||r.cells.slice(8).some(v=>v>r.cells[7])))throw Error('The export page could not be verified. Retry the original export.');
          for(const row of page.rows){if(seen.has(row.cells[0]))throw Error('The export repeated a campaign. Retry the original export.');seen.add(row.cells[0]);parts.push(csvRow(row.cells));}
          after+=page.rows.length;if(after>receipt.rowCount||(page.nextAfter===null?after!==receipt.rowCount:page.nextAfter!==after||!page.rows.length||after>=receipt.rowCount))throw Error('The export is incomplete. Retry the original export.');
          exportStatus.textContent=`Preparing ${count(after)} of ${plural(receipt.rowCount,'campaign')}…`;
        }while(after<receipt.rowCount);
        if(!alive())return;const href=URL.createObjectURL(new Blob(parts,{type:'text/csv;charset=utf-8'})),link=el('a');link.href=href;link.download=receipt.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);
        p.complete=true;persist();exportStatus.textContent=`Downloaded all ${plural(receipt.rowCount,'campaign')}. This saved snapshot is available for 24 hours.`;
      }catch(error){if(alive()){if(error.status===410){p.expired=true;persist();}exportStatus.textContent=(error.message||'The export could not be downloaded.')+' No partial file was saved.';}}
      finally{if(alive()){exportBusy=false;controls();}}
    }
    form.addEventListener('submit',event=>{event.preventDefault();void load();});form.addEventListener('change',controls);form.addEventListener('input',controls);
    q('[data-report-refresh]').addEventListener('click',()=>void load());q('[data-report-more]').addEventListener('click',()=>void load(false));
    q('[data-report-retry]').addEventListener('click',()=>void load(failedReplace));
    q('[data-report-export]').addEventListener('click',()=>void download());q('[data-report-new-export]').addEventListener('click',()=>void download(true));
    q('[data-report-storage-retry]').addEventListener('click',()=>{try{if(!storageLoaded)restore();if(pending)persist();else{sessionStorage.setItem(scope+'.check','1');sessionStorage.removeItem(scope+'.check');storageError='';}}catch(error){storageError=error.message;}controls();});
    return {configure(workspace){if(environment)return;environment=workspace.environment;scope=`ezkart.marketing.reports.v1:${host.account}:${host.store}:${environment}`;
        try{restore();}catch(error){storageError=error.message;}controls();void load();},stop(){dead=true;version++;},unprotected:()=>Boolean(pending&&storageError)};
  };
})();
