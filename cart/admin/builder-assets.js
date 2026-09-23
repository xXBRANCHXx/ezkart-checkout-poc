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
  const ink = '#28272c', muted = '#747078', accent = '#cf4938', paper = '#faf6f2';
  const eyebrow = value => text(value,{fontSize:'11px',fontWeight:'600',letterSpacing:'2px',textTransform:'uppercase',color:accent});
  const rule = () => group([],{height:'1px',backgroundColor:'#ded8d2',width:'100%'});
  const button = (value,style='solid') => ({type:'button',tag:'a',text:value,action:{type:'link',target:'#'},props:{display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'14px',lineHeight:'1.4',fontWeight:'600',textDecoration:'none',width:'fit-content',maxWidth:'100%',overflowWrap:'anywhere',...pad('14px'),paddingLeft:'22px',paddingRight:'22px',borderRadius:style==='link'?'0':'8px',backgroundColor:style==='solid'?ink:'transparent',color:style==='solid'?'#fff':ink,...(style==='outline'?border('#aaa3a0'):{}),...(style==='link'?{paddingLeft:'0',paddingRight:'0',...border(ink,['Bottom'])}:{})}});
  const card = (children,props={}) => group(children,{...pad('26px'),backgroundColor:'#fff',...border('#e5dfda'),borderRadius:'16px',...props});
  const columns = children => row(children.map(child=>({...child,props:{...child.props,flexGrow:'1',flexBasis:'180px',minWidth:'0'}})),{flexWrap:'wrap',alignItems:'stretch'});
  const quote = () => text('“Add a real customer quote that captures their experience.”',{fontFamily:'Georgia, serif',fontSize:'29px',lineHeight:'1.4'});
  const attribution = () => text('Customer name · Product or service',{fontSize:'12px',color:muted});
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
,
    {id:'review-editorial',category:'reviews',name:'Editorial quote',description:'An oversized quotation with a real customer attribution.',section:true,make:()=>group([
      text('“',{fontFamily:'Georgia, serif',fontSize:'104px',lineHeight:'.8',color:accent}),quote(),rule(),attribution()
    ],{...pad('32px'),backgroundColor:paper,gap:'22px'})},
    {id:'review-cards',category:'reviews',name:'Customer voices',description:'Two independent review cards. Replace the prompts with real feedback.',section:true,make:()=>group([
      eyebrow('In their words'),title('Small moments. Lasting impressions.',{fontSize:'34px'}),columns([0,1].map(()=>card([text('“',{fontFamily:'Georgia, serif',fontSize:'48px',lineHeight:'1',color:accent}),text('Add a real review from a customer.',{fontSize:'19px',lineHeight:'1.5'}),attribution()],{gap:'14px'})))
    ])},
    {id:'review-spotlight',category:'reviews',name:'Review spotlight',description:'A dark, spacious testimonial with a quiet source line.',section:true,make:()=>group([
      text('CUSTOMER STORY',{fontSize:'11px',letterSpacing:'2px',color:'#d6bdb2'}),quote(),text('— Customer name',{fontSize:'14px',color:'#d6bdb2'})
    ],{...pad('38px'),gap:'32px',color:'#fffaf4',backgroundColor:'#30282b',borderRadius:'24px'})},
    {id:'contact-letter',category:'contact',name:'Open letter',description:'A personal contact invitation. Set your email on the button.',section:true,make:()=>group([
      eyebrow('A conversation starts here'),title('Tell us what\nyou have in mind.',{fontFamily:'Georgia, serif',fontSize:'44px',fontWeight:'400',whiteSpace:'pre-line'}),text('Questions, ideas, or a simple hello. We would love to hear from you.',{color:muted}),button('Write to us ↗','link')
    ],{...pad('30px'),backgroundColor:paper,gap:'24px'})},
    {id:'contact-details',category:'contact',name:'Contact directory',description:'Editable email, location, and opening hours in a clean directory.',section:true,make:()=>group([
      title('Come say hello.',{fontSize:'34px'}),...['Email','Visit','Opening hours'].map((label,i)=>row([text(label,{fontSize:'12px',color:muted,width:'105px',flexShrink:'0'}),text(['Your email address','Your address or location','Your opening hours'][i],{fontSize:'17px'})],{...pad('16px'),paddingLeft:'0',paddingRight:'0',flexWrap:'wrap',...border('#ded8d2',['Bottom'])}))
    ],{...pad('26px')})},
    {id:'contact-card',category:'contact',name:'Conversation card',description:'A compact contact card with one configurable action.',section:true,make:()=>card([
      text('↗',{fontSize:'42px',color:accent,lineHeight:'1'}),title('Let’s talk.',{fontSize:'44px',letterSpacing:'-2px'}),text('For the question you could not find an answer to.',{color:muted}),button('Get in touch')
    ],{backgroundColor:'#f8ede8',gap:'22px',...pad('34px')})},
    {id:'invitation-poster',category:'invitations',name:'One clear next step',description:'A bold closing invitation with a primary action.',section:true,make:()=>group([
      eyebrow('Your next chapter'),title('Ready when\nyou are.',{fontSize:'62px',letterSpacing:'-3px',whiteSpace:'pre-line'}),text('Start with something that feels right.',{color:muted}),button('Explore the collection ↗')
    ],{alignItems:'center',textAlign:'center',...pad('36px'),backgroundColor:'#f7f3f0',gap:'24px'})},
    {id:'invitation-band',category:'invitations',name:'Invitation band',description:'A compact, contrasting closing banner.',section:true,make:()=>row([
      group([title('Something good\nstarts here.',{fontSize:'34px',whiteSpace:'pre-line'}),text('Take the next step at your own pace.',{color:'#ded2cb',fontSize:'14px'})],{flexGrow:'1',flexBasis:'220px'}),{...button('Let’s begin ↗'),props:{...button('x').props,backgroundColor:'#fff8ee',color:ink}}
    ],{...pad('32px'),backgroundColor:'#332b2e',color:'#fff8ee',borderRadius:'18px',flexWrap:'wrap',gap:'28px'})},
    {id:'invitation-minimal',category:'invitations',name:'Quiet invitation',description:'An editorial closing line and an understated link.',section:true,make:()=>group([
      rule(),title('Find your everyday favorite.',{fontFamily:'Georgia, serif',fontWeight:'400',fontSize:'40px'}),button('Take a closer look →','link')
    ],{...pad('24px'),gap:'28px'})},
    {id:'feature-columns',category:'features',name:'Three good reasons',description:'Three useful benefits in a flexible column layout.',section:true,make:()=>group([
      eyebrow('The details make it'),title('Thoughtful by design.',{fontSize:'34px'}),columns(['Made for you','Considered details','A useful difference'].map((label,i)=>group([text(['◎','◇','↗'][i],{fontSize:'34px',color:accent}),title(label,{fontSize:'21px'}),text('Describe a specific benefit and why it matters.',{fontSize:'14px',color:muted})],{gap:'12px',paddingTop:'16px'})))
    ],{...pad('24px'),gap:'22px'})},
    {id:'feature-stack',category:'features',name:'Benefit list',description:'A numbered list with room for the details.',section:true,make:()=>group(
      ['What makes it useful','The care behind it','How it fits your day'].map((label,i)=>row([text(`0${i+1}`,{fontSize:'12px',fontFamily:mono,color:accent,alignSelf:'flex-start',paddingTop:'4px'}),group([title(label,{fontSize:'23px'}),text('Add a clear, factual reason to choose your product or service.',{fontSize:'15px',color:muted})],{gap:'8px'})],{alignItems:'flex-start',gap:'24px',paddingTop:'22px',paddingBottom:'22px',...border('#ded8d2',['Bottom'])})),{...pad('20px'),gap:'0'})},
    {id:'feature-tiles',category:'features',name:'Feature mosaic',description:'One lead benefit with two supporting tiles.',section:true,make:()=>group([
      card([eyebrow('The big idea'),title('More thought.\nLess effort.',{fontSize:'42px',whiteSpace:'pre-line'}),text('Describe the difference your product makes.',{color:muted})],{backgroundColor:'#f6e7df',...border('#f6e7df')}),columns(['A better detail','An everyday benefit'].map((label,i)=>card([text(i?'↗':'◎',{fontSize:'26px',color:accent}),title(label,{fontSize:'23px'}),text('Make the benefit specific.',{fontSize:'14px',color:muted})],{backgroundColor:i?'#f7f4ed':'#f3f1f6'})))
    ],{gap:'12px'})},
    {id:'button-solid',category:'buttons',name:'Solid action',description:'A strong primary link with a soft corner.',make:()=>group([button('Discover more ↗')],{alignItems:'center',...pad('40px')})},
    {id:'button-outline',category:'buttons',name:'Outline action',description:'A quieter action outlined with a fine border.',make:()=>group([button('Take a closer look →','outline')],{alignItems:'center',...pad('40px')})},
    {id:'button-editorial',category:'buttons',name:'Editorial link',description:'An underlined text link for a minimal layout.',make:()=>group([button('Explore the details ↗','link')],{alignItems:'center',...pad('40px')})},
    {id:'pricing-card',category:'pricing',name:'Focused offer',description:'A service or offer card. Enter your real price and destination.',section:true,make:()=>card([
      eyebrow('Your offer'),title('A little more possibility.',{fontSize:'32px'}),text('Your price',{fontSize:'42px',fontWeight:'600',letterSpacing:'-1px'}),rule(),...['What is included','Who it is for','The useful details'].map(value=>text(`✓  ${value}`,{fontSize:'15px',color:muted})),button('Explore this offer →')
    ],{backgroundColor:paper,...pad('30px')})},
    {id:'pricing-compare',category:'pricing',name:'Two ways to begin',description:'Two editable service packages without invented prices.',section:true,make:()=>columns(['The essentials','A little more'].map((label,i)=>card([
      eyebrow(i?'More room':'A simple start'),title(label,{fontSize:'25px'}),text('Your price',{fontSize:'30px',fontWeight:'600'}),text('Describe the scope and what is included.',{fontSize:'14px',color:muted}),button('View details →',i?'solid':'outline')
    ],{backgroundColor:i?'#f6e7df':'#fff'})))},
    {id:'pricing-menu',category:'pricing',name:'Service menu',description:'A typographic list of services and their prices.',section:true,make:()=>group([
      eyebrow('What we offer'),title('Find your fit.',{fontFamily:'Georgia, serif',fontSize:'38px',fontWeight:'400'}),...['Your first service','Your second service','Your third service'].map(value=>row([group([text(value,{fontSize:'19px',fontWeight:'500'}),text('A short description of what is included.',{fontSize:'13px',color:muted})],{gap:'4px',flexGrow:'1',flexBasis:'240px'}),text('Your price',{fontSize:'14px',color:accent})],{paddingTop:'18px',paddingBottom:'18px',flexWrap:'wrap',...border('#ded8d2',['Bottom'])}))
    ],{...pad('26px'),gap:'12px'})},
    {id:'facts-strip',category:'facts',name:'Numbers at a glance',description:'Three placeholders for real, sourced numbers.',section:true,make:()=>columns(['First metric','Second metric','Third metric'].map(label=>group([text('—',{fontFamily:'Georgia, serif',fontSize:'60px',lineHeight:'1',color:accent}),text(label,{fontSize:'14px',fontWeight:'600'}),text('Add a verified figure',{fontSize:'11px',color:muted})],{gap:'10px',...pad('22px'),...border('#ded8d2',['Left'])})))},
    {id:'facts-spotlight',category:'facts',name:'One meaningful number',description:'A large number and context. Add your own verified figure.',section:true,make:()=>group([
      eyebrow('A fact worth sharing'),text('—',{fontSize:'100px',lineHeight:'1',fontWeight:'600',letterSpacing:'-6px'}),title('Give your number context.',{fontSize:'28px'}),text('Replace the dash with a verified figure and explain what it measures.',{fontSize:'15px',color:muted})
    ],{...pad('32px'),backgroundColor:'#f4ede5',gap:'20px'})},
    {id:'facts-details',category:'facts',name:'The fact sheet',description:'A simple specification table for accurate product details.',section:true,make:()=>card([
      eyebrow('A closer look'),title('All in the details.',{fontSize:'30px'}),...['Materials','Dimensions','Care'].map(label=>row([text(label,{fontSize:'13px',color:muted,flexBasis:'120px'}),text('Add your product details',{fontSize:'15px'})],{...border('#ded8d2',['Bottom']),paddingTop:'13px',paddingBottom:'13px',flexWrap:'wrap'}))
    ])},
    {id:'people-profile',category:'people',name:'Meet the maker',description:'A personal introduction with an editable initial.',section:true,make:()=>row([
      text('A',{fontFamily:'Georgia, serif',fontSize:'90px',lineHeight:'1',textAlign:'center',...pad('36px'),backgroundColor:'#efe2d8',borderRadius:'120px',color:'#846957',flexShrink:'0'}),group([eyebrow('The person behind it'),title('Your name',{fontFamily:'Georgia, serif',fontWeight:'400',fontSize:'35px'}),text('Your role',{fontSize:'13px',color:accent}),text('A short introduction to the person, their work, and what they care about.',{fontSize:'15px',color:muted})],{flexGrow:'1',flexBasis:'240px',gap:'12px'})
    ],{...pad('22px'),flexWrap:'wrap',gap:'28px'})},
    {id:'people-team',category:'people',name:'People & roles',description:'Two editable team introductions with monogram portraits.',section:true,make:()=>group([
      title('Good people. Shared purpose.',{fontSize:'32px'}),columns(['A','B'].map((initial,i)=>group([text(initial,{fontFamily:'Georgia, serif',fontSize:'82px',lineHeight:'1',textAlign:'center',...pad('36px'),backgroundColor:i?'#edeaf1':'#f2e3d9',borderRadius:'14px',color:i?'#7d6d8b':'#97715a'}),title('Your name',{fontSize:'23px'}),text('Role · A few words about you',{fontSize:'13px',color:muted})],{gap:'12px'})))
    ],{...pad('20px'),gap:'26px'})},
    {id:'people-note',category:'people',name:'A note from the founder',description:'A personal letter with an editable signature line.',section:true,make:()=>group([
      eyebrow('From the founder'),title('It started with\na simple idea.',{fontFamily:'Georgia, serif',fontWeight:'400',fontSize:'40px',whiteSpace:'pre-line'}),text('Share why you started, what matters to you, and the thought that goes into your work.',{fontSize:'17px',color:muted}),text('Your name',{fontFamily:'Georgia, serif',fontSize:'26px'}),text('Founder, your brand',{fontSize:'12px',color:muted})
    ],{...pad('32px'),backgroundColor:paper,gap:'22px'})},
    {id:'footer-simple',category:'footers',name:'Simple sign-off',description:'A minimal brand sign-off with a configurable contact link.',section:true,make:()=>group([
      rule(),row([title('Your brand',{fontSize:'26px'}),button('Say hello ↗','link')],{justifyContent:'space-between',flexWrap:'wrap'}),text('© Your brand. Add your legal details.',{fontSize:'11px',color:muted})
    ],{...pad('24px'),gap:'28px'})},
    {id:'footer-columns',category:'footers',name:'Footer directory',description:'A brand statement and editable navigation links.',section:true,make:()=>group([
      title('Your brand',{fontSize:'30px'}),text('A few words about what you make and why.',{fontSize:'15px',color:muted}),columns([group([eyebrow('Explore'),button('Our story ↗','link'),button('Collection ↗','link')],{gap:'2px'}),group([eyebrow('Stay in touch'),button('Contact ↗','link'),button('Social ↗','link')],{gap:'2px'})]),rule(),text('© Your brand · Add your legal details',{fontSize:'11px',color:muted})
    ],{...pad('30px'),backgroundColor:paper,gap:'24px'})},
    {id:'footer-signature',category:'footers',name:'Brand signature',description:'An expressive typographic finish to the page.',section:true,make:()=>group([
      text('Thanks for stopping by.',{fontSize:'13px',color:'#cbbab2'}),title('See you\naround.',{fontFamily:'Georgia, serif',fontWeight:'400',fontSize:'64px',letterSpacing:'-2px',whiteSpace:'pre-line'}),row([text('Your brand',{fontSize:'13px'}),{...button('Keep in touch ↗','link'),props:{...button('x','link').props,color:'#fff6ed',borderBottomColor:'#9b8984'}}],{justifyContent:'space-between',flexWrap:'wrap'})
    ],{...pad('32px'),backgroundColor:'#30282b',color:'#fff6ed',gap:'28px'})}
  ];
  // Packs are append-only data. Keep their trees private to the factories, so
  // catalogue cards and section metadata never copy a complete native tree.
  const recipeIds = new Set(recipes.map(item => item.id));
  for (const {id,category,name,description,section,node} of globalThis.EzkartAssetPacks || []) {
    if (recipeIds.has(id)) throw Error(`Duplicate asset recipe: ${id}`);
    recipeIds.add(id);
    recipes.push({id,category,name,description,section,make:()=>node});
  }
  const definitions = recipes.map(({make,...item}) => item);
  function cloneRecipe(source, kind = 'asset') {
    const root = structuredClone(source), nodes = [], ids = new Map(), anchors = new Map();
    const groups = new Map(), params = new Map();
    const prefix = `${kind}-${crypto.randomUUID().replaceAll('-','')}`;
    const collect = node => {
      const id = `${prefix}-${nodes.length + 1}`;
      if (node.id) {
        if (ids.has(node.id)) throw Error('Each asset element needs a unique local ID.');
        ids.set(node.id,id);
        anchors.set(`native-${node.id}`,`native-${id}`);
      }
      if (node.anchor) {
        if (anchors.has(node.anchor)) throw Error('Each asset anchor needs a unique local name.');
        anchors.set(node.anchor,`${id}-anchor`);
      }
      nodes.push({node,id});
      (node.children || []).forEach(collect);
    };
    collect(root);
    const localId = value => ids.get(value) || value;
    const localName = (map,value,label) => {
      if (!map.has(value)) map.set(value,`${prefix}-${label}-${map.size + 1}`);
      return map.get(value);
    };
    // Resolve after collecting every ID: forward references and references to
    // ancestors must work too. State names are values, not element IDs.
    for (const {node,id} of nodes) {
      node.id = id;
      if (node.anchor) node.anchor = anchors.get(node.anchor);
      if (node.group) node.group = localName(groups,node.group,'group');
      if (node.stateParam) node.stateParam = localName(params,node.stateParam,'state');
      if (node.stateScope) node.stateScope = localId(node.stateScope);
      else if (node.states) node.stateScope = root.id;
      if (node.action) {
        const action = node.action;
        if (action.scope) action.scope = localId(action.scope);
        else if (action.type === 'state') action.scope = root.id;
        if (action.type === 'link') {
          const anchor = action.target?.startsWith('#') && anchors.get(action.target.slice(1));
          if (anchor) action.target = `#${anchor}`;
        } else if (action.type !== 'state') action.target = localId(action.target);
      }
      if (node.scrollVisibility) {
        if (node.scrollVisibility.after) node.scrollVisibility.after = localId(node.scrollVisibility.after);
        if (node.scrollVisibility.hideWhile) node.scrollVisibility.hideWhile = node.scrollVisibility.hideWhile.map(localId);
      }
    }
    return root;
  }
  function create(id) {
    const recipe = recipes.find(item => item.id === id);
    if (!recipe) throw Error('Choose an asset from the library.');
    const node = cloneRecipe(recipe.make());
    node.name = recipe.name;
    node.props = {fontFamily:'Arial, Helvetica, sans-serif',color:'#28272c',width:'520px',maxWidth:'100%',flexShrink:'0',height:'auto',...node.props};
    EzkartNative.validate(node);
    return node;
  }
  let previewBaseSheet;
  function preview(id) {
    const config = create(id);
    // Use the native CSS and container queries inside an isolated preview.
    // A single shared sheet avoids copying the native CSS into every card;
    // shadow boundaries keep previews out of the editor's canvas selectors.
    if (!previewBaseSheet) {
      const source = [...document.styleSheets].find(sheet => sheet.href && new URL(sheet.href).pathname.endsWith('/builder-native.css'));
      if (!source) throw Error('Load builder-native.css before asset previews.');
      previewBaseSheet = new CSSStyleSheet();
      previewBaseSheet.replaceSync([...source.cssRules].map(rule => rule.cssText.replace(/url\(["']?([^"')]+)["']?\)/g,(_,url)=>`url("${new URL(url,source.href).href}")`)).join('\n'));
    }
    const frame = document.createElement('div');
    frame.style.cssText = 'width:520px;max-width:none;';
    frame.inert = true;
    const shadow = frame.attachShadow({mode:'closed'});
    shadow.adoptedStyleSheets = [previewBaseSheet];
    const canvas = document.createElement('div');
    canvas.className = 'sq-page-preview';
    canvas.style.cssText = 'width:100%;font-family:Arial,Helvetica,sans-serif;color:#28272c;--native-vw:5.2px;';
    const node = EzkartNative.create(config);
    canvas.append(node);
    const sheet = document.createElement('style');
    sheet.textContent = EzkartNative.stylesheet(canvas);
    for (const element of canvas.querySelectorAll('.sq-native')) {
      // CSS needs these selectors, but previews need no persisted configs,
      // editor-selection attributes or copies of the source JSON.
      for (const attr of [...element.attributes]) {
        if (attr.name.startsWith('data-') && !['data-native-id','data-native-type','data-native-text-field'].includes(attr.name)) element.removeAttribute(attr.name);
      }
    }
    shadow.append(sheet,canvas);
    return frame;
  }
  const categories = [
    ['text','Text & typography'],['buttons','Buttons & links'],['bulletins','Banners & bulletins'],
    ['features','Features & benefits'],['reviews','Reviews & testimonials'],['accordions','FAQ & accordions'],
    ['diagrams','Steps & diagrams'],['pricing','Pricing & services'],['facts','Numbers & details'],
    ['people','People & team'],['contact','Contact'],['invitations','Closing invitations'],['footers','Footers'],['code','Code artwork']
  ].map(([id,name])=>({id,name}));
  const sectionDefinitions = definitions.filter(item=>item.section || item.category==='accordions').map(item=>({...item,id:`asset-section-${item.id}`,assetId:item.id}));
  function createSection(id,sectionId) {
    const content = create(id.replace(/^asset-section-/,''));
    content.props.width='100%'; content.props.maxWidth='960px';
    const config = {id:sectionId,type:'container',tag:'section',name:content.name,props:{display:'flex',flexDirection:'column',alignItems:'center',...pad('56px'),backgroundColor:content.props.backgroundColor || '#fff'},responsive:[{max:700,props:pad('24px')}],children:[content]};
    const node = EzkartNative.create(config);
    node.classList.add('sq-page-block','sq-native-section');
    node.setAttribute('data-sq-block',''); node.dataset.sectionId=sectionId; node.dataset.sqSectionName=content.name;
    return node.outerHTML;
  }
  const choiceFamilies = {
    icon: {name:'Icons',description:'Choose an icon, then click or drag it onto your page.'},
    button: {name:'Buttons',description:'Choose a style. Edit its label and destination on the page.'},
    heading: {name:'Headings',description:'Choose the typography that fits your page.'},
    text: {name:'Paragraphs',description:'Choose a text style before adding your copy.'},
    container: {name:'Layouts',description:'Start with a column, row, or grid.'},
    accordion: {name:'Accordions',description:'Choose how your questions and answers appear.'},
    image: {name:'Images',description:'Use an upload or start with an image frame.'},
    video: {name:'Video',description:'Choose a video frame, then set its source on the page.'},
    commerce: {name:'Product controls',description:'Choose the part of your product you want to show.'},
    divider: {name:'Dividers',description:'Choose a line style.'}
  };
  const choice = (id,family,name,make) => ({id,family,name,make});
  const choices = [
    ...Object.keys(EzkartNativeIcons).map(icon=>choice(`icon-${icon}`,'icon',icon.replaceAll('-',' ').replace(/^./,c=>c.toUpperCase()),()=>({type:'icon',icon,props:{...EzkartNative.defaults.icon,width:'40px',height:'40px',color:ink}}))),
    ...['solid','outline','link'].map((style,i)=>choice(`button-${style}`,'button',['Solid button','Outline button','Text link'][i],()=>button('Learn more',style))),
    ...['display','editorial','section'].map((style,i)=>choice(`heading-${style}`,'heading',['Display heading','Editorial heading','Section heading'][i],()=>({...title('Your heading',{fontFamily:i===1?'Georgia, serif':'Arial, Helvetica, sans-serif',fontSize:['48px','48px','32px'][i],fontWeight:i===1?'400':'600',width:'fit-content',maxWidth:'100%'}),tag:i===2?'h2':'h1'}))),
    ...['body','lead','caption'].map((style,i)=>choice(`text-${style}`,'text',['Body text','Lead paragraph','Caption'][i],()=>text('Add your story or a useful detail.',{fontSize:['16px','22px','12px'][i],color:i===2?muted:ink,width:'fit-content',maxWidth:'100%'}))),
    ...['column','row','grid'].map((style,i)=>choice(`layout-${style}`,'container',['Column','Row','Grid'][i],()=>group([],{display:i===2?'grid':'flex',flexDirection:i===1?'row':'column',...(i===2?{gridTemplateColumns:'repeat(2, minmax(0, 1fr))'}:{}),flexWrap:'wrap',minHeight:'160px',width:'520px',maxWidth:'100%',...pad('24px'),...border('#ded8d2'),borderRadius:'12px'}))),
    ...['ruled','cards','numbered'].map(style=>choice(`faq-${style}`,'accordion',definitions.find(item=>item.id===`accordion-${style}`).name,()=>recipes.find(item=>item.id===`accordion-${style}`).make())),
    ...['landscape','square','portrait'].map((shape,i)=>choice(`image-${shape}`,'image',['Landscape frame','Square frame','Portrait frame'][i],()=>({type:'image',alt:'',props:{...EzkartNative.defaults.image,width:['360px','280px','240px'][i],height:['240px','280px','320px'][i],backgroundColor:'#f3f1f4',borderRadius:'8px'}}))),
    ...['wide','square','portrait'].map((shape,i)=>choice(`video-${shape}`,'video',['Wide video','Square video','Portrait video'][i],()=>({type:'video',controls:true,props:{...EzkartNative.defaults.video,width:['480px','320px','240px'][i],height:['270px','320px','426px'][i],maxWidth:'100%',backgroundColor:'#27232b',borderRadius:'12px'}}))),
    ...['image','title','price','options','quantity','add'].map((part,i)=>choice(`commerce-${part}`,'commerce',['Product image','Product title','Price','Variant options','Quantity','Add to cart'][i],()=>({type:'commerce',part,props:{...EzkartNative.defaults.commerce,width:part==='image'?'320px':'fit-content',maxWidth:'100%'}}))),
    ...['solid','dashed','dotted'].map(style=>choice(`divider-${style}`,'divider',style[0].toUpperCase()+style.slice(1)+' line',()=>group([],{width:'420px',maxWidth:'100%',height:'1px',borderTopWidth:'1px',borderTopStyle:style,borderTopColor:'#aaa3ad'})))
  ];
  function createChoice(id,options={}) {
    const item=choices.find(item=>item.id===id);
    if(!item)throw Error('Choose an option first.');
    const node=cloneRecipe(item.make(),'choice');if(node.type==='commerce')node.productId=options.productId;
    node.name=item.name;node.props={fontFamily:'Arial, Helvetica, sans-serif',color:ink,flexShrink:'0',...node.props};
    EzkartNative.validate(node);return node;
  }
  function previewChoice(id) {
    const item=choices.find(item=>item.id===id),config=createChoice(id,{productId:'preview-product'});
    const frame=document.createElement('div');
    frame.style.cssText='display:flex;align-items:center;justify-content:center;width:520px;min-height:180px;padding:24px;box-sizing:border-box;color:#28272c;';
    if(item.family==='icon'){
      frame.style.width='80px';frame.style.minHeight='80px';frame.style.padding='8px';
      frame.innerHTML=`<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${EzkartNativeIcons[config.icon]}</svg>`;
    }else if(['container','image','video','commerce'].includes(item.family)){
      const samples={container:config.props.display==='grid'?'▧':config.props.flexDirection==='row'?'▥':'▤',image:'▧',video:'▷',commerce:({image:'▧',title:'Product name',price:'Your price',options:'Size   ▾',quantity:'−   1   +',add:'Add to cart'})[config.part]};
      if(item.family==='container'){
        const grid=config.props.display==='grid',row=config.props.flexDirection==='row';
        frame.innerHTML=`<span style="display:grid;grid-template-columns:${grid?'1fr 1fr':row?'1fr 1fr 1fr':'1fr'};gap:12px;width:360px;height:150px;padding:14px;border:2px solid #ded8d2;border-radius:12px;background:#fff">${Array.from({length:grid?4:3},()=>'<span style="display:block;min-height:16px;background:#e9e2dd;border:1px solid #d9d0c9;border-radius:5px"></span>').join('')}</span>`;
      }else if(item.family==='image'||item.family==='video'){
        frame.innerHTML=`<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${EzkartNativeIcons[item.family==='video'?'play':'image']}</svg>`;
      }else frame.innerHTML=`<span style="font:500 38px/1.4 Arial,sans-serif">${samples[item.family]}</span>`;
      if(item.family==='image'||item.family==='video'){frame.style.width=config.props.width;frame.style.height=config.props.height;frame.style.background=config.props.backgroundColor;frame.style.color=item.family==='video'?'#fff':'#aea3b2';frame.style.borderRadius='12px';}
    }else{
      if(item.family==='button'){frame.style.width='160px';frame.style.minHeight='96px';frame.style.padding='8px';}
      const node=EzkartNative.create(config);
      const paint=(element,data)=>{
        [...element.attributes].filter(a=>a.name==='id'||a.name==='class'||a.name.startsWith('data-')).forEach(a=>element.removeAttribute(a.name));
        Object.assign(element.style,{boxSizing:'border-box',margin:'0',...EzkartNative.defaults[data.type],...data.props});
        (data.children || []).forEach((child,i)=>paint(element.children[i],child));
      };paint(node,config);frame.append(node);
    }
    frame.inert=true;return frame;
  }
  globalThis.EzkartAssets = {definitions,categories,sectionDefinitions,create,preview,createSection,choiceFamilies,choices:choices.map(({make,...item})=>item),createChoice,previewChoice};
})();
