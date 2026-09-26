import {campaignValues} from './marketing-campaigns.js';
import {emailAddress,campaignUnsubscribeHeaders} from './email-provider.js';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const invalid=()=>{throw Object.assign(new Error('The saved campaign content is incomplete or invalid.'),{code:'email_request_invalid',noEffect:true});};

// Render exactly once as part of the atomic token/outbox write. A later retry
// must use that saved string, even after a draft or store name changes.
export function campaignEmailPayload(configuration,source,email,deliveryId,unsubscribeUrl){
  let values;try{values=campaignValues(source?.values);}catch{invalid();}
  if(configuration?.ready!==true||!emailAddress(configuration.sender)||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(configuration.profile||'')
    ||!emailAddress(email)||!/^campmail_[a-f0-9]{32}$/.test(deliveryId||'')||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(source.sellerId||'')
    ||typeof source.storeName!=='string'||!source.storeName.trim()||source.storeName.length>160||/[\u0000-\u001f\u007f]/.test(source.storeName)
    ||typeof source.shopEnabled!=='boolean'||values.archived||!values.subject||!values.heading||!values.body
    ||values.buttonLabel&&!source.shopEnabled)invalid();
  const headers=campaignUnsubscribeHeaders(configuration,unsubscribeUrl),sandbox=configuration.environment==='sandbox';
  const shop=configuration.origin+'/shop/?store='+encodeURIComponent(source.sellerId),environment=sandbox?'Ezkart TEST · Sandbox campaign':'Ezkart';
  const footer='You gave '+source.storeName+' permission to send promotional emails to this address.';
  const choice='Unsubscribing does not change your order or delivery notification choices.';
  const text=[environment,source.storeName,values.heading,values.body,values.buttonLabel?values.buttonLabel+': '+shop:'',footer,
    'Stop promotional emails: '+unsubscribeUrl,choice].filter(Boolean).join('\n\n');
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(values.subject)}</title></head><body style="margin:0;background:#f6f6fa;color:#282534;font:15px/1.65 Arial,sans-serif">${values.preheader?'<div aria-hidden="true" style="display:none;max-height:0;overflow:hidden;mso-hide:all">'+escape(values.preheader)+'</div>':''}<table role="presentation" style="width:100%;table-layout:fixed;border-collapse:collapse"><tr><td style="padding:28px 16px"><table role="presentation" style="width:100%;max-width:600px;margin:auto;table-layout:fixed;border-collapse:collapse;overflow-wrap:anywhere;word-break:break-word"><tr><td style="padding:0 0 18px"><b style="font-size:26px;color:#ff4b2b">ez<span style="color:#222834">kart</span></b><p style="margin:4px 0 0;font-size:12px;color:#605970">${escape(environment)}</p></td></tr><tr><td style="padding:28px;background:#fff;border:1px solid #e5e3eb;border-radius:14px"><p style="margin:0 0 10px;font-size:13px;color:#6654b4">${escape(source.storeName)}</p><h1 style="font-size:26px;line-height:1.3;margin:0 0 18px">${escape(values.heading)}</h1><p style="margin:0 0 22px">${escape(values.body).replace(/\n/g,'<br>')}</p>${values.buttonLabel?'<a href="'+escape(shop)+'" style="display:inline-block;max-width:100%;box-sizing:border-box;padding:12px 20px;background:#6654d9;border-radius:9px;color:#fff;font-weight:bold;text-decoration:none">'+escape(values.buttonLabel)+'</a>':''}</td></tr><tr><td style="padding:18px 8px;font-size:12px;color:#605970"><p style="margin:0 0 10px">${escape(footer)}</p><a href="${unsubscribeUrl}" style="color:#5143b6">Stop promotional emails from ${escape(source.storeName)}</a><p style="margin:10px 0 0">${escape(choice)}</p></td></tr></table></td></tr></table></body></html>`;
  const payload=JSON.stringify({from:'Ezkart <'+configuration.sender+'>',to:[email],subject:(sandbox?'[Sandbox] ':'')+values.subject,html,text,headers,
    tags:[{name:'ezkart_environment',value:configuration.environment},{name:'ezkart_profile',value:configuration.profile},{name:'ezkart_delivery',value:deliveryId},{name:'ezkart_purpose',value:'campaign'}]});
  if(new TextEncoder().encode(payload).byteLength>65536)invalid();return payload;
}
