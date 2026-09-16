import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const MAX_PACKAGE_BYTES = 50_000_000;
export function enforceBudget(bytes) {
  if (bytes > MAX_PACKAGE_BYTES)
    throw Error(`Template exceeds the 50 MB limit (${bytes} bytes).`);
}
export async function inspectPackage(id, root = repo) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
    throw Error("Invalid template ID.");
  const directory = join(root, "cart/admin/templates", id),
    manifest = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    );
  if (
    manifest.id !== id ||
    manifest.schemaVersion !== 1 ||
    !manifest.approval?.recipeSha256
  )
    throw Error("Template approval and schema are required.");
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw Error("Package assets must be regular files.");
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(directory);
  // Count and include the complete shared builder runtime conservatively, including
  // styles and fonts that may be selected by the normal exporter.
  const dependencies = [
    "cart/admin/admin.js",
    "cart/admin/admin.css",
    "cart/admin/builder-native.js",
    "cart/admin/builder-native.css",
    "cart/admin/builder-native-icons.js",
    "cart/admin/builder-commerce.js",
    "cart/admin/builder-backgrounds.js",
    "cart/admin/builder-templates.js",
    "cart/admin/builder-publish.js",
    "cart/admin/builder-templates.css",
  ];
  dependencies.push("cart/admin/templates/index.json");
  for (const entry of await readdir(join(root, "cart/admin"))) {
    if (/^builder-.*\.(js|css)$/.test(entry))
      dependencies.push("cart/admin/" + entry);
  }
  for (const file of dependencies) files.push(join(root, file));
  await walk(join(root, "cart/admin/assets/fonts"));
  const records = [];
  for (const file of [...new Set(files)].sort()) {
    const data = await readFile(file);
    records.push({
      path: relative(root, file),
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  }
  const bytes = records.reduce((sum, file) => sum + file.bytes, 0);
  enforceBudget(bytes);
  for (const path of [
    manifest.recipe,
    manifest.thumbnail,
    ...manifest.previews,
  ]) {
    const target = resolve(directory, path);
    if (!target.startsWith(directory + "/"))
      throw Error("Invalid package path.");
    await stat(target);
  }
  const recipe = JSON.parse(
    await readFile(join(directory, manifest.recipe), "utf8"),
  );
  const ids = new Set();
  function check(node) {
    if (!node.id || ids.has(node.id))
      throw Error("Duplicate or missing element ID.");
    ids.add(node.id);
    if (node.src?.$asset) {
      const path = node.src.$asset;
      if (
        !path.startsWith(id + "/design/") ||
        path.includes("..") ||
        !records.some((file) => file.path === "cart/admin/templates/" + path)
      )
        throw Error("Template design image is missing or outside its package.");
    }
    if (
      node.type === "commerce" &&
      node.part !== "cart" &&
      !["set-price", "set-add"].includes(node.part) &&
      !/^product(?:[1-4]Product)?Id$/.test(node.productId?.$bind || "")
    )
      throw Error("Commerce must bind the merchant product.");
    if (
      ["set-price", "set-add"].includes(node.part) &&
      !/^set[1-3]ProductIds$/.test(node.productIds?.$bind || "")
    )
      throw Error("Product sets must bind merchant products.");
    if (
      typeof node.src === "string" &&
      /127\.0\.0\.1|localhost|\/preview\//.test(node.src)
    )
      throw Error("Demo image in applied recipe.");
    (node.children || []).forEach(check);
  }
  recipe.forEach(check);
  if (!manifest.productSlot || !ids.has(manifest.productSlot))
    throw Error("Every template needs an editable product section and an empty product slot.");
  return {
    id,
    version: manifest.version,
    bytes,
    limit: MAX_PACKAGE_BYTES,
    sections: recipe.length,
    nativeElements: ids.size,
    files: records,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [id = "pith", output] = process.argv.slice(2);
  const report = await inspectPackage(id);
  if (output) {
    const destination = resolve(output);
    await mkdir(dirname(destination), { recursive: true });
    const result = spawnSync(
      "tar",
      [
        "-czf",
        destination,
        "-C",
        repo,
        ...report.files.map((file) => file.path),
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0)
      throw Error(result.stderr || "Package could not be created.");
    await writeFile(
      destination + ".json",
      JSON.stringify(report, null, 2) + "\n",
    );
    report.artifact = destination;
  }
  console.log(JSON.stringify(report, null, 2));
}
