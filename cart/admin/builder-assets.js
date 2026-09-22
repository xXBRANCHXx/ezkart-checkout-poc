/* Curated compositions of ordinary native elements. No image or code embeds. */
(() => {
  'use strict';
  const pad = value => Object.fromEntries(['Top','Right','Bottom','Left'].map(side => ['padding' + side, value]));
  const border = (color, sides = ['Top','Right','Bottom','Left']) => Object.fromEntries(sides.flatMap(side => [[`border${side}Width`, '1px'], [`border${side}Style`, 'solid'], [`border${side}Color`, color]]));
  const text = (value, props = {}, extra = {}) => ({type:'text',text:value,props:{fontSize:'16px',lineHeight:'1.65',overflowWrap:'anywhere',...props},...extra});
  const title = (value, props = {}) => ({...text(value,{fontSize:'32px',fontWeight:'600',lineHeight:'1.15',textWrap:'balance',...props}),type:'heading',tag:'h2'});
  const group = (children, props = {}, extra = {}) => ({type:'container',props:{display:'flex',flexDirection:'column',gap:'16px',minWidth:'0',...props},children,...extra});
  const row = (children, props = {}) => group(children,{flexDirection:'row',alignItems:'center',gap:'16px',...props});
  const badge = (value, color = '#23614e') => text(value,{fontSize:'12px',fontWeight:'600',color,backgroundColor:'#eaf3ed',borderRadius:'999px',...pad('6px'),paddingLeft:'12px',paddingRight:'12px',width:'fit-content'});
  const mono = 'ui-monospace, SFMono-Regular, Consolas, monospace';
  const recipes = [
    {id:'text-editorial',category:'text',name:'Editorial title',description:'Expressive serif with a quiet supporting line.',make:() => group([
      title('Good things,\nwell considered.',{fontFamily:'Georgia, serif',fontSize:'56px',fontWeight:'400',letterSpacing:'-2px',whiteSpace:'pre-line'}),
      text('A little intention goes a long way.',{color:'#69645e',fontSize:'18px'})
    ],{gap:'20px',...pad('8px')})},
    {id:'text-statement',category:'text',name:'Bold statement',description:'A compact headline with one word in color.',make:() => group([
      {...title('Make space\nfor better.',{fontSize:'64px',fontWeight:'800',letterSpacing:'-3px',whiteSpace:'pre-line'}),marks:[{start:15,end:21,color:'#bd492a'}]},
      text('Fewer things. More meaning.',{fontSize:'18px',color:'#bd492a',fontWeight:'500'})
    ],{gap:'16px'})},
    {id:'text-story',category:'text',name:'Story & detail',description:'A clear heading, readable body, and a fine rule.',make:() => group([
      title('The thought behind it.',{fontSize:'27px'}),
      text('Every useful thing starts with a simple question: how could this feel a little better? Tell the story of what you make, and the choices that make it yours.',{fontSize:'17px',color:'#5c6267'}),
      text('Made with a point of view.',{fontSize:'13px',paddingTop:'18px',...border('#cbd1d1',['Top'])})
    ],{gap:'18px',maxWidth:'480px'})},
    {id:'bulletin-strip',category:'bulletins',name:'Announcement band',description:'A compact notice with a distinct label.',make:() => row([
      text('A little update',{fontSize:'13px',fontWeight:'600',backgroundColor:'#fff4cf',color:'#543f0e',...pad('9px'),borderRadius:'6px',flexShrink:'0'}),
      text('Something new is taking shape.',{fontSize:'17px',fontWeight:'500'})
    ],{backgroundColor:'#253c35',color:'#fffdf4',...pad('22px'),borderRadius:'12px',flexWrap:'wrap'})},
    {id:'bulletin-note',category:'bulletins',name:'Pinned note',description:'A warm paper note for something worth knowing.',make:() => group([
      text('Worth knowing',{fontSize:'14px',color:'#87571c',fontWeight:'600'}),
      title('Small details.\nA better experience.',{fontFamily:'Georgia, serif',fontSize:'36px',fontWeight:'400',whiteSpace:'pre-line'}),
      text('Use this space for a useful update, a thoughtful reminder, or the detail people usually miss.',{color:'#71603f'})
    ],{backgroundColor:'#fff3d6',color:'#49391c',...pad('28px'),borderRadius:'3px',...border('#cc9948',['Top']),borderTopWidth:'4px',gap:'18px'})},
    {id:'bulletin-checklist',category:'bulletins',name:'Bullet list',description:'Three editable points with generous spacing.',make:() => group([
      title('The essentials.',{fontSize:'28px'}),
      group(['Start with what matters','Keep the useful details','Make the next step clear'].map(value => row([
        text('✓',{fontSize:'15px',fontWeight:'700',color:'#23614e',backgroundColor:'#eaf3ed',borderRadius:'50%',width:'28px',height:'28px',textAlign:'center',flexShrink:'0'}), text(value,{fontSize:'17px'})
      ],{paddingTop:'12px',paddingBottom:'12px',...border('#e0e5e2',['Bottom'])})),{gap:'0'})
    ],{...pad('28px'),backgroundColor:'#fff',...border('#dfe5e1'),borderRadius:'16px'})},
    ...['ruled','cards','numbered'].map((style,index) => ({id:`accordion-${style}`,category:'accordions',name:['Quiet rules','Soft cards','Numbered answers'][index],description:['Clean dividing lines and a simple disclosure.','Separate, softly framed questions and answers.','An indexed list with an editorial rhythm.'][index],make:() => group([
      ...['What makes it different?','What should I know?','Where do I start?'].map((question,i) => ({type:'accordion',open:i===0,props:{display:'block',...pad(style==='cards'?'20px':'18px'),...(style==='cards'?{backgroundColor:'#f0f3f6',borderRadius:'12px'}:border(style==='numbered'?'#b6bcb4':'#d7dcdf',['Bottom']))},children:[
        {type:'summary',text:(style==='numbered'?`0${i+1}   `:'')+question,props:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'16px',cursor:'pointer',listStyleType:'none',fontSize:style==='numbered'?'20px':'17px',fontWeight:'500',fontFamily:style==='numbered'?'Georgia, serif':'inherit',lineHeight:'1.5',minHeight:'28px'}},
        text(['Tell the story behind your product and the details that make it useful.','Add the practical details your customers need before choosing.','Give people a clear first step and a way to find out more.'][i],{paddingTop:'14px',fontSize:'15px',color:'#626970'})
      ]}))
    ],{gap:style==='cards'?'10px':'0',backgroundColor:style==='numbered'?'#f4f2e9':'#fff',...pad(style==='numbered'?'22px':'4px')})})),
    {id:'diagram-process',category:'diagrams',name:'Connected steps',description:'A vertical path from first step to finish.',make:() => group([
      title('From idea to everyday.',{fontSize:'27px'}),
      group(['Choose your starting point','Make it your own','Put it into practice'].map((value,i) => row([
        text(`0${i+1}`,{fontFamily:mono,fontSize:'14px',color:'#fff',backgroundColor:'#254b41',borderRadius:'50%',width:'38px',height:'38px',lineHeight:'38px',textAlign:'center',flexShrink:'0'}),
        group([text(value,{fontWeight:'600'}),text(['Find the right fit.','Add your own details.','Start with one small step.'][i],{fontSize:'14px',color:'#6c756f'})],{gap:'3px'})
      ],{...pad('14px'),...(i<2?border('#ccd8d0',['Bottom']):{})})),{gap:'0'})
    ],{...pad('26px'),backgroundColor:'#f0f5ef',borderRadius:'16px'})},
    {id:'diagram-branch',category:'diagrams',name:'One idea, two paths',description:'A branching diagram for choices or categories.',make:() => group([
      text('Find your own way.',{fontSize:'24px',fontWeight:'600',textAlign:'center'}),
      text('Your starting point',{...pad('16px'),...border('#aeb7c0'),borderRadius:'8px',textAlign:'center',backgroundColor:'#fff',fontWeight:'500'}),
      text('↙                         ↘',{fontSize:'28px',lineHeight:'1',textAlign:'center',color:'#6b7a8c',whiteSpace:'pre'}),
      row(['Keep it simple','Go a little deeper'].map((value,i) => group([
        text(`0${i+1}`,{fontFamily:mono,fontSize:'12px',color:'#5c6f83'}),text(value,{fontSize:'19px',fontWeight:'500'}),text(['The essentials to get started.','More room to explore.'][i],{fontSize:'13px',color:'#62707d'})
      ],{flexGrow:'1',flexBasis:'160px',...pad('20px'),...border('#c9d2dc'),borderRadius:'10px',backgroundColor:i?'#e4edf6':'#fff'})),{alignItems:'stretch',flexWrap:'wrap'})
    ],{...pad('24px'),gap:'14px',backgroundColor:'#f1f4f8',borderRadius:'14px'})},
    {id:'diagram-cycle',category:'diagrams',name:'Learning loop',description:'A repeatable sequence, connected back to its start.',make:() => group([
      row([badge('A repeatable rhythm','#7a5022'),text('↻',{fontSize:'32px',color:'#9b6931'})],{justifyContent:'space-between'}),
      row(['Observe','Try','Refine'].map((value,i) => group([text(`0${i+1}`,{fontFamily:mono,fontSize:'12px',color:'#926632'}),title(value,{fontFamily:'Georgia, serif',fontWeight:'400',fontSize:'27px'}),text(['Notice what matters.','Make a small change.','Keep what works.'][i],{fontSize:'13px',color:'#776a56'})],{flexGrow:'1',flexBasis:'110px',...pad('14px'),...border('#d4c4a9',['Left'])})),{alignItems:'stretch',gap:'10px',flexWrap:'wrap'}),
      text('←  Take what you learn back to the beginning',{fontSize:'13px',paddingTop:'18px',...border('#d4c4a9',['Top']),color:'#7a5022'})
    ],{...pad('26px'),backgroundColor:'#f7f0e3',borderRadius:'12px',gap:'26px'})},
    {id:'code-terminal',category:'code',name:'Terminal note',description:'A dark command window with editable plain text.',make:() => group([
      row([text('●  ●  ●',{fontSize:'12px',color:'#8b9b92'}),text('a-small-start.sh',{fontFamily:mono,fontSize:'12px',color:'#acbbb2'})],{justifyContent:'space-between',paddingBottom:'18px',...border('#39463e',['Bottom'])}),
      text('$ start something-good\n\n✓ Find a useful idea\n✓ Make it your own\n✓ Share it with the world\n\nReady when you are. _',{fontFamily:mono,fontSize:'15px',lineHeight:'1.9',whiteSpace:'pre-wrap',color:'#c5e8ba'})
    ],{...pad('26px'),backgroundColor:'#202d27',color:'#fff',borderRadius:'14px',gap:'22px'})},
    {id:'code-object',category:'code',name:'Object of intent',description:'A light syntax card for a few meaningful details.',make:() => group([
      row([text('a-good-idea.json',{fontFamily:mono,fontSize:'13px',color:'#51657a'}),text('{ }',{fontFamily:mono,fontSize:'18px',color:'#8c9bac'})],{justifyContent:'space-between',...pad('18px'),backgroundColor:'#eef2f6',...border('#d8e0e8',['Bottom'])}),
      text('{\n  "purpose": "Make things useful",\n  "approach": "Keep it thoughtful",\n  "details": [\n    "clear",\n    "considered",\n    "yours"\n  ]\n}',{fontFamily:mono,fontSize:'15px',lineHeight:'1.8',whiteSpace:'pre-wrap',...pad('24px'),color:'#3a6186'})
    ],{backgroundColor:'#fff',...border('#d8e0e8'),borderRadius:'12px',gap:'0',overflow:'hidden'})},
    {id:'code-recipe',category:'code',name:'Creative recipe',description:'A typographic code sketch with a warm paper feel.',make:() => group([
      text('A recipe for something good',{fontFamily:'Georgia, serif',fontSize:'28px',lineHeight:'1.2'}),
      text('01   take(one_clear_idea)\n02     .add(a_little_care)\n03     .remove(the_extra)\n04     .make_it_yours()',{fontFamily:mono,fontSize:'15px',lineHeight:'2.2',whiteSpace:'pre-wrap',paddingTop:'20px',paddingBottom:'20px',...border('#d6c2b4',['Top','Bottom']),color:'#8e472e'}),
      text('// There is always room to make it better.',{fontFamily:mono,fontSize:'12px',color:'#807169'})
    ],{...pad('26px'),backgroundColor:'#f8ede6',color:'#51362b',gap:'20px'})}
  ];
  const definitions = recipes.map(({make,...item}) => item);
  function create(id) {
    const recipe = recipes.find(item => item.id === id);
    if (!recipe) throw Error('Choose an asset from the library.');
    let index = 0;
    const prefix = `asset-${crypto.randomUUID().replaceAll('-','').slice(0,12)}`;
    const node = recipe.make();
    const assign = n => { n.id = `${prefix}-${++index}`; (n.children || []).forEach(assign); };
    assign(node);
    node.name = recipe.name;
    node.props = {fontFamily:'Arial, Helvetica, sans-serif',color:'#26332f',width:'520px',maxWidth:'100%',flexShrink:'0',height:'auto',...node.props};
    EzkartNative.validate(node);
    return node;
  }
  function preview(id) {
    const config = create(id);
    const node = EzkartNative.create(config);
    const paint = (element, data) => {
      element.removeAttribute('id');
      [...element.attributes].filter(a => a.name.startsWith('data-')).forEach(a => element.removeAttribute(a.name));
      element.className = '';
      Object.assign(element.style,{boxSizing:'border-box',margin:'0',fontFamily:'inherit',...data.props});
      if (data.type === 'accordion') element.open = Boolean(data.open);
      (data.children || []).forEach((child,i) => paint(element.children[i],child));
    };
    paint(node,config);
    node.style.width = '520px';
    node.style.maxWidth = 'none';
    node.inert = true;
    return node;
  }
  globalThis.EzkartAssets = {definitions,create,preview};
})();
