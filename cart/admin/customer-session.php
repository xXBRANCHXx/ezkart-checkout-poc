<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/customer-auth.php';
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') ez_api_json(['ok' => false], 405);
    if (!ez_request_origin_allowed() || !ez_customer_session(false)
        || !hash_equals(ez_customer_csrf(), (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? ''))) ez_api_json(['ok' => false], 403);
    $bridgeCsrf = ez_customer_csrf();
    $bridgeCustomerSession = session_id();
    if (ez_customer_current() !== null) ez_api_json(['ok' => true, 'authenticated' => true]);
    if (!empty($_SESSION['customer_skip_existing_login']) || empty($_COOKIE['ezkart_admin'])) ez_api_json(['ok' => true, 'authenticated' => false]);
    if (preg_match('/^[A-Za-z0-9,-]{1,128}$/D', (string) $_COOKIE['ezkart_admin']) !== 1) ez_api_json(['ok' => true, 'authenticated' => false]);
    session_write_close();
    session_id((string) $_COOKIE['ezkart_admin']);
    $_SESSION = [];
    $_GET = $_POST = [];
    define('EZ_CUSTOMER_SESSION_BRIDGE', true);
    require __DIR__ . '/index.php';
    if (!$authenticated || $authenticationMethod !== 'supabase' || $pendingMfa !== null) ez_api_json(['ok' => true, 'authenticated' => false]);
    $token = (string) ($_SESSION['supabase_access_token'] ?? '');
    $user = ez_customer_verified_user($token);
    if ($user['id'] !== ($_SESSION['admin_user']['id'] ?? '') || ez_customer_needs_mfa($user, $token)) ez_api_json(['ok' => true, 'authenticated' => false]);
    ez_customer_save_profile(ez_customer_identity($user));
    $bridgeIdentity = [
        'source' => 'existing_google',
        'user' => ez_customer_identity($user),
        'expires_at' => min(time() + 600, (int) $_SESSION['authenticated_until']),
        'signed_in_at' => (int) $_SESSION['signed_in_at'],
        'version' => bin2hex(random_bytes(16)),
    ];
    session_write_close();
    session_id($bridgeCustomerSession);
    $_SESSION = [];
    ez_customer_session();
    // A concurrent explicit logout or account switch takes precedence over the bridge.
    if (!hash_equals(ez_customer_csrf(), $bridgeCsrf) || !empty($_SESSION['customer_skip_existing_login'])) ez_api_json(['ok' => true, 'authenticated' => false]);
    if (ez_customer_current() === null) {
        session_regenerate_id(true);
        $_SESSION['customer_auth'] = $bridgeIdentity;
        $_SESSION['customer_csrf'] = bin2hex(random_bytes(24));
    }
    ez_api_json(['ok' => true, 'authenticated' => true]);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'Your existing sign-in could not be checked. You can sign in with Google below.'], 503);
}
