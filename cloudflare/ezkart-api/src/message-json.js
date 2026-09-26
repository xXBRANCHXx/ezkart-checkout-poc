// Reject ambiguous object keys before normal JSON decoding. The bounded HTTP
// reader controls bytes; this scan also bounds nesting and checks escaped keys.
export function parseMessageJSON(raw){
  let at=0;
  const space=()=>{while(at<raw.length&&/[\x20\t\r\n]/.test(raw[at]))at++;};
  const string=()=>{const start=at++;let escaped=false;while(at<raw.length){const c=raw[at++];if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(c==='"')return JSON.parse(raw.slice(start,at));}throw Error();};
  function value(depth){
    if(depth>12)throw Error();space();const c=raw[at];if(c==='"'){string();return;}
    if(c==='{'||c==='['){at++;space();const end=c==='{'?'}':']',keys=new Set();if(raw[at]===end){at++;return;}
      while(true){space();if(c==='{'){if(raw[at]!=='"')throw Error();const key=string();if(keys.has(key))throw Error();keys.add(key);space();if(raw[at++]!==':')throw Error();}
        value(depth+1);space();const next=raw[at++];if(next===end)return;if(next!==',')throw Error();}}
    const token=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(raw.slice(at));if(!token)throw Error();at+=token[0].length;
  }
  value(0);space();if(at!==raw.length)throw Error();return JSON.parse(raw);
}
