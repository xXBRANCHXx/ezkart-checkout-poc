(() => {
  'use strict';
  const zones={'Asia/Jakarta':'WIB','Asia/Makassar':'WITA','Asia/Jayapura':'WIT'};
  function preferences(){let saved={};try{saved=JSON.parse(document.body.dataset.adminDatePreferences||'{}');}catch{}
    return {timezone:Object.hasOwn(zones,saved.timezone)?saved.timezone:'Asia/Jakarta',dateFormat:['long','numeric','iso'].includes(saved.dateFormat)?saved.dateFormat:'long'};
  }
  function date(value,{time=true,calendar=false}={}){
    if(!value||!Number.isFinite(Date.parse(value)))return '—';
    const p=preferences(),zone=calendar?'UTC':p.timezone,instant=new Date(calendar&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00Z':value);
    const part=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(x=>[x.type,x.value]));
    let day=p.dateFormat==='iso'?`${part.year}-${part.month}-${part.day}`:p.dateFormat==='numeric'?`${part.day}/${part.month}/${part.year}`:new Intl.DateTimeFormat(document.body.dataset.adminLanguage==='id'?'id-ID':'en-GB',{dateStyle:'medium',timeZone:zone}).format(instant);
    return day+(time&&!calendar?` ${part.hour}:${part.minute} ${zones[p.timezone]}`:'');
  }
  window.EzkartAdminFormat={date,preferences,update:values=>{document.body.dataset.adminDatePreferences=JSON.stringify(values);document.dispatchEvent(new CustomEvent('ezkart:date-format-changed'));}};
})();
