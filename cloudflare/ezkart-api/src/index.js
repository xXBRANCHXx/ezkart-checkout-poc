import {hostedLandingResponse, landingPageLinks} from './landing-page-hosting.js';
import {sellerPageAddress, sellerByPageAddress} from './seller-page-address.js';
import { adminPreferences } from './admin-preferences.js';
import { listBuilderFonts, saveBuilderFont, serveBuilderFont } from './builder-fonts.js';
import { listBuilderAssets, saveBuilderAsset, serveBuilderAsset } from "./builder-assets.js";
import {landingSummaryKey, listLandingObjects, cacheLandingSummary, readLandingSummary, staticLandingPreview} from './landing-page-index.js';
import {packLandingEditor, landingPageSaveReceipt} from './landing-page-transfer.js';
import {readLandingPageJson} from './landing-page-storage.js';
import { customerAddressBook, changeCustomerAddressBook } from "./customer-addresses.js";
import { validatePublication } from "./landing-publication.js";
import { merchantStorefront, publicStorefront } from "./storefront.js";
import { adminProfile } from "./admin-profile.js";
import { advancedMode, AdvancedModeLimitError, sellerPlan } from "./advanced-mode.js";
import { authenticateCommerceService, commerceServiceRoute, expireCommerceOrders, reservedStockSql } from "./commerce-orders.js";
import {merchantShippingSettings,saveShippingSettings,checkoutShippingSettings} from './shipping-settings.js';
import { claimCommerceJobs, finishCommerceJob } from "./commerce-jobs.js";
import { inventoryOverview, inventoryHistory, inventoryDraft, adjustInventory, catalogStockMovements } from "./inventory.js";
import { stockReviewList, stockReviewDetails, resolveStockReview } from "./stock-reviews.js";
import { claimCommerceOrder } from "./commerce-access.js";
import { returnList, returnOrder, returnDetail, customerReturns, createReturn, returnAction } from "./commerce-returns.js";
import {fulfillmentList,fulfillmentDetail,fulfillmentAction,serviceShipment,customerShipment,bindShipmentAccount,bindShipment,shippingInbox,refreshShipment,drainPendingShipping} from './commerce-fulfillment.js';
import {merchantOrderList,merchantOrderDetail,merchantOrderHistory} from './commerce-order-reads.js';
import {merchantDashboard} from './commerce-dashboard.js';
import {merchantPaymentList,merchantPaymentDetail,merchantPaymentHistory} from './commerce-payment-reads.js';
import {reconcileCaptureJournals,financialJournalSummary,financialJournalList} from './commerce-financial-journal.js';
import {walletEnrollment,walletRegistration,bindWalletRegistration,saveWalletRegistrationReceipt,recordWalletRegistration} from './commerce-wallet-enrollment.js';
import {providerFinancialAccount,recordProviderFinancialEvidence,providerFinancialEvidenceList} from './commerce-provider-evidence.js';
import {merchantCustomers,merchantCustomer,customerOrderHistory} from './commerce-customers.js';
import {customerSegments,customerSegment,saveCustomerWorkspace,customerProfileHistory} from './commerce-customer-workspace.js';
import {createCustomerExport,readCustomerExport,cleanupCustomerExports} from './commerce-customer-exports.js';
import {customerConsents} from './commerce-customer-consents.js';
import {buyerReviews,saveBuyerReview,merchantReview,saveMerchantReview,reviewHistory,reviewMode} from './commerce-reviews.js';
import {merchantReviews,publicReviews,publicReviewSql} from './commerce-review-reads.js';
import {uploadReviewPhoto,reviewPhoto,cleanupReviewPhotos} from './commerce-review-media.js';
import {startConversation,sendMessage,conversationDetail,markConversationRead,messageInbox,messageStats,savedReplies,saveReply} from './commerce-messages.js';
import {uploadMessagePhoto,messagePhoto,cleanupMessagePhotos} from './commerce-message-media.js';
import {parseMessageJSON} from './message-json.js';
import {merchantSettings,saveMerchantSettings,settingsHistory,publicStoreProfile} from './merchant-settings.js';
import {notificationInbox,notificationStats,readNotifications,notificationProcessing} from './commerce-notifications.js';
import {dispatchNotifications,scheduleNotifications} from './commerce-notification-dispatch.js';
import {dispatchEmails,recordEmailWebhook} from './commerce-email-delivery.js';
import {dispatchCampaignEmails} from './campaign-email-delivery.js';
import {processMarketingAutomations} from './automation-dispatch.js';
import {emailInvestigations,lookupEmail,resolveEmail,campaignEmailInvestigations,lookupCampaignEmail,resolveCampaignEmail} from './email-investigation.js';
import {campaignLink,cleanupCampaignVisits} from './campaign-attribution.js';
import {campaignReport} from './campaign-reports.js';
import {createCampaignReportExport,readCampaignReportExport,cleanupCampaignReportExports} from './campaign-report-exports.js';
import {campaignPerformance} from './campaign-performance.js';
import {createCampaignPerformanceExport,readCampaignPerformanceExport,cleanupCampaignPerformanceExports} from './campaign-performance-exports.js';
import {campaignWorkspace,listCampaigns,readCampaign,saveCampaign,campaignHistory,campaignAudience} from './marketing-campaigns.js';
import {listAutomations,readAutomation,saveAutomation,changeAutomation,automationHistory,automationActivity} from './marketing-automations.js';
import {readPublication,publishCampaign,changePublication,publicationRecipients,publicationHistory} from './campaign-publication.js';
import {campaignUnsubscribe} from './campaign-unsubscribe.js';
import {buyerNotificationPreferences,saveBuyerNotificationPreferences,buyerNotificationPreferenceHistory} from './buyer-notification-preferences.js';
import {merchantAnalytics} from './commerce-analytics.js';
import {createAnalyticsExport,readAnalyticsExport,cleanupAnalyticsExports} from './commerce-analytics-exports.js';
const json = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});

const privateImmutableImageCacheControl = "private, max-age=31536000, immutable";
const publicImmutableImageCacheControl = "public, max-age=31536000, immutable";
const maximumLandingPageBytes = 16000000;
const maximumLandingPagePreviewBytes = 16000000;
const maximumLandingPagePreviewRequestBytes = 20000000;
const landingPagePreviewVersion = "2";
const maximumComponentsPerSeller = 20;
const maximumComponentBytes = 200 * 1024;
const abandonedUploadGraceMilliseconds = 24 * 60 * 60 * 1000;

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
    "access-control-allow-headers": "authorization,content-type,prefer",
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
    SELECT s.id, s.slug, s.name, s.plan, s.status, sm.role, s.settings_json AS profile_settings_json,
      COALESCE(json_extract(s.settings_json, '$.adminProfile.logoId'), '') AS admin_logo_id
    FROM seller_memberships sm
    JOIN sellers s ON s.id = sm.seller_id
    WHERE sm.auth_user_id = ? AND s.status = 'active'
    ORDER BY sm.created_at ASC
  `).bind(user.id).all();

  if ((!Array.isArray(memberships.results) || memberships.results.length === 0)
    && !await env.DB.prepare('SELECT id FROM sellers WHERE id=?').bind(`seller_${user.id}`).first()) {
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
      SELECT s.id, s.slug, s.name, s.plan, s.status, sm.role, s.settings_json AS profile_settings_json,
        COALESCE(json_extract(s.settings_json, '$.adminProfile.logoId'), '') AS admin_logo_id
      FROM seller_memberships sm
      JOIN sellers s ON s.id = sm.seller_id
      WHERE sm.auth_user_id = ? AND s.status = 'active'
      ORDER BY sm.created_at ASC
    `).bind(user.id).all();
  }

  const sellers = Array.isArray(memberships.results) ? memberships.results.map(({profile_settings_json,...row})=>({...row,businessProfile:publicStoreProfile({name:row.name,settings_json:profile_settings_json})})) : [];
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

// Review image uploads may be streamed without Content-Length. Enforce their
// bound on bytes actually read, including for small review mutation bodies.
async function reviewRequestJson(request, maximumBytes=24000, parser=JSON.parse) {
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw new Response('Use a JSON request',{status:415});
  const reader=request.body?.getReader();if(!reader)throw new Response('Request body is required',{status:400});
  let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maximumBytes){await reader.cancel();throw new Response('Request body is too large',{status:413});}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body;try{body=parser(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Response('Request body must be valid JSON',{status:400});}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Response('Request body must be an object',{status:400});
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
const variantPositionSql = "COALESCE(json_extract(options_json, '$.position'), sort_order), id";
const assertCatalogEditor = (seller) => {
  if (seller.role === "viewer") throw new Response("You do not have permission to change this catalog", { status: 403 });
};
const catalogInteger = (value, label, minimum = 0, maximum = 1000000000) => {
  const number = Number(value);
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "" || !Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Response(`${label} must be a whole number from ${minimum} to ${maximum}`, { status: 400 });
  }
  return number;
};

