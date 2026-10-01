/* Publication timing uses an explicit saved snapshot and preserved requests. */
(() => {
  const t = text => globalThis.EzkartLanguage?.t(text) || text;
  const localDate = date => new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const parseTime = value => {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) throw Error(t('Choose a valid publication date.'));
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || localDate(date) !== value) throw Error(t('Choose a valid publication date.'));
    if (date.getTime() < Date.now()+60000 || date.getTime() > Date.now()+366*86400000) throw Error(t('Choose a time at least one minute ahead and within 366 days.'));
    return date.toISOString();
  };
  const mount = ({root,getPage,prepare,request,accept}) => {
    const button = root.querySelector('[data-sq-schedule]');
    if (!button) return;
    const dialog = document.createElement('dialog'); dialog.className='sq-favicon-dialog';
    dialog.setAttribute('aria-labelledby','sq-schedule-title'); dialog.dataset.sqScheduleDialog='';
    dialog.innerHTML = `<header><div><h2 id="sq-schedule-title">${t('Schedule publication')}</h2><p data-schedule-summary></p></div><button type="button" data-schedule-close aria-label="${t('Close schedule')}">×</button></header>
      <div class="sq-favicon-dialog-body"><p data-schedule-version></p><label><span>${t('Publication time')}</span><input type="datetime-local" data-schedule-time required style="width:100%;min-height:44px"></label><p><strong>${t('Timezone')}: </strong><span data-schedule-zone></span></p><p>${t('Publication starts at or after this time. Processing or service delays can postpone it.')}</p><p data-schedule-message role="status" aria-live="polite"></p></div>
      <footer style="flex-wrap:wrap"><button class="ui-button" type="button" data-schedule-refresh data-ui-icon="refresh">${t('Refresh schedule')}</button><button class="ui-button" type="button" data-schedule-cancel data-ui-icon="x">${t('Cancel schedule')}</button><button class="ui-button" type="button" data-schedule-move data-ui-icon="calendar">${t('Change time')}</button><button class="ui-button primary" type="button" data-schedule-create data-ui-icon="calendar">${t('Schedule this version')}</button><button class="ui-button primary" type="button" data-schedule-retry data-ui-icon="refresh" hidden>${t('Retry original request')}</button></footer>`;
    document.body.append(dialog);
    const q = selector => dialog.querySelector(selector);
    const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    let busy=false,site='',pending=null,unreadable=false;
    const key = () => `ezkart-page-schedule:${document.body.dataset.adminStorageScope || 'account'}:${site}`;
    const message = text => { q('[data-schedule-message]').textContent=t(text); };
    const render = () => {
      const schedule=getPage()?.scheduledPublication;
      button.title=schedule?.status==='pending' ? new Date(schedule.at).toLocaleString(undefined,{timeZone:schedule.timezone})+' · '+schedule.timezone : t('Schedule publication');
      q('[data-schedule-summary]').textContent=schedule?.status==='pending' ? new Date(schedule.at).toLocaleString(undefined,{timeZone:schedule.timezone})+' · '+schedule.timezone : t(schedule?.status==='published'?'Scheduled version published':schedule?.status==='failed'?'Scheduled publication failed':'Schedule publication');
      q('[data-schedule-version]').textContent=(schedule?.sourceUpdatedAt ? t('Saved version')+': '+new Date(schedule.sourceUpdatedAt).toLocaleString()+' · ' : '')+t('Later draft edits stay private. To include them, replace the scheduled version.')+(schedule?.status==='pending' ? ' '+t('Changing the time keeps the same saved version.') : '');
      if(schedule?.error) message(schedule.error);
      const blocked=busy || Boolean(pending) || unreadable;
      q('[data-schedule-time]').disabled=blocked;
      for(const name of ['create','move','cancel','refresh']) q(`[data-schedule-${name}]`).disabled=blocked;
      q('[data-schedule-move]').hidden=schedule?.status!=='pending'; q('[data-schedule-cancel]').hidden=schedule?.status!=='pending';
      q('[data-schedule-retry]').hidden=!pending; q('[data-schedule-retry]').disabled=busy;
      q('[data-schedule-close]').disabled=busy;
      if(pending) message(t('Schedule request needs confirmation. Retry the original request before making another change.'));
      if(unreadable) message(t('Saved schedule recovery data could not be read. Keep it and reload before continuing.'));
    };
    const clearPending = () => { sessionStorage.removeItem(key()); pending=null; };
    const receiptMatches = page => {
      const receipt=page?.scheduleReceipt;
      if(page?.id!==site || receipt?.requestId!==pending?.requestId || receipt?.action!==pending?.action) return false;
      if(pending.action==='cancel') return receipt.schedule===null;
      return receipt.schedule?.id===pending.requestId && receipt.schedule?.at===pending.at && receipt.schedule?.timezone===pending.timezone && (pending.action!=='create' || receipt.schedule?.sourceUpdatedAt===pending.sourceUpdatedAt);
    };
    const send = async () => {
      const originalSite=site;
      try {
        let result;
        try { result=await request('POST',`/v1/landing-pages/${site}/schedule`,pending); }
        catch(error) {
          // Unknown acknowledgements are reads first, never a new publication.
          try { result=await request('GET',`/v1/landing-pages/${site}/editor`); } catch {}
          if(!receiptMatches(result?.page)) {
            if([400,404,422].includes(error.status) || (error.status===409 && /^(Your page changed\.|The schedule changed or has already started\.)/.test(error.message))) clearPending();
            throw error;
          }
        }
        if(!receiptMatches(result?.page)) throw Error(t('Schedule request needs confirmation. Retry the original request before making another change.'));
        clearPending();
        if(getPage()?.id!==originalSite) return;
        accept(result.page);
        message(t(result.page.scheduleReceipt.action==='cancel'?'Schedule cancelled':'Publication scheduled'));
      } catch(error) { if(site===originalSite) message(error.message); }
    };
    const act = async action => {
      if(busy || unreadable || (pending && action!=='retry')) return;
      busy=true; render();
      try {
        if(action!=='retry') {
          const expected=getPage();
          const at=action==='cancel'?null:parseTime(q('[data-schedule-time]').value);
          const prepared=action==='create'?await prepare():{sourceUpdatedAt:expected.updatedAt};
          if(getPage()?.id!==site) throw Error(t('Your page changed. Reload its saved version before changing the schedule.'));
          const intent={requestId:crypto.randomUUID(),action,sourceUpdatedAt:prepared.sourceUpdatedAt,...(action==='cancel'?{}:{at,timezone}),...(action==='create'?{html:prepared.html}:{scheduleId:expected.scheduledPublication?.id})};
          try { sessionStorage.setItem(key(),JSON.stringify(intent)); } catch { throw Error(t('The schedule request could not be preserved. No new schedule was sent.')); } pending=intent;
        }
        await send();
      } catch(error) { message(error.message); }
      finally { busy=false; render(); }
    };
    button.addEventListener('click',()=>{
      if(!getPage())return;
      site=getPage().id; pending=null; unreadable=false;
      try { const saved=sessionStorage.getItem(key()); if(saved){pending=JSON.parse(saved);if(!pending || Array.isArray(pending) || !/^[a-f0-9-]{36}$/.test(pending.requestId || '') || !['create','reschedule','cancel'].includes(pending.action) || !Number.isFinite(Date.parse(pending.sourceUpdatedAt)) || (pending.action!=='cancel' && (!Number.isFinite(Date.parse(pending.at)) || typeof pending.timezone!=='string')) || (pending.action==='create' && typeof pending.html!=='string') || (pending.action!=='create' && !/^[a-f0-9-]{36}$/.test(pending.scheduleId || '')))throw Error();} } catch { unreadable=true; }
      q('[data-schedule-time]').value=localDate(new Date(getPage().scheduledPublication?.status==='pending'?getPage().scheduledPublication.at:Date.now()+3600000));
      q('[data-schedule-zone]').textContent=timezone; message('');render();dialog.showModal();
    });
    q('[data-schedule-create]').onclick=()=>act('create'); q('[data-schedule-move]').onclick=()=>act('reschedule'); q('[data-schedule-cancel]').onclick=()=>act('cancel'); q('[data-schedule-retry]').onclick=()=>act('retry');
    q('[data-schedule-refresh]').onclick=async()=>{
      if(busy)return;busy=true;render();
      try { const result=await request('GET',`/v1/landing-pages/${site}/editor`);if(getPage()?.id===site)accept(result.page);message(''); }
      catch(error){message(error.message);}finally{busy=false;render();}
    };
    q('[data-schedule-close]').onclick=()=>{if(!busy)dialog.close();}; dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    return {refresh:render};
  };
  globalThis.EzkartPageSchedule=Object.freeze({mount,parseTime});
})();
