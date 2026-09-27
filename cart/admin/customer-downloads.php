<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/customer-auth.php';
require_once dirname(__DIR__) . '/api/commerce-client.php';

header("Content-Security-Policy: default-src 'none'; sandbox");
header("X-Ezkart-Content-Security-Policy: default-src 'none'; sandbox");
header('Referrer-Policy: no-referrer');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
try {
    $downloadMethod = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
    if (!in_array($downloadMethod, ['GET', 'POST'], true)) ez_api_json(['ok' => false], 405);
    $downloadCustomer = ez_customer_current();
    $downloadCsrf = ez_customer_csrf();
    $downloadVersion = (string) ($_SESSION['customer_auth']['version'] ?? '');
    if ($downloadCustomer === null || $downloadVersion === '' || !hash_equals($downloadVersion, (string) ($_SERVER['HTTP_X_EZKART_CUSTOMER_SESSION'] ?? ''))) {
        ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page.', 'code' => 'customer_session_changed'], 401);
    }
    if (!ez_central_commerce_enabled()) ez_api_json(['ok' => false, 'error' => 'Downloads are not available for this checkout yet.'], 503);
    if ($downloadMethod === 'POST' && (!ez_request_origin_allowed() || !hash_equals($downloadCsrf, (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? '')))) ez_api_json(['ok' => false, 'error' => 'Reload this page before continuing.'], 403);
    $downloadSeen = [];
    foreach (explode('&', (string) ($_SERVER['QUERY_STRING'] ?? '')) as $piece) {
        if ($piece === '') continue;
        $name = urldecode(explode('=', $piece, 2)[0]);
        if (isset($downloadSeen[$name]) || !in_array($name, ['order', 'item', 'grant', 'part', 'receipt'], true)) ez_api_json(['ok' => false, 'error' => 'Download reference is invalid.'], 400);
        $downloadSeen[$name] = true;
    }
    foreach ($_GET as $value) if (!is_string($value)) ez_api_json(['ok' => false], 400);
    $downloadOrder = $_GET['order'] ?? '';
    $downloadItem = $_GET['item'] ?? '';
    $downloadGrant = $_GET['grant'] ?? '';
    $downloadPart = $_GET['part'] ?? '';
    $downloadReceipt = $_GET['receipt'] ?? '';
    if (preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $downloadOrder) !== 1
        || ($downloadItem !== '' && preg_match('/^item_[A-Za-z0-9-]{3,90}$/D', $downloadItem) !== 1)
        || ($downloadGrant !== '' && preg_match('/^dgrant_[a-f0-9]{32}$/D', $downloadGrant) !== 1)
        || ($downloadPart !== '' && (preg_match('/^[1-9][0-9]{0,2}$/D', $downloadPart) !== 1 || (int) $downloadPart > 100))
        || ($downloadReceipt !== '' && $downloadReceipt !== '1') || isset($_SERVER['HTTP_RANGE'])
        || ($downloadGrant !== '' && $downloadItem === '') || ($downloadPart !== '' && $downloadGrant === '')
        || ($downloadReceipt !== '' && $downloadPart === '')
        || ($downloadMethod === 'POST' && !($downloadItem !== '' && $downloadGrant === '' || $downloadReceipt === '1'))
        || ($downloadMethod === 'GET' && ($downloadReceipt !== '' || $downloadItem !== '' && $downloadGrant === ''))
        || count($downloadSeen) !== 1 + (int) ($downloadItem !== '') + (int) ($downloadGrant !== '') + (int) ($downloadPart !== '') + (int) ($downloadReceipt !== '')) {
        ez_api_json(['ok' => false, 'error' => 'Download reference is invalid.'], 400);
    }
    $downloadTarget = '/v1/customer/orders/' . $downloadOrder . '/downloads';
    if ($downloadItem !== '') $downloadTarget .= '/' . $downloadItem . '/grants';
    if ($downloadGrant !== '') $downloadTarget .= '/' . $downloadGrant;
    if ($downloadPart !== '') $downloadTarget .= '/parts/' . $downloadPart;
    if ($downloadReceipt !== '') $downloadTarget .= '/receipt';
    $downloadBinary = $downloadMethod === 'GET' && $downloadPart !== '';
    $downloadBody = $downloadMethod === 'POST' ? file_get_contents('php://input', false, null, 0, 2001) : '';
    if (!is_string($downloadBody) || strlen($downloadBody) > 2000) ez_api_json(['ok' => false, 'error' => 'Download request is too large.'], 413);
    if ($downloadMethod === 'POST' && !(json_decode($downloadBody) instanceof stdClass)) ez_api_json(['ok' => false, 'error' => 'Download request is invalid.'], 422);
    $downloadSessionId = session_id();
    $downloadToken = (string) ($_SESSION['customer_auth']['access_token'] ?? '');
    $downloadBridge = ($_SESSION['customer_auth']['source'] ?? '') === 'existing_google';
    session_write_close();
    if ($downloadBridge) {
        if (preg_match('/^[A-Za-z0-9,-]{1,128}$/D', (string) ($_COOKIE['ezkart_admin'] ?? '')) !== 1) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
        session_id((string) $_COOKIE['ezkart_admin']); $_SESSION = []; $_GET = $_POST = [];
        define('EZ_CUSTOMER_SESSION_BRIDGE', true);
        require __DIR__ . '/index.php';
        if (!$authenticated || $authenticationMethod !== 'supabase' || $pendingMfa !== null || ($_SESSION['admin_user']['id'] ?? '') !== $downloadCustomer['id']) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
        $downloadToken = (string) ($_SESSION['supabase_access_token'] ?? '');
        session_write_close();
    }
    $downloadVerified = ez_customer_verified_user($downloadToken);
    if ($downloadVerified['id'] !== $downloadCustomer['id'] || ez_customer_needs_mfa($downloadVerified, $downloadToken)) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
    $downloadIdentity = ez_customer_identity($downloadVerified);
    ez_commerce_request('POST', '/internal/commerce/orders/' . $downloadOrder . '/claim', [
        'environment' => ez_commerce_environment(), 'customer' => ['id' => $downloadIdentity['id'], 'email' => $downloadIdentity['email']],
    ]);
    $downloadDatabase = ez_database_configuration();
    $downloadHandle = curl_init($downloadDatabase['url'] . $downloadTarget);
    if ($downloadHandle === false) throw new RuntimeException('Download service unavailable.');
    $downloadRaw = ''; $downloadHeaders = [];
    curl_setopt_array($downloadHandle, [CURLOPT_CUSTOMREQUEST => $downloadMethod,
        CURLOPT_HTTPHEADER => ['Accept: application/json, application/octet-stream', 'Content-Type: application/json', 'Authorization: Bearer ' . $downloadToken],
        CURLOPT_POSTFIELDS => $downloadMethod === 'POST' ? $downloadBody : null, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 90, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$downloadRaw, $downloadBinary): int {
            if (strlen($downloadRaw) + strlen($chunk) > ($downloadBinary ? 5242880 : 64000)) return 0;
            $downloadRaw .= $chunk; return strlen($chunk);
        },
        CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$downloadHeaders): int {
            if (str_starts_with($line, 'HTTP/')) $downloadHeaders = [];
            $pair = explode(':', $line, 2);
            if (count($pair) === 2) $downloadHeaders[strtolower(trim($pair[0]))] = trim($pair[1]);
            return strlen($line);
        }]);
    $downloadResult = curl_exec($downloadHandle);
    $downloadStatus = (int) curl_getinfo($downloadHandle, CURLINFO_HTTP_CODE);
    $downloadContentType = (string) curl_getinfo($downloadHandle, CURLINFO_CONTENT_TYPE);
    if ($downloadResult === false) throw new RuntimeException('Download response interrupted.');
    session_id($downloadSessionId); $_SESSION = []; ez_customer_session();
    if (($_SESSION['customer_auth']['version'] ?? '') !== $downloadVersion || ($_SESSION['customer_auth']['user']['id'] ?? '') !== $downloadCustomer['id']) {
        ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page.', 'code' => 'customer_session_changed'], 401);
    }
    session_write_close();
    if ($downloadBinary && $downloadStatus === 200 && $downloadContentType === 'application/octet-stream') {
        if (($downloadHeaders['x-ezkart-file-part'] ?? '') !== $downloadPart
            || preg_match('/^[a-f0-9]{64}$/D', $downloadHeaders['x-ezkart-file-challenge'] ?? '') !== 1
            || preg_match('/^[a-f0-9]{64}$/D', $downloadHeaders['x-ezkart-file-sha256'] ?? '') !== 1
            || !hash_equals($downloadHeaders['x-ezkart-file-sha256'], hash('sha256', $downloadRaw))) throw new RuntimeException('File part could not be verified.');
        header('Content-Type: application/octet-stream'); header('Content-Length: ' . strlen($downloadRaw));
        foreach (['x-ezkart-file-part', 'x-ezkart-file-challenge', 'x-ezkart-file-sha256'] as $name) header($name . ': ' . $downloadHeaders[$name]);
        echo $downloadRaw; exit;
    }
    $downloadData = json_decode($downloadRaw, true);
    if (!is_array($downloadData)) throw new RuntimeException('Download result could not be confirmed.');
    if ($downloadStatus !== 200 || empty($downloadData['ok'])) ez_api_json(['ok' => false,
        'error' => is_string($downloadData['error'] ?? null) ? $downloadData['error'] : 'Download result could not be confirmed.'],
        in_array($downloadStatus, [400, 401, 403, 404, 409, 410, 413, 422, 429], true) ? $downloadStatus : 503);
    ez_api_json($downloadData);
} catch (EzCommerceStorageException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], in_array($error->httpStatus, [400, 401, 403, 404, 409, 413, 422, 429], true) ? $error->httpStatus : 503);
} catch (InvalidArgumentException) {
    ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'The download was interrupted. Resume to check the same request.'], 503);
}
