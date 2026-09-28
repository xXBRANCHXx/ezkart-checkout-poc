// Isolated merchant-contract facts; these never configure a live deployment.
export const fixtureTransferContract=(extra={})=>JSON.stringify({version:1,environment:'sandbox',credentialFingerprint:'a'.repeat(64),clientId:'MCH-FIXTURE-SNAP',
 platformSeller:'seller_bob',chargedCashAccount:'2010000002',sellerFeeBilling:'company_cash_direct',channels:{BI_FAST:'500',ONLINE:'1000'},
 evidenceReference:'offline fixture merchant agreement',evidenceDigest:'f'.repeat(64),validFrom:'2020-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',...extra});
