export function businessSlug(name) {
  return String(name || '').normalize('NFKD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60).replace(/^-+|-+$/g, '') || 'store';
}

export async function sellerPageAddress(env, seller) {
  const read = () => env.DB.prepare('SELECT slug FROM seller_page_addresses WHERE seller_id = ?').bind(seller.id).first();
  let address = await read();
  if (address) return {...seller, pageSlug: address.slug};
  const row = await env.DB.prepare('SELECT name, settings_json FROM sellers WHERE id = ?').bind(seller.id).first();
  let settings;
  try { settings = JSON.parse(row?.settings_json || '{}'); } catch { settings = {}; }
  const base = businessSlug(settings.storefront?.name || row?.name || seller.name);
  for (let suffix = 1; suffix <= 10000; suffix++) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    // Reserve atomically, including legacy addresses so old links cannot change owners.
    await env.DB.prepare(`INSERT OR IGNORE INTO seller_page_addresses (seller_id, slug, created_at)
      SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM sellers WHERE slug = ? AND id != ?)`)
      .bind(seller.id, slug, new Date().toISOString(), slug, seller.id).run();
    address = await read();
    if (address) return {...seller, pageSlug: address.slug};
  }
  throw new Response('A page address could not be reserved. Please try again.', {status: 503});
}

export async function sellerByPageAddress(env, slug) {
  const seller = await env.DB.prepare(`SELECT s.id, s.slug, s.name FROM sellers s
    JOIN seller_page_addresses a ON a.seller_id = s.id WHERE a.slug = ? AND s.status = 'active'`)
    .bind(slug).first()
    || await env.DB.prepare("SELECT id, slug, name FROM sellers WHERE slug = ? AND status = 'active'").bind(slug).first();
  return seller ? sellerPageAddress(env, seller) : null;
}
