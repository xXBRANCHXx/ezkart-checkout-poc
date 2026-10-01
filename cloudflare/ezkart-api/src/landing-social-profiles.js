import '../../../cart/admin/builder-media.js';
import {decodeHTMLAttribute} from 'entities';

export const socialProfile = globalThis.EzkartMedia.socialProfile;
export const socialProfileError = globalThis.EzkartMedia.socialError;
const voidTags=new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));

// Parse actual dedicated surfaces. General navigation, buttons, custom anchors
// and scripts are intentionally outside this policy. Drafts keep invalid source
// values for visible editor repair, but those values never become profile links.
export async function normalizeSocialHtml(source) {
  source=String(source||'');
  if(!/\bdata-(?:sq-native|native-type|image-extras|image-footer)\b/i.test(source))return {html:source,error:''};
  let error='';const stack=[];
  const invalid=()=>{error ||= socialProfileError;};
  const normalizeLinks=links=>{
    if(!Array.isArray(links)||links.length>8){invalid();return links;}
    return links.map(link=>{
      if(!link||typeof link!=='object'){invalid();return link;}
      if(!String(link.url||'').trim())return link;
      const profile=socialProfile(link.url,link.provider||'');
      if(!profile||String(link.label||'').length>80){invalid();return link;}
      return {...link,url:profile.url,provider:profile.provider};
    });
  };
  const html=await new HTMLRewriter().on('*',{element(element){
    const get=name=>{const value=element.getAttribute(name);return value===null?null:decodeHTMLAttribute(value);};
    let dedicated=get('data-native-type')==='social';
    const config=get('data-sq-native');
    if(config!==null){
      try{const data=JSON.parse(config);if(data.type==='social'){dedicated=true;data.links=normalizeLinks(data.links||[]);element.setAttribute('data-sq-native',JSON.stringify(data));}}
      catch{if(dedicated)invalid();}
    }
    const extras=get('data-image-extras');
    if(extras!==null){
      try{const data=JSON.parse(extras);if(data.footer?.links){data.footer.links=normalizeLinks(data.footer.links);element.setAttribute('data-image-extras',JSON.stringify(data));}}
      catch{invalid();}
    }
    const footer=get('data-image-footer')!==null||stack.some(item=>item.footer);
    dedicated ||= stack.some(item=>item.dedicated)||(footer&&String(get('class')||'').split(/\s+/).includes('sq-social-links'));
    if(dedicated&&element.tagName==='a'){
      const profile=socialProfile(get('href'),get('data-social-profile')||'');
      if(!profile){invalid();element.remove();}
      else{element.setAttribute('href',profile.url);element.setAttribute('data-social-profile',profile.provider);element.setAttribute('target','_blank');element.setAttribute('rel','noopener noreferrer');}
    }
    if(!voidTags.has(element.tagName)){
      const item={footer,dedicated};stack.push(item);element.onEndTag(()=>{const index=stack.indexOf(item);if(index>=0)stack.splice(index);});
    }
  }}).transform(new Response(String(source||''))).text();
  return {html,error};
}

export async function normalizeSocialState(state) {
  if(!state||typeof state!=='object'||typeof state.preview!=='string')return state;
  return {...state,preview:(await normalizeSocialHtml(state.preview)).html};
}

export async function validateSocialProfiles({html,state}) {
  for(const source of [html,state?.preview]){
    if(!source)continue;const {error}=await normalizeSocialHtml(source);if(error)return error;
  }
  return '';
}
