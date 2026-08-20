const json = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});

const privateImmutableImageCacheControl = "private, max-age=31536000, immutable";
const publicImmutableImageCacheControl = "public, max-age=31536000, immutable";

const allowedOrigin = (request, env) => {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : "";
};

const corsHeaders = (request, env) => {
  const origin = allowedOrigin(request, env);
  return origin ? {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "vary": "Origin",
  } : {};
};

const decodeBase64Url = (value) => {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
};

const decodeJwtJson = (value) => JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));

async function authenticatedUser(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Response("Missing access token", { status: 401 });
  const token = authorization.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) throw new Response("Invalid access token", { status: 401 });

  let header;
  let claims;
  try {
    header = decodeJwtJson(parts[0]);
    claims = decodeJwtJson(parts[1]);
  } catch (_) {
    throw new Response("Invalid access token", { status: 401 });
  }
  if (header.alg !== "ES256" || typeof header.kid !== "string" || header.kid === "") {
    throw new Response("Unsupported access token signature", { status: 401 });
  }

  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const issuer = `${supabaseUrl}/auth/v1`;
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== issuer
    || !audience.includes("authenticated")
    || typeof claims.sub !== "string"
    || claims.sub === ""
    || !Number.isFinite(claims.exp)
    || claims.exp <= now
    || (Number.isFinite(claims.nbf) && claims.nbf > now + 30)
  ) {
    throw new Response("Invalid or expired access token", { status: 401 });
  }

  const jwksResponse = await fetch(`${issuer}/.well-known/jwks.json`, {
    cf: { cacheEverything: true, cacheTtl: 600 },
    headers: { accept: "application/json" },
  });
  if (!jwksResponse.ok) throw new Response("Authentication keys are unavailable", { status: 503 });
  const jwks = await jwksResponse.json();
  const jwk = Array.isArray(jwks.keys)
    ? jwks.keys.find((candidate) => candidate?.kid === header.kid && candidate?.alg === "ES256")
    : null;
  if (!jwk) throw new Response("Access token signing key was not found", { status: 401 });

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch (_) {}
  if (!verified) throw new Response("Invalid access token signature", { status: 401 });

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    user_metadata: claims.user_metadata && typeof claims.user_metadata === "object"
      ? claims.user_metadata
      : {},
  };
}

async function health(env) {
  const checks = { d1: false, public_r2: false, private_r2: false };
  let tableCount = 0;
  try {
    const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations'").first();
    tableCount = Number(result?.count || 0);
    checks.d1 = true;
  } catch (_) {}
  try { await env.PUBLIC_ASSETS.list({ limit: 1 }); checks.public_r2 = true; } catch (_) {}
  try { await env.PRIVATE_ASSETS.list({ limit: 1 }); checks.private_r2 = true; } catch (_) {}
  return {
    ok: Object.values(checks).every(Boolean),
    environment: env.APP_ENVIRONMENT,
    auth_provider: "supabase",
    auth_verification: "supabase-jwks-es256",
    structured_data: "cloudflare-d1",
    file_storage: "cloudflare-r2",
    checks,
    table_count: tableCount,
    checked_at: new Date().toISOString(),
  };
}

