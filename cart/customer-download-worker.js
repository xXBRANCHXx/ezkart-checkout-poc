'use strict';
// One locked OPFS file and an append-only recovery journal. Only a verified,
// flushed original part may produce a receipt proof for the customer page.
let fileHandle=null,bytesHandle=null,journalHandle=null,journalLength=0,current=null,queue=Promise.resolve();
const encoder=new TextEncoder(),hex=bytes=>[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
const hash=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
function close(){bytesHandle?.close();journalHandle?.close();bytesHandle=journalHandle=null;}
function writeAll(handle,bytes,at){let offset=0;while(offset<bytes.length){const written=handle.write(bytes.subarray(offset),{at:at+offset});if(!written)throw Error('Your browser could not store the file. Free some space and retry.');offset+=written;}}
function readAll(handle,length,at=0){const bytes=new Uint8Array(length);let offset=0;while(offset<length){const n=handle.read(bytes.subarray(offset),{at:at+offset});if(!n)return null;offset+=n;}return bytes;}
async function init({scope}){
  if(!/^[a-f0-9]{64}$/.test(scope))throw Error('Download storage reference is invalid.');
  close();current=null;
  const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('ezkart-downloads',{create:true});
  try{
    const journal=await dir.getFileHandle(scope+'.journal',{create:true});journalHandle=await journal.createSyncAccessHandle();
    fileHandle=await dir.getFileHandle(scope+'.data',{create:true});bytesHandle=await fileHandle.createSyncAccessHandle();
    const size=journalHandle.getSize();if(size>65536)throw Error('The saved download record is too large. Remove the browser copy before starting again.');
    const raw=readAll(journalHandle,size);if(!raw)throw Error('Your saved download record could not be read.');
    journalLength=raw.lastIndexOf(10)+1;const source=new TextDecoder('utf-8',{fatal:true}).decode(raw.subarray(0,journalLength));
    for(const line of source.split('\n').filter(Boolean)){
      let value;try{value=JSON.parse(line);}catch{throw Error('Your saved download record is damaged. Remove the browser copy before starting again.');}
      if(typeof value.body!=='string'||value.hash!==await hash(encoder.encode(value.body)))throw Error('Your saved download record is damaged. Remove the browser copy before starting again.');
      current=JSON.parse(value.body);
    }
    // An incomplete last line predates any acknowledged journal write. It is
    // discarded only when appending the next fully checked recovery record.
    return {journal:current,size:bytesHandle.getSize()};
  }catch(error){close();throw error;}
}
async function saveJournal(value){
  if(!journalHandle)throw Error('Download storage is closed. Resume the download.');
  const body=JSON.stringify(value),line=encoder.encode(JSON.stringify({body,hash:await hash(encoder.encode(body))})+'\n');
  if(line.length>8000||journalLength+line.length>65536)throw Error('The saved download record is full. Remove the browser copy before starting again.');
  journalHandle.truncate(journalLength);writeAll(journalHandle,line,journalLength);journalHandle.flush();
  const check=readAll(journalHandle,line.length,journalLength);
  if(!check||await hash(check)!==await hash(line))throw Error('Your browser could not save the download reference. Retry before downloading.');
  journalLength+=line.length;current=value;return {saved:true};
}
async function part({number,length,checksum,grant,nonce,bytes}){
  if(!bytesHandle||!Number.isInteger(number)||number<1||number>100||!Number.isInteger(length)||length<1||length>5242880
    ||!/^[a-f0-9]{64}$/.test(checksum)||!/^dgrant_[a-f0-9]{32}$/.test(grant)||nonce!==null&&!/^[a-f0-9]{64}$/.test(nonce))throw Error('The file verification details are invalid.');
  const at=(number-1)*5242880;
  if(bytes){
    const value=new Uint8Array(bytes);
    if(value.length!==length||await hash(value)!==checksum)throw Error('This file part is incomplete or changed. Resume to retry it.');
    writeAll(bytesHandle,value,at);bytesHandle.flush();
  }
  const saved=bytesHandle.getSize()>=at+length?readAll(bytesHandle,length,at):null;
  if(!saved||await hash(saved)!==checksum)return {present:false};
  if(nonce===null)return {present:true};
  const prefix=encoder.encode(`ezkart-digital-part-v1\n${grant}\n${number}\n${nonce}\n`),proof=new Uint8Array(prefix.length+saved.length);
  proof.set(prefix);proof.set(saved,prefix.length);return {present:true,proof:await hash(proof)};
}
async function action(data){
  if(data.kind==='init')return init(data);
  if(data.kind==='journal')return saveJournal(data.value);
  if(data.kind==='part')return part(data);
  if(data.kind==='finish'){
    if(!bytesHandle||!Number.isSafeInteger(data.size)||data.size<1||bytesHandle.getSize()!==data.size)throw Error('The saved file is incomplete. Resume its download.');
    bytesHandle.flush();close();return {file:await fileHandle.getFile()};
  }
  if(data.kind==='close'){close();return {};}
  if(data.kind==='remove'){
    close();if(!/^[a-f0-9]{64}$/.test(data.scope))throw Error('Download storage reference is invalid.');
    const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('ezkart-downloads',{create:true});
    for(const suffix of ['.data','.journal'])try{await dir.removeEntry(data.scope+suffix);}catch(e){if(e.name!=='NotFoundError')throw e;}
    return {};
  }
  throw Error('Download storage request is invalid.');
}
self.addEventListener('message',event=>{
  const {id,...data}=event.data;queue=queue.then(async()=>{
    try{self.postMessage({id,ok:true,...await action(data)});}catch(error){self.postMessage({id,ok:false,error:error.name==='NoModificationAllowedError'?'This download is already open in another tab. Close it there and resume here.':error.message||'Your browser could not store this download.'});}
  });
});
