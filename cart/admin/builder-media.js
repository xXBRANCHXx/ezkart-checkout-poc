/* Shared structured media: never accept embed HTML or a caller-provided iframe URL. */
(() => {
  'use strict';
  function webUrl(value) {
    const text=String(value||'').trim();
    if(!text||/[\u0000-\u0020\u007f]/.test(text))return '';
    try {const url=new URL(text);return ['http:','https:'].includes(url.protocol)&&url.hostname&&!url.username&&!url.password?url.href:'';} catch{return '';}
  }
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
  globalThis.EzkartMedia={webUrl,youtube,createYoutube,mount};
})();
