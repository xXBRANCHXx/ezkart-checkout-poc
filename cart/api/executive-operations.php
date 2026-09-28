<?php
declare(strict_types=1);
require_once __DIR__.'/bootstrap.php';
require_once __DIR__.'/executive-operations-service.php';
try {
 if(($_SERVER['REQUEST_METHOD']??'')!=='POST'||!in_array(ez_config('deployment_environment'),['test','beta'],true))ez_api_json(['ok'=>false,'error'=>'Executive operations are only available on workbench.'],403);
 $body=(string)file_get_contents('php://input',false,null,0,20001);if(strlen($body)>20000)ez_api_json(['ok'=>false,'error'=>'Request too large.'],413);
 ez_executive_authorize($body);$operationsInput=json_decode($body,true);if(!is_array($operationsInput))throw new InvalidArgumentException('Invalid request.');
 $_GET=$_POST=[];define('EZ_CUSTOMER_SESSION_BRIDGE',true);require __DIR__.'/../admin/index.php';session_write_close();
 ez_api_json(['ok'=>true]+ez_operations_handle($operationsInput));
}catch(InvalidArgumentException $e){ez_api_json(['ok'=>false,'error'=>$e->getMessage()],400);}
catch(Throwable $e){$status=in_array($e->getCode(),[400,401,403,404,409,413,422,429],true)?$e->getCode():503;ez_api_json(['ok'=>false,'error'=>$status===503?'The operation could not be confirmed. Reconnect if your sign-in expired, or retry the original request.':$e->getMessage()],$status);}
