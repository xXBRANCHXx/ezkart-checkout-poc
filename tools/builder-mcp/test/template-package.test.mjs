import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enforceBudget,
  inspectPackage,
  MAX_PACKAGE_BYTES,
} from "../../templates/package.mjs";
test("The complete template package includes preview assets and runtime and obeys the hard 50 MB cap", async () => {
  const report = await inspectPackage("pith");
  assert.ok(report.bytes > 1_000_000 && report.bytes < MAX_PACKAGE_BYTES);
  assert.ok(
    report.files.some((file) =>
      file.path.includes("preview/assets/grapefruit"),
    ),
  );
  assert.ok(report.files.some((file) => file.path.endsWith("/admin.js")));
  assert.ok(report.files.some((file) => file.path.endsWith("/anton.woff2")));
  enforceBudget(MAX_PACKAGE_BYTES);
  assert.throws(() => enforceBudget(MAX_PACKAGE_BYTES + 1), /50 MB/);
});
