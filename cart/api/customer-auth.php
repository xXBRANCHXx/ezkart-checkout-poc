<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

const EZ_CUSTOMER_SESSION_LIFETIME = 2592000;

function ez_customer_session(bool $create = true): bool
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        if (session_name() !== 'ezkart_customer') throw new RuntimeException('Unexpected session context.');
        return true;
    }
    if (!$create && empty($_COOKIE['ezkart_customer'])) return false;
    $environment = ez_config('deployment_environment') === 'production' ? 'production' : 'test';
    $root = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    $directory = ez_config('customer_session_storage') ?: (($root !== '' ? dirname($root) : sys_get_temp_dir()) . '/ezkart-customer-sessions-' . $environment);
    if (!str_starts_with($directory, '/') || str_contains($directory, "\0")
        || (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory))) throw new RuntimeException('Customer sign-in is unavailable.');
    $resolved = realpath($directory);
    $publicRoot = $root !== '' ? realpath($root) : false;
    if ($resolved === false || !is_writable($resolved) || ($publicRoot !== false && ($resolved === $publicRoot || str_starts_with($resolved . '/', $publicRoot . '/')))) {
        throw new RuntimeException('Customer session storage must be private.');
    }
    @chmod($resolved, 0700);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) EZ_CUSTOMER_SESSION_LIFETIME);
    session_save_path($resolved);
    session_name('ezkart_customer');
    session_set_cookie_params([
        'lifetime' => EZ_CUSTOMER_SESSION_LIFETIME, 'path' => '/cart',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0])) === 'https',
        'httponly' => true, 'samesite' => 'Lax',
    ]);
    if (!session_start()) throw new RuntimeException('Customer sign-in is unavailable.');
    return true;
}

function ez_customer_csrf(): string
{
    ez_customer_session();
    return $_SESSION['customer_csrf'] ??= bin2hex(random_bytes(24));
}

function ez_customer_next(string $value): string
{
    $parts = parse_url($value);
    if (!is_array($parts) || isset($parts['scheme']) || isset($parts['host'])
        || !in_array($parts['path'] ?? '', ['/cart/return.php', '/cart/tracking-sandbox.php', '/cart/addresses.php', '/cart/', '/cart/index.html'], true)) return '/cart/return.php';
    parse_str($parts['query'] ?? '', $query);
    if ($parts['path'] === '/cart/addresses.php') return '/cart/addresses.php' . (($query['new'] ?? '') === '1' ? '?new=1' : '');
    if (in_array($parts['path'], ['/cart/', '/cart/index.html'], true)) {
        $safe = [];
        if (is_string($query['shop'] ?? null) && preg_match('/^[a-z0-9][a-z0-9_-]{5,79}$/D', $query['shop']) === 1) $safe['shop'] = $query['shop'];
        foreach (['store', 'product'] as $key) {
            if (is_string($query[$key] ?? null) && preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,95}$/D', $query[$key]) === 1) $safe[$key] = $query[$key];
        }
        return $parts['path'] . ($safe !== [] ? '?' . http_build_query($safe) : '');
    }
    if ($parts['path'] === '/cart/tracking-sandbox.php') {
        $stage = is_string($query['stage'] ?? null) && preg_match('/^[a-z-]{2,30}$/D', $query['stage']) === 1 ? $query['stage'] : '';
        return $parts['path'] . ($stage !== '' ? '?stage=' . rawurlencode($stage) : '');
    }
    $safe = [];
    if (is_string($query['order'] ?? null) && preg_match('/^EZK-[A-Z0-9-]{8,70}$/D', $query['order']) === 1) $safe['order'] = $query['order'];
    if (is_string($query['shop'] ?? null) && preg_match('/^[a-z0-9][a-z0-9_-]{5,79}$/D', $query['shop']) === 1) $safe['shop'] = $query['shop'];
    return '/cart/return.php' . ($safe !== [] ? '?' . http_build_query($safe) : '');
}

function ez_customer_auth_settings(): array
{
    $url = rtrim(ez_config('supabase_url'), '/');
    $key = ez_config('supabase_publishable_key');
    if (!filter_var($url, FILTER_VALIDATE_URL) || !str_starts_with($url, 'https://') || $key === '' || str_contains(strtoupper($key), 'REPLACE')) {
        throw new RuntimeException('Google sign-in is temporarily unavailable.');
    }
    return ['url' => $url, 'key' => $key];
}

function ez_customer_auth_request(string $path, ?array $body = null, string $token = ''): array
{
    $settings = ez_customer_auth_settings();
    $handle = curl_init($settings['url'] . '/auth/v1/' . $path);
    if ($handle === false) throw new RuntimeException('Google sign-in is temporarily unavailable.');
    $headers = ['Accept: application/json', 'apikey: ' . $settings['key']];
    if ($token !== '') $headers[] = 'Authorization: Bearer ' . $token;
    $options = [CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 10, CURLOPT_SSL_VERIFYPEER => true];
    if ($body !== null) {
        $options[CURLOPT_POST] = true;
        $options[CURLOPT_POSTFIELDS] = $body === [] ? '{}' : ez_json_encode($body);
        $options[CURLOPT_HTTPHEADER][] = 'Content-Type: application/json';
    }
    curl_setopt_array($handle, $options);
    $raw = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    $data = is_string($raw) ? json_decode($raw, true) : null;
    if ($status === 204) return [];
    if ($status < 200 || $status >= 300 || !is_array($data)) throw new EzProviderException('Google sign-in is temporarily unavailable.', $status);
    return $data;
}

