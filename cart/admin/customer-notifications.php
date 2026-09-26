<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/customer-auth.php';
require_once dirname(__DIR__) . '/api/commerce-client.php';
require_once dirname(__DIR__) . '/api/notification-query.php';
try {
    $noticeMethod = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
    if (!in_array($noticeMethod, ['GET','POST'], true)) ez_api_json(['ok' => false], 405);
    $noticeCustomer = ez_customer_current(); $noticeCsrf = ez_customer_csrf(); $noticeVersion = (string) ($_SESSION['customer_auth']['version'] ?? '');
    if ($noticeCustomer === null || $noticeVersion === '' || !hash_equals($noticeVersion, (string) ($_SERVER['HTTP_X_EZKART_CUSTOMER_SESSION'] ?? ''))) ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page.', 'code' => 'customer_session_changed'], 401);
    if ($noticeMethod === 'POST' && (!ez_request_origin_allowed() || !hash_equals($noticeCsrf, (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? '')))) ez_api_json(['ok' => false, 'error' => 'Reload this page before saving.'], 403);
    if (count($_GET) !== 1 || !is_string($_GET['path'] ?? null) || count(explode('&', (string) ($_SERVER['QUERY_STRING'] ?? ''))) !== 1) ez_api_json(['ok' => false, 'error' => 'Notification reference is invalid.'], 400);
    try { $noticeTarget = '/v1/customer/notifications' . ez_notification_target($_GET['path'], $noticeMethod, false); }
    catch (InvalidArgumentException $error) { ez_api_json(['ok' => false, 'error' => $error->getMessage()], 400); }
    if (!ez_central_commerce_enabled() && !str_starts_with($noticeTarget, '/v1/customer/notifications/preferences')) ez_api_json(['ok' => false, 'error' => 'Notifications are not available yet.'], 503);
    if ($noticeMethod === 'POST' && preg_match('#^application/json(?:;|$)#i', (string) ($_SERVER['CONTENT_TYPE'] ?? '')) !== 1) ez_api_json(['ok' => false, 'error' => 'Use a JSON request.'], 415);
    $noticeBody = $noticeMethod === 'POST' ? file_get_contents('php://input', false, null, 0, 3001) : '';
    if (!is_string($noticeBody) || strlen($noticeBody) > 3000) ez_api_json(['ok' => false, 'error' => 'Notification request is too large.'], 413);
    $noticeSession = session_id(); $noticeToken = (string) ($_SESSION['customer_auth']['access_token'] ?? ''); $noticeBridge = ($_SESSION['customer_auth']['source'] ?? '') === 'existing_google';
    session_write_close();
    $noticeAdminSession = ''; $noticeAdminCsrf = '';
    if ($noticeBridge) {
        $noticeAdminSession = (string) ($_COOKIE['ezkart_admin'] ?? '');
        if (preg_match('/^[A-Za-z0-9,-]{1,128}$/D', $noticeAdminSession) !== 1) throw new InvalidArgumentException('Sign in again.');
        session_id($noticeAdminSession); $_SESSION = []; $_GET = $_POST = []; define('EZ_CUSTOMER_SESSION_BRIDGE', true); require __DIR__ . '/index.php';
        if (!$authenticated || $authenticationMethod !== 'supabase' || $pendingMfa !== null || ($_SESSION['admin_user']['id'] ?? '') !== $noticeCustomer['id']) throw new InvalidArgumentException('Sign in again.');
        $noticeToken = (string) ($_SESSION['supabase_access_token'] ?? ''); $noticeAdminCsrf = (string) ($_SESSION['csrf_token'] ?? ''); session_write_close();
    }
    $noticeVerified = ez_customer_verified_user($noticeToken);
    if ($noticeVerified['id'] !== $noticeCustomer['id'] || ez_customer_needs_mfa($noticeVerified, $noticeToken)) throw new InvalidArgumentException('Sign in again.');
    $noticeDatabase = ez_database_configuration(); $noticeHandle = curl_init($noticeDatabase['url'] . $noticeTarget);
    if ($noticeHandle === false) throw new RuntimeException('Notifications unavailable.');
    curl_setopt_array($noticeHandle, [CURLOPT_CUSTOMREQUEST => $noticeMethod, CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json', 'Authorization: Bearer ' . $noticeToken],
        CURLOPT_POSTFIELDS => $noticeMethod === 'POST' ? $noticeBody : null, CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 25,
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_FOLLOWLOCATION => false]);
    $noticeRaw = curl_exec($noticeHandle); $noticeStatus = (int) curl_getinfo($noticeHandle, CURLINFO_HTTP_CODE);
    if ($noticeBridge) {
        session_name('ezkart_admin'); session_id($noticeAdminSession); $_SESSION = []; session_start();
        $noticeSame = ($_SESSION['authenticated'] ?? false) === true && ($_SESSION['authentication_method'] ?? '') === 'supabase'
            && ($_SESSION['admin_user']['id'] ?? '') === $noticeCustomer['id'] && ($_SESSION['csrf_token'] ?? '') === $noticeAdminCsrf
            && (empty($_SESSION['mfa_enabled']) || ($_SESSION['mfa_aal'] ?? '') === 'aal2'); session_write_close();
        if (!$noticeSame) throw new InvalidArgumentException('Sign in changed.');
    }
    session_id($noticeSession); $_SESSION = []; ez_customer_session();
    $noticeSame = ($_SESSION['customer_auth']['version'] ?? '') === $noticeVersion && ($_SESSION['customer_auth']['user']['id'] ?? '') === $noticeCustomer['id']; session_write_close();
    if (!$noticeSame) throw new InvalidArgumentException('Sign in changed.');
    $noticeData = is_string($noticeRaw) ? json_decode($noticeRaw, true) : null;
    if (!is_array($noticeData)) throw new RuntimeException('Notifications unavailable.');
    ez_api_json($noticeData, in_array($noticeStatus, [200,400,401,403,404,409,413,415,422,429], true) ? $noticeStatus : 503);
} catch (InvalidArgumentException) { header_remove('Set-Cookie'); ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page.', 'code' => 'customer_session_changed'], 401); }
catch (Throwable) { ez_api_json(['ok' => false, 'error' => 'Notifications could not be loaded. Try again.'], 503); }
