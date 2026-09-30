/* Trusted host player. Authored pages remain in their opaque iframe sandbox. */
export function mountLandingMediaPlayer(root=document) {
  if (globalThis.EzkartLandingMediaPlayer) return globalThis.EzkartLandingMediaPlayer;
    let dialog=null,owner=null,channel='',closing=false;
    const forwarding=globalThis.origin==='null'&&parent!==self,children=new Map();
    const sourceFrame=source=>[...root.querySelectorAll('iframe[data-hosted-page],iframe.ib-phone,iframe[data-sq-live-preview-frame]')].find(frame=>frame.contentWindow===source);
    const close=()=>{
      if(!dialog||closing)return;closing=true;
      const previous=owner,previousChannel=channel;
      dialog.querySelector('iframe')?.remove();if(dialog.open)dialog.close();dialog.remove();dialog=null;owner=null;channel='';closing=false;
      previous?.focus();previous?.contentWindow?.postMessage({type:'ezkart:youtube-closed',channel:previousChannel},'*');
    };
    addEventListener('message',event=>{
      const message=event.data;
      // Nested trusted shells may themselves be inside an opaque preview.
      // Relay through verified frame sources until a normal-origin host owns
      // the player; never grant authored documents same-origin privileges.
      if(forwarding&&event.source===parent&&['ezkart:youtube-supported','ezkart:youtube-closed'].includes(message?.type)){
        const child=children.get(message.channel);if(child&&sourceFrame(child.contentWindow)===child)child.contentWindow.postMessage(message,'*');return;
      }
      const frame=sourceFrame(event.source);
      if(!frame||!message||typeof message!=='object'||typeof message.channel!=='string'||message.channel.length>100)return;
      if(message.type==='ezkart:youtube-connect'){
        if(forwarding){if(children.size>=32&&!children.has(message.channel))children.delete(children.keys().next().value);children.set(message.channel,frame);parent.postMessage(message,'*');return;}
        event.source.postMessage({type:'ezkart:youtube-supported',channel:message.channel},'*');return;
      }
      if(message.type!=='ezkart:youtube-play'||typeof message.id!=='string'||!/^[\w-]{11}$/.test(message.id)||typeof message.start!=='number'||!Number.isInteger(message.start)||message.start<0||message.start>86400||typeof message.controls!=='boolean')return;
      if(forwarding){children.set(message.channel,frame);parent.postMessage(message,'*');return;}
      close();owner=frame;channel=message.channel;
      dialog=document.createElement('dialog');dialog.dataset.youtubeHostPlayer='';dialog.setAttribute('aria-label','YouTube video player');
      dialog.style.cssText='width:min(920px,calc(100vw - 32px));max-width:calc(100vw - 32px);padding:16px;border:1px solid #dfe2e9;border-radius:14px;background:#fff;color:#252724;box-sizing:border-box;max-height:calc(100dvh - 32px);overflow:auto;';
      const header=document.createElement('header');header.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px;font:14px/1.5 Arial,sans-serif;';
      const title=document.createElement('strong');title.textContent=String(message.title||'YouTube video').slice(0,200);title.style.cssText='overflow-wrap:anywhere;min-width:0;';
      const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='×';dismiss.setAttribute('aria-label','Close video');dismiss.style.cssText='flex:none;min-width:44px;min-height:44px;border:1px solid #dfe2e9;border-radius:8px;background:#fff;color:#252724;font:28px Arial,sans-serif;cursor:pointer;';dismiss.onclick=close;
      const player=document.createElement('iframe');player.title=title.textContent;player.referrerPolicy='strict-origin-when-cross-origin';player.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';player.allowFullscreen=true;
      player.src=`https://www.youtube-nocookie.com/embed/${message.id}?playsinline=1&autoplay=1&controls=${message.controls?1:0}${message.start?'&start='+message.start:''}&origin=${encodeURIComponent(location.origin)}`;
      player.style.cssText='display:block;width:100%;height:auto;min-height:200px;aspect-ratio:16/9;max-height:calc(100dvh - 130px);border:0;border-radius:8px;background:#151719;';
      header.append(title,dismiss);dialog.append(header,player);document.body.append(dialog);
      dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',close);
      dialog.showModal();dismiss.focus();
    });
    const controller={close};globalThis.EzkartLandingMediaPlayer=controller;return controller;
}
if(typeof document!=='undefined')mountLandingMediaPlayer();
