// Provider money can exceed JavaScript's exact numeric range. Keep JSON number
// tokens verbatim, and reject duplicate keys before deriving accounting facts.
export class FinancialJsonNumber { constructor(value){this.value=value;} }
export function parseFinancialEvidenceJSON(raw){
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>48000)throw Error('Financial evidence size is invalid');
  let index=0;
  const whitespace=()=>{while(/[\t\n\r ]/.test(raw[index]||'')&&index<raw.length)index++;};
  const string=()=>{
    const start=index++;let escaped=false;
    while(index<raw.length){
      const char=raw[index++];if(escaped){escaped=false;continue;}if(char==='\\'){escaped=true;continue;}
      if(char==='"'){
        const result=JSON.parse(raw.slice(start,index));
        for(const point of result){const code=point.codePointAt(0);if(code>=0xd800&&code<=0xdfff)throw Error('Unpaired JSON surrogate');}
        return result;
      }
    }
    throw Error('Unterminated JSON string');
  };
  const value=depth=>{
    if(depth>24)throw Error('Financial evidence is too deeply nested');
    whitespace();const char=raw[index];
    if(char==='"')return string();
    if(char==='{'||char==='['){
      index++;whitespace();const object=char==='{',result=object?Object.create(null):[],close=object?'}':']';
      if(raw[index]===close){index++;return result;}
      while(index<raw.length){
        whitespace();let key;
        if(object){if(raw[index]!=='"')throw Error('Invalid JSON key');key=string();if(Object.hasOwn(result,key))throw Error('Duplicate JSON key');whitespace();if(raw[index++]!==':')throw Error('Invalid JSON separator');}
        const entry=value(depth+1);if(object)result[key]=entry;else result.push(entry);
        whitespace();const next=raw[index++];if(next===close)return result;if(next!==',')throw Error('Invalid JSON separator');
      }
      throw Error('Unterminated JSON container');
    }
    const literal=/^(true|false|null)/.exec(raw.slice(index));
    if(literal){index+=literal[0].length;return {true:true,false:false,null:null}[literal[0]];}
    const number=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(raw.slice(index));
    if(!number)throw Error('Invalid JSON value');index+=number[0].length;return new FinancialJsonNumber(number[0]);
  };
  const result=value(0);whitespace();if(index!==raw.length)throw Error('Trailing JSON content');return result;
}
