<?php
declare(strict_types=1);

$nonce = base64_encode(random_bytes(18));
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; img-src 'self' data: https:; media-src data: https:; style-src 'unsafe-inline' https:; script-src 'nonce-{$nonce}'; font-src 'self' data: https:; connect-src 'none'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin");
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1440,initial-scale=1">
  <title>Landing page thumbnail renderer</title>
  <style>html,body{width:1440px;min-width:1440px;height:810px;margin:0;overflow:hidden;background:#fff}</style>
  <script nonce="<?= htmlspecialchars($nonce, ENT_QUOTES, 'UTF-8') ?>" src="assets/vendor/html2canvas.min.js"></script>
</head>
<body>
  <script nonce="<?= htmlspecialchars($nonce, ENT_QUOTES, 'UTF-8') ?>">
    (() => {
      "use strict";
      const postFailure = (error) => parent.postMessage({ type: "ezkart-thumbnail-failed", message: error instanceof Error ? error.message : String(error || "Desktop thumbnail rendering failed.") }, "*");
      const waitForImages = async (root) => {
        const pending = [...root.querySelectorAll("img")].filter((image) => !image.complete).map((image) => new Promise((resolve) => {
          const finish = () => resolve();
          image.addEventListener("load", finish, { once: true });
          image.addEventListener("error", finish, { once: true });
        }));
        await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, 5000))]);
      };
      const canvasBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
      const blobDataUrl = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Thumbnail encoding failed."));
        reader.readAsDataURL(blob);
      });
      const encodeThumbnail = async (canvas) => {
        const maximumBytes = 300 * 1024;
        let blob = null;
        for (const quality of [0.64, 0.54, 0.44, 0.34]) {
          blob = await canvasBlob(canvas, "image/webp", quality);
          if (blob?.type === "image/webp" && blob.size <= maximumBytes) break;
        }
        if (!blob || blob.type !== "image/webp") {
          for (const quality of [0.58, 0.46, 0.34]) {
            blob = await canvasBlob(canvas, "image/jpeg", quality);
            if (blob && blob.size <= maximumBytes) break;
          }
        }
        if (!blob || blob.size > maximumBytes) throw new Error("Thumbnail could not be compressed below 300 KB.");
        return blobDataUrl(blob);
      };
      const removeUnsupportedColorFunctions = (rules) => [...rules].forEach((rule) => {
        if (rule.cssRules) removeUnsupportedColorFunctions(rule.cssRules);
        if (!rule.style) return;
        [...rule.style].forEach((property) => {
          if (/(?:color-mix|oklch|oklab|lab|lch|color)\(/i.test(rule.style.getPropertyValue(property))) rule.style.removeProperty(property);
        });
      });
      addEventListener("message", async (event) => {
        if (event.source !== parent || !event.data || event.data.type !== "ezkart-render-thumbnail" || typeof event.data.html !== "string") return;
        try {
          if (event.data.html.length > 18000000) throw new Error("This landing page is too large to render a library preview.");
          if (typeof window.html2canvas !== "function") throw new Error("Thumbnail renderer could not load.");
          const parsed = new DOMParser().parseFromString(event.data.html, "text/html");
          parsed.querySelectorAll("script,iframe,object,embed,base,meta[http-equiv]").forEach((element) => element.remove());
          parsed.querySelectorAll("*").forEach((element) => [...element.attributes].forEach((attribute) => {
            if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
          }));
          parsed.head.querySelectorAll('style,link[rel="stylesheet"]').forEach((element) => document.head.append(document.importNode(element, true)));
          [...document.styleSheets].forEach((sheet) => {
            try { removeUnsupportedColorFunctions(sheet.cssRules); } catch (_) {}
          });
          [...parsed.body.childNodes].forEach((node) => document.body.append(document.importNode(node, true)));
          const root = document.querySelector(".sq-page-preview");
          if (!root) throw new Error("Desktop preview did not initialize.");
          root.style.width = "1440px";
          root.style.minWidth = "1440px";
          root.style.maxWidth = "none";
          root.querySelectorAll("img").forEach((image) => { image.loading = "eager"; image.decoding = "sync"; });
          root.querySelectorAll(".sq-element-animate,.animating").forEach((element) => element.classList.remove("sq-element-animate", "animating"));
          await waitForImages(root);
          if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const rendered = await window.html2canvas(root, {
            allowTaint: false,
            backgroundColor: getComputedStyle(root).getPropertyValue("--site-page").trim() || "#ffffff",
            foreignObjectRendering: false,
            height: 810,
            imageTimeout: 5000,
            logging: false,
            scale: 0.5,
            scrollX: 0,
            scrollY: 0,
            useCORS: true,
            width: 1440,
            windowHeight: 810,
            windowWidth: 1440,
          });
          parent.postMessage({ type: "ezkart-thumbnail-rendered", dataUrl: await encodeThumbnail(rendered) }, "*");
        } catch (error) {
          postFailure(error);
        }
      }, { once: true });
      parent.postMessage({ type: "ezkart-thumbnail-renderer-ready" }, "*");
    })();
  </script>
</body>
</html>
