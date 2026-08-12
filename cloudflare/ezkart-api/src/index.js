const json = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});

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
  return profile;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") return json(await health(env), 200, cors);
      if (request.method === "GET" && url.pathname === "/v1/me") return json({ ok: true, user: await currentUser(request, env) }, 200, cors);
      return json({ ok: false, error: "Not found" }, 404, cors);
    } catch (error) {
      if (error instanceof Response) return json({ ok: false, error: await error.text() }, error.status, cors);
      console.error("Ezkart Worker request failed", error);
      return json({ ok: false, error: "The API could not complete this request." }, 500, cors);
    }
  },
};
