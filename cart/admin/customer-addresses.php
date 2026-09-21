<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/customer-auth.php';
require_once dirname(__DIR__) . '/api/database.php';
require_once dirname(__DIR__) . '/api/address-location.php';

try {
    $method = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
    if (!in_array($method, ['GET', 'POST'], true)) ez_api_json(['ok' => false], 405);
    $customer = ez_customer_current();
    $csrf = ez_customer_csrf();
    if ($customer === null && isset($_COOKIE['ezkart_customer']) && session_id() !== $_COOKIE['ezkart_customer']) header_remove('Set-Cookie');
    if ($customer === null) {
        if ($method !== 'GET') ez_api_json(['ok' => false, 'error' => 'Sign in to save addresses.'], 401);
        ez_api_json(['ok' => true, 'authenticated' => false, 'csrf' => $csrf, 'check_existing' => empty($_SESSION['customer_skip_existing_login'])]);
    }
    if ($method === 'POST' && (!ez_request_origin_allowed() || !hash_equals($csrf, (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? '')))) ez_api_json(['ok' => false], 403);
    $body = $method === 'POST' ? file_get_contents('php://input', false, null, 0, 6001) : '';
    if (!is_string($body) || strlen($body) > 6000) ez_api_json(['ok' => false, 'error' => 'Address request is too large.'], 413);
    if ($method === 'POST') {
        $payload = json_decode($body, true);
        if (($payload['action'] ?? '') === 'save' && is_array($payload['address'] ?? null)) {
            // Keep pasted GPS coordinates in their own field, including older saved addresses.
            if (ez_delivery_coordinate($payload['address']['coordinate'] ?? null) === null) ez_address_location((string) ($payload['address']['address'] ?? ''));
            $payload['address'] = ez_address_with_location($payload['address']);
            $body = json_encode($payload, JSON_THROW_ON_ERROR);
        }
    }
    $customerSessionId = session_id();
    $customerVersion = $_SESSION['customer_auth']['version'];
    $token = (string) ($_SESSION['customer_auth']['access_token'] ?? '');
    $bridge = ($_SESSION['customer_auth']['source'] ?? '') === 'existing_google';
    session_write_close();
    if ($bridge) {
        // This path receives both scoped cookies; use the original token only in memory.
        if (preg_match('/^[A-Za-z0-9,-]{1,128}$/D', (string) ($_COOKIE['ezkart_admin'] ?? '')) !== 1) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'csrf' => $csrf], 401);
        session_id((string) $_COOKIE['ezkart_admin']); $_SESSION = []; $_GET = $_POST = [];
        define('EZ_CUSTOMER_SESSION_BRIDGE', true);
        require __DIR__ . '/index.php';
        if (!$authenticated || $authenticationMethod !== 'supabase' || $pendingMfa !== null || ($_SESSION['admin_user']['id'] ?? '') !== $customer['id']) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'csrf' => $csrf], 401);
        $token = (string) ($_SESSION['supabase_access_token'] ?? '');
        $verified = ez_customer_verified_user($token);
        if ($verified['id'] !== $customer['id'] || ez_customer_needs_mfa($verified, $token)) ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'csrf' => $csrf], 401);
        session_write_close();
    }
    if ($token === '') ez_api_json(['ok' => false, 'error' => 'Please sign in again.', 'csrf' => $csrf], 401);
    $database = ez_database_configuration();
    $handle = curl_init($database['url'] . '/v1/customer/addresses');
    $headers = ['Accept: application/json', 'Authorization: Bearer ' . $token];
    $options = [CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 12, CURLOPT_SSL_VERIFYPEER => true];
    if ($method === 'POST') { $options[CURLOPT_POST] = true; $options[CURLOPT_POSTFIELDS] = $body; $options[CURLOPT_HTTPHEADER][] = 'Content-Type: application/json'; }
    curl_setopt_array($handle, $options);
    $raw = curl_exec($handle); $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    $data = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($data)) throw new RuntimeException('Saved addresses unavailable.');
    if ($status < 200 || $status >= 300 || empty($data['ok'])) ez_api_json(['ok' => false, 'error' => is_string($data['error'] ?? null) ? $data['error'] : 'Saved addresses are unavailable.', 'csrf' => $csrf], in_array($status, [401, 403, 404, 409, 422], true) ? $status : 503);
    $data['book']['addresses'] = array_map('ez_address_with_location', $data['book']['addresses']);
    // Register saved map positions as temporary, customer-owned sandbox previews.
    session_id($customerSessionId); $_SESSION = []; ez_customer_session();
    if (($_SESSION['customer_auth']['version'] ?? '') !== $customerVersion || ($_SESSION['customer_auth']['user']['id'] ?? '') !== $customer['id']) ez_api_json(['ok' => false, 'error' => 'Your sign-in changed. Reload this page.', 'csrf' => $csrf], 401);
    if ($database['environment'] === 'test' && ez_commerce_environment() === 'sandbox') {
        $places = array_filter($_SESSION['tracking_preview_places'] ?? [], static fn(array $place): bool => ($place['until'] ?? 0) > time());
        foreach ($data['book']['addresses'] as &$address) {
            if (($coordinate = ez_tracking_coordinate($address['coordinate'] ?? null)) === null) continue;
            $id = 'saved-' . $address['id'];
            $places[$id] = ['coordinate' => $coordinate, 'owner' => $customer['id'], 'until' => time() + 3600];
            $address['preview_id'] = $id;
        }
        unset($address);
        $_SESSION['tracking_preview_places'] = array_slice($places, -30, null, true);
    }
    session_write_close();
    ez_api_json(['ok' => true, 'authenticated' => true, 'email' => $customer['email'], 'csrf' => $csrf, 'book' => $data['book']]);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'Saved addresses are temporarily unavailable. You can still enter an address.'], 503);
}
