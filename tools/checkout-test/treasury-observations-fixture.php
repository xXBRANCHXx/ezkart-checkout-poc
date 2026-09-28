<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
require_once dirname(__DIR__,2).'/cart/api/commerce-treasury-observations.php';
$input=json_decode(stream_get_contents(STDIN),true,64,JSON_THROW_ON_ERROR);$requests=[];$calls=[];$ids=[];$status=null;$results=[];
$id='try_'.str_repeat('a',40);$run=str_repeat('b',32);$now=gmdate('Y-m-d\TH:i:s\Z');
$reader=new EzDokuSubAccountReader($input['credentials'],static function($url,$headers,$body)use(&$requests,&$input,$now){
 $requests[]=['url'=>$url,'body'=>$body];$p=json_decode($body,true);$op=basename($url);
 if(($input['failOperation']??'')===$op)throw new RuntimeException('Fixture failed read');
 if($op==='b2b')$r=['responseCode'=>'2007300','accessToken'=>'fixture-token','tokenType'=>'Bearer','expiresIn'=>900];
 elseif($op==='transactions-status')$r=['responseCode'=>'2000000','partnerReferenceNo'=>$p['partnerReferenceNo'],'transactionType'=>'PAYOUT','latestTransactionStatus'=>'00','amount'=>['value'=>'1000.00','currency'=>'IDR'],'transactionDate'=>$now];
 elseif($op==='balance-inquiries')$r=['responseCode'=>'2000000','profileId'=>$p['profileId'],'name'=>'Fixture Company','accounts'=>[
  ['accountNo'=>'1234567890','type'=>'DOKU_MERCHANT_IDR','currency'=>'IDR','balance'=>['available'=>'1000','reserved'=>'0']],
  ['accountNo'=>'1234567891','type'=>'DOKU_MERCHANT_PENDING_IDR','currency'=>'IDR','balance'=>['available'=>'0','reserved'=>'0']]]];
 elseif($op==='transaction-history-list')$r=['responseCode'=>'2000000','detailData'=>[]];else throw new RuntimeException('Unexpected provider operation');
 return [200,json_encode($r,JSON_THROW_ON_ERROR)];
});
$binding=['environment'=>'sandbox','credentialFingerprint'=>$reader->credentialFingerprint,'partnerReferenceNo'=>'EZK-TREASURY-S-'.str_repeat('a',40),'fromAccount'=>'1234567890','beneficiaryBankCode'=>'CENAIDJA','beneficiaryAccountNumber'=>'001234567890','amount'=>'1000','channel'=>'BI_FAST','inquiryExternalId'=>str_repeat('0',31).'1','paymentExternalId'=>str_repeat('0',31).'2'];
if(isset($input['scopeFingerprint']))$binding['credentialFingerprint']=$input['scopeFingerprint'];
$original=['intentId'=>$id,'environment'=>'sandbox','clientId'=>$input['credentials']['clientId'],'binding'=>$binding,'confirmationId'=>'tryconf_'.str_repeat('c',40),'grantedAt'=>$input['grantedAt']??$now,'account'=>['enrollmentId'=>'fixture-enrollment','seller'=>'fixture-company','profileId'=>'BRN-fixture','cashAccount'=>'1234567890','pendingAccount'=>'1234567891']];
$outcome=['state'=>'held','reason'=>'actual_fee_unknown_or_ambiguous','payoutConfirmed'=>false];
$private=static function($method,$path,$body)use(&$calls,&$ids,&$status,$original,$id,$outcome,&$input){
 $calls[]=$path;
 if(($input['failDelivery']??'')===$path){$input['failDelivery']='';throw new RuntimeException('Fixture lost delivery');}
 if(str_ends_with($path,'/observations/scope'))return ['original'=>$original,'mayPay'=>false];
 if(str_ends_with($path,'/status/receipt')){$status=$body['evidence'];return ['recorded'=>true,'mayPay'=>false];}
 if(str_ends_with($path,'/status/history'))return ['cap'=>1,'status'=>['checkedAt'=>$status['observedAt']]];
 if(str_ends_with($path,'/provider-evidence')){$key=hash('sha256',json_encode($body));$ids[$key]??='fobs_'.substr($key,0,40);return ['id'=>$ids[$key]];}
 if(str_ends_with($path,'/provider-collections'))return ['collection'=>['id'=>'fcol_'.str_repeat('d',40),'observationIds'=>$body['observationIds'],'pagesExhausted'=>true]];
 return ['intentId'=>$id,'assessmentId'=>'tryout_'.str_repeat('e',40),'providerCalls'=>0,'mayPay'=>false,'outcome'=>$outcome];
};
foreach($input['modes']??['collect','recover'] as $mode){try{$results[]=ez_sync_treasury_observations($id,'sandbox',$run,$mode,10,$input['maxReads']??20,$mode==='collect'?$reader:null,$private);}catch(Throwable $e){$results[]=['error'=>$e->getMessage()];}}
echo json_encode(['results'=>$results,'requests'=>$requests,'calls'=>$calls,'files'=>glob(ez_treasury_receipt_directory().'/*/*.json')],JSON_THROW_ON_ERROR);
