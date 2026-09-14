// Rebuild the Ezkart.id reference through the public MCP tools.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {join} from 'node:path';
import {repoRoot} from '../workspace.mjs';
const client=new Client({name:'ezkart-reference-designer',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[join(repoRoot,'tools/builder-mcp/server.mjs')]});
const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});if(result.isError)throw Error(result.content[0]?.text);return JSON.parse(result.content[0].text);};
try{
 await client.connect(transport);
 await call('project_create',{id:process.argv[2]||'ezkart-id-remake',name:'Ezkart.id — Rebuilt in Ezkart',productIds:[]});
 await call('theme_update',{accent:'#f44b34',page:'#ffffff',ink:'#222222',surface:'#ffffff',radius:9,buttonBackground:'#242424',buttonText:'#ffffff'});
 for(const [component,id] of [['brand-navigation','navigation'],['centered-showcase','top'],['feature-showcase','builders'],['device-showcase','landing-pages'],['film-showcase','in-motion'],['journey-timeline','how-it-works'],['support-questions','questions'],['contact-invitation','get-started'],['brand-footer','footer']])await call('section_add',{component,id});
 await call('section_remove',{id:'blank'});await call('project_save');
 console.log(JSON.stringify(await call('page_export'),null,2));
}finally{await client.close();}