function shapeProduct(row, media = [], variants = [], performance = {}) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    id: row.id,
    revision: row.revision ?? null,
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
    variants: variants.map((variant) => {
      const storedOptions = parseJson(variant.options_json, []);
      return {
        id: variant.id,
        name: variant.name,
        options: Array.isArray(storedOptions) ? storedOptions : Array.isArray(storedOptions.values) ? storedOptions.values : [],
        hidden: !Array.isArray(storedOptions) && Boolean(storedOptions.hidden),
        sku: variant.sku,
        price: Number(variant.price_amount || 0),
        stock: variant.stock_quantity === null ? 0 : Number(variant.stock_quantity),
        weightGrams: variant.weight_grams === null ? null : Number(variant.weight_grams),
        billingUnit: variant.billing_interval || null,
        billingInterval: variant.billing_interval_count === null ? null : Number(variant.billing_interval_count),
        imageSource: variant.image_source || "main",
        imageUploadId: variant.image_upload_id || null,
        imagePath: variant.image_upload_id ? mediaPath(variant.image_upload_id) : null,
      };
    }),
    rating: Number(performance.review_count || 0) > 0 ? Number(performance.rating_average || 0) : null,
    reviewCount: Math.max(0, Number(performance.review_count || 0)),
    ratingSum: Math.max(0, Number(performance.rating_sum || 0)),
    soldCount: Math.max(0, Number(performance.sold_count || 0)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function catalog(request, env) {
  const { seller } = await sellerContext(request, env);
  const [productsResult, mediaResult, variantsResult, draftsResult, salesResult, reviewsResult] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM products WHERE seller_id = ? AND status IN ('active', 'archived') ORDER BY updated_at DESC").bind(seller.id),
    env.DB.prepare(`
      SELECT pm.id, pm.product_id, pm.mime_type, pm.sort_order, pm.alt_text
      FROM product_media pm
      WHERE pm.seller_id = ?
      ORDER BY pm.product_id, pm.sort_order
    `).bind(seller.id),
    env.DB.prepare(`SELECT * FROM product_variants WHERE seller_id = ? ORDER BY product_id, ${variantPositionSql}`).bind(seller.id),
    env.DB.prepare("SELECT id, product_id, title, snapshot_json, created_at, updated_at FROM product_drafts WHERE seller_id = ? ORDER BY updated_at DESC").bind(seller.id),
    env.DB.prepare(`
      SELECT oi.product_id, SUM(oi.quantity) AS sold_count
      FROM order_items oi
      JOIN orders o ON o.seller_id = oi.seller_id AND o.id = oi.order_id
      WHERE oi.seller_id = ? AND o.status = 'paid' AND oi.product_id IS NOT NULL
      GROUP BY oi.product_id
    `).bind(seller.id),
    env.DB.prepare(`
      SELECT r.product_id, AVG(r.rating) AS rating_average, SUM(r.rating) AS rating_sum, COUNT(*) AS review_count
      FROM product_reviews r
      WHERE r.seller_id = ? AND r.commerce_environment IN (?, 'legacy') AND ${publicReviewSql}
      GROUP BY product_id
    `).bind(seller.id,reviewMode(env)),
  ]);
  const media = Array.isArray(mediaResult.results) ? mediaResult.results : [];
  const variants = Array.isArray(variantsResult.results) ? variantsResult.results : [];
  const sales = new Map((Array.isArray(salesResult.results) ? salesResult.results : []).map((item) => [item.product_id, item]));
  const reviews = new Map((Array.isArray(reviewsResult.results) ? reviewsResult.results : []).map((item) => [item.product_id, item]));
  const products = (Array.isArray(productsResult.results) ? productsResult.results : []).map((row) => shapeProduct(
    row,
    media.filter((item) => item.product_id === row.id),
    variants.filter((item) => item.product_id === row.id),
    { ...sales.get(row.id), ...reviews.get(row.id) },
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

async function storefrontProducts(url, env) {
  const requested = String(url.searchParams.get("ids") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (requested.length < 1 || requested.length > 100) {
    throw new Response("The product request is too large", { status: 400 });
  }
  const selections = [...new Set(requested)].map((selectionId) => {
    const parts = selectionId.split("~");
    if (parts.length > 2) throw new Response("Product selection is invalid", { status: 400 });
    return {
      selectionId,
      productId: cleanId(parts[0], "Product ID"),
      variantId: parts[1] ? cleanId(parts[1], "Variant ID") : "",
    };
  });
  const productIds = [...new Set(selections.map((selection) => selection.productId))];
  const [productResults, variantResults, mediaResults] = await Promise.all([
    env.DB.batch(productIds.map((id) => env.DB.prepare(`
    SELECT p.id, p.seller_id, p.type, p.title, p.description, p.sku, p.currency,
      p.price_amount, p.stock_quantity, p.weight_grams, p.metadata_json, ${reservedStockSql(env)} AS reserved_quantity
    FROM products p
    JOIN sellers s ON s.id = p.seller_id
    WHERE p.id = ? AND p.status = 'active' AND s.status = 'active'
    LIMIT 1
  `).bind(id))),
    env.DB.batch(productIds.map((id) => env.DB.prepare(`
      SELECT v.id, v.product_id, v.name, v.options_json, v.sku, v.price_amount, v.stock_quantity,
        v.weight_grams, v.image_upload_id, v.sort_order, ${reservedStockSql(env, true)} AS reserved_quantity
      FROM product_variants v
      WHERE product_id = ?
      ORDER BY ${variantPositionSql}
    `).bind(id))),
    env.DB.batch(productIds.map((id) => env.DB.prepare(`
    SELECT id, product_id, alt_text
    FROM product_media
    WHERE product_id = ?
    ORDER BY sort_order
    LIMIT 1
  `).bind(id))),
  ]);
  const products = new Map(productResults.map((result) => result.results?.[0]).filter(Boolean).map((row) => [row.id, row]));
  const variants = new Map(productIds.map((id, index) => [id, (variantResults[index]?.results || []).filter((variant) => {
    const storedOptions = parseJson(variant.options_json, []);
    return Array.isArray(storedOptions) || !storedOptions.hidden;
  })]));
  const media = new Map(mediaResults.map((result) => result.results?.[0]).filter(Boolean).map((row) => [row.product_id, row]));
  return selections.map((selection) => {
    const row = products.get(selection.productId);
    if (!row) return null;
    const availableVariants = variants.get(row.id) || [];
    const variantIndex = productIds.indexOf(row.id);
    if (variantResults[variantIndex]?.results?.length && !availableVariants.length) return null;
    const variant = selection.variantId
      ? availableVariants.find((item) => item.id === selection.variantId)
      : availableVariants[0] || null;
    if (selection.variantId && !variant) return null;
    const metadata = parseJson(row.metadata_json, {});
    const storedOptions = variant ? parseJson(variant.options_json, []) : [];
    const options = Array.isArray(storedOptions) ? storedOptions : Array.isArray(storedOptions.values) ? storedOptions.values : [];
    const mainMedia = media.get(row.id) || null;
    const imageId = variant?.image_upload_id || mainMedia?.id || "";
    return {
      id: selection.selectionId,
      sellerId: row.seller_id,
      productId: row.id,
      variantId: variant?.id || "",
      type: row.type,
      name: variant ? `${row.title} — ${variant.name}` : row.title,
      productName: row.title,
      variantName: variant?.name || "",
      options,
      description: row.description || "",
      sku: variant?.sku || row.sku || "",
      currency: row.currency,
      price: Number(variant?.price_amount ?? row.price_amount ?? 0),
      stock: (variant?.stock_quantity ?? row.stock_quantity) === null ? null : Math.max(0, Number(variant?.stock_quantity ?? row.stock_quantity) - Number(variant?.reserved_quantity ?? row.reserved_quantity ?? 0)),
      weightGrams: (variant?.weight_grams ?? row.weight_grams) === null ? null : Number(variant?.weight_grams ?? row.weight_grams),
      category: cleanText(metadata.category, 80),
      imagePath: imageId ? `/v1/public/media/${encodeURIComponent(imageId)}` : "",
      imageAlt: variant?.name ? `${row.title} — ${variant.name}` : mainMedia?.alt_text || row.title,
    };
  }).filter(Boolean);
}

const landingPagePrefix = (sellerId) => `sellers/${sellerId}/landing-pages/`;
const landingPageKey = (sellerId, id) => `${landingPagePrefix(sellerId)}${id}.json`;
// Kept only so preview writes and page deletion can remove obsolete raster artifacts.
const landingPageThumbnailKey = (sellerId, id) => `sellers/${sellerId}/landing-page-thumbnails/${id}`;
const landingPagePreviewKey = (sellerId, id) => `sellers/${sellerId}/landing-page-previews/${id}.html`;
const cleanLandingPageId = (value) => {
  const id = String(value || "").trim().toLowerCase();
  if (id.length < 1 || id.length > 48 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Response("Landing page URL is invalid", { status: 400 });
  }
  return id;
};
const landingPageSummary = (page) => ({
  id: page.id,
  name: page.name,
  url: page.url,
  status: page.status,
  products: Array.isArray(page.products) ? page.products : [],
  customProducts: Array.isArray(page.customProducts) ? page.customProducts.map((product) => ({
    id: product?.id || "",
    name: cleanText(product?.name, 70),
    type: cleanText(product?.type, 20),
    price: Math.max(0, Math.round(Number(product?.price) || 0)),
  })) : [],
  createdAt: page.createdAt,
  updatedAt: page.updatedAt,
  publishedAt: page.publishedAt || null,
  previewUpdatedAt: page.previewUpdatedAt || null,
  previewBytes: Math.max(0, Math.round(Number(page.previewBytes) || 0)),
  previewSourceUpdatedAt: page.previewSourceUpdatedAt || null,
  previewVersion: String(page.previewVersion || ""),
});

async function landingPageObject(env, sellerId, id) {
  try {
    const page = await readLandingPageJson(env.PRIVATE_ASSETS, landingPageKey(sellerId, id), {
      onTiming: timing => { if (timing.failed || timing.openMs + timing.bodyMs > 1000) console.info('landing-page-read', timing); },
    });
    if (page === null) throw new Response("Landing page not found", {status: 404});
    if (!page || typeof page !== "object" || Array.isArray(page)) throw new Error("invalid landing page object");
    return page;
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof SyntaxError || error.message === 'invalid landing page object') throw new Response("Landing page data is invalid", {status: 500});
    throw new Response("Page storage is taking too long to respond. Please try again.", {status: 503});
  }
}

async function landingPageConfirmation(request, env, rawId) {
  const seller = await sellerPageAddress(env, (await sellerContext(request, env)).seller);
  const id = cleanLandingPageId(rawId);
  const object = await env.PRIVATE_ASSETS.head(landingPageKey(seller.id, id));
  if (!object) throw new Response('Landing page not found', {status: 404});
  const meta = object.customMetadata || {};
  return {saveId: meta.saveId || '', page: landingPageLinks({id, url: `${id}.ezkart.site`, name: meta.name, status: meta.status, createdAt: meta.createdAt, updatedAt: meta.updatedAt, publishedAt: meta.publishedAt || null}, seller)};
}

async function landingPageWithPreviewMetadata(env, sellerId, id) {
  const [page, preview] = await Promise.all([
    landingPageObject(env, sellerId, id),
    env.PRIVATE_ASSETS.head(landingPagePreviewKey(sellerId, id)),
  ]);
  return {
    ...page,
    previewUpdatedAt: preview?.customMetadata?.updatedAt || null,
    previewBytes: Math.max(0, Math.round(Number(preview?.size) || 0)),
    previewSourceUpdatedAt: preview?.customMetadata?.sourceUpdatedAt || null,
    previewVersion: String(preview?.customMetadata?.version || ""),
  };
}

async function landingPages(request, env) {
  const seller = await sellerPageAddress(env, (await sellerContext(request, env)).seller);
  const bucket = env.PRIVATE_ASSETS;
  const [objects, previews] = await Promise.all([
    listLandingObjects(bucket, landingPagePrefix(seller.id)),
    listLandingObjects(bucket, `sellers/${seller.id}/landing-page-previews/`),
  ]);
  const previewByKey = new Map(previews.map(object => [object.key, object]));
  const pages = await Promise.all(objects.filter(object => object.key.endsWith('.json')).map(async (object) => {
    const id = object.key.slice(landingPagePrefix(seller.id).length, -5);
    const summary = await readLandingSummary(bucket, seller.id, object, landingPageSummary);
    if (!summary) return null;
    const preview = previewByKey.get(landingPagePreviewKey(seller.id, id));
    return {...landingPageLinks(summary, seller),
      previewUpdatedAt: preview?.customMetadata?.updatedAt || null,
      previewBytes: preview?.size || 0,
      previewSourceUpdatedAt: preview?.customMetadata?.sourceUpdatedAt || null,
      previewVersion: preview?.customMetadata?.version || '',
    };
  }));
  return pages.filter(Boolean).sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

async function landingPage(request, env, rawId) {
  const seller = await sellerPageAddress(env, (await sellerContext(request, env)).seller);
  return landingPageLinks(await landingPageWithPreviewMetadata(env, seller.id, cleanLandingPageId(rawId)), seller);
}

async function saveLandingPage(request, env, rawId, context) {
  const seller = await sellerPageAddress(env, (await sellerContext(request, env)).seller);
  const id = cleanLandingPageId(rawId);
  const payload = await requestJson(request, maximumLandingPageBytes);
  const saveId = String(payload.saveId || '');
  if (saveId && !/^[a-f0-9-]{36}$/.test(saveId)) throw new Response('Save identifier is invalid', {status: 400});
  let existing = null;
  // A publication supplies every editable field and replaces the old HTML.
  // Only its original creation date is needed from storage. Downloading the
  // previous image-heavy project here adds a needless failure point to publish.
  const completePublication = payload.status === 'published'
    && typeof payload.name === 'string' && Array.isArray(payload.products)
    && Array.isArray(payload.customProducts) && Object.hasOwn(payload, 'state')
    && Object.hasOwn(payload, 'publishedHtml');
  try {
    if (completePublication) {
      const object = await env.PRIVATE_ASSETS.head(landingPageKey(seller.id, id));
      if (object) existing = object.customMetadata?.createdAt
        ? {createdAt: object.customMetadata.createdAt}
        : await landingPageObject(env, seller.id, id);
    } else existing = await landingPageObject(env, seller.id, id);
  } catch (error) {
    if (!(error instanceof Response) || error.status !== 404) throw error;
  }
  if (!existing) {
    const maximumLandingPagesPerSeller = sellerPlan(seller).limits.landingPages;
    const listed = await env.PRIVATE_ASSETS.list({ prefix: landingPagePrefix(seller.id), limit: maximumLandingPagesPerSeller + 1 });
    if (listed.objects.filter((object) => object.key.endsWith(".json")).length >= maximumLandingPagesPerSeller) {
      throw new Response(`This store can have up to ${maximumLandingPagesPerSeller} landing pages`, { status: 409 });
    }
  }
  const name = cleanText(payload.name ?? existing?.name, 60);
  if (!name) throw new Response("Landing page name is required", { status: 400 });
  const products = Array.isArray(payload.products)
    ? [...new Set(payload.products.slice(0, 100).map((productId) => cleanId(productId, "Product ID")))]
    : Array.isArray(existing?.products) ? existing.products : [];
  const customProducts = Array.isArray(payload.customProducts)
    ? payload.customProducts.slice(0, 100)
    : Array.isArray(existing?.customProducts) ? existing.customProducts : [];
  const state = Object.hasOwn(payload, "state")
    ? payload.state && typeof payload.state === "object" && !Array.isArray(payload.state) ? payload.state : null
    : existing?.state || null;
  const status = payload.status === "published" ? "published" : payload.status === "draft" ? "draft" : existing?.status || "draft";
  const publishedHtml = Object.hasOwn(payload, "publishedHtml")
    ? String(payload.publishedHtml || "")
    : String(existing?.publishedHtml || "");
  // Autosaving a draft never republishes its HTML. Every publication or replacement
  // of a published snapshot must use the seller's current authoritative catalog.
  if (status === "published" && (payload.status === "published" || Object.hasOwn(payload, "publishedHtml"))) {
    const result = await env.DB.prepare("SELECT * FROM products WHERE seller_id = ? AND status = 'active'").bind(seller.id).all();
    const variants = await env.DB.prepare("SELECT * FROM product_variants WHERE seller_id = ?").bind(seller.id).all();
    const catalogProducts = result.results.map((row) => shapeProduct(row, [], variants.results.filter((v) => v.product_id === row.id)));
    const error = await validatePublication({ html: publishedHtml, state, products: catalogProducts });
    if (error) throw new Response(error, { status: 422 });
  }
  const now = new Date().toISOString();
  const page = {
    id,
    name,
    url: `${id}.ezkart.site`,
    status,
    products,
    customProducts,
    state,
    publishedHtml,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    publishedAt: payload.status === "published" ? now : existing?.publishedAt || null,
  };
  const serialized = JSON.stringify(page);
  if (new TextEncoder().encode(serialized).byteLength > maximumLandingPageBytes) {
    throw new Response("Landing page project is too large", { status: 413 });
  }
  const savedObject = await env.PRIVATE_ASSETS.put(landingPageKey(seller.id, id), serialized, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { sellerId: seller.id, landingPageId: id, status, updatedAt: now, saveId, name, createdAt: page.createdAt, publishedAt: page.publishedAt || '' },
  });
  // A failed derived cache write must not turn a successful project save into
  // an error. The next list read repairs it against the authoritative version.
  context.waitUntil(cacheLandingSummary(env.PRIVATE_ASSETS, seller.id, savedObject, landingPageSummary(page)).catch(() => {}));
  return landingPageLinks(page, seller);
}

async function landingPagePreview(request, env, rawId) {
  const { seller } = await sellerContext(request, env);
  const id = cleanLandingPageId(rawId);
  const [page, object] = await Promise.all([
    env.PRIVATE_ASSETS.head(landingPageKey(seller.id, id)),
    env.PRIVATE_ASSETS.get(landingPagePreviewKey(seller.id, id)),
  ]);
  if (!page) throw new Response("Landing page not found", { status: 404 });
  if (!object) throw new Response("Landing page preview not found", { status: 404 });
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, max-age=600",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; img-src data: https:; media-src data: https:; style-src 'unsafe-inline' https:; font-src data: https:; script-src 'none'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox",
  });
  const etag = `"${object.etag}-static-1"`;
  headers.set('etag', etag);
  if ((request.headers.get('if-none-match') || '').split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*')) {
    await object.body.cancel();
    return new Response(null, {status: 304, headers});
  }
  return staticLandingPreview(new Response(object.body, { status: 200, headers }));
}

async function landingPageView(request, env, rawId) {
  const seller = await sellerPageAddress(env, (await sellerContext(request, env)).seller);
  const expectedStore = request.headers.get('x-ezkart-preview-store');
  if (expectedStore && expectedStore !== seller.pageSlug && expectedStore !== seller.slug) throw new Response("Page not found", {status: 404});
  const id = cleanLandingPageId(rawId);
  const [page, object] = await Promise.all([
    env.PRIVATE_ASSETS.head(landingPageKey(seller.id, id)),
    env.PRIVATE_ASSETS.get(landingPagePreviewKey(seller.id, id)),
  ]);
  if (!page || !object) throw new Response("Save a preview in the editor first", {status: 404});
  // The stored preview contains the full runtime. Only library thumbnails strip
  // scripts and pause motion; an interactive preview uses the same durable HTML.
  const response = new HTMLRewriter().on('#ezkart-library-preview-style', {element(node) { node.remove(); }})
    .transform(hostedLandingResponse(object.body));
  response.headers.set('x-ezkart-preview-path', landingPageLinks({id}, seller).previewPath);
  return response;
}

