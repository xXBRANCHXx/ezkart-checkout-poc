/* Shared structured media: never accept embed HTML or a caller-provided iframe URL. */
(() => {
  'use strict';
  function webUrl(value) {
    const text=String(value||'').trim();
    if(!text||/[\u0000-\u0020\u007f]/.test(text))return '';
    try {const url=new URL(text);return ['http:','https:'].includes(url.protocol)&&url.hostname&&!url.username&&!url.password?url.href:'';} catch{return '';}
  }
  // Shared by both editors and the Worker. This validates dedicated profile
  // links only; general buttons, navigation and authored scripts keep their policy.
  const socialProviders=Object.freeze([
    {id:'instagram',label:'Instagram',host:'www.instagram.com'},
    {id:'tiktok',label:'TikTok',host:'www.tiktok.com'},
    {id:'youtube',label:'YouTube',host:'www.youtube.com'},
    {id:'facebook',label:'Facebook',host:'www.facebook.com'},
    {id:'linkedin',label:'LinkedIn',host:'www.linkedin.com'},
    {id:'x',label:'X',host:'x.com'},
    {id:'pinterest',label:'Pinterest',host:'www.pinterest.com'},
    {id:'threads',label:'Threads',host:'www.threads.com'},
  ]);
  const socialHosts={
    'instagram.com':'instagram','www.instagram.com':'instagram',
    'tiktok.com':'tiktok','www.tiktok.com':'tiktok',
    'youtube.com':'youtube','www.youtube.com':'youtube','m.youtube.com':'youtube',
    'facebook.com':'facebook','www.facebook.com':'facebook','m.facebook.com':'facebook',
    'linkedin.com':'linkedin','www.linkedin.com':'linkedin',
    'x.com':'x','www.x.com':'x','twitter.com':'x','www.twitter.com':'x',
    'pinterest.com':'pinterest','www.pinterest.com':'pinterest',
    'threads.com':'threads','www.threads.com':'threads','threads.net':'threads','www.threads.net':'threads',
  };
  const socialReserved=new Set('about accounts ads api business challenge channels community developer developers direct directory download embed events explore feed friends groups help home i intent jobs legal live login logout messages notifications oauth p pages pin policy privacy reel reels search settings share sharer.php stories story.php terms tos tv watch web'.split(' '));
  function socialProvider(value) {
    try{return socialHosts[new URL(String(value||'').trim()).hostname.toLowerCase()]||'';}catch{return '';}
  }
  function socialProfile(value, expected='') {
    let text=String(value||'').trim();
    const provider=socialProviders.find(item=>item.id===expected);
    if(!text||text.length>2048||/[\u0000-\u0020\u007f\\]/.test(text)|| (expected&&!provider))return null;
    // Selecting a network makes a handle sufficient; pasted URLs must still
    // match that network. No URL inference, shortener requests or redirects.
    if(provider&&!/^[a-z][a-z\d+.-]*:/i.test(text)&&!text.includes('/')&&!text.includes('?')&&!text.includes('#')){
      const handle=text.replace(/^@/,'');
      text=`https://${provider.host}/${expected==='linkedin'?'in/':['tiktok','youtube','threads'].includes(expected)?'@':''}${handle}`;
    }
    let url;try{url=new URL(text);}catch{return null;}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port||url.hash)return null;
    const id=socialHosts[url.hostname.toLowerCase()];if(!id||(expected&&id!==expected))return null;
    // Reject encoded slashes/dots, URL parser dot-segment normalization and
    // percent-encoded host bypasses before checking exact profile paths.
    const raw=text.match(/^https?:\/\/([^/?#]+)([^?#]*)/i);
    if(!raw||(/[%:]/.test(raw[1]))||/%(?![89a-f][0-9a-f])|\/{2}|(?:^|\/)\.{1,2}(?:\/|$)/i.test(raw[2]))return null;
    let path;try{path=decodeURIComponent(url.pathname).replace(/\/$/,'');}catch{return null;}let handle='',canonicalPath='';
    if(id==='facebook'&&path==='/profile.php'){
      if(!/^\?id=[1-9]\d{4,24}$/.test(url.search))return null;
      handle=url.searchParams.get('id');canonicalPath='/profile.php?id='+handle;
    } else {
      if(url.search)return null;
      if(id==='youtube'){
        const match=path.match(/^\/@([\p{L}\p{N}._·-]{3,30})$/u)||path.match(/^\/channel\/(UC[\w-]{22})$/);
        if(!match)return null;handle=match[1];canonicalPath=path;
      } else if(id==='linkedin'){
        const match=path.match(/^\/(in|company)\/([a-z\d-]{3,100})$/i);if(!match)return null;handle=match[2];canonicalPath=`/${match[1].toLowerCase()}/${handle}`;
      } else if(['tiktok','threads'].includes(id)){
        const match=path.match(id==='tiktok'?/^\/@([a-z\d_][a-z\d_.]{1,23})$/i:/^\/@([a-z\d_][a-z\d_.]{0,29})$/i);
        if(!match||match[1].endsWith('.'))return null;handle=match[1];canonicalPath='/@'+handle;
      } else {
        const match=path.match(/^\/([a-z\d_.]+)$/i);if(!match)return null;handle=match[1];
        const valid=id==='instagram'?/^[a-z\d_][a-z\d_.]{0,29}$/i:id==='facebook'?/^[a-z\d.]{5,50}$/i:id==='x'?/^[a-z\d_]{1,15}$/i:/^[a-z\d_]{3,30}$/i;
        if(!valid.test(handle)||handle.endsWith('.')||socialReserved.has(handle.toLowerCase()))return null;canonicalPath='/'+handle;
      }
    }
    const network=socialProviders.find(item=>item.id===id);
    return {provider:id,label:network.label,handle,url:new URL(`https://${network.host}${canonicalPath}`).href};
  }
  const socialError='Choose a supported social network and its profile handle or URL. Websites, WhatsApp, link hubs and post links are not supported.';
  function youtube(value) {
    const text=String(value||'').trim();if(!text||/[\u0000-\u0020\u007f]/.test(text))return null;
    let url;try{url=new URL(text);}catch{return null;}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port)return null;
    const host=url.hostname.toLowerCase().replace(/^www\./,'');
    let id='';
    if(host==='youtu.be')id=url.pathname.slice(1).split('/')[0];
    else if(['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)){
      if(url.pathname==='/watch')id=url.searchParams.get('v')||'';
      else id=url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1]||'';
    }
    if(!/^[\w-]{11}$/.test(id))return null;
    const time=url.searchParams.get('start')||url.searchParams.get('t')||url.hash.match(/^#t=(.*)$/)?.[1]||'0';
    let start=0;
    if(/^\d+$/.test(time))start=Number(time);
    else if(/^(?:\d+h)?(?:\d+m)?(?:\d+s)?$/.test(time))start=Number(time.match(/(\d+)h/)?.[1]||0)*3600+Number(time.match(/(\d+)m/)?.[1]||0)*60+Number(time.match(/(\d+)s/)?.[1]||0);
    start=Math.min(86400,Math.max(0,start));
    return {id,start,url:`https://www.youtube.com/watch?v=${id}${start?'&t='+start+'s':''}`,embedUrl:`https://www.youtube-nocookie.com/embed/${id}?playsinline=1${start?'&start='+start:''}`};
  }
  function createYoutube({url='',title='YouTube video',ratio='16 / 9',controls=true}={}) {
    const parsed=youtube(url),node=document.createElement('div');node.className='sq-youtube-card';
    node.style.aspectRatio=['16 / 9','4 / 3','1 / 1','9 / 16'].includes(ratio)?ratio:'16 / 9';
    node.dataset.ezkartYoutube=parsed?.id||'';node.dataset.youtubeStart=String(parsed?.start||0);node.dataset.youtubeControls=String(controls!==false);node.dataset.youtubeTitle=String(title||'YouTube video').slice(0,200);
    const button=document.createElement('button');button.type='button';button.className='sq-youtube-play';button.disabled=!parsed;
    button.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m9 5 11 7-11 7z"/></svg>';
    const label=document.createElement('span');label.textContent=parsed?'Play '+node.dataset.youtubeTitle:'Add a YouTube video';button.append(label);button.setAttribute('aria-label',label.textContent);node.append(button);
    return node;
  }
  // Self-contained because this function also runs in exported pages.
  function mount(root=document) {
    if(root.dataset?.youtubeMounted)return;
    if(root.dataset)root.dataset.youtubeMounted='true';
    const channel=globalThis.crypto?.randomUUID?.()||String(Date.now())+Math.random();let hosted=false,lastButton=null,pendingButton=null,waited=false;
    if(parent!==self){
      addEventListener('message',event=>{
        if(event.source!==parent||event.data?.channel!==channel)return;
        if(event.data.type==='ezkart:youtube-supported'){hosted=true;const pending=pendingButton;pendingButton=null;pending?.click();}
        if(event.data.type==='ezkart:youtube-closed'&&lastButton?.isConnected)lastButton.focus({preventScroll:true});
      });
      parent.postMessage({type:'ezkart:youtube-connect',channel},'*');
    }
    root.addEventListener('click',event=>{
      const button=event.target.closest('.sq-youtube-play'),card=button?.closest('[data-ezkart-youtube]');
      if(!card||!root.contains(card)||button.disabled)return;
      const id=card.dataset.ezkartYoutube;if(!/^[\w-]{11}$/.test(id))return;
      const start=Math.floor(Math.min(86400,Math.max(0,Number(card.dataset.youtubeStart)||0)));
      if(parent!==self&&!hosted&&!waited){
        waited=true;pendingButton=button;parent.postMessage({type:'ezkart:youtube-connect',channel},'*');
        setTimeout(()=>{if(!hosted&&pendingButton===button){pendingButton=null;button.click();}},250);return;
      }
      if(hosted){lastButton=button;parent.postMessage({type:'ezkart:youtube-play',channel,id,start,controls:card.dataset.youtubeControls!=='false',title:card.dataset.youtubeTitle||'YouTube video'},'*');return;}
      const frame=document.createElement('iframe');frame.title=card.dataset.youtubeTitle||'YouTube video';
      frame.src=`https://www.youtube-nocookie.com/embed/${id}?playsinline=1&autoplay=1&controls=${card.dataset.youtubeControls==='false'?0:1}${start?'&start='+Math.floor(start):''}`;
      // Hosted pages intentionally run in an opaque sandbox/srcdoc. Some
      // browsers omit Referer there; supply the real page origin as player
      // identity too, without granting authored pages same-origin access.
      try {
        const pageUrl=new URL(document.baseURI==='about:srcdoc'?document.referrer:document.baseURI);
        if(['http:','https:'].includes(pageUrl.protocol))frame.src+='&origin='+encodeURIComponent(pageUrl.origin)+'&widget_referrer='+encodeURIComponent(pageUrl.origin);
      } catch (_) {}
      frame.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';frame.referrerPolicy='strict-origin-when-cross-origin';frame.allowFullscreen=true;
      card.replaceChildren(frame);frame.focus();
    });
  }
  globalThis.EzkartMedia={webUrl,socialProviders,socialProvider,socialProfile,socialError,youtube,createYoutube,mount};
})();
