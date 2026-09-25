import { listLandingObjects } from './landing-page-index.js';

const basicLimits = Object.freeze({ landingPages: 6, products: 10 });

export function sellerPlan(seller) {
  const enabled = seller.plan === 'advanced';
  return {
    enabled,
    canEdit: seller.role === 'owner',
    limits: enabled ? { landingPages: 24, products: 50 } : { ...basicLimits },
    commissionPercent: enabled ? 6 : 5,
  };
}

async function currentPlan(env, seller) {
  const [row, pages] = await Promise.all([
    env.DB.prepare(`SELECT plan, (SELECT COUNT(*) FROM products WHERE seller_id = ?) AS product_count
      FROM sellers WHERE id = ? AND status = 'active'`).bind(seller.id, seller.id).first(),
    listLandingObjects(env.PRIVATE_ASSETS, `sellers/${seller.id}/landing-pages/`),
  ]);
  if (!row) throw new Response('Store not found.', { status: 404 });
  const usage = { landingPages: pages.filter(object => object.key.endsWith('.json')).length, products: Number(row.product_count) };
  if (!Number.isSafeInteger(usage.products) || usage.products < 0) throw new Error('Store usage is unavailable');
  const excess = Object.fromEntries(Object.entries(basicLimits).map(([key, limit]) => [key, Math.max(0, usage[key] - limit)]));
  return {
    ...sellerPlan({ ...seller, plan: row.plan }),
    downgrade: { allowed: Object.values(excess).every(count => count === 0), limits: { ...basicLimits }, usage, excess },
  };
}

export class AdvancedModeLimitError extends Error {
  constructor(plan) {
    const { landingPages, products } = plan.downgrade.excess;
    const removals = [
      landingPages && `${landingPages} landing page${landingPages === 1 ? '' : 's'}`,
      products && `${products} product${products === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' and ');
    super(removals
      ? `Delete ${removals} before switching to Basic (6 landing pages and 10 products). Your plan has not changed. Nothing has been deleted.`
      : 'Your store changed while switching plans. Check limits and try again. Your plan has not changed. Nothing has been deleted.');
    this.plan = plan;
  }
}

export async function advancedMode(env, seller, payload = null) {
  if (payload !== null) {
    if (seller.role !== 'owner') throw new Response('Only the store owner can change Advanced Mode.', { status: 403 });
    if (typeof payload.enabled !== 'boolean') throw new Response('Choose whether Advanced Mode is on or off.', { status: 422 });
    if (payload.enabled && payload.commissionPercent !== 6) throw new Response('Advanced Mode adds 1% per transaction. Review the price before enabling it.', { status: 422 });
    if (!payload.enabled) {
      const plan = await currentPlan(env, seller);
      if (!plan.downgrade.allowed) throw new AdvancedModeLimitError(plan);
    }
    // Recheck products in the write itself: a concurrent create must not slip
    // between the usage read and the plan change. Inserts also enforce the plan.
    const result = await env.DB.prepare(`UPDATE sellers SET plan = ?, updated_at = ? WHERE id = ? AND status = 'active'
      AND (? = 1 OR (SELECT COUNT(*) FROM products WHERE seller_id = ?) <= ?)`)
      .bind(payload.enabled ? 'advanced' : 'standard', new Date().toISOString(), seller.id,
        payload.enabled ? 1 : 0, seller.id, basicLimits.products).run();
    if (!result.meta.changes) throw new AdvancedModeLimitError(await currentPlan(env, seller));
  }
  return currentPlan(env, seller);
}
