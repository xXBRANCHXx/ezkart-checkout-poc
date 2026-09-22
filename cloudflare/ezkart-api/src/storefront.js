const parse = (value) => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
const imagePath = (id) => id ? `/v1/public/media/${encodeURIComponent(id)}` : "";
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,95}$/;
const defaults = { enabled: false, name: "", accent: "#334155", button: "#111827", background: "#f7f8fa", logoId: "", backgroundId: "", animation: "none" };

function settings(row) {
  return { ...defaults, ...parse(row.settings_json).storefront };
}

export async function storefrontIdentity(env, row) {
  const appearance = settings(row);
  const owner = await env.DB.prepare("SELECT auth_user_id FROM seller_memberships WHERE seller_id = ? ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at, auth_user_id LIMIT 1").bind(row.id).first();
  // Match existing landing-page checkout storage for the store owner.
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.APP_ENVIRONMENT}|${owner?.auth_user_id || row.id}`));
  const cartScope = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("").slice(0, 24);
  return { id: row.id, cartScope, ...appearance, name: appearance.name || row.name, logoPath: imagePath(appearance.logoId), backgroundPath: imagePath(appearance.backgroundId) };
}

export async function merchantStorefront(env, seller, payload = null) {
  const row = await env.DB.prepare("SELECT id, name, settings_json FROM sellers WHERE id = ? AND status = 'active'").bind(seller.id).first();
  if (!row) throw new Response("Store not found", { status: 404 });
  if (payload !== null) {
    if (seller.role === "viewer") throw new Response("You do not have permission to change this shop", { status: 403 });
    const next = {};
    if (typeof payload.enabled !== "boolean") throw new Response("Choose whether the shop is enabled", { status: 422 });
    next.enabled = payload.enabled;
    if (typeof payload.name !== "string" || !payload.name.trim() || payload.name.trim().length > 80) throw new Response("Enter a store name of up to 80 characters", { status: 422 });
    next.name = payload.name.trim();
    for (const key of ["accent", "button", "background"]) {
      if (!/^#[0-9a-f]{6}$/i.test(payload[key] || "")) throw new Response("Choose valid appearance colors", { status: 422 });
      next[key] = payload[key].toLowerCase();
    }
    if (!["none", "fade", "rise"].includes(payload.animation)) throw new Response("Choose an available animation", { status: 422 });
    next.animation = payload.animation;
    for (const key of ["logoId", "backgroundId"]) {
      const id = payload[key] || "";
      if (typeof id !== "string" || (id && !idPattern.test(id))) throw new Response("Choose a valid image", { status: 422 });
      if (id && !await env.DB.prepare("SELECT id FROM media_uploads WHERE seller_id = ? AND id = ?").bind(seller.id, id).first()) throw new Response("The image does not belong to this store", { status: 422 });
      next[key] = id;
    }
    const result = await env.DB.prepare("UPDATE sellers SET settings_json = json_set(settings_json, '$.storefront', json(?)), updated_at = ? WHERE id = ? AND settings_json = ?")
      .bind(JSON.stringify(next), new Date().toISOString(), row.id, row.settings_json).run();
    if (result.meta.changes !== 1) throw new Response("The shop changed while saving. Reload and try again", { status: 409 });
    row.settings_json = JSON.stringify({ ...parse(row.settings_json), storefront: next });
  }
  return storefrontIdentity(env, row);
}

function publicProduct(row, media, variants) {
  const options = variants.filter(v => !parse(v.options_json).hidden);
  const choices = (variants.length ? options : [row]).map(option => {
    const stock = Number(option.stock_quantity ?? row.stock_quantity ?? 0);
    const price = Number(option.price_amount ?? row.price_amount ?? 0);
    const weight = Number(option.weight_grams ?? row.weight_grams ?? 0);
    const variant = option !== row;
    return {
      id: row.id + (variant ? `~${option.id}` : ""),
      name: variant ? option.name : "Standard",
      price, stock,
      available: row.type === "physical" && stock > 0 && price > 0 && weight > 0,
      imagePath: imagePath(option.image_upload_id || media?.id),
    };
  });
  return { id: row.id, name: row.title, description: row.description, type: row.type, imagePath: imagePath(media?.id), choices };
}

export async function publicStorefront(env, url) {
  const productId = url.searchParams.get("product") || "";
  const storeId = url.searchParams.get("store") || "";
  const appearanceOnly = url.searchParams.get("mode") === "checkout" && !productId;
  if ((!productId && !storeId) || (productId && !idPattern.test(productId)) || (storeId && !idPattern.test(storeId))) throw new Response("Shop link is invalid", { status: 400 });
  const row = productId
    ? await env.DB.prepare("SELECT s.id, s.name, s.settings_json FROM sellers s JOIN products p ON p.seller_id = s.id WHERE p.id = ? AND p.status = 'active' AND s.status = 'active'").bind(productId).first()
    : await env.DB.prepare("SELECT id, name, settings_json FROM sellers WHERE id = ? AND status = 'active'").bind(storeId).first();
  if (!row || (storeId && row.id !== storeId) || (!productId && !appearanceOnly && !settings(row).enabled)) throw new Response("This shop or product is unavailable", { status: 404 });
  const store = await storefrontIdentity(env, row);
  if (appearanceOnly) return { store, products: [] };
  const [products, media, variants] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM products WHERE seller_id = ? AND status = 'active' AND (? = '' OR id = ?) ORDER BY created_at DESC, id").bind(row.id, productId, productId),
    env.DB.prepare("SELECT id, product_id FROM product_media WHERE seller_id = ? ORDER BY sort_order").bind(row.id),
    env.DB.prepare("SELECT * FROM product_variants WHERE seller_id = ? ORDER BY sort_order").bind(row.id),
  ]);
  return { store, products: products.results.map(product => publicProduct(product, media.results.find(m => m.product_id === product.id), variants.results.filter(v => v.product_id === product.id))) };
}