async function publicLandingPage(env, store, rawId) {
  const seller = await sellerByPageAddress(env, store);
  if (!seller) throw new Response("Page not found", {status: 404});
  const page = await landingPageObject(env, seller.id, cleanLandingPageId(rawId));
  if (page.status !== 'published' || !page.publishedHtml) throw new Response("Page not found", {status: 404});
  // Never serve editable state or the draft preview from the public route.
  const response = hostedLandingResponse(page.publishedHtml, {noindex: env.APP_ENVIRONMENT !== 'production'});
  response.headers.set('x-ezkart-public-path', landingPageLinks(page, seller).publicPath);
  return response;
}

async function saveLandingPagePreview(request, env, rawId) {
  const { seller } = await sellerContext(request, env);
  const id = cleanLandingPageId(rawId);
  const page = await env.PRIVATE_ASSETS.head(landingPageKey(seller.id, id));
  if (!page) throw new Response('Landing page not found', {status: 404});
  const payload = await requestJson(request, maximumLandingPagePreviewRequestBytes);
  const sourceUpdatedAt = String(payload.sourceUpdatedAt || "");
  const savedVersion = page.customMetadata?.updatedAt || (await landingPageObject(env, seller.id, id)).updatedAt;
  if (!sourceUpdatedAt || sourceUpdatedAt !== savedVersion) {
    throw new Response("Landing page changed while its preview was saving", { status: 409 });
  }
  const html = String(payload.html || "");
  const bytes = new TextEncoder().encode(html).byteLength;
  if (!/^<!doctype html>/i.test(html.trimStart()) || !html.includes("sq-page-preview")) {
    throw new Response("Landing page preview HTML is invalid", { status: 400 });
  }
  if (bytes < 1 || bytes > maximumLandingPagePreviewBytes) {
    throw new Response("Landing page preview is too large", { status: 413 });
  }
  const previousPreview = await env.PRIVATE_ASSETS.head(landingPagePreviewKey(seller.id, id));
  const nowMilliseconds = Date.now();
  if (previousPreview?.customMetadata?.version === landingPagePreviewVersion
    && previousPreview.customMetadata.sourceUpdatedAt === sourceUpdatedAt) {
    return {
      updatedAt: previousPreview.customMetadata.updatedAt,
      bytes: Math.max(0, Math.round(Number(previousPreview.size) || 0)),
      sourceUpdatedAt,
      version: landingPagePreviewVersion,
      skipped: true,
    };
  }
  const updatedAt = new Date(nowMilliseconds).toISOString();
  await env.PRIVATE_ASSETS.put(landingPagePreviewKey(seller.id, id), html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
    customMetadata: { sellerId: seller.id, landingPageId: id, updatedAt, sourceUpdatedAt, version: landingPagePreviewVersion },
  });
  await env.PRIVATE_ASSETS.delete(landingPageThumbnailKey(seller.id, id));
  return { updatedAt, bytes, sourceUpdatedAt, version: landingPagePreviewVersion, skipped: false };
}

async function deleteLandingPage(request, env, rawId) {
  const { seller } = await sellerContext(request, env);
  const id = cleanLandingPageId(rawId);
  const key = landingPageKey(seller.id, id);
  if (!(await env.PRIVATE_ASSETS.head(key))) throw new Response("Landing page not found", { status: 404 });
  await env.PRIVATE_ASSETS.delete([key, landingPagePreviewKey(seller.id, id), landingPageThumbnailKey(seller.id, id), landingSummaryKey(seller.id, id)]);
}

const componentPrefix = (sellerId) => `sellers/${sellerId}/components/`;
const componentKey = (sellerId, id) => `${componentPrefix(sellerId)}${id}.json`;
const cleanComponentId = (value) => {
  const id = String(value || "").trim().toLowerCase();
  if (id.length < 3 || id.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Response("Component ID is invalid", { status: 400 });
  }
  return id;
};

async function componentObject(env, sellerId, id) {
  const object = await env.PRIVATE_ASSETS.get(componentKey(sellerId, id));
  if (!object) throw new Response("Component not found", { status: 404 });
  try {
    const component = JSON.parse(await object.text());
    if (!component || typeof component !== "object" || Array.isArray(component)) throw new Error("invalid component object");
    return component;
  } catch (_) {
    throw new Response("Component data is invalid", { status: 500 });
  }
}

async function components(request, env) {
  const { seller } = await sellerContext(request, env);
  const result = await env.PRIVATE_ASSETS.list({ prefix: componentPrefix(seller.id), limit: maximumComponentsPerSeller + 1 });
  const stored = result.objects.filter((object) => object.key.endsWith(".json")).slice(0, maximumComponentsPerSeller);
  const values = await Promise.all(stored.map((object) => {
    const id = object.key.slice(componentPrefix(seller.id).length, -5);
    return componentObject(env, seller.id, id);
  }));
  return values.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

async function component(request, env, rawId) {
  const { seller } = await sellerContext(request, env);
  return componentObject(env, seller.id, cleanComponentId(rawId));
}

async function saveComponent(request, env, rawId) {
  const { seller } = await sellerContext(request, env);
  const id = cleanComponentId(rawId);
  // JSON escaping can make the transport body larger than the UTF-8 component
  // itself. Enforce the exact 200 KB limit below after parsing the code value.
  const payload = await requestJson(request, maximumComponentBytes * 3 + 8192);
  let existing = null;
  try { existing = await componentObject(env, seller.id, id); } catch (error) {
    if (!(error instanceof Response) || error.status !== 404) throw error;
  }
  if (!existing) {
    const listed = await env.PRIVATE_ASSETS.list({ prefix: componentPrefix(seller.id), limit: maximumComponentsPerSeller + 1 });
    if (listed.objects.filter((object) => object.key.endsWith(".json")).length >= maximumComponentsPerSeller) {
      throw new Response(`This store can have up to ${maximumComponentsPerSeller} components`, { status: 409 });
    }
  }
  const name = cleanText(payload.name ?? existing?.name, 80);
  if (!name) throw new Response("Component name is required", { status: 400 });
  const description = cleanText(payload.description ?? existing?.description, 180);
  const code = String(payload.code ?? existing?.code ?? "");
  const sizeBytes = new TextEncoder().encode(code).byteLength;
  if (!code.trim()) throw new Response("Component code is required", { status: 400 });
  if (sizeBytes > maximumComponentBytes) throw new Response("Component code is larger than 200 KB", { status: 413 });
  const now = new Date().toISOString();
  const value = { id, name, description, code, sizeBytes, createdAt: existing?.createdAt || now, updatedAt: now };
  await env.PRIVATE_ASSETS.put(componentKey(seller.id, id), JSON.stringify(value), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { sellerId: seller.id, componentId: id, updatedAt: now },
  });
  return value;
}

