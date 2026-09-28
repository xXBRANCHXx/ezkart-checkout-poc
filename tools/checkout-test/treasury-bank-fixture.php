<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit(1);
require_once dirname(__DIR__, 2) . '/cart/api/commerce-treasury-bank.php';
$input=json_decode(stream_get_contents(STDIN),true,64,JSON_THROW_ON_ERROR);
$requests=[];$privateCalls=[];$ownerCalls=[];$grant=null;$recorded=null;$results=[];
$stage=$input['stage']??'inquiry';$id='try_'.str_repeat('a',40);$confirmation=$stage==='payment'?'tryconf_'.str_repeat('b',40):null;
$client=new EzDokuPayoutClient($input['credentials'],static function($url,$headers,$body)use(&$requests,&$input){
 $requests[]=['url'=>$url,'body'=>$body];$r=array_shift($input['responses']);if(!$r||isset($r['throw']))throw new RuntimeException('Fixture unknown');return [200,$r['body']];
});
$binding=$input['binding'];$binding['credentialFingerprint']=$client->credentialFingerprint;
if($stage==='payment'){
 $at=gmdate('Y-m-d\TH:i:s\Z');
 $input['inquiryEvidence']=['environment'=>'sandbox','credentialFingerprint'=>$client->credentialFingerprint,'operation'=>'transfer-inquiry','externalId'=>$binding['inquiryExternalId'],'requestedAt'=>$at,'observedAt'=>$at,'requestBody'=>json_encode($client->inquiryPayload($binding),JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),'responseBody'=>$input['inquiryResponse']];
 $input['inquiryDigest']=$client->inquiryReceipt($binding,$input['inquiryEvidence'])['inquiryDigest'];
}
$private=static function($method,$path,$payload)use(&$privateCalls,&$grant,&$recorded,$confirmation,&$input){
 $privateCalls[]=$path;if(str_ends_with($path,'/read')){if($grant===null)throw new EzCommerceStorageException('Fixture missing',404);return ['binding'=>$grant['binding'],'confirmationId'=>$confirmation,'originalEvidence'=>$recorded,'mayInquire'=>false,'mayPay'=>false];}
 if(!empty($input['failDelivery']))throw new RuntimeException('Fixture lost Worker delivery');$recorded=$payload['evidence'];return ['recorded'=>true,'digest'=>str_repeat('d',64),'payoutConfirmed'=>false];
};
$owner=static function($path,$payload)use(&$ownerCalls,&$grant,$binding,$stage,$confirmation,$input){
 $ownerCalls[]=$path;if(!str_ends_with($path,'/start'))return ['executionAvailable'=>$input['executionAvailable']??true];
 if($grant!==null)return ['mayInquire'=>false,'mayPay'=>false];
 return $grant=['binding'=>$binding,'mayInquire'=>$stage==='inquiry','mayPay'=>$stage==='payment','confirmationId'=>$confirmation,'originalInquiry'=>$input['inquiryEvidence']??null,'inquiryDigest'=>$input['inquiryDigest']??null];
};
try{
 foreach($input['actions']??['dispatch','dispatch'] as $action){
  if($action==='recover'){$input['failDelivery']=false;$file=ez_treasury_receipt_directory().'/'.$id.'-'.$stage.'.json';$r=ez_finalize_treasury_receipt(ez_treasury_saved_receipt($file),$private);}
  else $r=ez_dispatch_treasury_bank($id,'sandbox',$stage,$owner,$confirmation,$client,$private);
  $results[]=$r;
 }
 echo json_encode(['results'=>$results,'requests'=>$requests,'privateCalls'=>$privateCalls,'ownerCalls'=>$ownerCalls,'files'=>glob(ez_treasury_receipt_directory().'/*.json')],JSON_THROW_ON_ERROR);
}catch(Throwable $e){echo json_encode(['error'=>$e->getMessage(),'requests'=>$requests,'results'=>$results],JSON_THROW_ON_ERROR);}
