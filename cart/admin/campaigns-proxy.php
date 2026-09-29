<?php
declare(strict_types=1);
if (!function_exists('ez_admin_json')) { http_response_code(404); exit; }
function ez_admin_campaigns_proxy(string $token, string $path, string $method): never
{
    $session=session_id(); $account=(string) ($_SESSION['admin_user']['id']??''); $csrf=(string) ($_SESSION['csrf_token']??'');
    $store=(string) ($_SERVER['HTTP_X_EZKART_CAMPAIGN_STORE']??'');
    if ($account==='' || !hash_equals($account,(string) ($_SERVER['HTTP_X_EZKART_CAMPAIGN_ACCOUNT']??'')) || $csrf==='' || !hash_equals($csrf,(string) ($_SERVER['HTTP_X_EZKART_CSRF']??'')) || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/D',$store)!==1) ez_admin_json(['ok'=>false,'error'=>'Your sign-in or store changed. Reload this page.'],401);
    if (preg_match('#^/v1/commerce/campaigns(?:/(trk_[a-f0-9]{32})(?:/(sources|end))?)?(?:\?before=trk_[a-f0-9]{32})?$#D',$path,$match)!==1
        || !in_array($method,['GET','POST'],true) || ($method==='GET' && !empty($match[2])) || ($method==='POST' && (str_contains($path,'?') || (!empty($match[1]) && empty($match[2]))))) ez_admin_json(['ok'=>false,'error'=>'Campaign path is invalid.'],400);
    if ($method==='POST' && !ez_request_origin_allowed()) ez_admin_json(['ok'=>false,'error'=>'Reload this page before saving.'],403);
    $body=$method==='POST'?file_get_contents('php://input',false,null,0,10001):'';
    if (!is_string($body)||strlen($body)>10000) ez_admin_json(['ok'=>false,'error'=>'Campaign request is too large.'],413);
    $handle=curl_init(rtrim(ez_config('cloudflare_api_url'),'/').$path);
    if ($handle===false) ez_admin_json(['ok'=>false,'error'=>'Campaigns are unavailable.'],503);
    $raw='';
    curl_setopt_array($handle,[CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>['Accept: application/json','Content-Type: application/json','Authorization: Bearer '.$token,'X-Ezkart-Campaign-Store: '.$store],
        CURLOPT_POSTFIELDS=>$method==='POST'?$body:null,CURLOPT_WRITEFUNCTION=>static function ($curl,string $chunk) use (&$raw):int {if(strlen($raw)+strlen($chunk)>4000000)return 0;$raw.=$chunk;return strlen($chunk);},
        CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_TIMEOUT=>40,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_FOLLOWLOCATION=>false]);
    $received=curl_exec($handle);$status=(int)curl_getinfo($handle,CURLINFO_HTTP_CODE);
    session_id($session);$_SESSION=[];session_start();
    $same=($_SESSION['authenticated']??false)===true && ($_SESSION['admin_user']['id']??'')===$account && ($_SESSION['csrf_token']??'')===$csrf && (empty($_SESSION['mfa_enabled'])||($_SESSION['mfa_aal']??'')==='aal2');
    session_write_close();
    if(!$same){header_remove('Set-Cookie');ez_admin_json(['ok'=>false,'error'=>'Your sign-in changed. Reload to check the saved campaign.'],401);}
    $data=$received===true?json_decode($raw,true):null;
    if(!is_array($data))ez_admin_json(['ok'=>false,'error'=>'The save result is unconfirmed. Retry the original request.'],503);
    ez_admin_json($data,in_array($status,[200,400,401,403,404,409,410,413,415,422,429],true)?$status:503);
}