async function currentUser(request, env) {
  const user = await authenticatedUser(request, env);
  const metadata = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO app_users (id, auth_user_id, email, display_name, avatar_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(auth_user_id) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      updated_at = excluded.updated_at
  `).bind(
    crypto.randomUUID(),
    user.id,
    user.email || "",
    metadata.full_name || metadata.name || "",
    metadata.avatar_url || metadata.picture || "",
    now,
    now,
  ).run();
  const profile = await env.DB.prepare("SELECT id, auth_user_id, email, display_name, avatar_url, locale, created_at, updated_at FROM app_users WHERE auth_user_id = ?").bind(user.id).first();
  let memberships = await env.DB.prepare(`
    SELECT s.id, s.slug, s.name, s.plan, s.status, sm.role
    FROM seller_memberships sm
    JOIN sellers s ON s.id = sm.seller_id
    WHERE sm.auth_user_id = ? AND s.status = 'active'
    ORDER BY sm.created_at ASC
  `).bind(user.id).all();

  if (!Array.isArray(memberships.results) || memberships.results.length === 0) {
    const displayName = String(metadata.full_name || metadata.name || "").trim();
    const emailName = String(user.email || "").split("@")[0].trim();
    const sellerName = (displayName || emailName || "My Ezkart Store").slice(0, 120);
    const slugBase = sellerName.toLowerCase().normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "store";
    const stableSuffix = String(user.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toLowerCase();
    const sellerId = `seller_${user.id}`;
    const sellerSlug = `${slugBase}-${stableSuffix || "account"}`;
    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR IGNORE INTO sellers (id, slug, name, plan, status, settings_json, created_at, updated_at)
        VALUES (?, ?, ?, 'standard', 'active', '{}', ?, ?)
      `).bind(sellerId, sellerSlug, sellerName, now, now),
      env.DB.prepare(`
        INSERT OR IGNORE INTO seller_memberships (seller_id, auth_user_id, role, created_at)
        VALUES (?, ?, 'owner', ?)
      `).bind(sellerId, user.id, now),
    ]);
    memberships = await env.DB.prepare(`
      SELECT s.id, s.slug, s.name, s.plan, s.status, sm.role
      FROM seller_memberships sm
      JOIN sellers s ON s.id = sm.seller_id
      WHERE sm.auth_user_id = ? AND s.status = 'active'
      ORDER BY sm.created_at ASC
    `).bind(user.id).all();
  }

  const sellers = Array.isArray(memberships.results) ? memberships.results : [];
  return { ...profile, sellers, active_seller: sellers[0] || null };
}

const parseJson = (value, fallback) => {
  try { return JSON.parse(String(value || "")); } catch (_) { return fallback; }
};

const cleanText = (value, maximum = 160) => String(value || "").trim().slice(0, maximum);
const cleanId = (value, label = "ID") => {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,95}$/.test(id)) throw new Response(`${label} is invalid`, { status: 400 });
  return id;
};

