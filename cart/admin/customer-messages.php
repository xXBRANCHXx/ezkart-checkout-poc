<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/customer-auth.php';
require_once dirname(__DIR__) . '/api/commerce-client.php';

try {
    $messageMethod = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
    if (!in_array($messageMethod, ['GET', 'POST'], true)) ez_api_json(['ok' => false], 405);
    $messageCustomer = ez_customer_current();
    $messageCsrf = ez_customer_csrf();
    $messageVersion = (string) ($_SESSION['customer_auth']['version'] ?? '');
    if ($messageCustomer === null || $messageVersion === '' || !hash_equals($messageVersion, (string) ($_SERVER['HTTP_X_EZKART_CUSTOMER_SESSION'] ?? ''))) {
        ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page.', 'code' => 'customer_session_changed'], 401);
    }
    if (!ez_central_commerce_enabled()) ez_api_json(['ok' => false, 'error' => 'Messages are not available yet.'], 503);
    if ($messageMethod === 'POST' && (!ez_request_origin_allowed() || !hash_equals($messageCsrf, (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? '')))) ez_api_json(['ok' => false, 'error' => 'Reload this page before saving.'], 403);
    require_once dirname(__DIR__) . '/api/message-query.php';
    if (count($_GET) !== 1 || !is_string($_GET['path'] ?? null) || count(explode('&', (string) ($_SERVER['QUERY_STRING'] ?? ''))) !== 1) ez_api_json(['ok' => false, 'error' => 'Message reference is invalid.'], 400);
    try { $messageRoute = ez_message_target($_GET['path'], $messageMethod, false); }
    catch (InvalidArgumentException $error) { ez_api_json(['ok' => false, 'error' => $error->getMessage()], 400); }
    $messageTarget = '/v1/customer/messages' . $messageRoute['path'];
    $messagePhoto = $messageRoute['photo'] ? 'photo' : '';
    $messageUpload = $messageRoute['upload'];
    $messageMaximum = $messageUpload ? 1401000 : 24000;
    $messageBody = $messageMethod === 'POST' ? file_get_contents('php://input', false, null, 0, $messageMaximum + 1) : '';
    if (!is_string($messageBody) || strlen($messageBody) > $messageMaximum) ez_api_json(['ok' => false, 'error' => 'Message request is too large.'], 413);
    if ($messageMethod === 'POST' && !(json_decode($messageBody) instanceof stdClass)) ez_api_json(['ok' => false, 'error' => 'Message request is invalid.'], 422);
    $messageInput = $messageMethod === 'POST' ? json_decode($messageBody, true) : [];
    $messageOrder = is_array($messageInput['context'] ?? null) && ($messageInput['context']['kind'] ?? '') === 'order' ? ($messageInput['context']['id'] ?? '') : '';
    if (!is_string($messageOrder) || ($messageOrder !== '' && preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $messageOrder) !== 1)) ez_api_json(['ok' => false, 'error' => 'Order reference is invalid.'], 400);
    $messageSessionId = session_id();
    $messageToken = (string) ($_SESSION['customer_auth']['access_token'] ?? '');
    $messageBridge = ($_SESSION['customer_auth']['source'] ?? '') === 'existing_google';
    session_write_close();
    if ($messageBridge) {
        if (preg_match('/^[A-Za-z0-9,-]{1,128}$/D', (string) ($_COOKIE['ezkart_admin'] ?? '')) !== 1) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
        session_id((string) $_COOKIE['ezkart_admin']); $_SESSION = []; $_GET = $_POST = [];
        define('EZ_CUSTOMER_SESSION_BRIDGE', true);
        require __DIR__ . '/index.php';
        if (!$authenticated || $authenticationMethod !== 'supabase' || $pendingMfa !== null || ($_SESSION['admin_user']['id'] ?? '') !== $messageCustomer['id']) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
        $messageToken = (string) ($_SESSION['supabase_access_token'] ?? '');
        session_write_close();
    }
    $messageVerified = ez_customer_verified_user($messageToken);
    if ($messageVerified['id'] !== $messageCustomer['id'] || ez_customer_needs_mfa($messageVerified, $messageToken)) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
    $messageIdentity = ez_customer_identity($messageVerified);
    if ($messageOrder !== '') ez_commerce_request('POST', '/internal/commerce/orders/' . $messageOrder . '/claim', [
        'environment' => ez_commerce_environment(), 'customer' => ['id' => $messageIdentity['id'], 'email' => $messageIdentity['email']],
    ]);
    $messageDatabase = ez_database_configuration();
    $messageHandle = curl_init($messageDatabase['url'] . $messageTarget);
    if ($messageHandle === false) throw new RuntimeException('Message service unavailable.');
    curl_setopt_array($messageHandle, [CURLOPT_CUSTOMREQUEST => $messageMethod,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json', 'Authorization: Bearer ' . $messageToken],
        CURLOPT_POSTFIELDS => $messageMethod === 'POST' ? $messageBody : null, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 25, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_FOLLOWLOCATION => false]);
    $messageRaw = curl_exec($messageHandle);
    $messageStatus = (int) curl_getinfo($messageHandle, CURLINFO_HTTP_CODE);
    $messageContentType = (string) curl_getinfo($messageHandle, CURLINFO_CONTENT_TYPE);
    if (!is_string($messageRaw)) throw new RuntimeException('Message result was not confirmed.');
    session_id($messageSessionId); $_SESSION = []; ez_customer_session();
    if (($_SESSION['customer_auth']['version'] ?? '') !== $messageVersion || ($_SESSION['customer_auth']['user']['id'] ?? '') !== $messageCustomer['id']) {
        ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page to check the saved message.', 'code' => 'customer_session_changed'], 401);
    }
    session_write_close();
    if ($messagePhoto !== '' && $messageStatus === 200 && in_array($messageContentType, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        header('Content-Type: ' . $messageContentType); header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff');
        header("Content-Security-Policy: default-src 'none'; sandbox"); echo $messageRaw; exit;
    }
    $messageData = json_decode($messageRaw, true);
    if (!is_array($messageData)) throw new RuntimeException('Message result was not confirmed.');
    if ($messageStatus < 200 || $messageStatus >= 300 || empty($messageData['ok'])) ez_api_json(['ok' => false,
        'error' => is_string($messageData['error'] ?? null) ? $messageData['error'] : 'Message result was not confirmed.'],
        in_array($messageStatus, [400, 401, 403, 404, 409, 410, 413, 415, 422, 429], true) ? $messageStatus : 503);
    ez_api_json($messageData);
} catch (EzCommerceStorageException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], in_array($error->httpStatus, [400, 401, 403, 404, 409, 422], true) ? $error->httpStatus : 503);
} catch (InvalidArgumentException) {
    ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'Your message could not be confirmed. Retry the same request.'], 503);
}
