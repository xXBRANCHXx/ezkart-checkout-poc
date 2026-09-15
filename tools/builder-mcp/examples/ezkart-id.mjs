// Ezkart.id reconstructed with the same primitives and property controls in the Add panel.
// This example contains no page HTML, CSS selectors, source classes, or custom script.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { repoRoot } from "../workspace.mjs";
const id = process.argv[2] || "ezkart-native-exact";
const client = new Client({ name: "ezkart-native-author", version: "1.0.0" }),
  log = [];
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 180000,
  });
  if (result.isError) throw Error(result.content[0]?.text);
  log.push({ tool: name, arguments: args });
  return JSON.parse(result.content[0].text);
};
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(repoRoot, "tools/builder-mcp/server.mjs")],
    }),
  );
  await call("project_create", {
    id,
    name: "Ezkart.id — Native builder",
    productIds: [],
  });
  await call("theme_update", {
    accent: "#f44b34",
    page: "#ffffff",
    ink: "#222222",
    surface: "#ffffff",
    radius: 9,
    buttonBackground: "#242424",
    buttonText: "#ffffff",
  });
  const recipe = JSON.parse(
    await readFile(new URL("./ezkart-native.json", import.meta.url), "utf8"),
  );
  for (const node of recipe) {
    await call("section_add", { component: "blank", id: node.id });
    await call("native_add", { section: node.id, node });
  }
  await call("section_remove", { id: "blank" });
  await call("project_save");
  console.log(JSON.stringify(await call("page_export"), null, 2));
  const directory = join(
    process.env.EZKART_WORKSPACE ||
      join(homedir(), ".local/share/ezkart-builder"),
    "logs",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${id}-native-authoring.json`),
    JSON.stringify(log, null, 2),
  );
} finally {
  await client.close();
}
