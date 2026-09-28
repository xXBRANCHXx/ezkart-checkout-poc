<?php
declare(strict_types=1);
define('EZ_CUSTOMER_SESSION_BRIDGE',true);require __DIR__.'/index.php';
require_once __DIR__.'/../api/executive-operations-service.php';
header('Cache-Control: no-store');
$grant=(string)($_GET['grant']??'');$error='';$connected=false;
try{
 if(!in_array(ez_config('deployment_environment'),['test','beta'],true))throw new RuntimeException('This connection is only available on workbench.');
 if(!$authenticated||$authenticationMethod!=='supabase'||$pendingMfa!==null)throw new RuntimeException('Sign in to your Ezkart operator account, then return to this connection page.');
 $permission=ez_operations_require(ez_operations_worker((string)$_SESSION['supabase_access_token'],'/v1/support/session'))['support'];
 if(empty($permission['authorized']))throw new RuntimeException('This account has no Executive operator permission. Seller membership does not grant operator access.');
 $connected=ez_operations_lock($grant,static function($state,$file){
  if(!is_array($state)||$state['expires']<=time()||!empty($state['connected']))throw new RuntimeException('This connection link has expired or was already used. Start again from Executive.');
  if(($_SERVER['REQUEST_METHOD']??'')!=='POST')return false;
  $native=($_SERVER['HTTP_ORIGIN']??'')==='null'&&($_SERVER['HTTP_SEC_FETCH_SITE']??'')==='same-origin';
  if((!ez_request_origin_allowed()&&!$native)||!hash_equals((string)$_SESSION['csrf_token'],(string)($_POST['csrf_token']??'')))throw new RuntimeException('Reload this connection page before continuing.');
  $state+=['account'=>(string)$_SESSION['admin_user']['id'],'token'=>(string)$_SESSION['supabase_access_token']];$state['connected']=true;$state['expires']=time()+8*3600;ez_operations_save($file,$state);return true;
 });
}catch(Throwable $e){$error=$e->getMessage();}
?>
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Executive · Ezkart</title><link rel="stylesheet" href="seller-onboarding.css"><link rel="stylesheet" href="admin.css"></head><body><main class="page-canvas"><section class="surface"><h1>Connect Ezkart Executive</h1>
<?php if($error): ?><p role="alert"><?= ez_admin_escape($error) ?></p><a href="./" target="_blank" rel="noopener">Open Ezkart sign-in</a>
<?php elseif($connected): ?><p>Your operator account is connected. Return to Executive to continue. Fresh authenticator verification is still required for protected actions.</p>
<?php else: ?><p>Connect <?= ez_admin_escape((string)($_SESSION['admin_user']['email']??'')) ?> to the approved Executive browser that opened this link.</p><p>Only continue if you just selected Connect operator account in Ezkart Executive. Your existing permissions and authenticator checks still apply.</p><form method="post"><input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>"><button class="action-button primary" type="submit">Connect this operator account</button></form><?php endif; ?>
<p><a href="https://admin.ezkart.id/#operations">Return to Executive Dashboard</a></p></section></main></body></html>
