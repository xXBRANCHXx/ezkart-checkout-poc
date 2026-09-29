// Publishing can precede bank setup only when the store owner has two-step on.
// Look up enrollment live: JWT AAL and user metadata do not establish that a
// verified factor is still enrolled. A team member's factor cannot waive setup.
export async function requirePublicationBank(env, sellerId, fetcher = fetch, ownerId = null) {
  const bank = await env.DB.prepare(`SELECT b.revision FROM seller_onboarding_current_bank b
    JOIN seller_memberships m ON m.seller_id=b.seller_id AND m.auth_user_id=b.owner_auth_id AND m.role='owner'
    WHERE b.seller_id=? AND (? IS NULL OR b.owner_auth_id=?)`).bind(sellerId,ownerId,ownerId).first();
  if (bank) return;
  const owner = await env.DB.prepare(`SELECT auth_user_id FROM seller_memberships
    WHERE seller_id=? AND role='owner' AND (? IS NULL OR auth_user_id=?) ORDER BY created_at,auth_user_id LIMIT 1`).bind(sellerId,ownerId,ownerId).first();
  if (!owner) throw new Response('Your store owner must add bank details in Finish seller setup before publishing.', {status:409});
  const unavailable = () => new Response('Could not check two-step verification. Try again shortly.', {status:503});
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) throw unavailable();
  let user;
  try {
    const response = await fetcher(String(env.SUPABASE_URL).replace(/\/$/, '') + '/auth/v1/admin/users/' + encodeURIComponent(owner.auth_user_id), {
      method:'GET', redirect:'manual', signal:AbortSignal.timeout(10000),
      headers:{accept:'application/json', apikey:env.SUPABASE_SERVICE_ROLE_KEY, authorization:'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY},
    });
    if (!response.ok) throw unavailable();
    user = await response.json();
  } catch { throw unavailable(); }
  if (user?.id !== owner.auth_user_id || user.deleted_at || user.is_anonymous === true
      || (user.banned_until && Date.parse(user.banned_until) > Date.now())) throw unavailable();
  const enabled = Array.isArray(user.factors) && user.factors.some(factor => factor.factor_type === 'totp' && factor.status === 'verified');
  if (ownerId) {
    await env.DB.prepare(`INSERT INTO seller_two_step_checks(seller_id,owner_auth_id,expires_at) VALUES(?,?,?)
      ON CONFLICT(seller_id,owner_auth_id) DO UPDATE SET expires_at=excluded.expires_at`)
      .bind(sellerId,owner.auth_user_id,new Date(Date.now() + (enabled ? 60000 : -1000)).toISOString()).run();
  }
  if (enabled) return;
  throw new Response('Add your bank details in Finish seller setup before publishing or accepting payments. With two-step verification enabled, you can add them later before withdrawing.', {status:409});
}

export async function requireSellingOnboarding(env, sellerId, environment) {
  if (environment !== 'production') return;
  const profile = await env.DB.prepare('SELECT * FROM seller_onboarding_profile_ready WHERE seller_id=?').bind(sellerId).first();
  if (!profile) throw new Response('Complete your legal details, age declaration and confirmed pickup/return pins in Finish seller setup before accepting payments.', {status:409});
  await requirePublicationBank(env,sellerId,fetch,profile.owner_auth_id);
}