async function deleteComponent(request, env, rawId) {
  const { seller } = await sellerContext(request, env);
  const id = cleanComponentId(rawId);
  const key = componentKey(seller.id, id);
  if (!(await env.PRIVATE_ASSETS.head(key))) throw new Response("Component not found", { status: 404 });
  await env.PRIVATE_ASSETS.delete(key);
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
  assertCatalogEditor(seller);
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
      OR EXISTS (
        SELECT 1 FROM sellers s WHERE s.id = mu.seller_id AND s.status = 'active'
        AND (json_extract(s.settings_json, '$.storefront.logoId') = mu.id
          OR json_extract(s.settings_json, '$.storefront.backgroundId') = mu.id)
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

async function existingUploads(env, sellerId, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const results = await env.DB.batch(unique.map((id) => env.DB.prepare(
    `SELECT id, r2_key, mime_type, size_bytes, created_by_auth_user_id, created_at
     FROM media_uploads
     WHERE seller_id = ? AND id = ?`,
  ).bind(sellerId, id)));
  const rows = results.map((result) => result.results?.[0]).filter(Boolean);
  return new Map(rows.map((row) => [row.id, row]));
}

async function ownedUploads(env, sellerId, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const uploads = await existingUploads(env, sellerId, unique);
  if (uploads.size !== unique.length) throw new Response("One or more images do not belong to this seller", { status: 400 });
  return uploads;
}

async function assertProductCapacity(env, seller) {
  const sellerId = seller.id;
  const maximumProductsPerSeller = sellerPlan(seller).limits.products;
  const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM products WHERE seller_id = ?").bind(sellerId).first();
  if (Number(result?.count || 0) >= maximumProductsPerSeller) {
    throw new Response(`This store can have up to ${maximumProductsPerSeller} products. Delete a product before creating another one.`, { status: 409 });
  }
}

async function productMediaIds(env, sellerId, productId) {
  const [galleryResult, variantResult, draftResult] = await env.DB.batch([
    env.DB.prepare("SELECT id FROM product_media WHERE seller_id = ? AND product_id = ?").bind(sellerId, productId),
    env.DB.prepare("SELECT image_upload_id AS id FROM product_variants WHERE seller_id = ? AND product_id = ? AND image_upload_id IS NOT NULL").bind(sellerId, productId),
    env.DB.prepare("SELECT snapshot_json FROM product_drafts WHERE seller_id = ? AND product_id = ?").bind(sellerId, productId),
  ]);
  const ids = [
    ...(Array.isArray(galleryResult.results) ? galleryResult.results.map((row) => row.id) : []),
    ...(Array.isArray(variantResult.results) ? variantResult.results.map((row) => row.id) : []),
  ];
  (Array.isArray(draftResult.results) ? draftResult.results : []).forEach((row) => {
    const snapshot = parseJson(row.snapshot_json, {});
    (Array.isArray(snapshot.images) ? snapshot.images : []).forEach((image) => ids.push(image?.cloudId));
    (Array.isArray(snapshot.variants) ? snapshot.variants : []).forEach((variant) => ids.push(variant?.customImage?.cloudId));
  });
  return [...new Set(ids.filter(Boolean))];
}

async function cleanupUnusedMedia(env, sellerId, ids) {
  const candidates = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
  if (!candidates.length) return 0;
  const uploads = await existingUploads(env, sellerId, candidates);
  let removed = 0;
  for (const mediaId of candidates) {
    const upload = uploads.get(mediaId);
    if (!upload) continue;
    try {
      const result = await env.DB.prepare(`
        DELETE FROM media_uploads
        WHERE seller_id = ? AND id = ?
          AND NOT EXISTS (SELECT 1 FROM product_media WHERE seller_id = ? AND id = ?)
          AND NOT EXISTS (SELECT 1 FROM product_variants WHERE seller_id = ? AND image_upload_id = ?)
          AND NOT EXISTS (SELECT 1 FROM product_drafts WHERE seller_id = ? AND instr(snapshot_json, ?) > 0)
          AND NOT EXISTS (SELECT 1 FROM sellers WHERE id = media_uploads.seller_id
            AND (json_extract(settings_json, '$.storefront.logoId') = media_uploads.id
              OR json_extract(settings_json, '$.storefront.backgroundId') = media_uploads.id
              OR json_extract(settings_json, '$.adminProfile.logoId') = media_uploads.id))
      `).bind(sellerId, mediaId, sellerId, mediaId, sellerId, mediaId, sellerId, mediaId).run();
      if (Number(result.meta?.changes || 0) < 1) continue;
      try {
        await env.PUBLIC_ASSETS.delete(upload.r2_key);
        removed += 1;
      } catch (error) {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO media_uploads (id, seller_id, r2_key, mime_type, size_bytes, created_by_auth_user_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(upload.id, sellerId, upload.r2_key, upload.mime_type, upload.size_bytes, upload.created_by_auth_user_id, upload.created_at).run();
        console.error("Could not delete an unused product image", { mediaId, error });
      }
    } catch (error) {
      console.error("Could not clean an unused product image", { mediaId, error });
    }
  }
  return removed;
}

async function cleanupAbandonedMedia(env) {
  const cutoff = new Date(Date.now() - abandonedUploadGraceMilliseconds).toISOString();
  const result = await env.DB.prepare(`
    SELECT id, seller_id
    FROM media_uploads
    WHERE created_at < ?
    ORDER BY created_at ASC
    LIMIT 50
  `).bind(cutoff).all();
  const bySeller = new Map();
  (Array.isArray(result.results) ? result.results : []).forEach((row) => {
    if (!bySeller.has(row.seller_id)) bySeller.set(row.seller_id, []);
    bySeller.get(row.seller_id).push(row.id);
  });
  let removed = 0;
  for (const [sellerId, ids] of bySeller) removed += await cleanupUnusedMedia(env, sellerId, ids);
  return removed;
}

function normalizedOptions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((group) => ({
    name: cleanText(group?.name, 20),
    values: Array.isArray(group?.values) ? [...new Set(group.values.map((item) => cleanText(item, 60)).filter(Boolean))].slice(0, 30) : [],
  })).filter((group) => group.name && group.values.length);
}

async function saveProduct(request, env, rawId) {
  const { seller, authUserId } = await sellerContext(request, env);
  assertCatalogEditor(seller);
  const payload = await requestJson(request, 500000);
  const id = cleanId(rawId || payload.id, "Product ID");
  const existing = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first();
  if (existing && existing.seller_id !== seller.id) throw new Response("Product not found", { status: 404 });
  if (existing && (!Number.isSafeInteger(payload.revision) || payload.revision !== existing.revision)) {
    throw new Response("This product changed since these edits started. Load the latest product and review your changes before publishing.", { status: 409, headers: { "x-ezkart-error-code": "catalog_revision_conflict" } });
  }
  if (!existing) await assertProductCapacity(env, seller);
  const type = ["physical", "digital", "subscription"].includes(payload.type) ? payload.type : "physical";
  const title = cleanText(payload.name, 160);
  if (title.length < 2) throw new Response("Product name must contain at least 2 characters", { status: 400 });
  const description = cleanText(payload.description, 10000);
  const sku = cleanText(payload.sku, 80) || `EZK-${id.slice(-12).toUpperCase()}`;
  if (Array.isArray(payload.options) && payload.options.length > 3) throw new Response("Products can have up to 3 option groups", { status: 400 });
  if (Array.isArray(payload.options) && payload.options.some((group) => Array.isArray(group?.values) && new Set(group.values.map((item) => cleanText(item, 60)).filter(Boolean)).size > 30)) {
    throw new Response("Each option group can have up to 30 unique values", { status: 400 });
  }
  const options = normalizedOptions(payload.options);
  const imageIds = Array.isArray(payload.imageUploadIds) ? payload.imageUploadIds.slice(0, 9).map((item) => cleanId(item, "Image ID")) : [];
  const minimumImages = type === "physical" ? 3 : 1;
  if (imageIds.length < minimumImages || imageIds.length > 9) throw new Response(`This product requires ${minimumImages}–9 images`, { status: 400 });
  if (Array.isArray(payload.variants) && payload.variants.length > 100) throw new Response("Products can have up to 100 generated combinations", { status: 400 });
  const rawVariants = Array.isArray(payload.variants) ? payload.variants : [];
  const variants = rawVariants.map((variant, index) => ({
    id: cleanId(variant.id || `variant-${crypto.randomUUID()}`, "Variant ID"),
    name: cleanText(variant.name, 120) || `${type === "subscription" ? "Plan" : "Variant"} ${index + 1}`,
    options: Array.isArray(variant.options) ? variant.options.slice(0, 3).map((option) => ({ option: cleanText(option?.option, 20), value: cleanText(option?.value, 60) })) : [],
    sku: cleanText(variant.sku, 80),
    price: catalogInteger(variant.price, "Variant price", 1000),
    stock: type === "physical" ? catalogInteger(variant.stock, "Variant stock") : 0,
    weightGrams: type === "physical" ? catalogInteger(variant.weightGrams, "Variant weight", 1, 1000000) : 0,
    billingUnit: type === "subscription" && ["month", "year"].includes(variant.billingUnit) ? variant.billingUnit : null,
    billingInterval: type === "subscription" ? Math.max(1, Math.min(variant.billingUnit === "year" ? 10 : 120, Math.round(Number(variant.billingInterval) || 1))) : null,
    hidden: Boolean(variant.hidden),
    imageSource: /^gallery-[1-9]$/.test(String(variant.imageSource || "")) ? String(variant.imageSource) : variant.imageUploadId ? "variant-upload" : "main",
    imageUploadId: variant.imageUploadId ? cleanId(variant.imageUploadId, "Variant image ID") : null,
  }));
  const firstOptionName = options[0]?.name;
  if (firstOptionName) {
    const sharedImages = new Map();
    variants.forEach((variant) => {
      const value = variant.options.find((option) => option.option === firstOptionName)?.value;
      if (!value) return;
      const current = sharedImages.get(value);
      if (!current || (!current.imageUploadId && variant.imageUploadId)) sharedImages.set(value, { imageSource: variant.imageSource, imageUploadId: variant.imageUploadId });
    });
    variants.forEach((variant) => {
      const value = variant.options.find((option) => option.option === firstOptionName)?.value;
      const shared = value ? sharedImages.get(value) : null;
      if (shared) { variant.imageSource = shared.imageSource; variant.imageUploadId = shared.imageUploadId; }
    });
  }
  if (variants.some((variant) => !variant.sku || variant.price < 1000 || (type === "physical" && variant.weightGrams < 1) || (type === "subscription" && (!variant.billingUnit || variant.billingInterval < 1)))) {
    throw new Response(type === "subscription" ? "Every plan needs a valid price, SKU, and billing period" : "Every variant needs a valid price, SKU, and shipping weight", { status: 400 });
  }
  if (new Set(variants.map((variant) => variant.sku.toLowerCase())).size !== variants.length) throw new Response(type === "subscription" ? "Plan SKUs must be unique" : "Variant SKUs must be unique", { status: 400 });
  if (new Set(variants.map((variant) => variant.id)).size !== variants.length) throw new Response("Variant IDs must be unique", { status: 400 });
  const storedVariants = existing ? (await env.DB.prepare("SELECT * FROM product_variants WHERE seller_id = ? AND product_id = ?").bind(seller.id, id).all()).results : [];
  const retainedIds = new Set(variants.map((variant) => variant.id));
  const retainedSlots = new Map(storedVariants.filter((variant) => retainedIds.has(variant.id)).map((variant) => [variant.id, variant.sort_order]));
  const usedSlots = new Set(retainedSlots.values());
  // sort_order is a stable unique slot. Display order is stored separately so
  // reordering variants never deletes a held identity or violates slot uniqueness.
  for (const variant of variants) {
    variant.slot = retainedSlots.get(variant.id);
    if (variant.slot === undefined) {
      for (let slot = 1; slot <= 100; slot++) if (!usedSlots.has(slot)) { variant.slot = slot; usedSlots.add(slot); break; }
    }
  }
  if (variants.length) {
    const owners = await env.DB.batch(variants.map((variant) => env.DB.prepare("SELECT seller_id, product_id FROM product_variants WHERE id = ?").bind(variant.id)));
    if (owners.some((result) => result.results.some((owner) => owner.seller_id !== seller.id || owner.product_id !== id))) {
      throw new Response("A variant does not belong to this product", { status: 409 });
    }
  }
  const requestedMediaIds = [...imageIds, ...rawVariants.map((variant) => variant?.imageUploadId).filter(Boolean)];
  const uploadMap = await ownedUploads(env, seller.id, [...imageIds, ...variants.map((variant) => variant.imageUploadId)]);
  const replacedMediaIds = existing ? await productMediaIds(env, seller.id, id) : [];
  const sellableVariants = variants.filter((variant) => !variant.hidden);
  if (variants.length && !sellableVariants.length) throw new Response(type === "subscription" ? "At least one plan must be visible" : "At least one variant must be visible", { status: 400 });
  const basePrice = sellableVariants.length ? Math.min(...sellableVariants.map((variant) => variant.price)) : catalogInteger(payload.price, "Price", 1000);
  const stock = type === "physical" ? (variants.length ? sellableVariants.reduce((sum, variant) => sum + variant.stock, 0) : catalogInteger(payload.stock, "Stock")) : null;
  const weight = type === "physical" ? (sellableVariants.length ? Math.max(...sellableVariants.map((variant) => variant.weightGrams)) : catalogInteger(payload.weightGrams, "Shipping weight", 1, 1000000)) : null;
  const firstPlan = type === "subscription" && sellableVariants.length ? sellableVariants[0] : null;
  const displayBillingUnit = type === "subscription" ? (firstPlan?.billingUnit || (["month", "year"].includes(payload.subscription?.unit) ? payload.subscription.unit : "month")) : null;
  const displayBillingInterval = type === "subscription" ? (firstPlan?.billingInterval || Math.max(1, Math.min(displayBillingUnit === "year" ? 10 : 120, Math.round(Number(payload.subscription?.interval) || 1)))) : null;
  const billingUnit = type === "subscription" ? "month" : null;
  const billingInterval = type === "subscription" ? displayBillingInterval * (displayBillingUnit === "year" ? 12 : 1) : null;
  const digitalFilename = type === "digital" ? cleanText(payload.digitalFileName, 180) : null;
  const now = new Date().toISOString();
  const createdAt = existing?.created_at || now;
  const eventId = `event_${crypto.randomUUID()}`;
  const statements = [
    env.DB.prepare(`
      INSERT INTO seller_events (id, seller_id, actor_auth_user_id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, 'product', ?, ?, ?)
    `).bind(eventId, seller.id, authUserId, existing ? "product.updated" : "product.created", id,
      JSON.stringify({ title, variants: variants.length, images: imageIds.length, expectedRevision: existing ? payload.revision : null }), now),
    ...catalogStockMovements(env, {sellerId: seller.id, actor: authUserId, reason: existing ? 'catalog_edit' : 'catalog_create', reference: eventId, now},
      existing, storedVariants, {id, type, title, sku, stock_quantity: stock}, variants.map(v => ({...v, stock_quantity: v.stock}))),
    env.DB.prepare(`
      INSERT INTO products (id, seller_id, type, status, title, description, sku, currency, price_amount, stock_quantity, weight_grams, billing_interval, billing_interval_count, digital_filename, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, 'IDR', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${existing ? `ON CONFLICT(id) DO UPDATE SET type = excluded.type, status = 'active', title = excluded.title,
        description = excluded.description, sku = excluded.sku, price_amount = excluded.price_amount,
        stock_quantity = excluded.stock_quantity, weight_grams = excluded.weight_grams,
        billing_interval = excluded.billing_interval, billing_interval_count = excluded.billing_interval_count,
        digital_filename = excluded.digital_filename, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at` : ""}
    `).bind(id, seller.id, type, title, description, sku, basePrice, stock, weight, billingUnit, billingInterval, digitalFilename, JSON.stringify({ category: cleanText(payload.category, 80), categoryKey: cleanText(payload.categoryKey, 120), options, ...(type === "subscription" ? { subscription: { interval: displayBillingInterval, unit: displayBillingUnit } } : {}) }), createdAt, now),
    env.DB.prepare("DELETE FROM product_media WHERE seller_id = ? AND product_id = ?").bind(seller.id, id),
  ];
  for (const variant of storedVariants) {
    if (!retainedIds.has(variant.id)) statements.push(env.DB.prepare("DELETE FROM product_variants WHERE seller_id = ? AND product_id = ? AND id = ?").bind(seller.id, id, variant.id));
  }
  // Vacate retained SKUs inside the transaction to permit deliberate SKU swaps.
  // No temporary value can become externally visible, even when a later guard fails.
  const temporarySkuPrefix = `edit-${crypto.randomUUID()}-`;
  for (const variantId of retainedSlots.keys()) statements.push(env.DB.prepare("UPDATE product_variants SET sku = ? WHERE seller_id = ? AND product_id = ? AND id = ?").bind(temporarySkuPrefix + retainedSlots.get(variantId), seller.id, id, variantId));
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
    ${retainedSlots.has(variant.id) ? `ON CONFLICT(id) DO UPDATE SET name = excluded.name, options_json = excluded.options_json,
      sku = excluded.sku, price_amount = excluded.price_amount, stock_quantity = excluded.stock_quantity,
      weight_grams = excluded.weight_grams, billing_interval = excluded.billing_interval,
      billing_interval_count = excluded.billing_interval_count, image_source = excluded.image_source,
      image_upload_id = excluded.image_upload_id, updated_at = excluded.updated_at` : ""}
  `).bind(variant.id, seller.id, id, variant.name, JSON.stringify({ values: variant.options, hidden: variant.hidden, position: index + 1 }), variant.sku, variant.price, type === "physical" ? variant.stock : null, type === "physical" ? variant.weightGrams : null, variant.billingUnit, variant.billingInterval, variant.imageSource, variant.imageUploadId, variant.slot, now, now)));
  await env.DB.batch(statements);
  await cleanupUnusedMedia(env, seller.id, [...replacedMediaIds, ...requestedMediaIds]);
  const result = await catalog(request, env);
  return result.products.find((product) => product.id === id);
}

async function deleteProduct(request, env, productId) {
  const { seller, authUserId } = await sellerContext(request, env);
  assertCatalogEditor(seller);
  const id = cleanId(productId, "Product ID");
  const existing = await env.DB.prepare("SELECT * FROM products WHERE seller_id = ? AND id = ?").bind(seller.id, id).first();
  if (!existing) throw new Response("Product not found", { status: 404 });
  const variants = (await env.DB.prepare("SELECT * FROM product_variants WHERE seller_id = ? AND product_id = ?").bind(seller.id, id).all()).results;
  const removedMediaIds = await productMediaIds(env, seller.id, id);
  const now = new Date().toISOString();
  const eventId = `event_${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO seller_events (id, seller_id, actor_auth_user_id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, ?, 'product.deleted', 'product', ?, ?, ?)
    `).bind(eventId, seller.id, authUserId, id, JSON.stringify({expectedRevision: existing.revision}), now),
    ...catalogStockMovements(env, {sellerId: seller.id, actor: authUserId, reason: 'catalog_delete', reference: eventId, now}, existing, variants, null, []),
    env.DB.prepare("DELETE FROM products WHERE seller_id = ? AND id = ?").bind(seller.id, id),
  ]);
  await cleanupUnusedMedia(env, seller.id, removedMediaIds);
}

async function setProductStatus(request, env, productId) {
  const { seller, authUserId } = await sellerContext(request, env);
  assertCatalogEditor(seller);
  const id = cleanId(productId, "Product ID");
  const payload = await requestJson(request, 2000);
  const status = ["active", "archived"].includes(payload.status) ? payload.status : null;
  if (!status) throw new Response("Product status must be active or archived", { status: 400 });
  const existing = await env.DB.prepare("SELECT id, status FROM products WHERE seller_id = ? AND id = ?").bind(seller.id, id).first();
  if (!existing) throw new Response("Product not found", { status: 404 });
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE products SET status = ?, updated_at = ? WHERE seller_id = ? AND id = ?").bind(status, now, seller.id, id),
    env.DB.prepare(`
      INSERT INTO seller_events (id, seller_id, actor_auth_user_id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, 'product', ?, ?, ?)
    `).bind(`event_${crypto.randomUUID()}`, seller.id, authUserId, status === "archived" ? "product.archived" : "product.restored", id, JSON.stringify({ previousStatus: existing.status, status }), now),
  ]);
  const result = await catalog(request, env);
  return result.products.find((product) => product.id === id);
}

const duplicatedValue = (value, suffix, maximum) => {
  const ending = `-${suffix}`;
  const base = String(value || "").trim() || "EZK";
  return `${base.slice(0, Math.max(1, maximum - ending.length))}${ending}`;
};

async function duplicateProduct(request, env, productId) {
  const { seller, authUserId } = await sellerContext(request, env);
  assertCatalogEditor(seller);
  const sourceId = cleanId(productId, "Product ID");
  const [product, mediaResult, variantsResult] = await Promise.all([
    env.DB.prepare("SELECT * FROM products WHERE seller_id = ? AND id = ?").bind(seller.id, sourceId).first(),
    env.DB.prepare("SELECT * FROM product_media WHERE seller_id = ? AND product_id = ? ORDER BY sort_order").bind(seller.id, sourceId).all(),
    env.DB.prepare(`SELECT * FROM product_variants WHERE seller_id = ? AND product_id = ? ORDER BY ${variantPositionSql}`).bind(seller.id, sourceId).all(),
  ]);
  if (!product) throw new Response("Product not found", { status: 404 });
  await assertProductCapacity(env, seller);

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
    const copiedVariants = [];
    sourceVariants.forEach((variant, index) => {
      const variantIdSuffix = crypto.randomUUID().replaceAll("-", "");
      copiedVariants.push({...variant, id: `variant-${variantIdSuffix}`, sku: duplicatedValue(variant.sku, skuSuffix, 80)});
      const imageUploadId = variant.image_upload_id ? mediaCopies.get(variant.image_upload_id)?.id || null : null;
      statements.push(env.DB.prepare(`
        INSERT INTO product_variants (id, seller_id, product_id, name, options_json, sku, price_amount, stock_quantity, weight_grams, billing_interval, billing_interval_count, image_source, image_upload_id, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(`variant-${variantIdSuffix}`, seller.id, copyId, variant.name, variant.options_json, duplicatedValue(variant.sku, skuSuffix, 80), variant.price_amount, variant.stock_quantity, variant.weight_grams, variant.billing_interval, variant.billing_interval_count, variant.image_source, imageUploadId, index + 1, now, now));
    });
    const duplicateEventId = `event_${crypto.randomUUID()}`;
    statements.push(...catalogStockMovements(env, {sellerId: seller.id, actor: authUserId, reason: 'catalog_duplicate', reference: duplicateEventId, now},
      null, [], {...product, id: copyId, title: copyTitle, sku: copySku}, copiedVariants));
    statements.push(env.DB.prepare(`
      INSERT INTO seller_events (id, seller_id, actor_auth_user_id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, ?, 'product.duplicated', 'product', ?, ?, ?)
    `).bind(duplicateEventId, seller.id, authUserId, copyId, JSON.stringify({ source_product_id: sourceId, title: copyTitle }), now));

    await env.DB.batch(statements);
    persisted = true;
    const result = await catalog(request, env);
    return result.products.find((candidate) => candidate.id === copyId);
  } catch (error) {
    if (!persisted) await Promise.allSettled(copiedR2Keys.map((key) => env.PUBLIC_ASSETS.delete(key)));
    if (!persisted) await cleanupUnusedMedia(env, seller.id, [...mediaCopies.values()].map((media) => media.id));
    throw error;
  }
}

