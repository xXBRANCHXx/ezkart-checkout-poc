import {withdrawalPaymentRecovery} from './commerce-withdrawal-payments.js';

// Private operator scope. Every account comes from the original grant, never
// the currently configured platform seller or the current merchant session.
export async function payoutSyncScope(env,id,input){
  const payment=await withdrawalPaymentRecovery(env,id,input);
  const source=await env.DB.prepare(`SELECT w.seller_id,w.enrollment_id,g.platform_enrollment_id,g.created_at,
    sp.profile_id AS seller_profile,sp.cash_account AS seller_cash,sp.pending_account AS seller_pending,
    pp.profile_id AS platform_profile,pp.cash_account AS platform_cash,pp.pending_account AS platform_pending,
    pe.seller_id AS platform_seller
    FROM commerce_withdrawals w JOIN commerce_withdrawal_payment_grants g ON g.withdrawal_id=w.id
    JOIN commerce_wallet_provider_profiles sp ON sp.enrollment_id=w.enrollment_id
    JOIN commerce_wallet_provider_profiles pp ON pp.enrollment_id=g.platform_enrollment_id
    JOIN commerce_wallet_enrollments pe ON pe.id=g.platform_enrollment_id WHERE w.id=?`).bind(id).first();
  if(!source)throw new Response('The original payout accounts require review',{status:409});
  const pair=[source.enrollment_id,source.platform_enrollment_id];
  // DOKU accepts at most 31 days per history window. Older work and batches over
  // the limit stay explicit; this plan never silently claims a complete sweep.
  const cutoff=new Date(Date.now()-31*86400000+600000).toISOString();
  const orders=(await env.DB.prepare(`SELECT o.seller_id AS seller,o.id AS orderId,o.created_at AS createdAt,b.seller_enrollment_id AS sellerEnrollmentId
    FROM orders o JOIN commerce_payment_route_bindings b ON b.order_id=o.id
    JOIN commerce_payment_captures c ON c.order_id=o.id AND c.capture_kind='order_payment'
    WHERE b.platform_enrollment_id=? AND b.credential_fingerprint=?
      AND c.commerce_environment=? AND o.created_at>=? ORDER BY o.created_at,o.id LIMIT 101`)
    .bind(source.platform_enrollment_id,payment.binding.credentialFingerprint,input.environment,cutoff).all()).results;
  const withdrawals=(await env.DB.prepare(`SELECT w.id AS withdrawalId,g.created_at AS createdAt,w.enrollment_id AS sellerEnrollmentId
    FROM commerce_withdrawals w JOIN commerce_withdrawal_payment_grants g ON g.withdrawal_id=w.id
    WHERE g.platform_enrollment_id=? AND g.credential_fingerprint=? AND w.commerce_environment=?
      AND w.id!=? AND g.created_at>=?
    ORDER BY g.created_at,w.id LIMIT 101`).bind(source.platform_enrollment_id,payment.binding.credentialFingerprint,input.environment,id,cutoff).all()).results;
  const staleOrders=await env.DB.prepare(`SELECT COUNT(*) AS n FROM commerce_settlement_scopes s
    JOIN commerce_settlement_source_freshness f ON f.assessment_sequence=s.sequence AND f.current=0
    WHERE s.commerce_environment=? AND (s.seller_enrollment_id IN (?,?) OR s.platform_enrollment_id IN (?,?))
      AND NOT EXISTS(SELECT 1 FROM commerce_settlement_assessments a WHERE a.capture_id=s.capture_id AND a.sequence>s.sequence)`)
    .bind(input.environment,...pair,...pair).first();
  const stalePayouts=await env.DB.prepare(`SELECT COUNT(*) AS n FROM commerce_payout_scopes s
    JOIN commerce_payout_source_freshness f ON f.assessment_sequence=s.sequence AND f.current=0
    WHERE s.commerce_environment=? AND (s.seller_enrollment_id IN (?,?) OR s.platform_enrollment_id IN (?,?))
      AND NOT EXISTS(SELECT 1 FROM commerce_payout_assessments a WHERE a.withdrawal_id=s.withdrawal_id AND a.sequence>s.sequence)`)
    .bind(input.environment,...pair,...pair).first();
  const settlements=orders.slice(0,100),payouts=withdrawals.slice(0,100);
  const enrollmentIds=[...new Set([...pair,...settlements.map(x=>x.sellerEnrollmentId),...payouts.map(x=>x.sellerEnrollmentId)])];
  const wallets=(await env.DB.prepare(`SELECT e.id AS enrollmentId,e.seller_id AS seller,p.profile_id AS profileId,
      p.cash_account AS cashAccount,p.pending_account AS pendingAccount
    FROM commerce_wallet_enrollments e JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id
    JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=e.id
    WHERE e.id IN (SELECT value FROM json_each(?)) AND e.commerce_environment=? AND b.credential_fingerprint=? ORDER BY e.id`)
    .bind(JSON.stringify(enrollmentIds),input.environment,payment.binding.credentialFingerprint).all()).results;
  if(wallets.length!==enrollmentIds.length)throw new Response('The original shared wallet accounts require review',{status:409});
  const from=new Date(Math.floor(Math.min(Date.parse(source.created_at)-300000,
    ...settlements.map(x=>Date.parse(x.createdAt)),...payouts.map(x=>Date.parse(x.createdAt)-300000))/1000)*1000).toISOString().replace('.000Z','Z');
  return {original:{withdrawalId:id,environment:input.environment,binding:payment.binding,clientId:payment.clientId,
    confirmationId:payment.confirmationId,grantedAt:source.created_at,
    sellerAccount:{seller:source.seller_id,enrollmentId:source.enrollment_id,profileId:source.seller_profile,cashAccount:source.seller_cash,pendingAccount:source.seller_pending},
    platformAccount:{seller:source.platform_seller,enrollmentId:source.platform_enrollment_id,profileId:source.platform_profile,cashAccount:source.platform_cash,pendingAccount:source.platform_pending}},
    plan:{version:2,from,wallets,settlements:settlements.map(({createdAt,...row})=>row),withdrawals:payouts.map(({createdAt,...row})=>row),truncated:orders.length>100||withdrawals.length>100},
    sharedHistoryReview:{settlements:staleOrders.n,payouts:stalePayouts.n},providerCalls:0,mayPay:false};
}
