import {validateSocialProfiles} from './landing-social-profiles.js';
import "../../../cart/admin/builder-publish.js";
import { decodeHTMLAttribute } from "entities";

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
        // HTMLRewriter returns source attribute values; browser getAttribute()
        // decodes entities. Match the browser once before reading native JSON,
        // product IDs, and visibility rules from serialized builder HTML.
        const get = (key) => {
          const value = element.getAttribute(key);
          return value === null ? null : decodeHTMLAttribute(value);
        };
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
  const socialError=await validateSocialProfiles({html,state});if(socialError)return socialError;
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

// Only referenced commerce products participate. Sorting makes catalog query
// order irrelevant; visible variant changes also invalidate a frozen offer.
export async function publicationPriceBaseline(html, products) {
  const referenced = new Set((await purchaseGroups(html)).flat().map(id => id.split('::')[0]));
  return products.filter(product => referenced.has(product.id)).map(product => ({
    id:product.id,price:Number(product.price),
    variants:(product.variants || []).filter(variant => !variant.hidden).map(variant => ({id:variant.id,price:Number(variant.price)})).sort((a,b)=>a.id.localeCompare(b.id)),
  })).sort((a,b)=>a.id.localeCompare(b.id));
}