function ez_customer_verified_user(string $token): array
{
    if (strlen($token) < 40 || strlen($token) > 8192) throw new InvalidArgumentException('Please sign in with Google again.');
    $user = ez_customer_auth_request('user', null, $token);
    $google = false;
    foreach (($user['identities'] ?? []) as $identity) {
        if (is_array($identity) && ($identity['provider'] ?? '') === 'google') $google = true;
    }
    $email = strtolower(trim((string) ($user['email'] ?? '')));
    if (!$google || empty($user['email_confirmed_at']) || !filter_var($email, FILTER_VALIDATE_EMAIL)
        || !is_string($user['id'] ?? null) || $user['id'] === '') throw new InvalidArgumentException('Use a verified Google account to track your order.');
    return $user;
}

function ez_customer_needs_mfa(array $user, string $token): bool
{
    $required = array_filter($user['factors'] ?? [], static fn(array $factor): bool => ($factor['status'] ?? '') === 'verified');
    if ($required === []) return false;
    // The token has already been checked with /user; these claims only select the second-factor step.
    $parts = explode('.', $token);
    $claims = json_decode((string) base64_decode(strtr($parts[1] ?? '', '-_', '+/'), true), true);
    return ($claims['aal'] ?? '') !== 'aal2';
}

function ez_customer_store_session(array $tokens, array $user, bool $new): void
{
    $token = (string) ($tokens['access_token'] ?? '');
    $refresh = (string) ($tokens['refresh_token'] ?? '');
    if (strlen($token) < 40 || strlen($token) > 8192 || $refresh === '' || strlen($refresh) > 8192 || ez_customer_needs_mfa($user, $token)) throw new InvalidArgumentException('Complete two-step verification to continue.');
    $old = $_SESSION['customer_auth'] ?? [];
    $_SESSION['customer_auth'] = [
        'user' => ['id' => $user['id'], 'email' => strtolower(trim($user['email']))],
        'access_token' => $token, 'refresh_token' => $refresh,
        'expires_at' => time() + max(0, min(3600, (int) ($tokens['expires_in'] ?? 3600))),
        'signed_in_at' => $new ? time() : (int) ($old['signed_in_at'] ?? time()),
        'version' => $new ? bin2hex(random_bytes(16)) : ($old['version'] ?? bin2hex(random_bytes(16))),
    ];
}

function ez_customer_current(): ?array
{
    if (!ez_customer_session(false)) return null;
    $auth = $_SESSION['customer_auth'] ?? null;
    if (!is_array($auth) || (int) ($auth['signed_in_at'] ?? 0) + EZ_CUSTOMER_SESSION_LIFETIME <= time()) {
        unset($_SESSION['customer_auth']);
        return null;
    }
    $_SESSION['customer_auth']['version'] ??= bin2hex(random_bytes(16));
    // Existing Ezkart Google sessions are verified by the admin-path bridge. Only that
    // session rotates its refresh token; the customer session stores no shared tokens.
    if (($auth['source'] ?? '') === 'existing_google') {
        if ((int) ($auth['expires_at'] ?? 0) <= time()) { unset($_SESSION['customer_auth']); return null; }
        return $auth['user'];
    }
    if ((int) ($auth['expires_at'] ?? 0) <= time() + 300) {
        try {
            $tokens = ez_customer_auth_request('token?grant_type=refresh_token', ['refresh_token' => $auth['refresh_token']]);
            $user = ez_customer_verified_user((string) ($tokens['access_token'] ?? ''));
            if (($user['id'] ?? '') !== ($auth['user']['id'] ?? '')) throw new InvalidArgumentException('Account changed.');
            ez_customer_store_session($tokens, $user, false);
        } catch (Throwable $error) {
            if ($error instanceof InvalidArgumentException || ($error instanceof EzProviderException && in_array($error->providerStatus, [400, 401, 403], true))) {
                unset($_SESSION['customer_auth']);
                return null;
            }
            // Preserve refresh tokens on temporary failures, but do not authorize with an expired session.
            if ((int) ($auth['expires_at'] ?? 0) <= time()) throw new RuntimeException('Sign-in could not be refreshed. Please try again.');
        }
    }
    return $_SESSION['customer_auth']['user'];
}

function ez_customer_owns_order(array $order, array $customer): bool
{
    $owner = (string) ($order['customer_auth_user_id'] ?? '');
    if ($owner !== '') return hash_equals($owner, (string) $customer['id']);
    $email = strtolower(trim((string) ($order['customer']['email'] ?? '')));
    return $email !== '' && hash_equals($email, (string) $customer['email']);
}

function ez_customer_claim_order(string $id, array $customer): array
{
    // Load first so random references do not create state-lock files.
    $order = ez_load_order($id);
    if (!ez_customer_owns_order($order, $customer)) throw new InvalidArgumentException('Order not found.');
    if (!empty($order['customer_auth_user_id'])) return $order;
    $lock = ez_lock_order_state($id);
    try {
        $order = ez_load_order($id);
        if (!ez_customer_owns_order($order, $customer)) throw new InvalidArgumentException('Order not found.');
        $order['customer_auth_user_id'] = $customer['id'];
        ez_save_order($order);
        return $order;
    } finally { ez_unlock_order_state($lock); }
}
