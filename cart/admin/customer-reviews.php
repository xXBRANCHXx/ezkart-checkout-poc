<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/customer-auth.php';
require_once dirname(__DIR__) . '/api/commerce-client.php';

try {
    $reviewMethod = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
    if (!in_array($reviewMethod, ['GET', 'POST'], true)) ez_api_json(['ok' => false], 405);
    $reviewCustomer = ez_customer_current();
    $reviewCsrf = ez_customer_csrf();
    $reviewVersion = (string) ($_SESSION['customer_auth']['version'] ?? '');
    if ($reviewCustomer === null || $reviewVersion === '' || !hash_equals($reviewVersion, (string) ($_SERVER['HTTP_X_EZKART_CUSTOMER_SESSION'] ?? ''))) {
        ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page.', 'code' => 'customer_session_changed'], 401);
    }
    if (!ez_central_commerce_enabled()) ez_api_json(['ok' => false, 'error' => 'Reviews are not available yet.'], 503);
    if ($reviewMethod === 'POST' && (!ez_request_origin_allowed() || !hash_equals($reviewCsrf, (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? '')))) ez_api_json(['ok' => false, 'error' => 'Reload this page before saving.'], 403);
    $reviewSeen = [];
    foreach (explode('&', (string) ($_SERVER['QUERY_STRING'] ?? '')) as $part) {
        if ($part === '') continue;
        $name = urldecode(explode('=', $part, 2)[0]);
        if (isset($reviewSeen[$name]) || !in_array($name, ['order', 'review', 'cursor', 'limit', 'upload', 'photo'], true)) ez_api_json(['ok' => false, 'error' => 'Review reference is invalid.'], 400);
        $reviewSeen[$name] = true;
    }
    foreach ($_GET as $value) if (!is_string($value)) ez_api_json(['ok' => false], 400);
    $reviewOrder = $_GET['order'] ?? '';
    $reviewId = $_GET['review'] ?? '';
    $reviewPhoto = $_GET['photo'] ?? '';
    $reviewUpload = isset($_GET['upload']);
    $reviewCursor = $_GET['cursor'] ?? '';
    $reviewLimit = $_GET['limit'] ?? '20';
    if ($reviewPhoto !== '') {
        if ($reviewMethod !== 'GET' || count($reviewSeen) !== 1 || preg_match('/^rphoto_[a-f0-9]{32}$/D', $reviewPhoto) !== 1) ez_api_json(['ok' => false], 400);
        $reviewTarget = '/v1/customer/review-media/' . $reviewPhoto;
    } else {
        if (preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $reviewOrder) !== 1
            || ($reviewId !== '' && preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/D', $reviewId) !== 1)
            || ($reviewCursor !== '' && preg_match('/^[A-Za-z0-9_-]{1,1800}$/D', $reviewCursor) !== 1)
            || preg_match('/^[1-9][0-9]?$/D', $reviewLimit) !== 1 || (int) $reviewLimit > 50
            || ($reviewUpload && ($reviewMethod !== 'POST' || $_GET['upload'] !== '1' || count($reviewSeen) !== 2))
            || ($reviewId !== '' && ($reviewMethod !== 'GET' || $reviewUpload))
            || ($reviewId === '' && (isset($_GET['cursor']) || isset($_GET['limit']))) || isset($_GET['photo'])) ez_api_json(['ok' => false, 'error' => 'Review reference is invalid.'], 400);
        $reviewTarget = '/v1/customer/orders/' . $reviewOrder . ($reviewUpload ? '/review-media' : '/reviews');
        if ($reviewId !== '') $reviewTarget .= '/' . $reviewId . '/history?limit=' . $reviewLimit . ($reviewCursor !== '' ? '&cursor=' . rawurlencode($reviewCursor) : '');
    }
    $reviewMaximum = $reviewUpload ? 1401000 : 24000;
    $reviewBody = $reviewMethod === 'POST' ? file_get_contents('php://input', false, null, 0, $reviewMaximum + 1) : '';
    if (!is_string($reviewBody) || strlen($reviewBody) > $reviewMaximum) ez_api_json(['ok' => false, 'error' => 'Review request is too large.'], 413);
    if ($reviewMethod === 'POST' && !(json_decode($reviewBody) instanceof stdClass)) ez_api_json(['ok' => false, 'error' => 'Review request is invalid.'], 422);
    $reviewSessionId = session_id();
    $reviewToken = (string) ($_SESSION['customer_auth']['access_token'] ?? '');
    $reviewBridge = ($_SESSION['customer_auth']['source'] ?? '') === 'existing_google';
    session_write_close();
    if ($reviewBridge) {
        if (preg_match('/^[A-Za-z0-9,-]{1,128}$/D', (string) ($_COOKIE['ezkart_admin'] ?? '')) !== 1) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
        session_id((string) $_COOKIE['ezkart_admin']); $_SESSION = []; $_GET = $_POST = [];
        define('EZ_CUSTOMER_SESSION_BRIDGE', true);
        require __DIR__ . '/index.php';
        if (!$authenticated || $authenticationMethod !== 'supabase' || $pendingMfa !== null || ($_SESSION['admin_user']['id'] ?? '') !== $reviewCustomer['id']) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
        $reviewToken = (string) ($_SESSION['supabase_access_token'] ?? '');
        session_write_close();
    }
    $reviewVerified = ez_customer_verified_user($reviewToken);
    if ($reviewVerified['id'] !== $reviewCustomer['id'] || ez_customer_needs_mfa($reviewVerified, $reviewToken)) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
    $reviewIdentity = ez_customer_identity($reviewVerified);
    if ($reviewOrder !== '') ez_commerce_request('POST', '/internal/commerce/orders/' . $reviewOrder . '/claim', [
        'environment' => ez_commerce_environment(), 'customer' => ['id' => $reviewIdentity['id'], 'email' => $reviewIdentity['email']],
    ]);
    $reviewDatabase = ez_database_configuration();
    $reviewHandle = curl_init($reviewDatabase['url'] . $reviewTarget);
    if ($reviewHandle === false) throw new RuntimeException('Review service unavailable.');
    curl_setopt_array($reviewHandle, [CURLOPT_CUSTOMREQUEST => $reviewMethod,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json', 'Authorization: Bearer ' . $reviewToken],
        CURLOPT_POSTFIELDS => $reviewMethod === 'POST' ? $reviewBody : null, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 25, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_FOLLOWLOCATION => false]);
    $reviewRaw = curl_exec($reviewHandle);
    $reviewStatus = (int) curl_getinfo($reviewHandle, CURLINFO_HTTP_CODE);
    $reviewContentType = (string) curl_getinfo($reviewHandle, CURLINFO_CONTENT_TYPE);
    if (!is_string($reviewRaw)) throw new RuntimeException('Review result was not confirmed.');
    session_id($reviewSessionId); $_SESSION = []; ez_customer_session();
    if (($_SESSION['customer_auth']['version'] ?? '') !== $reviewVersion || ($_SESSION['customer_auth']['user']['id'] ?? '') !== $reviewCustomer['id']) {
        ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page to check the saved review.', 'code' => 'customer_session_changed'], 401);
    }
    session_write_close();
    if ($reviewPhoto !== '' && $reviewStatus === 200 && in_array($reviewContentType, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        header('Content-Type: ' . $reviewContentType); header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff');
        header("Content-Security-Policy: default-src 'none'; sandbox"); echo $reviewRaw; exit;
    }
    $reviewData = json_decode($reviewRaw, true);
    if (!is_array($reviewData)) throw new RuntimeException('Review result was not confirmed.');
    if ($reviewStatus < 200 || $reviewStatus >= 300 || empty($reviewData['ok'])) ez_api_json(['ok' => false,
        'error' => is_string($reviewData['error'] ?? null) ? $reviewData['error'] : 'Review result was not confirmed.'],
        in_array($reviewStatus, [400, 401, 403, 404, 409, 410, 413, 415, 422, 429], true) ? $reviewStatus : 503);
    ez_api_json($reviewData);
} catch (EzCommerceStorageException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], in_array($error->httpStatus, [400, 401, 403, 404, 409, 422], true) ? $error->httpStatus : 503);
} catch (InvalidArgumentException) {
    ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'Your review could not be confirmed. Retry the same request.'], 503);
}