async function saveDraft(request, env, draftId) {
  const { seller, authUserId } = await sellerContext(request, env);
  assertCatalogEditor(seller);
  const id = cleanId(draftId, "Draft ID");
  const payload = await requestJson(request, 500000);
  const existing = await env.DB.prepare("SELECT seller_id, snapshot_json, created_at FROM product_drafts WHERE id = ?").bind(id).first();
  if (existing && existing.seller_id !== seller.id) throw new Response("Draft not found", { status: 404 });
  const productId = payload.productId ? cleanId(payload.productId, "Product ID") : null;
  if (productId) {
    const product = await env.DB.prepare("SELECT id FROM products WHERE seller_id = ? AND id = ?").bind(seller.id, productId).first();
    if (!product) throw new Response("Draft product not found", { status: 400 });
  }
  const snapshot = payload.snapshot && typeof payload.snapshot === "object" && !Array.isArray(payload.snapshot) ? payload.snapshot : {};
  if (Array.isArray(snapshot.options) && snapshot.options.length > 3) throw new Response("Product drafts can have up to 3 option groups", { status: 400 });
  if (Array.isArray(snapshot.options) && snapshot.options.some((group) => Array.isArray(group?.values) && new Set(group.values.map((item) => cleanText(item, 60)).filter(Boolean)).size > 30)) {
    throw new Response("Each draft option group can have up to 30 unique values", { status: 400 });
  }
  if (Array.isArray(snapshot.variants) && snapshot.variants.length > 100) throw new Response("Product drafts can have up to 100 generated combinations", { status: 400 });
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > 400000) throw new Response("Draft is too large", { status: 413 });
  const referencedMedia = [
    ...(Array.isArray(snapshot.images) ? snapshot.images.map((item) => item?.cloudId) : []),
    ...(Array.isArray(snapshot.variants) ? snapshot.variants.map((item) => item?.customImage?.cloudId) : []),
  ].filter(Boolean).map((mediaId) => cleanId(mediaId, "Draft image ID"));
  const previousSnapshot = parseJson(existing?.snapshot_json, {});
  const previousMedia = [
    ...(Array.isArray(previousSnapshot.images) ? previousSnapshot.images.map((item) => item?.cloudId) : []),
    ...(Array.isArray(previousSnapshot.variants) ? previousSnapshot.variants.map((item) => item?.customImage?.cloudId) : []),
  ].filter(Boolean);
  await ownedUploads(env, seller.id, referencedMedia);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO product_drafts (id, seller_id, product_id, title, snapshot_json, created_by_auth_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET product_id = excluded.product_id, title = excluded.title,
      snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at
  `).bind(id, seller.id, productId, cleanText(payload.title, 160), serialized, authUserId, existing?.created_at || now, now).run();
  await cleanupUnusedMedia(env, seller.id, previousMedia);
  return { id, updatedAt: now };
}

async function deleteDraft(request, env, draftId) {
  const { seller } = await sellerContext(request, env);
  assertCatalogEditor(seller);
  const id = cleanId(draftId, "Draft ID");
  const existing = await env.DB.prepare("SELECT snapshot_json FROM product_drafts WHERE seller_id = ? AND id = ?").bind(seller.id, id).first();
  const snapshot = parseJson(existing?.snapshot_json, {});
  const removedMedia = [
    ...(Array.isArray(snapshot.images) ? snapshot.images.map((item) => item?.cloudId) : []),
    ...(Array.isArray(snapshot.variants) ? snapshot.variants.map((item) => item?.customImage?.cloudId) : []),
  ].filter(Boolean);
  await env.DB.prepare("DELETE FROM product_drafts WHERE seller_id = ? AND id = ?").bind(seller.id, id).run();
  await cleanupUnusedMedia(env, seller.id, removedMedia);
}

async function authorizeLandingExport(request, env, id) {
  const { seller } = await sellerContext(request, env);
  await landingPageObject(env, seller.id, cleanLandingPageId(id));
  const payload = await requestJson(request, maximumLandingPageBytes);
  const html = String(payload.html || "");
  if (new TextEncoder().encode(html).length > 12 * 1024 * 1024) throw new Response("Page is too large.", {status:413});
  const result = await env.DB.prepare("SELECT * FROM products WHERE seller_id = ? AND status = 'active'").bind(seller.id).all();
  const variants = await env.DB.prepare("SELECT * FROM product_variants WHERE seller_id = ?").bind(seller.id).all();
  const products = result.results.map(row => shapeProduct(row, [], variants.results.filter(v => v.product_id === row.id)));
  const error = await validatePublication({html,state:payload.state,products});
  if (error) throw new Response(error.replaceAll("before publishing", "before copying or exporting code"), {status:422});
  return {ok:true};
}

export default {
  async fetch(request, env, context) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    try {
      const emailCallback=/^\/webhooks\/commerce-email\/resend\/([A-Za-z0-9][A-Za-z0-9_-]{2,63})$/.exec(url.pathname);
      if(emailCallback){
        if(url.search)return json({ok:false,error:'Email callback parameters are invalid'},422);
        return json({ok:true,...await recordEmailWebhook(request,env,emailCallback[1])});
      }
      if(url.pathname==='/internal/commerce/automations/process'&&request.method==='POST'){
        const input=await authenticateCommerceService(request,env,{strictJSON:true,maxBytes:1000});
        if(url.search||Object.keys(input).some(k=>k!=='environment')||input.environment!==(env.APP_ENVIRONMENT==='test'?'sandbox':'production'))return json({ok:false,error:'Automation processing request is invalid'},422);
        return json({ok:true,...await processMarketingAutomations(env)});
      }
      if(url.pathname==='/internal/commerce/campaigns/drain'&&request.method==='POST'){
        const input=await authenticateCommerceService(request,env,{strictJSON:true,maxBytes:2000});
        if(url.search||Object.keys(input).some(k=>!['environment','limit'].includes(k))||input.environment!==(env.APP_ENVIRONMENT==='test'?'sandbox':'production')||input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>2))return json({ok:false,error:'Campaign processing request is invalid'},422);
        return json({ok:true,...await dispatchCampaignEmails(env,input.limit??2)});
      }
      if(url.pathname==='/internal/commerce/email/drain'&&request.method==='POST'){
        const input=await authenticateCommerceService(request,env);
        if(url.search||Object.keys(input).some(k=>!['environment','limit'].includes(k))||input.environment!==(env.APP_ENVIRONMENT==='test'?'sandbox':'production')||input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>2))return json({ok:false,error:'Email processing request is invalid'},422);
        return json({ok:true,...await dispatchEmails(env,input.limit??2)});
      }
      const campaignInvestigation=/^\/internal\/commerce\/campaigns\/(investigations(?:\/(campmail_[a-f0-9]{32}))?|lookup|resolve)$/.exec(url.pathname);
      if(campaignInvestigation){
        const input=await authenticateCommerceService(request,env,{strictJSON:true,maxBytes:3000});
        if(campaignInvestigation[1].startsWith('investigations')&&request.method==='GET'&&!Object.keys(input).length)return json({ok:true,...await campaignEmailInvestigations(env,url,campaignInvestigation[2]||null)});
        if(request.method==='POST'&&!url.search&&['lookup','resolve'].includes(campaignInvestigation[1]))return json({ok:true,...await (campaignInvestigation[1]==='lookup'?lookupCampaignEmail(env,input):resolveCampaignEmail(env,input))});
        return json({ok:false,error:'Campaign investigation method or parameters are invalid'},422);
      }
      const emailInvestigation=/^\/internal\/commerce\/email\/(investigations(?:\/(email_[a-f0-9]{32}))?|lookup|resolve)$/.exec(url.pathname);
      if(emailInvestigation){
        const input=await authenticateCommerceService(request,env,{strictJSON:true,maxBytes:3000});
        if(emailInvestigation[1].startsWith('investigations')&&request.method==='GET'&&!Object.keys(input).length)return json({ok:true,...await emailInvestigations(env,url,emailInvestigation[2]||null)});
        if(request.method==='POST'&&!url.search&&['lookup','resolve'].includes(emailInvestigation[1]))return json({ok:true,...await (emailInvestigation[1]==='lookup'?lookupEmail(env,input):resolveEmail(env,input))});
        return json({ok:false,error:'Email investigation method or parameters are invalid'},422);
      }
      if(url.pathname==='/internal/commerce/notifications/drain'&&request.method==='POST'){
        const input=await authenticateCommerceService(request,env);
        if(url.search||Object.keys(input).some(k=>!['environment','limit','schedule'].includes(k))||input.environment!==(env.APP_ENVIRONMENT==='test'?'sandbox':'production')||input.schedule!==undefined&&typeof input.schedule!=='boolean'||input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>3))return json({ok:false,error:'Notification processing request is invalid'},422);
        const scheduled=input.schedule?await scheduleNotifications(env):null;
        return json({ok:true,scheduled,...await dispatchNotifications(env,input.limit??3)});
      }
      if(url.pathname.startsWith('/internal/commerce/finance/')){
        const payload=await authenticateCommerceService(request,env);
        if(url.pathname==='/internal/commerce/finance/provider-account'&&request.method==='GET')return json({ok:true,account:await providerFinancialAccount(env,url)});
        if(url.pathname==='/internal/commerce/finance/provider-evidence'){
          if(request.method==='GET')return json({ok:true,...await providerFinancialEvidenceList(env,url)});
          if(request.method==='POST'&&!url.search)return json({ok:true,...await recordProviderFinancialEvidence(env,payload)});
          return json({ok:false,error:'Provider evidence route or method is unavailable'},404);
        }
        if(url.pathname==='/internal/commerce/finance/wallet'&&request.method==='POST'){
          if(url.search)return json({ok:false,error:'Wallet parameters belong in the request body'},422);
          return json({ok:true,...await walletEnrollment(env,payload)});
        }
        const walletRegistrationPath=/^\/internal\/commerce\/finance\/wallet\/registrations\/(wallet_[a-f0-9]{40})(?:\/(bind|receipt|record))?$/.exec(url.pathname);
        if(walletRegistrationPath){
          if(request.method==='GET'&&!walletRegistrationPath[2]){
            if([...url.searchParams.keys()].length!==1||!url.searchParams.has('environment'))return json({ok:false,error:'Wallet parameters are invalid'},422);
            return json({ok:true,registration:await walletRegistration(env,walletRegistrationPath[1],url.searchParams.get('environment'))});
          }
          if(request.method==='POST'&&!url.search&&walletRegistrationPath[2])return json({ok:true,...await ({bind:bindWalletRegistration,receipt:saveWalletRegistrationReceipt,record:recordWalletRegistration}[walletRegistrationPath[2]])(env,walletRegistrationPath[1],payload)});
          return json({ok:false,error:'Wallet route or method is unavailable'},404);
        }
        if(url.pathname==='/internal/commerce/finance/captures/reconcile'&&request.method==='POST'){
          if(url.search)return json({ok:false,error:'Financial parameters belong in the request body'},422);
          return json({ok:true,...await reconcileCaptureJournals(env,payload)});
        }
        if(request.method==='GET'&&url.pathname==='/internal/commerce/finance/summary')return json({ok:true,...await financialJournalSummary(env,url)});
        if(request.method==='GET'&&url.pathname==='/internal/commerce/finance/journals')return json({ok:true,...await financialJournalList(env,url)});
        return json({ok:false,error:'Financial route or method is unavailable'},404);
      }
      if(url.pathname==='/internal/commerce/customer-consents'){
        const payload=await authenticateCommerceService(request,env);
        if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
        if(url.search)return json({ok:false,error:'Preference parameters belong in the request body'},422);
        return json({ok:true,...await customerConsents(env,payload)});
      }
      if(url.pathname==='/v1/public/campaign-link'){
        const headers={...cors,'referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow'};
        if(!['GET','HEAD'].includes(request.method))return json({ok:false,error:'Method not allowed.'},405,{...headers,allow:'GET, HEAD'});
        const view=await campaignLink(env,request),response=json({ok:true,...view},200,{...headers,'x-ezkart-campaign-store':view.storeId,'x-ezkart-campaign-environment':view.environment});return request.method==='HEAD'?new Response(null,{headers:response.headers}):response;
      }
      if(url.pathname==='/v1/public/campaign-unsubscribe'){
        const headers={...cors,'referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
        if(!['GET','HEAD','POST'].includes(request.method))return json({ok:false,error:'Method not allowed.'},405,{...headers,allow:'GET, HEAD, POST'});
        const response=json({ok:true,...await campaignUnsubscribe(env,request)},200,headers);
        return request.method==='HEAD'?new Response(null,{headers:response.headers}):response;
      }
      const claimOrderMatch = /^\/internal\/commerce\/orders\/(EZK-[SP]-[A-F0-9]{24})\/claim$/.exec(url.pathname);
      if (claimOrderMatch && request.method === 'POST') {
        return json({ok:true,...await claimCommerceOrder(env,claimOrderMatch[1],await authenticateCommerceService(request,env))});
      }
      const customerShipmentMatch=/^\/internal\/commerce\/orders\/(EZK-[SP]-[A-F0-9]{24})\/tracking$/.exec(url.pathname);
      if(customerShipmentMatch&&request.method==='POST')return json({ok:true,...await customerShipment(env,customerShipmentMatch[1],await authenticateCommerceService(request,env))});
      if (url.pathname.startsWith('/internal/commerce/jobs/') && request.method === 'POST') {
        const payload = await authenticateCommerceService(request, env);
        if (url.pathname === '/internal/commerce/jobs/claim') return json({ok: true, jobs: await claimCommerceJobs(env, payload)});
        const jobMatch = /^\/internal\/commerce\/jobs\/(job_[a-f0-9]{32})\/finish$/.exec(url.pathname);
        if (jobMatch) return json({ok: true, job: await finishCommerceJob(env, jobMatch[1], payload)});
        return json({ok: false, error: 'Job route not found'}, 404);
      }
      const serviceShipmentMatch=/^\/internal\/commerce\/shipments\/(ship_[a-f0-9]{32})(?:\/(account|bind|refresh))?$/.exec(url.pathname);
      if(serviceShipmentMatch){
        const payload=await authenticateCommerceService(request,env),[,shipmentId,operation]=serviceShipmentMatch;
        if(request.method==='GET'&&!operation)return json({ok:true,...await serviceShipment(env,shipmentId,url.searchParams.get('environment'))});
        if(request.method==='POST'&&operation==='account')return json({ok:true,...await bindShipmentAccount(env,shipmentId,payload)});
        if(request.method==='POST'&&operation==='bind')return json({ok:true,...await bindShipment(env,shipmentId,payload)});
        if(request.method==='POST'&&operation==='refresh')return json({ok:true,...await refreshShipment(env,shipmentId,payload)});
        return json({ok:false,error:'Method not allowed'},405);
      }
      if(['/internal/commerce/shipping-events','/internal/commerce/shipping-events/drain'].includes(url.pathname)&&request.method==='POST'){
        const payload=await authenticateCommerceService(request,env);return json({ok:true,...await (url.pathname.endsWith('/drain')?drainPendingShipping(env,payload):shippingInbox(env,payload))});
      }
      const shippingSettingsService=/^\/internal\/commerce\/shipping-settings\/([A-Za-z0-9][A-Za-z0-9_-]{2,95})$/.exec(url.pathname);
      if(shippingSettingsService&&request.method==='GET'){
        await authenticateCommerceService(request,env);
        return json({ok:true,shipping:await checkoutShippingSettings(env,shippingSettingsService[1],url.searchParams.get('environment'))});
      }
      if (url.pathname.startsWith('/internal/commerce/')) return json({ok: true, ...await commerceServiceRoute(request, env)});
      const publicLandingMatch = /^\/v1\/public\/landing-pages\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(url.pathname);
      if (request.method === "GET" && publicLandingMatch) return await publicLandingPage(env, publicLandingMatch[1], publicLandingMatch[2]);
      const landingViewMatch = /^\/v1\/landing-pages\/([a-z0-9-]+)\/view$/.exec(url.pathname);
      if (request.method === "GET" && landingViewMatch) return await landingPageView(request, env, landingViewMatch[1]);
      if (request.method === "GET" && url.pathname === "/health") return json(await health(env), 200, cors);
      if(/^\/v1\/customer\/notifications\/preferences(?:\/history)?$/.test(url.pathname)){
        const user=await authenticatedUser(request,env),actor={kind:'buyer',id:user.id},history=url.pathname.endsWith('/history');
        if(request.method==='GET'&&(history||!url.search))return json({ok:true,...await(history?buyerNotificationPreferenceHistory(env,actor,url):buyerNotificationPreferences(env,actor))},200,cors);
        if(request.method==='POST'&&!history&&!url.search)return json({ok:true,...await saveBuyerNotificationPreferences(env,actor,await reviewRequestJson(request,3000,parseMessageJSON))},200,cors);
        return json({ok:false,error:'Method or parameters not allowed'},405,cors);
      }
      const noticeMatch=/^\/v1\/(customer|commerce)\/notifications(?:\/(stats|processing|email|read))?$/.exec(url.pathname);
      if(noticeMatch){
        const user=await authenticatedUser(request,env);let actor={kind:'buyer',id:user.id};
        if(noticeMatch[1]==='commerce'){
          const seller=await env.DB.prepare(`SELECT s.id FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id WHERE m.auth_user_id=? AND s.status='active' ORDER BY m.created_at ASC LIMIT 1`).bind(user.id).first();
          if(!seller)return json({ok:false,error:'Your store membership is no longer available'},403,cors);
          if(request.headers.has('x-ezkart-notification-store')&&request.headers.get('x-ezkart-notification-store')!==seller.id)return json({ok:false,error:'Your active store changed. Reload this page.',code:'notification_session_changed'},409,cors);
          actor={kind:'merchant',id:user.id,sellerId:seller.id};
        }
        const action=noticeMatch[2];
        if(request.method==='GET'&&action!=='read')return json({ok:true,...await(action==='stats'?notificationStats(env,actor,url):action==='processing'?notificationProcessing(env,actor,url):notificationInbox(env,actor,url,action==='email'?'email':'inbox'))},200,cors);
        if(request.method==='POST'&&action==='read'&&!url.search)return json({ok:true,...await readNotifications(env,actor,await reviewRequestJson(request,3000,parseMessageJSON))},200,cors);
        return json({ok:false,error:'Method or parameters not allowed'},405,cors);
      }
      const automation=/^\/v1\/commerce\/marketing\/automations(?:\/(auto_[a-f0-9]{32})(?:\/(history|action|activity))?)?$/.exec(url.pathname);
      if(automation){
        const user=await authenticatedUser(request,env),seller=await env.DB.prepare(`SELECT s.id FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id WHERE m.auth_user_id=? AND s.status='active' ORDER BY m.created_at ASC LIMIT 1`).bind(user.id).first();
        if(!seller)return json({ok:false,error:'Your store membership is no longer available'},403,cors);
        if(request.headers.has('x-ezkart-marketing-store')&&request.headers.get('x-ezkart-marketing-store')!==seller.id)return json({ok:false,error:'Your active store changed. Reload this page.',code:'marketing_session_changed'},409,cors);
        const actor={id:user.id,sellerId:seller.id},[,id,action]=automation;
        if(request.method==='GET'&&!action)return json({ok:true,...await (id?readAutomation(env,actor,id,url):listAutomations(env,actor,url))},200,cors);
        if(request.method==='GET'&&action==='history')return json({ok:true,...await automationHistory(env,actor,id,url)},200,cors);
        if(request.method==='GET'&&action==='activity')return json({ok:true,...await automationActivity(env,actor,id,url)},200,cors);
        if(request.method==='POST'&&!url.search&&(!id||action==='action')){
          const input=await reviewRequestJson(request,id?3000:32000,parseMessageJSON);
          return json({ok:true,...await (id?changeAutomation(env,actor,id,input):saveAutomation(env,actor,input))},200,cors);
        }
        return json({ok:false,error:'Automation method or parameters are invalid'},405,cors);
      }
      const marketing=/^\/v1\/commerce\/marketing(?:\/(campaigns|workspace|audience|reports|report-exports|performance|performance-exports)(?:\/((?:cmp_|crex_|cpex_)[a-f0-9]{32})(?:\/(history|publication|publish|publication-action|recipients|publication-history))?)?)?$/.exec(url.pathname);
      if(marketing){
        const user=await authenticatedUser(request,env),seller=await env.DB.prepare(`SELECT s.id FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id WHERE m.auth_user_id=? AND s.status='active' ORDER BY m.created_at ASC LIMIT 1`).bind(user.id).first();
        if(!seller)return json({ok:false,error:'Your store membership is no longer available'},403,cors);
        if(request.headers.has('x-ezkart-marketing-store')&&request.headers.get('x-ezkart-marketing-store')!==seller.id)return json({ok:false,error:'Your active store changed. Reload this page.',code:'marketing_session_changed'},409,cors);
        const actor={id:user.id,sellerId:seller.id},[,route,id,action]=marketing;
        if(id&&(route==='report-exports'?!id.startsWith('crex_')||action:route==='performance-exports'?!id.startsWith('cpex_')||action:route!=='campaigns'||!id.startsWith('cmp_')))return json({ok:false,error:'Campaign path is invalid'},404,cors);
        if(route==='reports'&&!id&&request.method==='GET')return json({ok:true,...await campaignReport(env,actor,url)},200,cors);
        if(route==='report-exports'&&request.method==='POST'&&!id&&!url.search)return json({ok:true,...await createCampaignReportExport(env,actor,await reviewRequestJson(request,3000,parseMessageJSON))},200,cors);
        if(route==='report-exports'&&id&&request.method==='GET')return json({ok:true,...await readCampaignReportExport(env,actor,id,url)},200,cors);
        if(route==='performance'&&request.method==='GET'&&!id)return json({ok:true,...await campaignPerformance(env,actor,url)},200,cors);
        if(route==='performance-exports'&&request.method==='POST'&&!id&&!url.search)return json({ok:true,...await createCampaignPerformanceExport(env,actor,await reviewRequestJson(request,3000,parseMessageJSON))},200,cors);
        if(route==='performance-exports'&&id&&request.method==='GET')return json({ok:true,...await readCampaignPerformanceExport(env,actor,id,url)},200,cors);
        if(route==='workspace'&&!id&&request.method==='GET'&&!url.search)return json({ok:true,...await campaignWorkspace(env,actor)},200,cors);
        if(route==='campaigns'&&id&&request.method==='GET'&&['publication','recipients','publication-history'].includes(action)){
          const read={publication:readPublication,recipients:publicationRecipients,'publication-history':publicationHistory}[action];return json({ok:true,...await read(env,actor,id,url)},200,cors);
        }
        if(route==='campaigns'&&id&&request.method==='POST'&&!url.search&&['publish','publication-action'].includes(action)){
          const write=action==='publish'?publishCampaign:changePublication;return json({ok:true,...await write(env,actor,id,await reviewRequestJson(request,3000,parseMessageJSON))},200,cors);
        }
        if(route==='campaigns'&&request.method==='GET'&&(!action||action==='history'))return json({ok:true,...await(id?(action?campaignHistory(env,actor,id,url):readCampaign(env,actor,id,url)):listCampaigns(env,actor,url))},200,cors);
        if(!id&&!url.search&&request.method==='POST'&&['campaigns','audience'].includes(route))return json({ok:true,...await(route==='campaigns'?saveCampaign(env,actor,await reviewRequestJson(request,32000,parseMessageJSON)):campaignAudience(env,actor,await reviewRequestJson(request,5000,parseMessageJSON)))},200,cors);
        return json({ok:false,error:'Method or parameters not allowed'},405,cors);
      }
      if(/^\/v1\/commerce\/settings(?:\/history)?$/.test(url.pathname)){
        const user=await authenticatedUser(request,env),seller=await env.DB.prepare(`SELECT s.id FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id WHERE m.auth_user_id=? AND s.status='active' ORDER BY m.created_at ASC LIMIT 1`).bind(user.id).first();
        if(!seller)return json({ok:false,error:'Your store membership is no longer available'},403,cors);
        if(request.headers.has('x-ezkart-settings-store')&&request.headers.get('x-ezkart-settings-store')!==seller.id)return json({ok:false,error:'Your active store changed. Reload this page.',code:'settings_session_changed'},409,cors);
        const actor={id:user.id,sellerId:seller.id},history=url.pathname.endsWith('/history');
        if(request.method==='GET'&&(history||!url.search))return json({ok:true,...await(history?settingsHistory(env,actor,url):merchantSettings(env,actor))},200,cors);
        if(request.method==='POST'&&!history&&!url.search)return json({ok:true,...await saveMerchantSettings(env,actor,await reviewRequestJson(request,12000,parseMessageJSON))},200,cors);
        return json({ok:false,error:'Method or parameters not allowed'},405,cors);
      }
      const messageMatch=/^\/v1\/(customer|commerce)\/messages(?:\/(stats|replies|conv_[a-f0-9]{32})(?:\/(read|media)(?:\/(mphoto_[a-f0-9]{32}))?)?)?$/.exec(url.pathname);
      if(messageMatch){
        const [,audience,id,action,photo]=messageMatch;
        let actor;
        if(audience==='customer'){const user=await authenticatedUser(request,env);actor={kind:'buyer',id:user.id,name:String(user.user_metadata?.full_name||'Customer').slice(0,100)};}
        else{const user=await authenticatedUser(request,env);const seller=await env.DB.prepare(`SELECT s.id,m.role FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id WHERE m.auth_user_id=? AND s.status='active' ORDER BY m.created_at ASC LIMIT 1`).bind(user.id).first();
          if(!seller)return json({ok:false,error:'Your store membership is no longer available'},403,cors);
          actor={kind:'merchant',id:user.id,sellerId:seller.id,role:seller.role};
          if(request.headers.has('x-ezkart-message-store')&&request.headers.get('x-ezkart-message-store')!==seller.id)return json({ok:false,error:'Your active store changed. Reload this page.',code:'message_session_changed'},409,cors);}
        if(request.method==='GET'){
          if(photo&&action==='media'&&id?.startsWith('conv_')&&!url.search)return await messagePhoto(env,actor,id,photo);
          if(!action)return json({ok:true,...await (id==='stats'?messageStats(env,actor,url):id==='replies'?savedReplies(env,actor,url):id?conversationDetail(env,actor,id,url):messageInbox(env,actor,url))},200,cors);
        }
        if(request.method==='POST'&&!url.search&&!photo&&id!=='stats'){
          const body=await reviewRequestJson(request,action==='media'?1401000:24000,parseMessageJSON);
          if(!action&&id==='replies')return json({ok:true,...await saveReply(env,actor,body)},200,cors);
          if(!id)return json({ok:true,...await startConversation(env,actor,body)},200,cors);
          if(id.startsWith('conv_'))return json({ok:true,...await (action==='media'?uploadMessagePhoto(env,actor,id,body):action==='read'?markConversationRead(env,actor,id,body):sendMessage(env,actor,id,body))},200,cors);
        }
        return json({ok:false,error:'Method or parameters not allowed'},405,cors);
      }
      const buyerReviewMatch=/^\/v1\/customer\/orders\/(EZK-[SP]-[A-F0-9]{24})\/reviews(?:\/([A-Za-z0-9_-]{3,96})\/history)?$/.exec(url.pathname);
      const buyerPhotoUpload=/^\/v1\/customer\/orders\/(EZK-[SP]-[A-F0-9]{24})\/review-media$/.exec(url.pathname);
      const buyerPhoto=/^\/v1\/customer\/review-media\/(rphoto_[a-f0-9]{32})$/.exec(url.pathname);
      if(buyerReviewMatch||buyerPhotoUpload||buyerPhoto){
        const user=await authenticatedUser(request,env),actor={kind:'buyer',id:user.id};
        if(buyerPhoto){if(request.method==='GET'&&!url.search)return await reviewPhoto(env,actor,'',buyerPhoto[1]);}
        else if(buyerPhotoUpload){if(request.method==='POST'&&!url.search)return json({ok:true,...await uploadReviewPhoto(env,user,buyerPhotoUpload[1],await reviewRequestJson(request,1401000))},200,cors);}
        else if(request.method==='GET')return json({ok:true,...await (buyerReviewMatch[2]?reviewHistory(env,actor,buyerReviewMatch[2],url,buyerReviewMatch[1]):buyerReviews(env,user,buyerReviewMatch[1],url))},200,cors);
        else if(request.method==='POST'&&!buyerReviewMatch[2]&&!url.search)return json({ok:true,...await saveBuyerReview(env,user,buyerReviewMatch[1],await reviewRequestJson(request))},200,cors);
        return json({ok:false,error:'Method or parameters not allowed'},405,cors);
      }
      const publicReviewPhoto=/^\/v1\/public\/reviews\/([A-Za-z0-9_-]{3,96})\/media\/(rphoto_[a-f0-9]{32})$/.exec(url.pathname);
      if(url.pathname==='/v1/public/reviews'||publicReviewPhoto){
        if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405,cors);
        if(publicReviewPhoto){if(url.search)return json({ok:false,error:'Photo parameters are not allowed'},422,cors);return await reviewPhoto(env,{kind:'public'},publicReviewPhoto[1],publicReviewPhoto[2]);}
        return json({ok:true,...await publicReviews(env,url)},200,cors);
      }
      const merchantReviewMatch=/^\/v1\/commerce\/reviews(?:\/([A-Za-z0-9_-]{3,96})(?:\/(history)|\/media\/(rphoto_[a-f0-9]{32}))?)?$/.exec(url.pathname);
      if(merchantReviewMatch){
        const {seller,authUserId}=await sellerContext(request,env),actor={kind:'merchant',id:authUserId,sellerId:seller.id,role:seller.role},[,id,history,photo]=merchantReviewMatch;
        if(request.method==='GET'){
          if(photo){if(url.search)return json({ok:false,error:'Photo parameters are not allowed'},422,cors);return await reviewPhoto(env,actor,id,photo);}
          if(id&&!history&&url.search)return json({ok:false,error:'Review parameters are not allowed'},422,cors);
          return json({ok:true,...await (history?reviewHistory(env,actor,id,url):id?merchantReview(env,actor,id):merchantReviews(env,actor,url))},200,cors);
        }
        if(request.method==='POST'&&id&&!history&&!photo&&!url.search)return json({ok:true,...await saveMerchantReview(env,actor,id,await reviewRequestJson(request))},200,cors);
        return json({ok:false,error:'Method or parameters not allowed'},405,cors);
      }
      const customerReturnMatch = /^\/v1\/customer\/orders\/(EZK-[SP]-[A-F0-9]{24})\/returns(?:\/(ret_[a-f0-9]{32}))?$/.exec(url.pathname);
      if (customerReturnMatch && ['GET','POST'].includes(request.method)) {
        const user=await authenticatedUser(request,env),actor={kind:'customer',id:user.id},[,orderId,returnId]=customerReturnMatch;
        if(request.method==='GET')return json({ok:true,...await (returnId?returnDetail(env,actor,returnId,orderId,url.searchParams.get('before')||''):customerReturns(env,user,orderId,url))},200,cors);
        const body=await requestJson(request,16000);
        return json(returnId?{ok:true,receipt:await returnAction(env,actor,returnId,body,orderId)}:{ok:true,...await createReturn(env,actor,orderId,body)},200,cors);
      }
      if (url.pathname === "/v1/customer/addresses") {
        if (!["GET", "POST"].includes(request.method)) return json({ ok: false, error: "Method not allowed." }, 405, cors);
        const user = await authenticatedUser(request, env);
        const book = request.method === "GET" ? await customerAddressBook(env, user.id) : await changeCustomerAddressBook(env, user.id, await requestJson(request, 6000));
        return json({ ok: true, book }, 200, cors);
      }
      if (request.method === "GET" && url.pathname === "/v1/me") return json({ ok: true, user: await currentUser(request, env) }, 200, cors);
      if (url.pathname === "/v1/advanced-mode") {
        if (!["GET", "PUT"].includes(request.method)) return json({ ok: false, error: "Method not allowed." }, 405, cors);
        const { seller } = await sellerContext(request, env);
        return json({ ok: true, plan: await advancedMode(env, seller, request.method === "PUT" ? await requestJson(request, 2000) : null) }, 200, cors);
      }
      if (url.pathname === "/v1/admin-preferences") {
        if (!["GET", "PUT"].includes(request.method)) return json({ ok: false, error: "Method not allowed." }, 405, cors);
        const user = await authenticatedUser(request, env);
        return json({ ok: true, preferences: await adminPreferences(env, user.id, request.method === "PUT" ? await requestJson(request, 2000) : null) }, 200, cors);
      }
      if (url.pathname === '/v1/shipping-settings') {
        if(!['GET','PUT'].includes(request.method))return json({ok:false,error:'Method not allowed'},405,cors);
        const {seller,authUserId}=await sellerContext(request,env),actor={sellerId:seller.id,id:authUserId,role:seller.role};
        return json(request.method==='GET'?{ok:true,...await merchantShippingSettings(env,actor)}:
          {ok:true,receipt:await saveShippingSettings(env,actor,await requestJson(request,64000))},200,cors);
      }
      if (url.pathname === "/v1/admin-profile") {
        if (!["GET", "PUT"].includes(request.method)) return json({ ok: false, error: "Method not allowed." }, 405, cors);
        const { seller } = await sellerContext(request, env);
        return json({ ok: true, profile: await adminProfile(env, seller, request.method === "PUT" ? await requestJson(request, 2000) : null) }, 200, cors);
      }
      if (request.method === "GET" && url.pathname === "/v1/storefront/products") return json({ ok: true, products: await storefrontProducts(url, env) }, 200, cors);
      if (request.method === "GET" && url.pathname === "/v1/storefront/view") return json({ ok: true, ...(await publicStorefront(env, url)) }, 200, cors);
      if (["GET", "PUT"].includes(request.method) && url.pathname === "/v1/storefront") {
        const { seller } = await sellerContext(request, env);
        return json({ ok: true, store: await merchantStorefront(env, seller, request.method === "PUT" ? await requestJson(request, 5000) : null) }, 200, cors);
      }
      if (request.method === "GET" && url.pathname === "/v1/catalog") return json({ ok: true, ...(await catalog(request, env)) }, 200, cors);
      const returnOrderMatch = /^\/v1\/returns\/orders\/(EZK-[SP]-[A-F0-9]{24})$/.exec(url.pathname);
      const returnCaseMatch = /^\/v1\/returns\/(ret_[a-f0-9]{32})$/.exec(url.pathname);
      if ((url.pathname==='/v1/returns'||returnOrderMatch||returnCaseMatch) && ['GET','POST'].includes(request.method)) {
        const {seller,authUserId}=await sellerContext(request,env),actor={kind:'merchant',id:authUserId,sellerId:seller.id,role:seller.role};
        if(returnOrderMatch)return json({ok:true,...await (request.method==='GET'?returnOrder(env,actor,returnOrderMatch[1]):createReturn(env,actor,returnOrderMatch[1],await requestJson(request,16000)))},200,cors);
        if(returnCaseMatch)return request.method==='GET'?json({ok:true,...await returnDetail(env,actor,returnCaseMatch[1],'',url.searchParams.get('before')||'')},200,cors):json({ok:true,receipt:await returnAction(env,actor,returnCaseMatch[1],await requestJson(request,16000))},200,cors);
        if(request.method==='GET')return json({ok:true,...await returnList(env,actor,url)},200,cors);
        return json({ok:false,error:'Method not allowed'},405,cors);
      }
      const analyticsExportMatch=/^\/v1\/commerce\/analytics\/exports\/(aex_[a-f0-9]{40})$/.exec(url.pathname);
      if(url.pathname==='/v1/commerce/analytics'||url.pathname==='/v1/commerce/analytics/exports'||analyticsExportMatch){
        const {seller}=await sellerContext(request,env);
        if(url.pathname==='/v1/commerce/analytics/exports'){
          if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405,cors);
          if(url.search)return json({ok:false,error:'Export filters belong in the report'},422,cors);
          return json({ok:true,...await createAnalyticsExport(env,seller,await requestJson(request,4000))},200,cors);
        }
        if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405,cors);
        return json({ok:true,...await (analyticsExportMatch?readAnalyticsExport(env,seller,analyticsExportMatch[1],url):merchantAnalytics(env,seller,url))},200,cors);
      }
      if(url.pathname==='/v1/commerce/dashboard'){
        const {seller}=await sellerContext(request,env);
        if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405,cors);
        return json({ok:true,...await merchantDashboard(env,seller,url)},200,cors);
      }
      const customerPath='/v1/commerce/customers';
      const customerMatch=/^\/v1\/commerce\/customers\/(customer_[A-Za-z0-9_-]{1,85})(?:\/(orders|profile|changes))?$/.exec(url.pathname);
      const customerSegmentMatch=/^\/v1\/commerce\/customers\/segments(?:\/(cseg_[a-f0-9]{40}))?$/.exec(url.pathname);
      const customerExportMatch=/^\/v1\/commerce\/customers\/exports(?:\/(cex_[a-f0-9]{40}))?$/.exec(url.pathname);
      if(url.pathname===customerPath||customerMatch||customerSegmentMatch||customerExportMatch){
        const {seller,authUserId}=await sellerContext(request,env),method=request.method;
        if(method!=='GET'&&url.search)return json({ok:false,error:'Customer changes do not accept query parameters'},422,cors);
        if(customerSegmentMatch){
          const id=customerSegmentMatch[1];
          if(method==='GET'){
            if(id&&url.search)return json({ok:false,error:'Segment detail does not accept filters'},422,cors);
            return json({ok:true,...await(id?customerSegment(env,seller,id):customerSegments(env,seller,url))},200,cors);
          }
          if((!id&&method==='POST')||(id&&method==='PUT'))return json({ok:true,change:await saveCustomerWorkspace(env,seller,authUserId,'segment',id,await requestJson(request,6000))},200,cors);
        }else if(customerExportMatch){
          const id=customerExportMatch[1];
          if(id&&method==='GET')return json({ok:true,...await readCustomerExport(env,seller,id,url)},200,cors);
          if(!id&&method==='POST')return json({ok:true,...await createCustomerExport(env,seller,await requestJson(request,6000))},200,cors);
        }else if(customerMatch){
          const [,id,kind]=customerMatch;
          if(kind==='profile'&&method==='PUT')return json({ok:true,change:await saveCustomerWorkspace(env,seller,authUserId,'profile',id,await requestJson(request,10000))},200,cors);
          if(method==='GET'&&kind!=='profile'){
            if(!kind&&url.search)return json({ok:false,error:'Customer detail does not accept filters'},422,cors);
            return json({ok:true,...await(kind==='orders'?customerOrderHistory(env,seller,id,url):kind==='changes'?customerProfileHistory(env,seller,authUserId,id,url):merchantCustomer(env,seller,id))},200,cors);
          }
        }else if(method==='GET')return json({ok:true,...await merchantCustomers(env,seller,url)},200,cors);
        return json({ok:false,error:'Method not allowed'},405,cors);
      }
      const paymentReadMatch=/^\/v1\/commerce\/payments(?:\/(EZK-[SP]-[A-F0-9]{24})(?:\/(captures|attempts|events))?)?$/.exec(url.pathname);
      if(paymentReadMatch){
        const {seller}=await sellerContext(request,env);
        if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405,cors);
        const [,orderId,kind]=paymentReadMatch;
        if(orderId&&!kind&&url.search)return json({ok:false,error:'Payment detail does not accept filters'},422,cors);
        return json({ok:true,...await (kind?merchantPaymentHistory(env,seller,orderId,kind,url):orderId?merchantPaymentDetail(env,seller,orderId):merchantPaymentList(env,seller,url))},200,cors);
      }
      const orderReadMatch=/^\/v1\/commerce\/orders(?:\/(EZK-[SP]-[A-F0-9]{24})(?:\/(captures|activity))?)?$/.exec(url.pathname);
      if(orderReadMatch){
        const {seller}=await sellerContext(request,env);
        if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405,cors);
        const [,orderId,kind]=orderReadMatch;
        if(orderId&&!kind&&url.search)return json({ok:false,error:'Order detail does not accept filters'},422,cors);
        return json({ok:true,...await (kind?merchantOrderHistory(env,seller,orderId,kind,url):orderId?merchantOrderDetail(env,seller,orderId):merchantOrderList(env,seller,url))},200,cors);
      }
      const fulfillmentMatch=/^\/v1\/fulfillment(?:\/(EZK-[SP]-[A-F0-9]{24}))?$/.exec(url.pathname);
      if(fulfillmentMatch&&['GET','POST'].includes(request.method)){
        const {seller,authUserId}=await sellerContext(request,env),actor={id:authUserId,sellerId:seller.id,role:seller.role};
        if(request.method==='GET')return json({ok:true,...await (fulfillmentMatch[1]?fulfillmentDetail(env,actor,fulfillmentMatch[1],url.searchParams.get('before')||''):fulfillmentList(env,actor,url))},200,cors);
        if(fulfillmentMatch[1])return json({ok:true,receipt:await fulfillmentAction(env,actor,fulfillmentMatch[1],await requestJson(request,4000))},200,cors);
        return json({ok:false,error:'Order reference is required'},422,cors);
      }
      if (url.pathname === '/v1/inventory/reviews' && request.method === 'GET') {
        const {seller} = await sellerContext(request, env);
        return json({ok:true,...await stockReviewList(env,seller,url)},200,cors);
      }
      const stockReviewMatch = /^\/v1\/inventory\/reviews\/(EZK-[SP]-[A-F0-9]{24})$/.exec(url.pathname);
      if (stockReviewMatch && ['GET','POST'].includes(request.method)) {
        const {seller,authUserId} = await sellerContext(request, env);
        return request.method === 'GET' ? json({ok:true,...await stockReviewDetails(env,seller,stockReviewMatch[1])},200,cors)
          : json({ok:true,receipt:await resolveStockReview(env,seller,authUserId,stockReviewMatch[1],await requestJson(request,64000))},200,cors);
      }
      if (url.pathname === "/v1/inventory" && request.method === "GET") {
        const {seller} = await sellerContext(request, env);
        return json({ok: true, ...await inventoryOverview(env, seller, url)}, 200, cors);
      }
      if (url.pathname === "/v1/inventory/history" && request.method === "GET") {
        const {seller} = await sellerContext(request, env);
        return json({ok: true, ...await inventoryHistory(env, seller, url)}, 200, cors);
      }
      if (url.pathname === "/v1/inventory/draft" && ["GET", "PUT", "DELETE"].includes(request.method)) {
        const {seller, authUserId} = await sellerContext(request, env);
        return json({ok: true, draft: await inventoryDraft(env, seller, authUserId, request.method, request.method === 'GET' ? null : await requestJson(request, 64000))}, 200, cors);
      }
      if (url.pathname === "/v1/inventory/adjustments" && request.method === "POST") {
        const {seller, authUserId} = await sellerContext(request, env);
        return json({ok: true, receipt: await adjustInventory(env, seller, authUserId, await requestJson(request, 64000))}, 200, cors);
      }
      if (request.method === "GET" && url.pathname === "/v1/landing-pages") return json({ ok: true, pages: await landingPages(request, env) }, 200, cors);
      const landingExportMatch = /^\/v1\/landing-pages\/([a-z0-9-]+)\/export$/.exec(url.pathname);
      if (request.method === "POST" && landingExportMatch) return json(await authorizeLandingExport(request, env, landingExportMatch[1]), 200, cors);
      const landingPagePreviewMatch = /^\/v1\/landing-pages\/([a-z0-9-]+)\/preview$/.exec(url.pathname);
      if (request.method === "GET" && landingPagePreviewMatch) {
        const response = await landingPagePreview(request, env, landingPagePreviewMatch[1]);
        const headers = new Headers(response.headers);
        Object.entries(cors).forEach(([name, value]) => headers.set(name, value));
        return new Response(response.body, { status: response.status, headers });
      }
      if (["PUT", "POST"].includes(request.method) && landingPagePreviewMatch) return json({ ok: true, preview: await saveLandingPagePreview(request, env, landingPagePreviewMatch[1]) }, 200, cors);
      const landingPageMatch = /^\/v1\/landing-pages\/([a-z0-9-]+)$/.exec(url.pathname);
      const landingEditorMatch = /^\/v1\/landing-pages\/([a-z0-9-]+)\/editor$/.exec(url.pathname);
      const landingConfirmationMatch = /^\/v1\/landing-pages\/([a-z0-9-]+)\/confirmation$/.exec(url.pathname);
      if (request.method === 'GET' && landingConfirmationMatch) return json({ok: true, ...await landingPageConfirmation(request, env, landingConfirmationMatch[1])}, 200, cors);
      if (request.method === "GET" && landingEditorMatch) return json({ok: true, editor: packLandingEditor(await landingPage(request, env, landingEditorMatch[1]))}, 200, cors);
      if (request.method === "GET" && landingPageMatch) return json({ ok: true, page: await landingPage(request, env, landingPageMatch[1]) }, 200, cors);
      if (["PUT", "POST"].includes(request.method) && landingPageMatch) {
        const page = await saveLandingPage(request, env, landingPageMatch[1], context);
        const minimal = request.headers.get('prefer')?.trim().toLowerCase() === 'return=minimal';
        return json({ok: true, page: minimal ? landingPageSaveReceipt(page) : page}, 200, {
          ...cors, ...(minimal ? {'preference-applied': 'return=minimal'} : {}),
        });
      }
      if (request.method === "DELETE" && landingPageMatch) { await deleteLandingPage(request, env, landingPageMatch[1]); return json({ ok: true }, 200, cors); }
      if (request.method === "GET" && url.pathname === "/v1/components") return json({ ok: true, components: await components(request, env), limits: { count: maximumComponentsPerSeller, bytes: maximumComponentBytes } }, 200, cors);
      const componentMatch = /^\/v1\/components\/([a-z0-9-]+)$/.exec(url.pathname);
      if (request.method === "GET" && componentMatch) return json({ ok: true, component: await component(request, env, componentMatch[1]) }, 200, cors);
      if (["PUT", "POST"].includes(request.method) && componentMatch) return json({ ok: true, component: await saveComponent(request, env, componentMatch[1]) }, 200, cors);
      if (request.method === "DELETE" && componentMatch) { await deleteComponent(request, env, componentMatch[1]); return json({ ok: true }, 200, cors); }
      if (url.pathname === "/v1/fonts" && ["GET", "POST"].includes(request.method)) {
        const { seller } = await sellerContext(request, env);
        if (request.method === "GET") return json({ok:true,fonts:await listBuilderFonts(env,seller)},200,cors);
        return json({ok:true,font:await saveBuilderFont(env,seller,await requestJson(request,7100000))},201,cors);
      }
      const builderFontMatch = /^\/v1\/fonts\/(font_[a-f0-9]{64})$/.exec(url.pathname);
      if (request.method === "GET" && builderFontMatch) {
        const { seller } = await sellerContext(request,env);
        return await serveBuilderFont(env,seller,builderFontMatch[1]);
      }
      if (url.pathname === "/v1/assets" && ["GET", "POST"].includes(request.method)) {
        const { seller } = await sellerContext(request, env);
        if (request.method === "GET") return json({ok:true,assets:await listBuilderAssets(env,seller)},200,cors);
        const payload = await requestJson(request,2900000);
        return json({ok:true,asset:await saveBuilderAsset(env,seller,payload,decodeImageDataUrl(payload.dataUrl))},201,cors);
      }
      const builderAssetMatch = /^\/v1\/assets\/(asset_[a-f0-9]{32})$/.exec(url.pathname);
      if (request.method === "GET" && builderAssetMatch) {
        const { seller } = await sellerContext(request,env);
        return await serveBuilderAsset(env,seller,builderAssetMatch[1]);
      }
      if (request.method === "POST" && url.pathname === "/v1/media") return json({ ok: true, media: await uploadMedia(request, env) }, 201, cors);
      const publicMediaMatch = /^\/v1\/public\/media\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (request.method === "GET" && publicMediaMatch) return await servePublicMedia(request, env, context, cleanId(publicMediaMatch[1], "Image ID"));
      const mediaMatch = /^\/v1\/media\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (request.method === "GET" && mediaMatch) return await serveMedia(request, env, cleanId(mediaMatch[1], "Image ID"));
      const productDuplicateMatch = /^\/v1\/products\/([a-zA-Z0-9_-]+)\/duplicate$/.exec(url.pathname);
      if (request.method === "POST" && productDuplicateMatch) return json({ ok: true, product: await duplicateProduct(request, env, productDuplicateMatch[1]) }, 201, cors);
      const productStatusMatch = /^\/v1\/products\/([a-zA-Z0-9_-]+)\/status$/.exec(url.pathname);
      if (request.method === "PATCH" && productStatusMatch) return json({ ok: true, product: await setProductStatus(request, env, productStatusMatch[1]) }, 200, cors);
      const productMatch = /^\/v1\/products\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (["PUT", "POST"].includes(request.method) && productMatch) return json({ ok: true, product: await saveProduct(request, env, productMatch[1]) }, 200, cors);
      if (request.method === "DELETE" && productMatch) { await deleteProduct(request, env, productMatch[1]); return json({ ok: true }, 200, cors); }
      const draftMatch = /^\/v1\/drafts\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (["PUT", "POST"].includes(request.method) && draftMatch) return json({ ok: true, draft: await saveDraft(request, env, draftMatch[1]) }, 200, cors);
      if (request.method === "DELETE" && draftMatch) { await deleteDraft(request, env, draftMatch[1]); return json({ ok: true }, 200, cors); }
      return json({ ok: false, error: "Not found" }, 404, cors);
    } catch (error) {
      if (error instanceof AdvancedModeLimitError) return json({ ok: false, code: 'basic_limits_exceeded', error: error.message, plan: error.plan }, 409, cors);
      if (error instanceof Response) return json({ ok: false, error: await error.text(), ...(error.headers.has("x-ezkart-error-code") ? { code: error.headers.get("x-ezkart-error-code") } : {}) }, error.status, cors);
      const failure = `${error?.message || error || ""} ${error?.cause?.message || ""}`;
      if (failure.includes("catalog_revision_conflict")) {
        return json({ ok: false, code: "catalog_revision_conflict", error: "This product changed since these edits started. Load the latest product and review your changes before publishing." }, 409, cors);
      }
      if (failure.includes("commerce_reserved_stock")) {
        return json({ ok: false, error: "Pending orders reserve this stock. Keep those variants and enough stock to fulfill them, or wait for the orders to complete or expire." }, 409, cors);
      }
      if (failure.includes("catalog_ordered_product")) {
        return json({ ok: false, error: "This product has order history. Archive it to stop new sales while keeping the records." }, 409, cors);
      }
      if (failure.includes('review_history_retained')) return json({ok:false,error:'This product has review history. Archive it to stop new sales while keeping the reviews.'},409,cors);
      if (failure.includes("UNIQUE constraint failed: products") || failure.includes("UNIQUE constraint failed: product_variants")) {
        return json({ ok: false, error: "This product or SKU already exists. Load the latest catalog and use a unique SKU." }, 409, cors);
      }
      if (failure.includes("seller_product_limit")) {
        return json({ ok: false, error: "Your store has reached its product limit. Review Advanced Mode or remove a product before creating another." }, 409, cors);
      }
      console.error("Ezkart Worker request failed", error);
      return json({ ok: false, error: "The API could not complete this request." }, 500, cors);
    }
  },
  async scheduled(controller, env, context) {
    // One registered trigger, separate invocations: retain sends at :00/:03/...
    // and scan/publish at :01/:04/... without sharing a D1 query budget.
    if(controller.cron==='0-59/3,1-59/3 * * * *'){
      const minute=new Date(controller.scheduledTime).getUTCMinutes();
      if(!Number.isInteger(minute)||minute%3===2)throw new Error('Marketing schedule time is invalid');
      context.waitUntil(minute%3===0?dispatchCampaignEmails(env):processMarketingAutomations(env));return;
    }
    // Keep the previous handlers while updated triggers propagate.
    if(controller.cron==='*/4 * * * *'){
      context.waitUntil(processMarketingAutomations(env));return;
    }
    if(controller.cron==='*/3 * * * *'){
      context.waitUntil(dispatchCampaignEmails(env));return;
    }
    if(controller.cron==='*/2 * * * *'){
      context.waitUntil(dispatchEmails(env));return;
    }
    if(controller.cron==='* * * * *'){
      context.waitUntil((async()=>{await scheduleNotifications(env);await dispatchNotifications(env);})());return;
    }
    context.waitUntil(cleanupAbandonedMedia(env));
    context.waitUntil(cleanupCampaignVisits(env));
    context.waitUntil(cleanupCampaignReportExports(env));
    context.waitUntil(cleanupCampaignPerformanceExports(env));
    context.waitUntil(cleanupAnalyticsExports(env));
    context.waitUntil(cleanupCustomerExports(env));
    context.waitUntil(cleanupReviewPhotos(env));
    context.waitUntil(cleanupMessagePhotos(env));
    context.waitUntil(expireCommerceOrders(env));
  },
};
