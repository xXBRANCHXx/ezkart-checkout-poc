// Create a new editable page using the public template tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { repoRoot } from "../workspace.mjs";
const [templateId, id, productId, brandName] = process.argv.slice(2);
if (!templateId || !id || !productId || !brandName)
  throw Error(
    'Usage: node examples/template.mjs TEMPLATE PAGE_ID PRODUCT_ID[,PRODUCT_ID...]|- "Store name"',
  );
const productIds = productId === "-" ? [] : productId.split(",").filter(Boolean);
const directory =
  process.env.EZKART_WORKSPACE ||
  join(homedir(), ".local/share/ezkart-builder");
const client = new Client({ name: "template-author", version: "1.0.0" }),
  log = [];
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 180000,
  });
  if (result.isError) throw Error(result.content[0]?.text);
  const data = JSON.parse(result.content[0].text);
  log.push({ tool: name, arguments: args, result: data });
  return data;
};
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(repoRoot, "tools/builder-mcp/server.mjs")],
      env: { ...process.env, EZKART_WORKSPACE: directory },
    }),
  );
  await call("project_create", {
    id,
    name: brandName.slice(0, 60),
    productIds,
  });
  await call("template_apply", { templateId, productIds, brandName });
  await call("project_save");
  const exported = productIds.length ? await call("page_export") : null;
  const audit = await call("page_audit");
  await mkdir(join(directory, "logs"), { recursive: true });
  await writeFile(
    join(directory, "logs", id + "-template.json"),
    JSON.stringify(log, null, 2) + "\n",
  );
  console.log(JSON.stringify({ exported, audit }, null, 2));
} finally {
  await client.close();
}
