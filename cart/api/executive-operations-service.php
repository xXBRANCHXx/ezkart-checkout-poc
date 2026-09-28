<?php
declare(strict_types=1);
require_once __DIR__ . '/executive-bridge.php';
function ez_operations_file(string $grant): string {
 if (preg_match('/^[a-f0-9]{64}$/D', $grant)!==1) throw new InvalidArgumentException('Connection reference is invalid.');
 $dir=ez_executive_directory().'/operations';if(!is_dir($dir)&&!mkdir($dir,0700,true))throw new RuntimeException('Connection storage unavailable.');
 return $dir.'/'.$grant.'.json';
}
function ez_operations_lock(string $grant, callable $fn): mixed {
 $path=ez_operations_file($grant);$old=umask(0077);$lock=fopen($path.'.lock','c');umask($old);
 if(!$lock||!flock($lock,LOCK_EX))throw new RuntimeException('Connection is busy.');
 try{$state=is_file($path)?json_decode((string)file_get_contents($path),true):null;return $fn($state,$path);}finally{flock($lock,LOCK_UN);fclose($lock);}
}
function ez_operations_save(string $path,array $state): void {
 $old=umask(0077);$tmp=$path.'.'.bin2hex(random_bytes(8)).'.tmp';
 try{if(file_put_contents($tmp,json_encode($state,JSON_THROW_ON_ERROR),LOCK_EX)===false||!rename($tmp,$path))throw new RuntimeException('Connection could not be saved.');chmod($path,0600);}finally{umask($old);if(is_file($tmp))unlink($tmp);}
}
function ez_operations_target(string $path,string $method): void {
 if(strlen($path)>2400||str_contains($path,'#')||!in_array($method,['GET','POST'],true))throw new InvalidArgumentException('Operation is invalid.');
 $patterns=[
  'GET'=>['~^/v1/support/session$~D','~^/v1/jev/pages\?store=[a-z0-9-]{1,96}$~D','~^/v1/jev/reviews(?:/jev_[a-f0-9]{32}(?:/image/[1-9][0-9]?)?)?$~D',
   '~^/v1/support/refunds(?:\?(?:state=(?:all|open|awaiting_buyer|awaiting_store|closed|processing)|cursor=[A-Za-z0-9_-]{1,1800})(?:&(?:state=(?:all|open|awaiting_buyer|awaiting_store|closed|processing)|cursor=[A-Za-z0-9_-]{1,1800}))?)?$~D',
   '~^/v1/support/refunds/ref_[a-f0-9]{32}(?:/packet|/evidence/rattach_[a-f0-9]{32}|/dispute\?before=[1-9][0-9]{0,14})?$~D','~^/v1/treasury/(?:commissions|intents/try_[a-f0-9]{40})$~D'],
  'POST'=>['~^/v1/jev/reviews(?:/jev_[a-f0-9]{32}/(?:run|grade|restore|rescan))?$~D','~^/v1/support/refunds/ref_[a-f0-9]{32}/(?:dispute|processing)$~D','~^/v1/treasury/intents(?:/lookup|/try_[a-f0-9]{40}/(?:cancel|confirm))?$~D']
 ];foreach($patterns[$method] as $pattern)if(preg_match($pattern,$path)===1)return;
 throw new InvalidArgumentException('This operation is not available in Executive.');
}
function ez_operations_worker(string $token,string $path,?array $body=null): array {
 $h=curl_init(rtrim(ez_config('cloudflare_api_url'),'/').$path);$mime='';$digest='';
 curl_setopt_array($h,[CURLOPT_CUSTOMREQUEST=>$body===null?'GET':'POST',CURLOPT_HTTPHEADER=>['Accept: application/json','Content-Type: application/json','Authorization: Bearer '.$token],CURLOPT_POSTFIELDS=>$body===null?null:json_encode($body,JSON_THROW_ON_ERROR),CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>55,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_HEADERFUNCTION=>static function($curl,$line)use(&$mime,&$digest){if(stripos($line,'content-type:')===0)$mime=trim(substr($line,13));if(stripos($line,'x-ezkart-file-sha256:')===0)$digest=trim(substr($line,21));return strlen($line);}]);
 $raw=curl_exec($h);$status=(int)curl_getinfo($h,CURLINFO_RESPONSE_CODE);if(!is_string($raw)||$status===0)throw new RuntimeException('The original operation could not be confirmed. Retry only the saved request.');
 if(preg_match('~/evidence/rattach_[a-f0-9]{32}$~D',$path)&&$status===200)return ['status'=>200,'binary'=>base64_encode($raw),'mime'=>$mime,'sha256'=>$digest];
 $data=json_decode($raw,true);if(!is_array($data))return ['status'=>$status,'data'=>['ok'=>false,'error'=>'The operation returned an unreadable response. Retry the original request.']];
 return ['status'=>$status,'data'=>$data];
}
function ez_operations_require(array $response): array {
 if($response['status']!==200||empty($response['data']['ok']))throw new RuntimeException((string)($response['data']['error']??'Operation unavailable.'),$response['status']);return $response['data'];
}
function ez_operations_handle(array $input): array {
 $grant=(string)($input['grant']??'');$binding=(string)($input['binding']??'');$action=(string)($input['operation']??'');
 if(!preg_match('/^[a-f0-9]{64}$/D',$binding))throw new InvalidArgumentException('Connection binding is invalid.');
 return ez_operations_lock($grant,static function($state,$file)use($input,$grant,$binding,$action){
  if($action==='begin'){
   if($state!==null&&!hash_equals($state['binding'],$binding))throw new InvalidArgumentException('Connection already exists.');
   if($state===null)ez_operations_save($file,['binding'=>$binding,'expires'=>time()+600,'connected'=>false]);
   return ['connected'=>false,'authorizeUrl'=>'https://test.ezkart.id/cart/admin/executive-connect.php?grant='.$grant];
  }
  if(!is_array($state)||!hash_equals((string)($state['binding']??''),$binding)||(int)($state['expires']??0)<=time())return ['connected'=>false];
  if($action==='disconnect'){unlink($file);return ['connected'=>false];}
  if(empty($state['connected']))return ['connected'=>false,'pending'=>true];
  // No refresh token is delegated. Expired credentials require reconnecting the original account.
  $token=$state['token'];$identity=$state['account'];
  if($action==='verify'){
   $code=(string)($input['code']??'');if(!preg_match('/^[0-9]{6}$/D',$code))throw new InvalidArgumentException('Enter the six-digit authenticator code.');
   ez_wallet_rate_limit($identity,'support_verify');$user=ez_admin_verify_supabase_user($token);if(!hash_equals($identity,(string)$user['id']))throw new RuntimeException('Operator account changed.',401);
   $factors=ez_admin_totp_factors($user,'verified');if(!$factors)throw new InvalidArgumentException('Set up an authenticator for your operator account first.');$factor=$factors[0]['id'];
   $challenge=ez_admin_auth_request('POST','/auth/v1/factors/'.$factor.'/challenge',$token);
   $tokens=ez_admin_auth_request('POST','/auth/v1/factors/'.$factor.'/verify',$token,['challenge_id'=>$challenge['id'],'code'=>$code]);
   $verified=ez_admin_verify_supabase_user($tokens['access_token']);if(!hash_equals($identity,(string)$verified['id'])||ez_admin_token_aal($tokens['access_token'])!=='aal2')throw new RuntimeException('Operator verification failed.',401);
   $state['token']=$token=$tokens['access_token'];ez_operations_save($file,$state);
  }
  $permission=ez_operations_require(ez_operations_worker($token,'/v1/support/session'))['support'];
  if(empty($permission['authorized'])){unlink($file);throw new RuntimeException('Operator access was revoked.',403);}
  $meta=['connected'=>true,'account'=>$identity,'support'=>$permission,'workspace'=>ez_config('deployment_environment')];
  if(in_array($action,['session','verify'],true))return $meta;
  if(in_array($action,['request','treasury-bank'],true)&&!hash_equals($identity,(string)($input['expectedAccount']??'')))throw new RuntimeException('Operator account changed. Reload before continuing.',409);
  if($action==='request'){
   $path=(string)($input['path']??'');$method=(string)($input['method']??'GET');ez_operations_target($path,$method);
   $body=$input['body']??null;if($method==='POST'&&!is_array($body)||$method==='GET'&&$body!==null)throw new InvalidArgumentException('Operation body is invalid.');
   $response=ez_operations_worker($token,$path,$body);
   $current=ez_operations_require(ez_operations_worker($token,'/v1/support/session'))['support'];
   if(empty($current['authorized'])){unlink($file);throw new RuntimeException('Operator access was revoked.',403);}
   return $meta+['response'=>$response];
  }
  if($action==='treasury-bank'){
   $id=(string)($input['intent']??'');$stage=(string)($input['stage']??'');if(!preg_match('/^try_[a-f0-9]{40}$/D',$id)||!in_array($stage,['inquiry','payment'],true))throw new InvalidArgumentException('Treasury reference is invalid.');
   $summary=ez_operations_require(ez_operations_worker($token,'/v1/treasury/commissions'));
   require_once __DIR__.'/commerce-treasury-bank.php';
   $owner=static fn(string $path,?array $body)=>ez_operations_require(ez_operations_worker($token,'/v1/treasury'.$path,$body));
   return $meta+['receipt'=>ez_dispatch_treasury_bank($id,$summary['environment'],$stage,$owner,$stage==='payment'?(string)($input['confirmationId']??''):null)];
  }
  throw new InvalidArgumentException('Unknown operation.');
 });
}
