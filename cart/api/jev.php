<?php
declare(strict_types=1);
// Reuse the existing verified admin session; never proxy a browser-supplied token.
$jevPath = is_string($_GET['path'] ?? null) ? $_GET['path'] : '';
$jevMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$_GET = $_POST = [];
define('EZ_CUSTOMER_SESSION_BRIDGE', true);
require dirname(__DIR__) . '/admin/index.php';
try {
    if (!$authenticated || $authenticationMethod !== 'supabase' || $pendingMfa !== null) ez_api_json(['ok'=>false,'error'=>'Sign in to Ezkart reviews.'],401);
    $account=(string) ($_SESSION['admin_user']['id'] ?? ''); $csrf=(string) ($_SESSION['csrf_token'] ?? '');
    if ($account==='' || $csrf==='' || !hash_equals($account,(string)($_SERVER['HTTP_X_EZKART_JEV_ACCOUNT']??'')) || !hash_equals($csrf,(string)($_SERVER['HTTP_X_EZKART_CSRF']??''))) ez_api_json(['ok'=>false,'error'=>'Your sign-in changed. Reload this page.'],401);
    if (!in_array($jevMethod,['GET','POST'],true) || preg_match('~^/v1/jev/(?:pages\?store=[a-z0-9-]{1,96}|reviews(?:/jev_[a-f0-9]{32}(?:/(?:run|grade|restore|rescan|image/[1-9][0-9]?))?)?)$~D',$jevPath)!==1) ez_api_json(['ok'=>false,'error'=>'Jev request is invalid.'],400);
    if ($jevMethod==='POST' && (!ez_request_origin_allowed() || preg_match('~^application/json(?:;|$)~i',(string)($_SERVER['CONTENT_TYPE']??''))!==1)) ez_api_json(['ok'=>false,'error'=>'Reload before submitting a review.'],403);
    $body=$jevMethod==='POST'?file_get_contents('php://input',false,null,0,5001):'';
    if (!is_string($body)||strlen($body)>5000) ez_api_json(['ok'=>false,'error'=>'Review request is too large.'],413);
    $session=session_id(); $token=(string)$_SESSION['supabase_access_token']; session_write_close();
    $handle=curl_init(rtrim(ez_config('cloudflare_api_url'),'/').$jevPath);if($handle===false)throw new RuntimeException();
    $raw='';curl_setopt_array($handle,[CURLOPT_CUSTOMREQUEST=>$jevMethod,CURLOPT_HTTPHEADER=>['Accept: application/json','Content-Type: application/json','Authorization: Bearer '.$token],CURLOPT_POSTFIELDS=>$jevMethod==='POST'?$body:null,
      CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>35,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,
      CURLOPT_WRITEFUNCTION=>static function($curl,string $chunk)use(&$raw):int{if(strlen($raw)+strlen($chunk)>4000000)return 0;$raw.=$chunk;return strlen($chunk);}]);
    $sent=curl_exec($handle);$status=(int)curl_getinfo($handle,CURLINFO_RESPONSE_CODE);curl_close($handle);
    session_id($session);$_SESSION=[];session_start();$same=($_SESSION['authenticated']??false)===true&&($_SESSION['authentication_method']??'')==='supabase'&&($_SESSION['admin_user']['id']??'')===$account&&($_SESSION['csrf_token']??'')===$csrf;session_write_close();
    if(!$same)ez_api_json(['ok'=>false,'error'=>'Your sign-in changed. Reload to check the original request.'],401);
    $data=json_decode($raw,true);if($sent===false||!is_array($data))throw new RuntimeException();
    ez_api_json($data,$status>=200&&$status<=599?$status:503);
} catch(Throwable){ez_api_json(['ok'=>false,'error'=>'The review response was not confirmed. Retry only the original request.'],503);}
