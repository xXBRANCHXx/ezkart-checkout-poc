export function sellerPlan(seller) {
  const enabled = seller.plan === 'advanced';
  return {
    enabled,
    canEdit: seller.role === 'owner',
    limits: { landingPages: enabled ? 24 : 6, products: enabled ? 50 : 10 },
    commissionPercent: enabled ? 6 : 5,
  };
}

export async function advancedMode(env, seller, payload = null) {
  if (payload !== null) {
    if (seller.role !== 'owner') throw new Response('Only the store owner can change Advanced Mode.', { status: 403 });
    if (typeof payload.enabled !== 'boolean') throw new Response('Choose whether Advanced Mode is on or off.', { status: 422 });
    if (payload.enabled && payload.commissionPercent !== 6) throw new Response('Advanced Mode adds 1% per transaction. Review the price before enabling it.', { status: 422 });
    if (!payload.enabled) {
      const products = await env.DB.prepare('SELECT COUNT(*) AS count FROM products WHERE seller_id = ?').bind(seller.id).first();
      const pages = await env.PRIVATE_ASSETS.list({ prefix: `sellers/${seller.id}/landing-pages/`, limit: 1000 });
      if (Number(products?.count || 0) > 10 || pages.objects.filter(object => object.key.endsWith('.json')).length > 6 || pages.truncated) {
        throw new Response('To turn off Advanced, first reduce your store to 6 landing pages and 10 products. Your content has not been changed.', { status: 409 });
      }
    }
    await env.DB.prepare("UPDATE sellers SET plan = ?, updated_at = ? WHERE id = ? AND status = 'active'")
      .bind(payload.enabled ? 'advanced' : 'standard', new Date().toISOString(), seller.id).run();
  }
  const row = await env.DB.prepare("SELECT plan FROM sellers WHERE id = ? AND status = 'active'").bind(seller.id).first();
  if (!row) throw new Response('Store not found.', { status: 404 });
  return sellerPlan({ ...seller, plan: row.plan });
}
