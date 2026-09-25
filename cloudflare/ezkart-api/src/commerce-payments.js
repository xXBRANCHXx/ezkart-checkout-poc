const fail=(message,status=422)=>{throw new Response(message,{status});};

export function checkoutContext(input,environment){
  if(!input||typeof input!=='object'||Array.isArray(input)||!/^[a-f0-9]{64}$/.test(input.intentHash||''))fail('Checkout identity is invalid');
  if(!['direct_bca','hosted'].includes(input.paymentFlow)||(environment==='production'&&input.paymentFlow!=='hosted'))fail('Payment flow is unavailable');
  const shop=input.shop||'';
  if(typeof shop!=='string'||(shop&&!/^[a-z0-9][a-z0-9_-]{5,79}$/.test(shop)))fail('Checkout store reference is invalid');
  return {intentHash:input.intentHash,paymentFlow:input.paymentFlow,shop};
}

export function paymentSession(order,data){
  if(data.provider!=='doku'||data.providerRequestId!==order.paymentRequestId||data.amount!==order.total||data.currency!=='IDR')fail('Payment session does not match the original provider request',409);
  const flow=order.snapshot.checkout.paymentFlow,expires=Date.parse(data.expiresAt);
  if(!Number.isFinite(expires)||expires<Date.parse(order.createdAt)||expires>Date.now()+86400000)fail('Provider payment expiry is invalid');
  let paymentUrl='',method='',accountNumber='';
  if(flow==='direct_bca'){
    if(data.method!=='VIRTUAL_ACCOUNT_BCA'||typeof data.accountNumber!=='string'||!/^\d{8,23}$/.test(data.accountNumber))fail('Provider account details are invalid');
    method=data.method;accountNumber=data.accountNumber;paymentUrl='https://test.ezkart.id/cart/payment.php?order='+order.id;
  }else{
    let url;try{url=new URL(data.paymentUrl);}catch{fail('Provider payment link is invalid');}
    const hosts=order.environment==='sandbox'?['sandbox.doku.com','staging.doku.com']:['jokul.doku.com'];
    if(url.protocol!=='https:'||!hosts.includes(url.hostname)||url.username||url.password||url.port||url.hash||url.href.length>2000||!/^\/(?:checkout-link(?:-v2)?\/|checkout\/link\/).+/.test(url.pathname))fail('Provider payment link is invalid');
    paymentUrl=url.href;
  }
  const session={provider:'doku',providerRequestId:order.paymentRequestId,flow,paymentUrl,method,accountNumber,expiresAt:new Date(expires).toISOString()};
  if(order.payment&&JSON.stringify(order.payment)!==JSON.stringify(session))fail('The original provider instructions cannot be replaced',409);
  return session;
}

export function paymentAccountStatement(env,order,data,now){
  if(order.snapshot.checkout?.paymentFlow!=='direct_bca')return null;
  if(data.originalRequestId!==order.paymentRequestId||data.channel!=='VIRTUAL_ACCOUNT_BCA'||typeof data.accountNumber!=='string'||!/^\d{8,23}$/.test(data.accountNumber))fail('The notification does not match the original virtual account request',409);
  return env.DB.prepare(`INSERT INTO commerce_payment_accounts(order_id,seller_id,provider_request_id,account_number,created_at)
    VALUES (?,?,?,?,?) ON CONFLICT(order_id) DO NOTHING`).bind(order.id,order.sellerId,order.paymentRequestId,data.accountNumber,now);
}

export function paymentSessionStatements(env,order,session,now){
  const statements=[];
  if(session.flow==='direct_bca')statements.push(paymentAccountStatement(env,order,{originalRequestId:session.providerRequestId,channel:session.method,accountNumber:session.accountNumber},now));
  statements.push(env.DB.prepare(`INSERT INTO commerce_payment_sessions(order_id,seller_id,commerce_environment,provider_request_id,details_json,created_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(order_id) DO NOTHING`).bind(order.id,order.sellerId,order.environment,session.providerRequestId,JSON.stringify(session),now));
  return statements;
}
