import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {webcrypto} from 'node:crypto';

const repo = process.argv[2];
if (!repo) throw new Error('Usage: node inventory.mjs <repository>');
// Metadata enumeration does not instantiate native nodes or basic icon choices.
const context = vm.createContext({crypto:webcrypto,EzkartNativeIcons:{}});
for (const name of ['builder-asset-packs.js','builder-assets.js']) {
  const file = path.join(repo,'cart/admin',name);
  if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:name});
}
if (!context.EzkartAssets) throw new Error('The native asset catalogue did not load.');
process.stdout.write(JSON.stringify({categories:context.EzkartAssets.categories,definitions:context.EzkartAssets.definitions},null,2)+'\n');