async function requestJson(request, maximumBytes = 350000) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maximumBytes) throw new Response("Request body is too large", { status: 413 });
  let body;
  try { body = await request.json(); } catch (_) { throw new Response("Request body must be valid JSON", { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Response("Request body must be an object", { status: 400 });
  return body;
}

async function sellerContext(request, env) {
  const user = await authenticatedUser(request, env);
  let seller = await env.DB.prepare(`
    SELECT s.id, s.slug, s.name, s.plan, s.status, sm.role
    FROM seller_memberships sm
    JOIN sellers s ON s.id = sm.seller_id
    WHERE sm.auth_user_id = ? AND s.status = 'active'
    ORDER BY sm.created_at ASC
    LIMIT 1
  `).bind(user.id).first();
  if (!seller) {
    const profile = await currentUser(request, env);
    seller = profile.active_seller || null;
  }
  if (!seller?.id) throw new Response("No active seller is available", { status: 403 });
  return { seller, authUserId: user.id };
}

const mediaPath = (id) => `/v1/media/${encodeURIComponent(id)}`;

function shapeProduct(row, media = [], variants = []) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    id: row.id,
    sku: row.sku || "",
    name: row.title,
    category: cleanText(metadata.category, 80),
    categoryKey: cleanText(metadata.categoryKey, 120),
    description: row.description || "",
    type: row.type,
    status: row.status,
    price: Number(row.price_amount || 0),
    stock: row.stock_quantity === null ? null : Number(row.stock_quantity),
    weightGrams: row.weight_grams === null ? null : Number(row.weight_grams),
    digitalFileName: row.digital_filename || "",
    subscription: row.type === "subscription" ? {
      interval: Number(metadata.subscription?.interval || row.billing_interval_count || 1),
      unit: ["month", "year"].includes(metadata.subscription?.unit) ? metadata.subscription.unit : "month",
    } : null,
    options: Array.isArray(metadata.options) ? metadata.options : [],
    media: media.map((item) => ({
      id: item.id,
      path: mediaPath(item.id),
      mimeType: item.mime_type,
      sortOrder: Number(item.sort_order),
      alt: item.alt_text || "",
    })),
    variants: variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      options: parseJson(variant.options_json, []),
      sku: variant.sku,
      price: Number(variant.price_amount || 0),
      stock: variant.stock_quantity === null ? 0 : Number(variant.stock_quantity),
      weightGrams: variant.weight_grams === null ? null : Number(variant.weight_grams),
      billingUnit: variant.billing_interval || null,
      billingInterval: variant.billing_interval_count === null ? null : Number(variant.billing_interval_count),
      imageSource: variant.image_source || "main",
      imageUploadId: variant.image_upload_id || null,
      imagePath: variant.image_upload_id ? mediaPath(variant.image_upload_id) : null,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function catalog(request, env) {
  const { seller } = await sellerContext(request, env);
  const [productsResult, mediaResult, variantsResult, draftsResult] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM products WHERE seller_id = ? AND status != 'archived' ORDER BY updated_at DESC").bind(seller.id),
    env.DB.prepare(`
      SELECT pm.id, pm.product_id, pm.mime_type, pm.sort_order, pm.alt_text
      FROM product_media pm
      WHERE pm.seller_id = ?
      ORDER BY pm.product_id, pm.sort_order
    `).bind(seller.id),
    env.DB.prepare("SELECT * FROM product_variants WHERE seller_id = ? ORDER BY product_id, sort_order").bind(seller.id),
    env.DB.prepare("SELECT id, product_id, title, snapshot_json, created_at, updated_at FROM product_drafts WHERE seller_id = ? ORDER BY updated_at DESC").bind(seller.id),
  ]);
  const media = Array.isArray(mediaResult.results) ? mediaResult.results : [];
  const variants = Array.isArray(variantsResult.results) ? variantsResult.results : [];
  const products = (Array.isArray(productsResult.results) ? productsResult.results : []).map((row) => shapeProduct(
    row,
    media.filter((item) => item.product_id === row.id),
    variants.filter((item) => item.product_id === row.id),
  ));
  const drafts = (Array.isArray(draftsResult.results) ? draftsResult.results : []).map((row) => ({
    ...parseJson(row.snapshot_json, {}),
    id: row.id,
    productId: row.product_id || null,
    name: row.title || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  return { products, drafts };
}

const imageTypes = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/avif", "avif"],
]);

function decodeImageDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp|avif));base64,([a-zA-Z0-9+/=\s]+)$/.exec(String(value || ""));
  if (!match || !imageTypes.has(match[1])) throw new Response("Image must be a JPEG, PNG, WebP, or AVIF data URL", { status: 400 });
  const encoded = match[2].replace(/\s/g, "");
  if (encoded.length > 2800000) throw new Response("Image is larger than 2 MB", { status: 413 });
  let bytes;
  try {
    const decoded = atob(encoded);
    bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch (_) { throw new Response("Image encoding is invalid", { status: 400 }); }
  if (bytes.byteLength < 1 || bytes.byteLength > 2097152) throw new Response("Image must be between 1 byte and 2 MB", { status: 413 });
  return { bytes, mimeType: match[1], extension: imageTypes.get(match[1]) };
}

