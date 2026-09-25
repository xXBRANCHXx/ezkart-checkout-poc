<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/customer-auth.php';
require_once dirname(__DIR__) . '/api/commerce-client.php';

try {
    $returnMethod = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
    if (!in_array($returnMethod, ['GET', 'POST'], true)) ez_api_json(['ok' => false], 405);
    $returnCustomer = ez_customer_current();
    $returnCsrf = ez_customer_csrf();
    if ($returnCustomer === null) ez_api_json(['ok' => false, 'error' => 'Sign in to view your returns.'], 401);
    if (!ez_central_commerce_enabled()) ez_api_json(['ok' => false, 'error' => 'Returns are not available yet.'], 503);
    if ($returnMethod === 'POST' && (!ez_request_origin_allowed() || !hash_equals($returnCsrf, (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? '')))) ez_api_json(['ok' => false, 'error' => 'Reload this page before submitting.'], 403);
    $returnOrderId = $_GET['order'] ?? '';
    $returnCaseId = $_GET['return'] ?? '';
    $returnCursor = $_GET['cursor'] ?? '';
    $returnBefore = $_GET['before'] ?? '';
    if (!is_string($returnOrderId) || preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $returnOrderId) !== 1
        || !is_string($returnCaseId) || ($returnCaseId !== '' && preg_match('/^ret_[a-f0-9]{32}$/D', $returnCaseId) !== 1)
        || !is_string($returnCursor) || strlen($returnCursor) > 150 || preg_match('/[\x00-\x1f]/', $returnCursor)
        || !is_string($returnBefore) || ($returnBefore !== '' && preg_match('/^[1-9][0-9]{0,14}$/D', $returnBefore) !== 1)
        || ($returnMethod !== 'GET' && ($returnCursor !== '' || $returnBefore !== ''))
        || ($returnBefore !== '' && ($returnCaseId === '' || $returnCursor !== ''))) ez_api_json(['ok' => false, 'error' => 'Return reference is invalid.'], 400);
    $returnTarget = '/v1/customer/orders/' . $returnOrderId . '/returns' . ($returnCaseId !== '' ? '/' . $returnCaseId : '') . ($returnCursor !== '' ? '?cursor=' . rawurlencode($returnCursor) : ($returnBefore !== '' ? '?before=' . rawurlencode($returnBefore) : ''));
    $returnBody = $returnMethod === 'POST' ? file_get_contents('php://input', false, null, 0, 16001) : '';
    if (!is_string($returnBody) || strlen($returnBody) > 16000) ez_api_json(['ok' => false, 'error' => 'Return request is too large.'], 413);
    $returnSessionId = session_id();
    $returnVersion = $_SESSION['customer_auth']['version'];
    $returnToken = (string) ($_SESSION['customer_auth']['access_token'] ?? '');
    $returnBridge = ($_SESSION['customer_auth']['source'] ?? '') === 'existing_google';
    session_write_close();
    if ($returnBridge) {
        // Receive both scoped cookies here. A borrowed login never copies tokens.
        if (preg_match('/^[A-Za-z0-9,-]{1,128}$/D', (string) ($_COOKIE['ezkart_admin'] ?? '')) !== 1) ez_api_json(['ok' => false, 'error' => 'Please sign in again.'], 401);
        session_id((string) $_COOKIE['ezkart_admin']); $_SESSION = []; $_GET = $_POST = [];
        define('EZ_CUSTOMER_SESSION_BRIDGE', true);
        require __DIR__ . '/index.php';
        if (!$authenticated || $authenticationMethod !== 'supabase' || $pendingMfa !== null || ($_SESSION['admin_user']['id'] ?? '') !== $returnCustomer['id']) ez_api_json(['ok' => false, 'error' => 'Please sign in again.'], 401);
        $returnToken = (string) ($_SESSION['supabase_access_token'] ?? '');
        $returnVerified = ez_customer_verified_user($returnToken);
        if ($returnVerified['id'] !== $returnCustomer['id'] || ez_customer_needs_mfa($returnVerified, $returnToken)) ez_api_json(['ok' => false, 'error' => 'Please sign in again.'], 401);
        session_write_close();
    }
    if ($returnToken === '') ez_api_json(['ok' => false, 'error' => 'Please sign in again.'], 401);
    // Only a server-verified identity may claim an unbound guest checkout.
    // Customer email or account IDs supplied in the request are never used.
    ez_commerce_request('POST', '/internal/commerce/orders/' . $returnOrderId . '/claim', [
        'environment' => ez_commerce_environment(), 'customer' => ['id' => $returnCustomer['id'], 'email' => $returnCustomer['email']],
    ]);
    $returnDatabase = ez_database_configuration();
    $returnHandle = curl_init($returnDatabase['url'] . $returnTarget);
    if ($returnHandle === false) throw new RuntimeException('Return request unavailable.');
    $returnOptions = [CURLOPT_HTTPHEADER => ['Accept: application/json', 'Authorization: Bearer ' . $returnToken],
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_FOLLOWLOCATION => false];
    if ($returnMethod === 'POST') { $returnOptions[CURLOPT_POST] = true; $returnOptions[CURLOPT_POSTFIELDS] = $returnBody; $returnOptions[CURLOPT_HTTPHEADER][] = 'Content-Type: application/json'; }
    curl_setopt_array($returnHandle, $returnOptions);
    $returnRaw = curl_exec($returnHandle); $returnStatus = (int) curl_getinfo($returnHandle, CURLINFO_HTTP_CODE);
    $returnData = is_string($returnRaw) ? json_decode($returnRaw, true) : null;
    if (!is_array($returnData)) throw new RuntimeException('Return result was not confirmed.');
    // A response from an earlier login must not be shown after an account change.
    session_id($returnSessionId); $_SESSION = []; ez_customer_session();
    if (($_SESSION['customer_auth']['version'] ?? '') !== $returnVersion || ($_SESSION['customer_auth']['user']['id'] ?? '') !== $returnCustomer['id']) ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Sign back in and confirm the same return request.'], $returnMethod === 'POST' ? 503 : 401);
    session_write_close();
    if ($returnStatus < 200 || $returnStatus >= 300 || empty($returnData['ok'])) ez_api_json(['ok' => false,
        'error' => is_string($returnData['error'] ?? null) ? $returnData['error'] : 'The return could not be confirmed.',
        'code' => is_string($returnData['code'] ?? null) ? $returnData['code'] : ''], in_array($returnStatus, [400, 401, 403, 404, 409, 413, 422], true) ? $returnStatus : 503);
    ez_api_json($returnData + ['csrf' => $returnCsrf]);
} catch (EzCommerceStorageException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], in_array($error->httpStatus, [401, 403, 404, 409, 422], true) ? $error->httpStatus : 503);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'Your return could not be confirmed. Please retry the same request.'], 503);
}
