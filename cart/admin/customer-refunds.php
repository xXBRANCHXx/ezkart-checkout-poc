<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/customer-auth.php';
require_once dirname(__DIR__) . '/api/commerce-client.php';
require_once dirname(__DIR__) . '/api/refund-media.php';

try {
    $refundMethod = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
    if (!in_array($refundMethod, ['GET', 'POST'], true)) ez_api_json(['ok' => false], 405);
    $refundCustomer = ez_customer_current();
    $refundCsrf = ez_customer_csrf();
    $refundVersion = (string) ($_SESSION['customer_auth']['version'] ?? '');
    if ($refundCustomer === null || $refundVersion === '' || !hash_equals($refundVersion, (string) ($_SERVER['HTTP_X_EZKART_CUSTOMER_SESSION'] ?? ''))) {
        ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page.', 'code' => 'customer_session_changed'], 401);
    }
    if (!ez_central_commerce_enabled()) ez_api_json(['ok' => false, 'error' => 'Refunds are not available yet.'], 503);
    if ($refundMethod === 'POST' && (!ez_request_origin_allowed() || !hash_equals($refundCsrf, (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? '')))) ez_api_json(['ok' => false, 'error' => 'Reload this page before saving.'], 403);
    $query = [];
    foreach (explode('&', (string) ($_SERVER['QUERY_STRING'] ?? '')) as $pair) {
        if ($pair === '') continue;
        [$key, $value] = array_pad(explode('=', $pair, 2), 2, ''); $key = urldecode($key); $value = urldecode($value);
        if (isset($query[$key]) || !in_array($key, ['order','refund','state','cursor','evidence'], true)) ez_api_json(['ok' => false, 'error' => 'Refund reference is invalid.'], 400);
        $query[$key] = $value;
    }
    $refundOrder = $query['order'] ?? ''; $refundId = $query['refund'] ?? '';
    if (preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $refundOrder) !== 1 || ($refundId !== '' && preg_match('/^ref_[a-f0-9]{32}$/D', $refundId) !== 1)) ez_api_json(['ok' => false, 'error' => 'Refund reference is invalid.'], 400);
    $refundEvidence = $query['evidence'] ?? ''; $refundDownload = str_starts_with($refundEvidence, 'rattach_');
    if (isset($query['evidence']) && ($refundId === '' || preg_match('/^(?:upload|rattach_[a-f0-9]{32})$/D', $refundEvidence) !== 1)) ez_api_json(['ok' => false], 400);
    if ($refundEvidence !== '' && (($refundMethod === 'GET' && !$refundDownload) || ($refundMethod === 'POST' && $refundDownload))) ez_api_json(['ok' => false], 405);
    $filters = array_diff_key($query, ['order' => '', 'refund' => '', 'evidence' => '']);
    if ($filters !== [] && ($refundMethod !== 'GET' || $refundId !== '')) ez_api_json(['ok' => false], 400);
    if (isset($filters['state']) && !in_array($filters['state'], ['all','open','requested','approved','declined','withdrawn'], true)) ez_api_json(['ok' => false], 400);
    if (isset($filters['cursor']) && preg_match('/^[A-Za-z0-9_-]{1,1800}$/D', $filters['cursor']) !== 1) ez_api_json(['ok' => false], 400);
    $refundTarget = '/v1/customer/orders/' . $refundOrder . '/refunds' . ($refundId !== '' ? '/' . $refundId : '')
        . ($refundEvidence !== '' ? '/evidence' . ($refundDownload ? '/' . $refundEvidence : '') : '') . ($filters !== [] ? '?' . http_build_query($filters) : '');
    $refundMaximum = $refundEvidence === 'upload' ? 6994000 : 16000;
    if ($refundMethod === 'POST' && preg_match('#^application/json(?:;|$)#i', (string) ($_SERVER['CONTENT_TYPE'] ?? '')) !== 1) ez_api_json(['ok' => false, 'error' => 'Use a JSON request.'], 415);
    $refundBody = $refundMethod === 'POST' ? file_get_contents('php://input', false, null, 0, $refundMaximum + 1) : '';
    if (!is_string($refundBody) || strlen($refundBody) > $refundMaximum) ez_api_json(['ok' => false, 'error' => 'Refund request is too large.'], 413);
    if ($refundMethod === 'POST' && !(json_decode($refundBody) instanceof stdClass)) ez_api_json(['ok' => false, 'error' => 'Refund request is invalid.'], 422);
    $refundSessionId = session_id();
    $refundToken = (string) ($_SESSION['customer_auth']['access_token'] ?? '');
    $refundBridge = ($_SESSION['customer_auth']['source'] ?? '') === 'existing_google';
    session_write_close();
    if ($refundBridge) {
        if (preg_match('/^[A-Za-z0-9,-]{1,128}$/D', (string) ($_COOKIE['ezkart_admin'] ?? '')) !== 1) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
        session_id((string) $_COOKIE['ezkart_admin']); $_SESSION = []; $_GET = $_POST = [];
        define('EZ_CUSTOMER_SESSION_BRIDGE', true);
        require __DIR__ . '/index.php';
        if (!$authenticated || $authenticationMethod !== 'supabase' || $pendingMfa !== null || ($_SESSION['admin_user']['id'] ?? '') !== $refundCustomer['id']) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
        $refundToken = (string) ($_SESSION['supabase_access_token'] ?? '');
        session_write_close();
    }
    $refundVerified = ez_customer_verified_user($refundToken);
    if ($refundVerified['id'] !== $refundCustomer['id'] || ez_customer_needs_mfa($refundVerified, $refundToken)) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
    $refundIdentity = ez_customer_identity($refundVerified);
    if ($refundOrder !== '') ez_commerce_request('POST', '/internal/commerce/orders/' . $refundOrder . '/claim', [
        'environment' => ez_commerce_environment(), 'customer' => ['id' => $refundIdentity['id'], 'email' => $refundIdentity['email']],
    ]);
    $refundDatabase = ez_database_configuration();
    $refundHandle = curl_init($refundDatabase['url'] . $refundTarget);
    if ($refundHandle === false) throw new RuntimeException('Refund service unavailable.');
    curl_setopt_array($refundHandle, [CURLOPT_CUSTOMREQUEST => $refundMethod,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json', 'Authorization: Bearer ' . $refundToken],
        CURLOPT_POSTFIELDS => $refundMethod === 'POST' ? $refundBody : null, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 25, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_FOLLOWLOCATION => false]);
    $refundResponse = ez_refund_fetch($refundHandle); $refundRaw = $refundResponse['raw']; $refundStatus = $refundResponse['status'];
    if (!is_string($refundRaw)) throw new RuntimeException('Refund result was not confirmed.');
    session_id($refundSessionId); $_SESSION = []; ez_customer_session();
    if (($_SESSION['customer_auth']['version'] ?? '') !== $refundVersion || ($_SESSION['customer_auth']['user']['id'] ?? '') !== $refundCustomer['id']) {
        ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page to check the saved refund.', 'code' => 'customer_session_changed'], 401);
    }
    session_write_close();
    if ($refundDownload) ez_refund_send_file($refundResponse);
    $refundData = json_decode($refundRaw, true);
    if (!is_array($refundData)) throw new RuntimeException('Refund result was not confirmed.');
    if ($refundStatus < 200 || $refundStatus >= 300 || empty($refundData['ok'])) ez_api_json(['ok' => false,
        'error' => is_string($refundData['error'] ?? null) ? $refundData['error'] : 'Refund result was not confirmed.'],
        in_array($refundStatus, [400, 401, 403, 404, 409, 410, 413, 415, 422, 429], true) ? $refundStatus : 503);
    ez_api_json($refundData);
} catch (EzCommerceStorageException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], in_array($error->httpStatus, [400, 401, 403, 404, 409, 422], true) ? $error->httpStatus : 503);
} catch (InvalidArgumentException) {
    ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'Your refund could not be confirmed. Retry the same request.'], 503);
}
