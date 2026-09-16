import "../../../cart/admin/builder-publish.js";

// Parse actual elements, so IDs in comments, scripts, or a product list do not count.
export async function purchaseGroups(html, draft = false) {
  const groups = [],
    stack = [];
  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  await new HTMLRewriter()
    .on("*", {
      element(element) {
        const get = (key) => element.getAttribute(key);
        const blocked =
          stack.some((item) => item.blocked) ||
          ["script", "style", "template", "noscript"].includes(
            element.tagName,
          ) ||
          EzkartPublish.hidden(get);
        const ids = EzkartPublish.fromAttributes((key) =>
          key === "data-product-card" && !draft ? null : get(key),
        );
        if (!blocked && element.tagName === "button") {
          if (get("data-ezkart-add")) groups.push(ids);
          if (
            get("data-commerce-add") !== null ||
            get("data-commerce-set") !== null ||
            (draft && stack.at(-1)?.tag === "footer")
          ) {
            const candidate = [...stack]
              .reverse()
              .find((item) => item.ids.length);
            if (candidate) groups.push(candidate.ids);
          }
        }
        if (!voidTags.has(element.tagName)) {
          const item = { blocked, ids, tag: element.tagName };
          stack.push(item);
          element.onEndTag(() => {
            const i = stack.indexOf(item);
            if (i >= 0) stack.splice(i);
          });
        }
      },
    })
    .transform(new Response(String(html || "")))
    .text();
  return groups;
}

export async function validatePublication({ html, state, products }) {
  if (!String(html || "").trim())
    return "Preview your page and add a product before publishing.";
  const groups = await purchaseGroups(html);
  const draftGroups = await purchaseGroups(state?.preview, true);
  const draftIds = new Set(draftGroups.flat());
  return EzkartPublish.check(
    groups.filter((ids) =>
      ids.every((id) => draftIds.has(id) || draftIds.has(id.split("::")[0])),
    ),
    products,
  );
}
