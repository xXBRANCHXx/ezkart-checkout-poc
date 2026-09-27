// Read-only refund planning. These amounts never post a journal or prove payment.
const money=value=>{
  const text=String(value);
  if(!/^(0|[1-9][0-9]{0,11})$/.test(text)||BigInt(text)>100000000000n)throw new TypeError('Invalid refund money');
  return BigInt(text);
};

export function refundCostRange({subtotal,commission,admin,productRefund,shippingRefund,originalProcessingFee=null}){
  const original=money(subtotal),fee=money(commission),fixed=money(admin),product=money(productRefund),shipping=money(shippingRefund);
  if(original===0n||fee>original||product>original||fixed!==1250n||product+shipping>100000000000n)throw new TypeError('Invalid original refund allocation');
  // Cumulative proportional rounding can allocate the remaining one rupiah to
  // either partial refund. Showing a range avoids promising a premature ledger
  // amount; a full product refund always returns the exact original commission.
  const numerator=product*fee,low=numerator/original,high=(numerator+original-1n)/original;
  return {currency:'IDR',state:'preview',productRefund:String(product),shippingRefund:String(shipping),buyerRefund:String(product+shipping),
    commissionReversal:{minimum:String(low),maximum:String(high)},
    sellerProductDeduction:{minimum:String(product-high),maximum:String(product-low)},
    retainedAdminFee:String(fixed),originalProcessingFee:originalProcessingFee===null?null:String(money(originalProcessingFee)),
    actualRefundFee:null,refundFeePayer:null,refundFeePolicy:'current_funds_holder',paymentConfirmed:false,ledgerPosted:false};
}

export async function refundCostPreview(env,row){
  const original=await env.DB.prepare(`SELECT o.subtotal_amount,json_extract(o.snapshot_json,'$.fees.commissionAmount') AS commission,
    json_extract(o.snapshot_json,'$.fees.adminAmount') AS admin,
    (SELECT r.fee_amount FROM commerce_settlement_assessments a JOIN commerce_settlement_results r ON r.assessment_sequence=a.sequence
      JOIN commerce_settlement_source_freshness f ON f.assessment_sequence=a.sequence AND f.current=1
      WHERE a.capture_id=c.capture_id AND r.state='settled' AND a.sequence=(SELECT MAX(x.sequence) FROM commerce_settlement_assessments x WHERE x.capture_id=c.capture_id)) AS processing_fee
    FROM commerce_capture_accounting c JOIN orders o ON o.id=c.order_id AND o.seller_id=c.seller_id
    WHERE c.capture_id=? AND c.order_id=? AND c.seller_id=? AND c.commerce_environment=? AND c.allocation_state='allocated'`)
    .bind(row.capture_id,row.order_id,row.seller_id,row.commerce_environment).first();
  if(!original)return null;
  return refundCostRange({subtotal:original.subtotal_amount,commission:original.commission,admin:original.admin,
    productRefund:row.amount-row.shipping_amount,shippingRefund:row.shipping_amount,originalProcessingFee:original.processing_fee});
}
