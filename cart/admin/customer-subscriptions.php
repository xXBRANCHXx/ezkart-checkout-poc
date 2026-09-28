<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/customer-auth.php';
require_once dirname(__DIR__) . '/api/commerce-client.php';

try {
    $subscriptionMethod = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
    if (!in_array($subscriptionMethod, ['GET', 'POST'], true)) ez_api_json(['ok' => false], 405);
    $subscriptionCustomer = ez_customer_current();
    $subscriptionCsrf = ez_customer_csrf();
    if ($subscriptionCustomer === null) ez_api_json(['ok' => false, 'error' => 'Sign in to manage subscriptions.', 'code' => 'customer_session_changed'], 401);
    $subscriptionVersion = (string) ($_SESSION['customer_auth']['version'] ?? '');
    if ($subscriptionVersion === '' || !hash_equals($subscriptionVersion, (string) ($_SERVER['HTTP_X_EZKART_CUSTOMER_SESSION'] ?? ''))) {
        ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page.', 'code' => 'customer_session_changed'], 401);
    }
    if (!ez_central_commerce_enabled()) ez_api_json(['ok' => false, 'error' => 'Subscriptions are not available yet.'], 503);
    if ($subscriptionMethod === 'POST' && (!ez_request_origin_allowed() || !hash_equals($subscriptionCsrf, (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? '')))) ez_api_json(['ok' => false, 'error' => 'Reload this page before saving.'], 403);
    $subscriptionPayload = ['action' => 'list'];
    if ($subscriptionMethod === 'GET') {
        if (array_diff(array_keys($_GET), ['cursor']) !== [] || (isset($_GET['cursor']) && !is_string($_GET['cursor']))) ez_api_json(['ok' => false], 400);
        if (isset($_GET['cursor'])) $subscriptionPayload['cursor'] = $_GET['cursor'];
    } else {
        if (($_SERVER['QUERY_STRING'] ?? '') !== '') ez_api_json(['ok' => false], 400);
        $subscriptionRaw = file_get_contents('php://input', false, null, 0, 6001);
        if (!is_string($subscriptionRaw) || strlen($subscriptionRaw) > 6000) ez_api_json(['ok' => false], 413);
        $subscriptionObject = json_decode($subscriptionRaw);
        if (!$subscriptionObject instanceof stdClass) ez_api_json(['ok' => false], 422);
        $subscriptionPayload = (array) $subscriptionObject;
        if (array_diff(array_keys($subscriptionPayload), ['action','id','confirm','sellerId','productId','variantId','termsHash','statement','consentVersion','consent','requestKey']) !== []
            || !in_array($subscriptionPayload['action'] ?? '', ['quote','enroll','cancel','detail'], true)) ez_api_json(['ok' => false], 422);
    }
    $subscriptionSessionId = session_id();
    $subscriptionToken = (string) ($_SESSION['customer_auth']['access_token'] ?? '');
    $subscriptionBridge = ($_SESSION['customer_auth']['source'] ?? '') === 'existing_google';
    session_write_close();
    if ($subscriptionBridge) {
        if (preg_match('/^[A-Za-z0-9,-]{1,128}$/D', (string) ($_COOKIE['ezkart_admin'] ?? '')) !== 1) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
        session_id((string) $_COOKIE['ezkart_admin']); $_SESSION = []; $_GET = $_POST = [];
        define('EZ_CUSTOMER_SESSION_BRIDGE', true);
        require __DIR__ . '/index.php';
        if (!$authenticated || $authenticationMethod !== 'supabase' || $pendingMfa !== null || ($_SESSION['admin_user']['id'] ?? '') !== $subscriptionCustomer['id']) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
        $subscriptionToken = (string) ($_SESSION['supabase_access_token'] ?? '');
        session_write_close();
    }
    // Revalidate the account and its current verified email before every operation.
    // The submitted address is only a subscription target, never identity proof.
    $subscriptionVerified = ez_customer_verified_user($subscriptionToken);
    if ($subscriptionVerified['id'] !== $subscriptionCustomer['id'] || ez_customer_needs_mfa($subscriptionVerified, $subscriptionToken)) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
    $subscriptionIdentity = ez_customer_identity($subscriptionVerified);
    $subscriptionPayload['customer'] = ['id' => $subscriptionIdentity['id'], 'email' => $subscriptionIdentity['email']];
    $subscriptionPayload['environment'] = ez_commerce_environment();
    $subscriptionData = ez_commerce_request('POST', '/internal/commerce/customer-subscriptions', $subscriptionPayload);
    session_id($subscriptionSessionId); $_SESSION = []; ez_customer_session();
    if (($_SESSION['customer_auth']['version'] ?? '') !== $subscriptionVersion || ($_SESSION['customer_auth']['user']['id'] ?? '') !== $subscriptionCustomer['id']) {
        ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page to check your saved subscription.', 'code' => 'customer_session_changed'], 401);
    }
    session_write_close();
    ez_api_json($subscriptionData);
} catch (EzCommerceStorageException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], in_array($error->httpStatus, [400, 401, 403, 404, 409, 413, 422, 429], true) ? $error->httpStatus : 503);
} catch (InvalidArgumentException) {
    ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'code' => 'customer_session_changed'], 401);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'Subscriptions could not be confirmed. Retry the same request.'], 503);
}