async function uploadMedia(request, env) {
  const { seller, authUserId } = await sellerContext(request, env);
  const payload = await requestJson(request, 2900000);
  const image = decodeImageDataUrl(payload.dataUrl);
  const id = `media_${crypto.randomUUID().replaceAll("-", "")}`;
  const r2Key = `sellers/${seller.id}/products/${id}.${image.extension}`;
  const now = new Date().toISOString();
  await env.PUBLIC_ASSETS.put(r2Key, image.bytes, {
    httpMetadata: { contentType: image.mimeType, cacheControl: publicImmutableImageCacheControl },
    customMetadata: { sellerId: seller.id, mediaId: id },
  });
  try {
    await env.DB.prepare(`
      INSERT INTO media_uploads (id, seller_id, r2_key, mime_type, size_bytes, created_by_auth_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, seller.id, r2Key, image.mimeType, image.bytes.byteLength, authUserId, now).run();
  } catch (error) {
    await env.PUBLIC_ASSETS.delete(r2Key);
    throw error;
  }
  return { id, path: mediaPath(id), mimeType: image.mimeType, sizeBytes: image.bytes.byteLength };
}

async function serveMedia(request, env, mediaId) {
  const user = await authenticatedUser(request, env);
  const media = await env.DB.prepare(`
    SELECT mu.r2_key, mu.mime_type
    FROM media_uploads mu
    JOIN seller_memberships sm ON sm.seller_id = mu.seller_id
    WHERE mu.id = ? AND sm.auth_user_id = ?
    LIMIT 1
  `).bind(mediaId, user.id).first();
  if (!media) throw new Response("Image not found", { status: 404 });
  const object = await env.PUBLIC_ASSETS.get(media.r2_key);
  if (!object) throw new Response("Image file not found", { status: 404 });
  const headers = new Headers({
    "content-type": media.mime_type,
    "cache-control": privateImmutableImageCacheControl,
    "x-content-type-options": "nosniff",
  });
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  const requestedEtags = String(request.headers.get("if-none-match") || "")
    .split(",")
    .map((value) => value.trim());
  if (object.httpEtag && (requestedEtags.includes(object.httpEtag) || requestedEtags.includes("*"))) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

const etagMatches = (request, etag) => {
  if (!etag) return false;
  return String(request.headers.get("if-none-match") || "")
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === etag || value === "*");
};

async function servePublicMedia(request, env, context, mediaId) {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) {
    const cachedEtag = cached.headers.get("etag") || "";
    if (etagMatches(request, cachedEtag)) return new Response(null, { status: 304, headers: cached.headers });
    return cached;
  }

  const media = await env.DB.prepare(`
    SELECT mu.r2_key, mu.mime_type
    FROM media_uploads mu
    WHERE mu.id = ? AND (
      EXISTS (
        SELECT 1
        FROM product_media pm
        JOIN products p ON p.seller_id = pm.seller_id AND p.id = pm.product_id
        WHERE pm.id = mu.id AND p.status = 'active'
      )
      OR EXISTS (
        SELECT 1
        FROM product_variants pv
        JOIN products p ON p.seller_id = pv.seller_id AND p.id = pv.product_id
        WHERE pv.image_upload_id = mu.id AND p.status = 'active'
      )
    )
    LIMIT 1
  `).bind(mediaId).first();
  if (!media) throw new Response("Image not found", { status: 404 });
  const object = await env.PUBLIC_ASSETS.get(media.r2_key);
  if (!object) throw new Response("Image file not found", { status: 404 });
  const headers = new Headers({
    "content-type": media.mime_type,
    "cache-control": publicImmutableImageCacheControl,
    "cross-origin-resource-policy": "cross-origin",
    "x-content-type-options": "nosniff",
  });
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  if (etagMatches(request, object.httpEtag)) return new Response(null, { status: 304, headers });
  const response = new Response(object.body, { status: 200, headers });
  context.waitUntil(cache.put(request, response.clone()));
  return response;
}

async function ownedUploads(env, sellerId, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const results = await env.DB.batch(unique.map((id) => env.DB.prepare(
    "SELECT id, r2_key, mime_type, size_bytes FROM media_uploads WHERE seller_id = ? AND id = ?",
  ).bind(sellerId, id)));
  const rows = results.map((result) => result.results?.[0]).filter(Boolean);
  if (rows.length !== unique.length) throw new Response("One or more images do not belong to this seller", { status: 400 });
  return new Map(rows.map((row) => [row.id, row]));
}

function normalizedOptions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((group) => ({
    name: cleanText(group?.name, 20),
    values: Array.isArray(group?.values) ? group.values.slice(0, 50).map((item) => cleanText(item, 60)).filter(Boolean) : [],
  })).filter((group) => group.name && group.values.length);
}

async function saveProduct(request, env, rawId) {
  const { seller, authUserId } = await sellerContext(request, env);
  const payload = await requestJson(request, 500000);
  const id = cleanId(rawId || payload.id, "Product ID");
  const existing = await env.DB.prepare("SELECT seller_id, created_at FROM products WHERE id = ?").bind(id).first();
  if (existing && existing.seller_id !== seller.id) throw new Response("Product not found", { status: 404 });
  const type = ["physical", "digital", "subscription"].includes(payload.type) ? payload.type : "physical";
  const title = cleanText(payload.name, 160);
  if (title.length < 2) throw new Response("Product name must contain at least 2 characters", { status: 400 });
  const description = cleanText(payload.description, 10000);
  const sku = cleanText(payload.sku, 80) || `EZK-${id.slice(-12).toUpperCase()}`;
  const options = normalizedOptions(payload.options);
  const imageIds = Array.isArray(payload.imageUploadIds) ? payload.imageUploadIds.slice(0, 9).map((item) => cleanId(item, "Image ID")) : [];
  const minimumImages = type === "physical" ? 3 : 1;
  if (imageIds.length < minimumImages || imageIds.length > 9) throw new Response(`This product requires ${minimumImages}–9 images`, { status: 400 });
  const rawVariants = Array.isArray(payload.variants) ? payload.variants.slice(0, 100) : [];
  const variants = rawVariants.map((variant, index) => ({
    id: cleanId(variant.id || `variant-${crypto.randomUUID()}`, "Variant ID"),
    name: cleanText(variant.name, 120) || `${type === "subscription" ? "Plan" : "Variant"} ${index + 1}`,
    options: Array.isArray(variant.options) ? variant.options.slice(0, 3).map((option) => ({ option: cleanText(option?.option, 20), value: cleanText(option?.value, 60) })) : [],
    sku: cleanText(variant.sku, 80),
    price: Math.max(0, Math.round(Number(variant.price) || 0)),
    stock: Math.max(0, Math.round(Number(variant.stock) || 0)),
    weightGrams: Math.max(0, Math.round(Number(variant.weightGrams) || 0)),
    billingUnit: type === "subscription" && ["month", "year"].includes(variant.billingUnit) ? variant.billingUnit : null,
    billingInterval: type === "subscription" ? Math.max(1, Math.min(variant.billingUnit === "year" ? 10 : 120, Math.round(Number(variant.billingInterval) || 1))) : null,
    imageSource: /^gallery-[1-9]$/.test(String(variant.imageSource || "")) ? String(variant.imageSource) : variant.imageUploadId ? "variant-upload" : "main",
    imageUploadId: variant.imageUploadId ? cleanId(variant.imageUploadId, "Variant image ID") : null,
  }));
  if (variants.some((variant) => !variant.sku || variant.price < 1000 || (type === "physical" && variant.weightGrams < 1) || (type === "subscription" && (!variant.billingUnit || variant.billingInterval < 1)))) {
    throw new Response(type === "subscription" ? "Every plan needs a valid price, SKU, and billing period" : "Every variant needs a valid price, SKU, and shipping weight", { status: 400 });
  }
  if (new Set(variants.map((variant) => variant.sku.toLowerCase())).size !== variants.length) throw new Response(type === "subscription" ? "Plan SKUs must be unique" : "Variant SKUs must be unique", { status: 400 });
  const uploadMap = await ownedUploads(env, seller.id, [...imageIds, ...variants.map((variant) => variant.imageUploadId)]);
  const basePrice = variants.length ? Math.min(...variants.map((variant) => variant.price)) : Math.max(0, Math.round(Number(payload.price) || 0));
  const stock = type === "physical" ? (variants.length ? variants.reduce((sum, variant) => sum + variant.stock, 0) : Math.max(0, Math.round(Number(payload.stock) || 0))) : null;
  const weight = type === "physical" ? (variants.length ? Math.max(...variants.map((variant) => variant.weightGrams)) : Math.max(1, Math.round(Number(payload.weightGrams) || 0))) : null;
  const firstPlan = type === "subscription" && variants.length ? variants[0] : null;
  const displayBillingUnit = type === "subscription" ? (firstPlan?.billingUnit || (["month", "year"].includes(payload.subscription?.unit) ? payload.subscription.unit : "month")) : null;
  const displayBillingInterval = type === "subscription" ? (firstPlan?.billingInterval || Math.max(1, Math.min(displayBillingUnit === "year" ? 10 : 120, Math.round(Number(payload.subscription?.interval) || 1)))) : null;
  const billingUnit = type === "subscription" ? "month" : null;
  const billingInterval = type === "subscription" ? displayBillingInterval * (displayBillingUnit === "year" ? 12 : 1) : null;
  const digitalFilename = type === "digital" ? cleanText(payload.digitalFileName, 180) : null;
  const now = new Date().toISOString();
  const createdAt = existing?.created_at || now;
  const statements = [
    env.DB.prepare(`
      INSERT INTO products (id, seller_id, type, status, title, description, sku, currency, price_amount, stock_quantity, weight_grams, billing_interval, billing_interval_count, digital_filename, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, 'IDR', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET type = excluded.type, status = 'active', title = excluded.title,
        description = excluded.description, sku = excluded.sku, price_amount = excluded.price_amount,
        stock_quantity = excluded.stock_quantity, weight_grams = excluded.weight_grams,
        billing_interval = excluded.billing_interval, billing_interval_count = excluded.billing_interval_count,
        digital_filename = excluded.digital_filename, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
    `).bind(id, seller.id, type, title, description, sku, basePrice, stock, weight, billingUnit, billingInterval, digitalFilename, JSON.stringify({ category: cleanText(payload.category, 80), categoryKey: cleanText(payload.categoryKey, 120), options, ...(type === "subscription" ? { subscription: { interval: displayBillingInterval, unit: displayBillingUnit } } : {}) }), createdAt, now),
    env.DB.prepare("DELETE FROM product_variants WHERE seller_id = ? AND product_id = ?").bind(seller.id, id),
    env.DB.prepare("DELETE FROM product_media WHERE seller_id = ? AND product_id = ?").bind(seller.id, id),
  ];
  imageIds.forEach((mediaId, index) => {
    const media = uploadMap.get(mediaId);
    statements.push(env.DB.prepare(`
      INSERT INTO product_media (id, seller_id, product_id, r2_key, mime_type, size_bytes, sort_order, alt_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(mediaId, seller.id, id, media.r2_key, media.mime_type, media.size_bytes, index + 1, index === 0 ? title : `${title} image ${index + 1}`, now));
  });
  variants.forEach((variant, index) => statements.push(env.DB.prepare(`
    INSERT INTO product_variants (id, seller_id, product_id, name, options_json, sku, price_amount, stock_quantity, weight_grams, billing_interval, billing_interval_count, image_source, image_upload_id, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(variant.id, seller.id, id, variant.name, JSON.stringify(variant.options), variant.sku, variant.price, type === "physical" ? variant.stock : null, type === "physical" ? variant.weightGrams : null, variant.billingUnit, variant.billingInterval, variant.imageSource, variant.imageUploadId, index + 1, now, now)));
  statements.push(env.DB.prepare(`
    INSERT INTO seller_events (id, seller_id, actor_auth_user_id, event_type, entity_type, entity_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, 'product', ?, ?, ?)
  `).bind(`event_${crypto.randomUUID()}`, seller.id, authUserId, existing ? "product.updated" : "product.created", id, JSON.stringify({ title, variants: variants.length, images: imageIds.length }), now));
  await env.DB.batch(statements);
  const result = await catalog(request, env);
  return result.products.find((product) => product.id === id);
}

async function deleteProduct(request, env, productId) {
  const { seller, authUserId } = await sellerContext(request, env);
  const id = cleanId(productId, "Product ID");
  const existing = await env.DB.prepare("SELECT id FROM products WHERE seller_id = ? AND id = ?").bind(seller.id, id).first();
  if (!existing) throw new Response("Product not found", { status: 404 });
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM products WHERE seller_id = ? AND id = ?").bind(seller.id, id),
    env.DB.prepare(`
      INSERT INTO seller_events (id, seller_id, actor_auth_user_id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, ?, 'product.deleted', 'product', ?, '{}', ?)
    `).bind(`event_${crypto.randomUUID()}`, seller.id, authUserId, id, now),
  ]);
}

const duplicatedValue = (value, suffix, maximum) => {
  const ending = `-${suffix}`;
  const base = String(value || "").trim() || "EZK";
  return `${base.slice(0, Math.max(1, maximum - ending.length))}${ending}`;
};

async function duplicateProduct(request, env, productId) {
  const { seller, authUserId } = await sellerContext(request, env);
  const sourceId = cleanId(productId, "Product ID");
  const [product, mediaResult, variantsResult] = await Promise.all([
    env.DB.prepare("SELECT * FROM products WHERE seller_id = ? AND id = ? AND status != 'archived'").bind(seller.id, sourceId).first(),
    env.DB.prepare("SELECT * FROM product_media WHERE seller_id = ? AND product_id = ? ORDER BY sort_order").bind(seller.id, sourceId).all(),
    env.DB.prepare("SELECT * FROM product_variants WHERE seller_id = ? AND product_id = ? ORDER BY sort_order").bind(seller.id, sourceId).all(),
  ]);
  if (!product) throw new Response("Product not found", { status: 404 });

  const sourceMedia = Array.isArray(mediaResult.results) ? mediaResult.results : [];
  const sourceVariants = Array.isArray(variantsResult.results) ? variantsResult.results : [];
  const sourceUploadIds = [...new Set([
    ...sourceMedia.map((media) => media.id),
    ...sourceVariants.map((variant) => variant.image_upload_id),
  ].filter(Boolean))];
  const uploads = await ownedUploads(env, seller.id, sourceUploadIds);
  const mediaCopies = new Map();
  const copiedR2Keys = [];
  const now = new Date().toISOString();
  let persisted = false;

  try {
    for (const sourceUploadId of sourceUploadIds) {
      const sourceUpload = uploads.get(sourceUploadId);
      const sourceObject = await env.PUBLIC_ASSETS.get(sourceUpload.r2_key);
      if (!sourceObject) throw new Response("A product image file could not be copied", { status: 404 });
      const mediaId = `media_${crypto.randomUUID().replaceAll("-", "")}`;
      const extension = imageTypes.get(sourceUpload.mime_type) || "jpg";
      const r2Key = `sellers/${seller.id}/products/${mediaId}.${extension}`;
      await env.PUBLIC_ASSETS.put(r2Key, await sourceObject.arrayBuffer(), {
        httpMetadata: {
          ...sourceObject.httpMetadata,
          contentType: sourceUpload.mime_type,
          cacheControl: publicImmutableImageCacheControl,
        },
        customMetadata: { sellerId: seller.id, mediaId },
      });
      copiedR2Keys.push(r2Key);
      mediaCopies.set(sourceUploadId, { ...sourceUpload, id: mediaId, r2_key: r2Key });
    }

    const productIdSuffix = crypto.randomUUID().replaceAll("-", "");
    const copyId = `custom-${productIdSuffix}`;
    const skuSuffix = `COPY-${productIdSuffix.slice(0, 8).toUpperCase()}`;
    const copyTitleSuffix = " (Copy)";
    const copyTitle = `${String(product.title || "Product").slice(0, 160 - copyTitleSuffix.length)}${copyTitleSuffix}`;
    const copySku = duplicatedValue(product.sku, skuSuffix, 80);
    const statements = [
      env.DB.prepare(`
        INSERT INTO products (id, seller_id, type, status, title, description, sku, currency, price_amount, stock_quantity, weight_grams, billing_interval, billing_interval_count, digital_filename, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(copyId, seller.id, product.type, copyTitle, product.description, copySku, product.currency, product.price_amount, product.stock_quantity, product.weight_grams, product.billing_interval, product.billing_interval_count, product.digital_filename, product.metadata_json, now, now),
    ];

    mediaCopies.forEach((copy) => {
      statements.push(env.DB.prepare(`
        INSERT INTO media_uploads (id, seller_id, r2_key, mime_type, size_bytes, created_by_auth_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(copy.id, seller.id, copy.r2_key, copy.mime_type, copy.size_bytes, authUserId, now));
    });
    sourceMedia.forEach((media) => {
      const copy = mediaCopies.get(media.id);
      statements.push(env.DB.prepare(`
        INSERT INTO product_media (id, seller_id, product_id, r2_key, mime_type, size_bytes, sort_order, alt_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(copy.id, seller.id, copyId, copy.r2_key, copy.mime_type, copy.size_bytes, media.sort_order, media.sort_order === 1 ? copyTitle : `${copyTitle} image ${media.sort_order}`, now));
    });
    sourceVariants.forEach((variant, index) => {
      const variantIdSuffix = crypto.randomUUID().replaceAll("-", "");
      const imageUploadId = variant.image_upload_id ? mediaCopies.get(variant.image_upload_id)?.id || null : null;
      statements.push(env.DB.prepare(`
        INSERT INTO product_variants (id, seller_id, product_id, name, options_json, sku, price_amount, stock_quantity, weight_grams, billing_interval, billing_interval_count, image_source, image_upload_id, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(`variant-${variantIdSuffix}`, seller.id, copyId, variant.name, variant.options_json, duplicatedValue(variant.sku, skuSuffix, 80), variant.price_amount, variant.stock_quantity, variant.weight_grams, variant.billing_interval, variant.billing_interval_count, variant.image_source, imageUploadId, index + 1, now, now));
    });
    statements.push(env.DB.prepare(`
      INSERT INTO seller_events (id, seller_id, actor_auth_user_id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, ?, 'product.duplicated', 'product', ?, ?, ?)
    `).bind(`event_${crypto.randomUUID()}`, seller.id, authUserId, copyId, JSON.stringify({ source_product_id: sourceId, title: copyTitle }), now));

    await env.DB.batch(statements);
    persisted = true;
    const result = await catalog(request, env);
    return result.products.find((candidate) => candidate.id === copyId);
  } catch (error) {
    if (!persisted) await Promise.allSettled(copiedR2Keys.map((key) => env.PUBLIC_ASSETS.delete(key)));
    throw error;
  }
}

async function saveDraft(request, env, draftId) {
  const { seller, authUserId } = await sellerContext(request, env);
  const id = cleanId(draftId, "Draft ID");
  const payload = await requestJson(request, 500000);
  const existing = await env.DB.prepare("SELECT seller_id, created_at FROM product_drafts WHERE id = ?").bind(id).first();
  if (existing && existing.seller_id !== seller.id) throw new Response("Draft not found", { status: 404 });
  const productId = payload.productId ? cleanId(payload.productId, "Product ID") : null;
  if (productId) {
    const product = await env.DB.prepare("SELECT id FROM products WHERE seller_id = ? AND id = ?").bind(seller.id, productId).first();
    if (!product) throw new Response("Draft product not found", { status: 400 });
  }
  const snapshot = payload.snapshot && typeof payload.snapshot === "object" && !Array.isArray(payload.snapshot) ? payload.snapshot : {};
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > 400000) throw new Response("Draft is too large", { status: 413 });
  const referencedMedia = [
    ...(Array.isArray(snapshot.images) ? snapshot.images.map((item) => item?.cloudId) : []),
    ...(Array.isArray(snapshot.variants) ? snapshot.variants.map((item) => item?.customImage?.cloudId) : []),
  ].filter(Boolean).map((mediaId) => cleanId(mediaId, "Draft image ID"));
  await ownedUploads(env, seller.id, referencedMedia);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO product_drafts (id, seller_id, product_id, title, snapshot_json, created_by_auth_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET product_id = excluded.product_id, title = excluded.title,
      snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at
  `).bind(id, seller.id, productId, cleanText(payload.title, 160), serialized, authUserId, existing?.created_at || now, now).run();
  return { id, updatedAt: now };
}

async function deleteDraft(request, env, draftId) {
  const { seller } = await sellerContext(request, env);
  await env.DB.prepare("DELETE FROM product_drafts WHERE seller_id = ? AND id = ?").bind(seller.id, cleanId(draftId, "Draft ID")).run();
}

export default {
  async fetch(request, env, context) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") return json(await health(env), 200, cors);
      if (request.method === "GET" && url.pathname === "/v1/me") return json({ ok: true, user: await currentUser(request, env) }, 200, cors);
      if (request.method === "GET" && url.pathname === "/v1/catalog") return json({ ok: true, ...(await catalog(request, env)) }, 200, cors);
      if (request.method === "POST" && url.pathname === "/v1/media") return json({ ok: true, media: await uploadMedia(request, env) }, 201, cors);
      const publicMediaMatch = /^\/v1\/public\/media\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (request.method === "GET" && publicMediaMatch) return await servePublicMedia(request, env, context, cleanId(publicMediaMatch[1], "Image ID"));
      const mediaMatch = /^\/v1\/media\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (request.method === "GET" && mediaMatch) return await serveMedia(request, env, cleanId(mediaMatch[1], "Image ID"));
      const productDuplicateMatch = /^\/v1\/products\/([a-zA-Z0-9_-]+)\/duplicate$/.exec(url.pathname);
      if (request.method === "POST" && productDuplicateMatch) return json({ ok: true, product: await duplicateProduct(request, env, productDuplicateMatch[1]) }, 201, cors);
      const productMatch = /^\/v1\/products\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (["PUT", "POST"].includes(request.method) && productMatch) return json({ ok: true, product: await saveProduct(request, env, productMatch[1]) }, 200, cors);
      if (request.method === "DELETE" && productMatch) { await deleteProduct(request, env, productMatch[1]); return json({ ok: true }, 200, cors); }
      const draftMatch = /^\/v1\/drafts\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (["PUT", "POST"].includes(request.method) && draftMatch) return json({ ok: true, draft: await saveDraft(request, env, draftMatch[1]) }, 200, cors);
      if (request.method === "DELETE" && draftMatch) { await deleteDraft(request, env, draftMatch[1]); return json({ ok: true }, 200, cors); }
      return json({ ok: false, error: "Not found" }, 404, cors);
    } catch (error) {
      if (error instanceof Response) return json({ ok: false, error: await error.text() }, error.status, cors);
      console.error("Ezkart Worker request failed", error);
      return json({ ok: false, error: "The API could not complete this request." }, 500, cors);
    }
  },
};
