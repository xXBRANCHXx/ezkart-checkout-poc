/* Shared section backgrounds. UI and MCP edit this same saved configuration. */
(() => {
  const defaults={kind:'linear',from:'#ff8430',to:'#f82177',base:'#ffffff',angle:135,opacity:100,x:50,y:50};
  const normalize=(input={})=>{
    const value={...defaults,...input};
    if(!['linear','radial','wash'].includes(value.kind))throw Error('Choose a linear, radial, or soft blend gradient.');
    for(const key of ['from','to','base']){if(!/^#[0-9a-f]{6}$/i.test(value[key]||''))throw Error('Gradient colors must be six-digit hex colors.');value[key]=value[key].toLowerCase();}
    for(const [key,min,max] of [['angle',0,360],['opacity',0,100],['x',0,100],['y',0,100]]){if(!Number.isFinite(Number(value[key])))throw Error('Gradient controls require numbers.');value[key]=Math.max(min,Math.min(max,Number(value[key])));}
    return value;
  };
  const read=section=>{try{return normalize(JSON.parse(section?.dataset.sqGradient||'{}'));}catch{return {...defaults};}};
  const type=section=>['solid','image','gradient'].includes(section?.dataset.sqBackgroundType)?section.dataset.sqBackgroundType:'solid';
  const rgba=(hex,alpha)=>`rgba(${hex.slice(1).match(/../g).map(n=>parseInt(n,16)).join(',')},${alpha})`;
  function render(section){
    if(!section)return;
    const active=type(section)==='gradient';section.classList.toggle('section-bg-gradient',active);
    let layer=section.querySelector(':scope > .sq-gradient-layer');
    if(!active){if(layer)layer.hidden=true;return;}
    const gradient=read(section),alpha=gradient.opacity/100,from=rgba(gradient.from,alpha),to=rgba(gradient.to,alpha);
    if(!layer){layer=document.createElement('div');layer.className='sq-gradient-layer';layer.setAttribute('aria-hidden','true');layer.innerHTML='<div class="sq-gradient-surface"></div>';section.prepend(layer);}
    layer.hidden=false;layer.dataset.gradientKind=gradient.kind;
    section.style.setProperty('--sq-gradient-base',gradient.base);
    const surface=layer.firstElementChild;
    surface.style.backgroundImage=gradient.kind==='linear'?`linear-gradient(${gradient.angle}deg,${from},${to})`:gradient.kind==='radial'?`radial-gradient(ellipse at ${gradient.x}% ${gradient.y}%,${from},${to})`:`radial-gradient(ellipse at 20% 50%,${from},transparent 60%),radial-gradient(ellipse at 80% 45%,${to},transparent 60%)`;
  }
  const set=(section,input)=>{const value=normalize(input);section.dataset.sqGradient=JSON.stringify(value);section.dataset.sqBackgroundType='gradient';render(section);return value;};
  function migrate(section){
    const legacy=section.querySelector(':scope > .ezm-closing-glow');
    if(legacy){if(!section.dataset.sqGradient)set(section,{kind:'wash',from:'#ff8430',to:'#f82177',opacity:26.3});legacy.remove();}
    render(section);
  }
  globalThis.EzkartBackgrounds={defaults,normalize,read,type,render,set,migrate};
  // Per-device text size uses the same variables in the canvas and exported page.
  const fontSize=(element,device)=>element.style.getPropertyValue(`--sq-font-size-${device}`).trim() || (device==='mobile'&&element.style.getPropertyValue('--sq-font-size-tablet').trim()) || element.style.getPropertyValue('--sq-font-size-desktop').trim() || element.style.getPropertyValue('--sq-font-size-base').trim();
  const setFontSize=(element,value,device)=>{
    if(!element.style.getPropertyValue('--sq-font-size-base'))element.style.setProperty('--sq-font-size-base',getComputedStyle(element).fontSize);
    element.style.setProperty(`--sq-font-size-${device}`,value);element.classList.add('sq-responsive-type');
  };
  globalThis.EzkartTypography={fontSize,setFontSize};
})();
