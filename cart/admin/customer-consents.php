<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/customer-auth.php';
require_once dirname(__DIR__) . '/api/commerce-client.php';

try {
    $consentMethod = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
    if (!in_array($consentMethod, ['GET', 'POST'], true)) ez_api_json(['ok' => false], 405);
    $consentCustomer = ez_customer_current();
    $consentCsrf = ez_customer_csrf();
    if ($consentCustomer === null) ez_api_json(['ok' => false, 'error' => 'Sign in to manage email preferences.', 'code' => 'customer_session_changed'], 401);
    $consentVersion = (string) ($_SESSION['customer_auth']['version'] ?? '');
    if ($consentVersion === '' || !hash_equals($consentVersion, (string) ($_SERVER['HTTP_X_EZKART_CUSTOMER_SESSION'] ?? ''))) {
        ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page.', 'code' => 'customer_session_changed'], 401);
    }
    if (!ez_central_commerce_enabled()) ez_api_json(['ok' => false, 'error' => 'Email preferences are not available yet.'], 503);
    if ($consentMethod === 'POST' && (!ez_request_origin_allowed() || !hash_equals($consentCsrf, (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? '')))) ez_api_json(['ok' => false, 'error' => 'Reload this page before saving.'], 403);
    $consentPayload = ['action' => 'list'];
    if ($consentMethod === 'GET') {
        $seen = [];
        foreach (explode('&', (string) ($_SERVER['QUERY_STRING'] ?? '')) as $part) {
            if ($part === '') continue;
            $key = urldecode(explode('=', $part, 2)[0]);
            if (isset($seen[$key]) || !in_array($key, ['action', 'order', 'seller', 'email', 'cursor'], true)) ez_api_json(['ok' => false, 'error' => 'Preference page is invalid.'], 400);
            $seen[$key] = true;
        }
        foreach ($_GET as $value) if (!is_string($value)) ez_api_json(['ok' => false], 400);
        $consentAction = $_GET['action'] ?? 'list';
        if (!in_array($consentAction, ['list', 'history'], true)
            || ($consentAction === 'list' && (isset($_GET['seller']) || isset($_GET['email'])))
            || ($consentAction === 'history' && (isset($_GET['order']) || !isset($_GET['seller'], $_GET['email'])))) ez_api_json(['ok' => false, 'error' => 'Preference page is invalid.'], 400);
        $consentPayload['action'] = $consentAction;
        foreach (['order' => 'orderId', 'seller' => 'sellerId', 'email' => 'email', 'cursor' => 'cursor'] as $query => $field) {
            if (isset($_GET[$query])) $consentPayload[$field] = $_GET[$query];
        }
        if (isset($consentPayload['orderId']) && preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $consentPayload['orderId']) !== 1) ez_api_json(['ok' => false, 'error' => 'Order reference is invalid.'], 400);
        if (strlen($consentPayload['cursor'] ?? '') > 1800) ez_api_json(['ok' => false], 400);
    } else {
        if (($_SERVER['QUERY_STRING'] ?? '') !== '') ez_api_json(['ok' => false], 400);
        $consentRaw = file_get_contents('php://input', false, null, 0, 4001);
        if (!is_string($consentRaw) || strlen($consentRaw) > 4000) ez_api_json(['ok' => false], 413);
        $consentObject = json_decode($consentRaw);
        if (!$consentObject instanceof stdClass) ez_api_json(['ok' => false], 422);
        $consentPayload = (array) $consentObject;
        if (array_diff(array_keys($consentPayload), ['sellerId', 'email', 'revision', 'requestKey', 'allow', 'policyVersion', 'statement']) !== []) ez_api_json(['ok' => false, 'error' => 'Preference choice is invalid.'], 422);
        $consentPayload['action'] = 'save';
    }
    $consentSessionId = session_id();
    $consentToken = (string) ($_SESSION['customer_auth']['access_token'] ?? '');
    $consentBridge = ($_SESSION['customer_auth']['source'] ?? '') === 'existing_google';
    session_write_close();
    if ($consentBridge) {
        if (preg_match('/^[A-Za-z0-9,-]{1,128}$/D', (string) ($_COOKIE['ezkart_admin'] ?? '')) !== 1) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
        session_id((string) $_COOKIE['ezkart_admin']); $_SESSION = []; $_GET = $_POST = [];
        define('EZ_CUSTOMER_SESSION_BRIDGE', true);
        require __DIR__ . '/index.php';
        if (!$authenticated || $authenticationMethod !== 'supabase' || $pendingMfa !== null || ($_SESSION['admin_user']['id'] ?? '') !== $consentCustomer['id']) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
        $consentToken = (string) ($_SESSION['supabase_access_token'] ?? '');
        session_write_close();
    }
    // Revalidate the account and its current verified email before every operation.
    // The submitted address is only a preference target, never identity proof.
    $consentVerified = ez_customer_verified_user($consentToken);
    if ($consentVerified['id'] !== $consentCustomer['id'] || ez_customer_needs_mfa($consentVerified, $consentToken)) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
    $consentIdentity = ez_customer_identity($consentVerified);
    $consentPayload['customer'] = ['id' => $consentIdentity['id'], 'email' => $consentIdentity['email']];
    $consentPayload['environment'] = ez_commerce_environment();
    $consentData = ez_commerce_request('POST', '/internal/commerce/customer-consents', $consentPayload);
    session_id($consentSessionId); $_SESSION = []; ez_customer_session();
    if (($_SESSION['customer_auth']['version'] ?? '') !== $consentVersion || ($_SESSION['customer_auth']['user']['id'] ?? '') !== $consentCustomer['id']) {
        ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page to check your saved preference.', 'code' => 'customer_session_changed'], 401);
    }
    session_write_close();
    ez_api_json($consentData);
} catch (EzCommerceStorageException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], in_array($error->httpStatus, [400, 401, 403, 404, 409, 413, 422, 429], true) ? $error->httpStatus : 503);
} catch (InvalidArgumentException) {
    ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'Email preferences could not be confirmed. Retry the same request.'], 503);
}
