<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/bootstrap.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header("Content-Security-Policy: default-src 'self'; img-src 'self' data: blob: https:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");

const EZ_ADMIN_SESSION_LIFETIME = 60 * 60 * 24 * 30;

$deployment = strtolower(ez_config('deployment_environment'));
$sessionEnvironment = in_array($deployment, ['test', 'production'], true) ? $deployment : 'local';
$configuredSessionDirectory = ez_config('admin_session_storage');
$documentRoot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
$sessionDirectory = $configuredSessionDirectory !== ''
    ? $configuredSessionDirectory
    : (($documentRoot !== '' ? dirname($documentRoot) : sys_get_temp_dir())
        . '/ezkart-admin-sessions-' . $sessionEnvironment);
if (
    str_contains($sessionDirectory, "\0")
    || !str_starts_with($sessionDirectory, DIRECTORY_SEPARATOR)
    || (!is_dir($sessionDirectory) && !@mkdir($sessionDirectory, 0700, true) && !is_dir($sessionDirectory))
) {
    error_log('Ezkart admin session storage could not be initialized.');
    http_response_code(503);
    exit('Ezkart sign-in is temporarily unavailable.');
}
$resolvedSessionDirectory = realpath($sessionDirectory);
if ($resolvedSessionDirectory === false || !is_writable($resolvedSessionDirectory)) {
    error_log('Ezkart admin session storage is not writable.');
    http_response_code(503);
    exit('Ezkart sign-in is temporarily unavailable.');
}
@chmod($resolvedSessionDirectory, 0700);

$forwardedProtocol = strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0]));
$isHttps = (isset($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
    || $forwardedProtocol === 'https';
if ($isHttps) {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
ini_set('session.gc_maxlifetime', (string) EZ_ADMIN_SESSION_LIFETIME);
ini_set('session.gc_probability', '1');
ini_set('session.gc_divisor', '100');
session_save_path($resolvedSessionDirectory);
session_name('ezkart_admin');
session_set_cookie_params([
    'lifetime' => EZ_ADMIN_SESSION_LIFETIME,
    'path' => '/cart/admin',
    'secure' => $isHttps,
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();
if (isset($_COOKIE[session_name()])) {
    setcookie(session_name(), session_id(), [
        'expires' => time() + EZ_ADMIN_SESSION_LIFETIME,
        'path' => '/cart/admin',
        'secure' => $isHttps,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

final class EzAdminAuthProviderException extends RuntimeException
{
    public function __construct(string $message, public readonly int $providerStatus)
    {
        parent::__construct($message);
    }
}

function ez_admin_json(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function ez_admin_escape(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function ez_admin_base64url(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function ez_admin_auth_error_message(array $decoded, string $fallback): string
{
    $message = trim((string) ($decoded['msg'] ?? $decoded['message'] ?? $decoded['error_description'] ?? ''));
    return $message !== '' ? mb_substr($message, 0, 220) : $fallback;
}

function ez_admin_log_auth_error(string $operation, Throwable $error): void
{
    $message = preg_replace('/[\r\n]+/', ' ', $error->getMessage()) ?: 'Unknown provider error';
    error_log('Ezkart Auth ' . $operation . ': ' . mb_substr($message, 0, 220));
}

function ez_admin_money(mixed $value): string
{
    return 'Rp' . number_format((int) $value, 0, ',', '.');
}

function ez_admin_time(mixed $value): string
{
    $timestamp = strtotime((string) $value);
    if ($timestamp === false) return '—';
    $date = new DateTimeImmutable('@' . $timestamp);
    return $date->setTimezone(new DateTimeZone('Asia/Jakarta'))->format('d M Y, H:i') . ' WIB';
}

function ez_admin_status_label(string $status): string
{
    return match (strtoupper($status)) {
        'PAID' => 'Dibayar',
        'PENDING' => 'Menunggu',
        'CREATING' => 'Dibuat',
        'FAILED' => 'Gagal',
        default => ucfirst(strtolower($status)),
    };
}

function ez_admin_icon(string $name, string $class = ''): string
{
    $safeName = preg_replace('/[^a-z0-9-]/', '', strtolower($name)) ?: 'grid';
    $safeClass = htmlspecialchars($class, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    return '<svg class="icon ' . $safeClass . '" aria-hidden="true"><use href="#icon-' . $safeName . '"></use></svg>';
}

function ez_admin_short_money(mixed $value): string
{
    $amount = (int) $value;
    if ($amount >= 1_000_000) return 'Rp' . number_format($amount / 1_000_000, 1, ',', '.') . ' jt';
    if ($amount >= 1_000) return 'Rp' . number_format($amount / 1_000, 0, ',', '.') . ' rb';
    return ez_admin_money($amount);
}

function ez_admin_product_art(string $name): string
{
    $normalized = mb_strtolower($name);
    $type = str_contains($normalized, 'kopi')
        ? 'coffee'
        : (str_contains($normalized, 'sambal') ? 'sambal' : 'granola');
    $src = match ($type) {
        'coffee' => 'assets/products/kopi-susu.webp',
        'sambal' => 'assets/products/sambal-roa.webp',
        default => 'assets/products/granola.webp',
    };
    return '<span class="product-art product-' . $type . '"><img src="' . $src . '" alt="" loading="lazy"></span>';
}

function ez_admin_location_coordinates(string $location): array
{
    $normalized = mb_strtolower($location);
    foreach ([
        'surabaya' => [-7.2575, 112.7521, 'Surabaya'],
        'bandung' => [-6.9175, 107.6191, 'Bandung'],
        'yogyakarta' => [-7.7956, 110.3695, 'Yogyakarta'],
        'sleman' => [-7.7325, 110.4024, 'Sleman'],
        'denpasar' => [-8.6705, 115.2126, 'Denpasar'],
        'bali' => [-8.4095, 115.1889, 'Bali'],
        'depok' => [-6.4025, 106.7942, 'Depok'],
        'jakarta' => [-6.1754, 106.8272, 'Jakarta'],
    ] as $needle => $coordinates) {
        if (str_contains($normalized, $needle)) return $coordinates;
    }
    return [-6.1754, 106.8272, $location !== '' ? $location : 'Jakarta'];
}

function ez_admin_orders(): array
{
    $orders = [];
    $files = glob(ez_order_directory() . '/*.json') ?: [];
    foreach ($files as $path) {
        if (!is_file($path) || filesize($path) > 1_000_000) continue;
        $order = json_decode((string) file_get_contents($path), true);
        if (!is_array($order) || !is_string($order['order_id'] ?? null)) continue;
        $orders[] = $order;
    }
    usort($orders, static fn(array $left, array $right): int =>
        strcmp((string) ($right['created_at'] ?? ''), (string) ($left['created_at'] ?? ''))
    );
    return $orders;
}

function ez_admin_supabase_settings(): array
{
    $url = rtrim(ez_config('supabase_url'), '/');
    $key = ez_config('supabase_publishable_key');
    $configured = filter_var($url, FILTER_VALIDATE_URL) !== false
        && str_starts_with($url, 'https://')
        && $key !== ''
        && !str_contains(strtoupper($key), 'REPLACE');
    return ['url' => $url, 'key' => $key, 'configured' => $configured];
}

function ez_admin_allowed_emails(): array
{
    $emails = array_map(
        static fn(string $email): string => strtolower(trim($email)),
        explode(',', ez_config('admin_allowed_emails')),
    );
    return array_values(array_filter($emails, static fn(string $email): bool =>
        filter_var($email, FILTER_VALIDATE_EMAIL) !== false
        && !str_contains(strtoupper($email), 'REPLACE')
    ));
}

function ez_admin_auth_mode(): string
{
    $configured = strtolower(ez_config('admin_auth_mode'));
    if (in_array($configured, ['allowlist', 'open_beta', 'open'], true)) return $configured;
    return strtolower(ez_config('deployment_environment')) === 'test' ? 'open_beta' : 'allowlist';
}

function ez_admin_email_has_legacy_access(string $email): bool
{
    return in_array(strtolower(trim($email)), ez_admin_allowed_emails(), true);
}

function ez_admin_user_has_google_identity(array $user): bool
{
    $appMetadata = is_array($user['app_metadata'] ?? null) ? $user['app_metadata'] : [];
    $providers = is_array($appMetadata['providers'] ?? null) ? $appMetadata['providers'] : [];
    $providers[] = (string) ($appMetadata['provider'] ?? '');
    foreach ($providers as $provider) {
        if (strtolower((string) $provider) === 'google') return true;
    }
    $identities = is_array($user['identities'] ?? null) ? $user['identities'] : [];
    foreach ($identities as $identity) {
        if (is_array($identity) && strtolower((string) ($identity['provider'] ?? '')) === 'google') return true;
    }
    return false;
}

function ez_admin_get_json(string $url, array $headers, string $service): array
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('PHP cURL is required to contact ' . $service . '.');
    }
    $handle = curl_init($url);
    if ($handle === false) throw new RuntimeException('Could not start the ' . $service . ' request.');
    curl_setopt_array($handle, [
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_error($handle);
    $decoded = is_string($body) ? json_decode($body, true) : null;
    if ($status < 200 || $status >= 300 || !is_array($decoded)) {
        $fallback = $service . ' rejected the request' . ($error !== '' ? ': ' . $error : '.');
        throw new EzAdminAuthProviderException(
            is_array($decoded) ? ez_admin_auth_error_message($decoded, $fallback) : $fallback,
            $status,
        );
    }
    return $decoded;
}

function ez_admin_post_form_json(string $url, array $headers, array $fields, string $service): array
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('PHP cURL is required to contact ' . $service . '.');
    }
    $handle = curl_init($url);
    if ($handle === false) throw new RuntimeException('Could not start the ' . $service . ' request.');
    curl_setopt_array($handle, [
        CURLOPT_HTTPHEADER => array_merge($headers, ['Content-Type: application/x-www-form-urlencoded']),
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($fields, '', '&', PHP_QUERY_RFC3986),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_error($handle);
    $decoded = is_string($body) ? json_decode($body, true) : null;
    if ($status < 200 || $status >= 300 || !is_array($decoded)) {
        $fallback = $service . ' rejected the request' . ($error !== '' ? ': ' . $error : '.');
        throw new EzAdminAuthProviderException(
            is_array($decoded) ? ez_admin_auth_error_message($decoded, $fallback) : $fallback,
            $status,
        );
    }
    return $decoded;
}

function ez_admin_post_json(string $url, array $headers, array $payload, string $service): array
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('PHP cURL is required to contact ' . $service . '.');
    }
    $handle = curl_init($url);
    if ($handle === false) throw new RuntimeException('Could not start the ' . $service . ' request.');
    curl_setopt_array($handle, [
        CURLOPT_HTTPHEADER => array_merge($headers, ['Content-Type: application/json']),
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_SLASHES),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_error($handle);
    $decoded = is_string($body) ? json_decode($body, true) : null;
    if ($status < 200 || $status >= 300 || !is_array($decoded)) {
        $fallback = $service . ' rejected the request' . ($error !== '' ? ': ' . $error : '.');
        throw new EzAdminAuthProviderException(
            is_array($decoded) ? ez_admin_auth_error_message($decoded, $fallback) : $fallback,
            $status,
        );
    }
    return $decoded;
}

function ez_admin_token_expiration(string $accessToken): int
{
    $parts = explode('.', $accessToken);
    if (count($parts) !== 3) return time() + 300;
    $payload = strtr($parts[1], '-_', '+/');
    $payload .= str_repeat('=', (4 - strlen($payload) % 4) % 4);
    $decoded = json_decode((string) base64_decode($payload, true), true);
    $expiration = is_array($decoded) ? (int) ($decoded['exp'] ?? 0) : 0;
    return $expiration > time() ? $expiration : time() + 300;
}

function ez_admin_verify_supabase_user(string $accessToken): array
{
    if (strlen($accessToken) < 40 || strlen($accessToken) > 8192) {
        throw new InvalidArgumentException('The Supabase access token is invalid.');
    }
    $settings = ez_admin_supabase_settings();
    if (!$settings['configured']) {
        throw new RuntimeException('Supabase login is not configured on this server.');
    }
    $user = ez_admin_get_json($settings['url'] . '/auth/v1/user', [
        'Accept: application/json',
        'apikey: ' . $settings['key'],
        'Authorization: Bearer ' . $accessToken,
    ], 'Supabase Auth');
    $email = strtolower(trim((string) ($user['email'] ?? '')));
    if (($user['id'] ?? '') === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        throw new RuntimeException('Supabase did not return a valid user identity.');
    }
    if (($user['email_confirmed_at'] ?? $user['confirmed_at'] ?? '') === '') {
        throw new RuntimeException('Sign in with a verified email address.');
    }
    $legacyAccess = ez_admin_email_has_legacy_access($email);
    if (ez_admin_auth_mode() === 'allowlist' && !$legacyAccess) {
        throw new RuntimeException('This email address is not authorized for the Ezkart admin.');
    }
    if (ez_admin_auth_mode() !== 'allowlist' && !$legacyAccess && !ez_admin_user_has_google_identity($user)) {
        throw new RuntimeException('Use a verified Google account to join the Ezkart beta.');
    }
    return $user;
}

function ez_admin_store_supabase_session(array $tokens, array $user, bool $newSignIn): void
{
    $accessToken = trim((string) ($tokens['access_token'] ?? ''));
    $refreshToken = trim((string) ($tokens['refresh_token'] ?? ''));
    if (strlen($accessToken) < 40 || strlen($accessToken) > 8192) {
        throw new InvalidArgumentException('Supabase did not return a valid access token.');
    }
    if ($refreshToken === '' || strlen($refreshToken) > 8192) {
        throw new InvalidArgumentException('Supabase did not return a valid refresh token.');
    }
    $metadata = is_array($user['user_metadata'] ?? null) ? $user['user_metadata'] : [];
    $email = strtolower(trim((string) ($user['email'] ?? '')));
    $name = trim((string) ($metadata['full_name'] ?? $metadata['name'] ?? ''));

    $_SESSION['authenticated'] = true;
    $_SESSION['authentication_method'] = 'supabase';
    $_SESSION['authenticated_until'] = ez_admin_token_expiration($accessToken);
    $_SESSION['supabase_access_token'] = $accessToken;
    $_SESSION['supabase_refresh_token'] = $refreshToken;
    $_SESSION['legacy_data_access'] = ez_admin_email_has_legacy_access($email);
    if ($newSignIn || (int) ($_SESSION['signed_in_at'] ?? 0) <= 0) {
        $_SESSION['signed_in_at'] = time();
    }
    $_SESSION['admin_user'] = [
        'id' => (string) ($user['id'] ?? ''),
        'email' => $email,
        'name' => $name !== '' ? mb_substr($name, 0, 100) : $email,
    ];
}

function ez_admin_refresh_supabase_session(): string
{
    if (($_SESSION['authentication_method'] ?? '') !== 'supabase') return 'invalid';
    $refreshToken = trim((string) ($_SESSION['supabase_refresh_token'] ?? ''));
    if ($refreshToken === '' || strlen($refreshToken) > 8192) return 'invalid';

    try {
        $settings = ez_admin_supabase_settings();
        if (!$settings['configured']) return 'temporary';
        $tokens = ez_admin_post_form_json(
            $settings['url'] . '/auth/v1/token?grant_type=refresh_token',
            ['Accept: application/json', 'apikey: ' . $settings['key']],
            ['refresh_token' => $refreshToken],
            'Supabase Auth',
        );
        $accessToken = trim((string) ($tokens['access_token'] ?? ''));
        $nextRefreshToken = trim((string) ($tokens['refresh_token'] ?? ''));
        $tokens['refresh_token'] = $nextRefreshToken !== '' ? $nextRefreshToken : $refreshToken;
        $user = ez_admin_verify_supabase_user($accessToken);
        ez_admin_store_supabase_session($tokens, $user, false);
        return 'refreshed';
    } catch (Throwable $error) {
        ez_admin_log_auth_error('refresh failed', $error);
        if ($error instanceof EzAdminAuthProviderException) {
            return in_array($error->providerStatus, [400, 401, 403], true) ? 'invalid' : 'temporary';
        }
        if ($error instanceof InvalidArgumentException) return 'invalid';
        $message = strtolower($error->getMessage());
        return str_contains($message, 'not authorized')
            || str_contains($message, 'verified email')
            || str_contains($message, 'google account')
            ? 'invalid'
            : 'temporary';
    }
}

function ez_admin_revoke_supabase_session(): void
{
    if (($_SESSION['authentication_method'] ?? '') !== 'supabase') return;
    $accessToken = trim((string) ($_SESSION['supabase_access_token'] ?? ''));
    $settings = ez_admin_supabase_settings();
    if (!$settings['configured'] || strlen($accessToken) < 40 || strlen($accessToken) > 8192) return;
    if (!function_exists('curl_init')) return;

    $handle = curl_init($settings['url'] . '/auth/v1/logout?scope=local');
    if ($handle === false) return;
    curl_setopt_array($handle, [
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'apikey: ' . $settings['key'],
            'Authorization: Bearer ' . $accessToken,
        ],
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_error($handle);
    if (!in_array($status, [200, 204, 401], true)) {
        ez_admin_log_auth_error(
            'logout revocation failed',
            new EzAdminAuthProviderException($error !== '' ? $error : 'Unexpected provider response.', $status),
        );
    }
}

function ez_admin_clear_authentication(): void
{
    unset(
        $_SESSION['authenticated'],
        $_SESSION['authentication_method'],
        $_SESSION['authenticated_until'],
        $_SESSION['supabase_access_token'],
        $_SESSION['supabase_refresh_token'],
        $_SESSION['admin_user'],
        $_SESSION['cloudflare_profile_sync'],
        $_SESSION['legacy_data_access'],
        $_SESSION['signed_in_at'],
        $_SESSION['last_activity_at'],
    );
}

function ez_admin_sync_cloudflare_user(string $accessToken): array
{
    $apiUrl = rtrim(ez_config('cloudflare_api_url'), '/');
    if (filter_var($apiUrl, FILTER_VALIDATE_URL) === false) {
        return ['ok' => false, 'message' => 'Cloudflare API URL is not configured.'];
    }
    try {
        $result = ez_admin_get_json($apiUrl . '/v1/me', [
            'Accept: application/json',
            'Authorization: Bearer ' . $accessToken,
        ], 'the Ezkart Cloudflare API');
        $ok = ($result['ok'] ?? false) === true;
        return [
            'ok' => $ok,
            'message' => $ok
                ? 'D1 profile synchronized.'
                : mb_substr((string) ($result['error'] ?? 'The D1 profile was not synchronized.'), 0, 220),
        ];
    } catch (Throwable $error) {
        return ['ok' => false, 'message' => mb_substr($error->getMessage(), 0, 220)];
    }
}

function ez_admin_proxy_cloud_request(string $accessToken, string $path, string $method): never
{
    $allowedPath = preg_match('#^/v1/(?:catalog|media(?:/[a-zA-Z0-9_-]+)?|products/[a-zA-Z0-9_-]+|drafts/[a-zA-Z0-9_-]+)$#', $path) === 1;
    if (!$allowedPath || str_contains($path, '?') || str_contains($path, '#')) {
        ez_admin_json(['ok' => false, 'error' => 'Cloud data path is not allowed.'], 400);
    }
    if (!in_array($method, ['GET', 'POST', 'PUT', 'DELETE'], true)) {
        ez_admin_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    $apiUrl = rtrim(ez_config('cloudflare_api_url'), '/');
    if (filter_var($apiUrl, FILTER_VALIDATE_URL) === false || !function_exists('curl_init')) {
        ez_admin_json(['ok' => false, 'error' => 'Cloud product storage is unavailable.'], 503);
    }
    $contentLength = max(0, (int) ($_SERVER['CONTENT_LENGTH'] ?? 0));
    if ($contentLength > 3_200_000) {
        ez_admin_json(['ok' => false, 'error' => 'Upload is larger than the 2 MB image limit.'], 413);
    }
    $body = in_array($method, ['POST', 'PUT'], true) ? file_get_contents('php://input') : '';
    if (!is_string($body) || strlen($body) > 3_200_000) {
        ez_admin_json(['ok' => false, 'error' => 'Cloud request body is too large.'], 413);
    }

    $handle = curl_init($apiUrl . $path);
    if ($handle === false) ez_admin_json(['ok' => false, 'error' => 'Cloud request could not start.'], 503);
    $headers = ['Accept: application/json', 'Authorization: Bearer ' . $accessToken];
    if ($body !== '') $headers[] = 'Content-Type: application/json';
    curl_setopt_array($handle, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $body !== '' ? $body : null,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 40,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_FOLLOWLOCATION => false,
    ]);
    $responseBody = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $contentType = trim((string) curl_getinfo($handle, CURLINFO_CONTENT_TYPE));
    $error = curl_error($handle);
    if (!is_string($responseBody)) {
        ez_admin_log_auth_error('Cloud data proxy failed', new RuntimeException($error !== '' ? $error : 'Empty Worker response.'));
        ez_admin_json(['ok' => false, 'error' => 'Cloud product storage could not be reached.'], 503);
    }
    http_response_code($status > 0 ? $status : 502);
    header('Content-Type: ' . ($contentType !== '' ? $contentType : 'application/json; charset=utf-8'));
    header('Cache-Control: ' . (str_starts_with($contentType, 'image/') ? 'private, max-age=3600' : 'private, no-store'));
    header('X-Content-Type-Options: nosniff');
    echo $responseBody;
    exit;
}

$csrfToken = $_SESSION['csrf_token'] ?? null;
if (!is_string($csrfToken) || strlen($csrfToken) < 32) {
    $csrfToken = bin2hex(random_bytes(24));
    $_SESSION['csrf_token'] = $csrfToken;
}

$adminPassword = ez_config('sandbox_admin_password');
$adminConfigured = $adminPassword !== '' && !str_contains(strtoupper($adminPassword), 'REPLACE');
$supabaseSettings = ez_admin_supabase_settings();
$loginError = trim((string) ($_SESSION['auth_flash_error'] ?? ''));
unset($_SESSION['auth_flash_error']);

$oauthFlows = is_array($_SESSION['oauth_flows'] ?? null) ? $_SESSION['oauth_flows'] : [];
foreach ($oauthFlows as $flowId => $flow) {
    if (!is_array($flow) || (int) ($flow['expires_at'] ?? 0) <= time()) unset($oauthFlows[$flowId]);
}
$_SESSION['oauth_flows'] = $oauthFlows;

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET' && (string) ($_GET['auth_callback'] ?? '') === '1') {
    $flowId = strtolower(trim((string) ($_GET['flow'] ?? '')));
    $code = trim((string) ($_GET['code'] ?? ''));
    $providerError = trim((string) ($_GET['error_description'] ?? $_GET['error'] ?? ''));
    $flow = preg_match('/^[a-f0-9]{32}$/', $flowId) === 1 && is_array($oauthFlows[$flowId] ?? null)
        ? $oauthFlows[$flowId]
        : null;
    unset($_SESSION['oauth_flows'][$flowId]);

    try {
        if ($providerError !== '') throw new RuntimeException('Google sign-in was cancelled or denied.');
        if ($flow === null || (int) ($flow['expires_at'] ?? 0) <= time()) {
            throw new RuntimeException('This Google sign-in request expired. Please start again.');
        }
        $verifier = (string) ($flow['verifier'] ?? '');
        if ($code === '' || strlen($code) > 512 || strlen($verifier) < 43 || strlen($verifier) > 128) {
            throw new RuntimeException('The Google sign-in response was invalid. Please start again.');
        }
        if (!$supabaseSettings['configured']) {
            throw new RuntimeException('Supabase login is not configured on this server.');
        }
        $tokens = ez_admin_post_json(
            $supabaseSettings['url'] . '/auth/v1/token?grant_type=pkce',
            ['Accept: application/json', 'apikey: ' . $supabaseSettings['key']],
            ['auth_code' => $code, 'code_verifier' => $verifier],
            'Supabase Auth',
        );
        $accessToken = trim((string) ($tokens['access_token'] ?? ''));
        $user = ez_admin_verify_supabase_user($accessToken);
        session_regenerate_id(true);
        ez_admin_store_supabase_session($tokens, $user, true);
        $_SESSION['cloudflare_profile_sync'] = ez_admin_sync_cloudflare_user($accessToken);
        $_SESSION['csrf_token'] = bin2hex(random_bytes(24));
        unset($_SESSION['oauth_flows']);
        header('Location: ./', true, 303);
        exit;
    } catch (Throwable $error) {
        ez_admin_log_auth_error('PKCE callback failed', $error);
        $message = $error->getMessage();
        $_SESSION['auth_flash_error'] = str_contains(strtolower($message), 'not authorized')
            ? 'This account is not permitted for this Ezkart environment.'
            : (str_starts_with($message, 'This Google sign-in') || str_starts_with($message, 'Google sign-in')
                ? $message
                : 'Google sign-in could not be completed. Please try again.');
        header('Location: ./', true, 303);
        exit;
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && !isset($_GET['cloud'])) {
    $submittedToken = (string) ($_POST['csrf_token'] ?? '');
    if (!hash_equals($csrfToken, $submittedToken)) {
        http_response_code(400);
        $loginError = 'Permintaan tidak valid. Muat ulang halaman dan coba lagi.';
    } elseif ((string) ($_POST['action'] ?? '') === 'google_oauth_start') {
        try {
            if (!$supabaseSettings['configured']) {
                throw new RuntimeException('Supabase login is not configured on this server.');
            }
            session_regenerate_id(true);
            $flowId = bin2hex(random_bytes(16));
            $verifier = ez_admin_base64url(random_bytes(64));
            $challenge = ez_admin_base64url(hash('sha256', $verifier, true));
            $callbackUrl = ez_checkout_public_url() . '/cart/admin/?' . http_build_query([
                'auth_callback' => '1',
                'flow' => $flowId,
            ], '', '&', PHP_QUERY_RFC3986);
            $_SESSION['oauth_flows'] = [
                $flowId => ['verifier' => $verifier, 'expires_at' => time() + 600],
            ];
            $_SESSION['csrf_token'] = bin2hex(random_bytes(24));
            $authorizeUrl = $supabaseSettings['url'] . '/auth/v1/authorize?' . http_build_query([
                'provider' => 'google',
                'redirect_to' => $callbackUrl,
                'code_challenge' => $challenge,
                'code_challenge_method' => 's256',
            ], '', '&', PHP_QUERY_RFC3986);
            header('Location: ' . $authorizeUrl, true, 303);
            exit;
        } catch (Throwable $error) {
            ez_admin_log_auth_error('start failed', $error);
            $loginError = 'Google sign-in could not be started. Please try again.';
        }
    } elseif ((string) ($_POST['action'] ?? '') === 'logout') {
        ez_admin_revoke_supabase_session();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires' => time() - 42000,
                'path' => $params['path'],
                'domain' => $params['domain'],
                'secure' => $params['secure'],
                'httponly' => $params['httponly'],
                'samesite' => 'Lax',
            ]);
        }
        session_destroy();
        header('Location: ./', true, 303);
        exit;
    } elseif ((string) ($_POST['action'] ?? '') === 'login' && $adminConfigured) {
        $submittedPassword = (string) ($_POST['password'] ?? '');
        if (hash_equals($adminPassword, $submittedPassword)) {
            session_regenerate_id(true);
            $_SESSION['authenticated'] = true;
            $_SESSION['authentication_method'] = 'password';
            unset(
                $_SESSION['authenticated_until'],
                $_SESSION['supabase_access_token'],
                $_SESSION['supabase_refresh_token'],
                $_SESSION['admin_user'],
                $_SESSION['cloudflare_profile_sync'],
                $_SESSION['legacy_data_access'],
                $_SESSION['signed_in_at'],
            );
            $_SESSION['csrf_token'] = bin2hex(random_bytes(24));
            header('Location: ./', true, 303);
            exit;
        }
        usleep(350000);
        $loginError = 'Password admin tidak cocok.';
    } elseif ((string) ($_POST['action'] ?? '') === 'email_login') {
        try {
            $email = strtolower(trim((string) ($_POST['email'] ?? '')));
            if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                throw new InvalidArgumentException('Enter a valid email address.');
            }
            if (!in_array($email, ez_admin_allowed_emails(), true)) {
                throw new RuntimeException('This email address is not authorized for the Ezkart admin.');
            }
            $settings = ez_admin_supabase_settings();
            if (!$settings['configured']) {
                throw new RuntimeException('Supabase login is not configured on this server.');
            }
            $redirectUrl = ez_checkout_public_url() . '/cart/admin/';
            ez_admin_post_json(
                $settings['url'] . '/auth/v1/otp?redirect_to=' . rawurlencode($redirectUrl),
                ['Accept: application/json', 'apikey: ' . $settings['key']],
                ['email' => $email, 'create_user' => true],
                'Supabase Auth',
            );
            ez_admin_json(['ok' => true]);
        } catch (Throwable $error) {
            usleep(350000);
            ez_admin_json(['ok' => false, 'error' => $error->getMessage()], 400);
        }
    } elseif ((string) ($_POST['action'] ?? '') === 'supabase_login') {
        try {
            $accessToken = trim((string) ($_POST['access_token'] ?? ''));
            $refreshToken = trim((string) ($_POST['refresh_token'] ?? ''));
            if ($refreshToken === '' || strlen($refreshToken) > 8192) {
                throw new InvalidArgumentException('Supabase did not return a valid refresh token.');
            }
            $user = ez_admin_verify_supabase_user($accessToken);
            session_regenerate_id(true);
            ez_admin_store_supabase_session([
                'access_token' => $accessToken,
                'refresh_token' => $refreshToken,
            ], $user, true);
            $_SESSION['cloudflare_profile_sync'] = ez_admin_sync_cloudflare_user($accessToken);
            $_SESSION['csrf_token'] = bin2hex(random_bytes(24));
            ez_admin_json(['ok' => true]);
        } catch (Throwable $error) {
            usleep(350000);
            ez_admin_json(['ok' => false, 'error' => $error->getMessage()], 401);
        }
    }
}

$authenticationMethod = (string) ($_SESSION['authentication_method'] ?? 'password');
$existingUser = is_array($_SESSION['admin_user'] ?? null) ? $_SESSION['admin_user'] : [];
if (
    $authenticationMethod === 'supabase'
    && ($_SESSION['authenticated'] ?? false) === true
    && !array_key_exists('legacy_data_access', $_SESSION)
) {
    $_SESSION['legacy_data_access'] = ez_admin_email_has_legacy_access(
        (string) ($existingUser['email'] ?? ''),
    );
}
$signedInAt = (int) ($_SESSION['signed_in_at'] ?? 0);
if ($authenticationMethod === 'supabase' && ($_SESSION['authenticated'] ?? false) === true && $signedInAt <= 0) {
    $signedInAt = time();
    $_SESSION['signed_in_at'] = $signedInAt;
}
if ($authenticationMethod === 'supabase' && $signedInAt > 0 && $signedInAt + EZ_ADMIN_SESSION_LIFETIME <= time()) {
    ez_admin_revoke_supabase_session();
    ez_admin_clear_authentication();
    $loginError = 'For your security, please sign in again after 30 days.';
}
$authenticationMethod = (string) ($_SESSION['authentication_method'] ?? 'password');
$supabaseExpiration = (int) ($_SESSION['authenticated_until'] ?? 0);
$supabaseSessionNeedsRefresh = $authenticationMethod === 'supabase'
    && $supabaseExpiration <= time() + 300;
if ($supabaseSessionNeedsRefresh) {
    $refreshResult = ez_admin_refresh_supabase_session();
    if ($refreshResult === 'invalid') {
        ez_admin_clear_authentication();
        $loginError = 'Your secure session ended. Continue with Google to sign in again.';
    } elseif ($refreshResult === 'temporary' && $supabaseExpiration <= time()) {
        $loginError = 'Ezkart could not refresh your session just now. Reload this page in a moment—your sign-in has been preserved.';
    }
}
$authenticationMethod = (string) ($_SESSION['authentication_method'] ?? 'password');
$sessionCurrent = $authenticationMethod !== 'supabase'
    || (int) ($_SESSION['authenticated_until'] ?? 0) > time();
$authenticated = ($_SESSION['authenticated'] ?? false) === true
    && $sessionCurrent
    && ($authenticationMethod === 'supabase' || $adminConfigured);
$legacyDataAccess = $authenticated && (
    $authenticationMethod === 'password'
    || ($_SESSION['legacy_data_access'] ?? false) === true
);
if ($authenticated) {
    $_SESSION['last_activity_at'] = time();
}
$cloudPath = trim((string) ($_GET['cloud'] ?? ''));
if ($cloudPath !== '') {
    if (!$authenticated || $authenticationMethod !== 'supabase') {
        ez_admin_json(['ok' => false, 'error' => 'Sign in with Google to use cloud product storage.'], 401);
    }
    $cloudMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if (in_array($cloudMethod, ['POST', 'PUT', 'DELETE'], true)) {
        $cloudCsrf = (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? '');
        if (!hash_equals($csrfToken, $cloudCsrf)) {
            ez_admin_json(['ok' => false, 'error' => 'The cloud save request expired. Reload and try again.'], 403);
        }
    }
    ez_admin_proxy_cloud_request(
        (string) ($_SESSION['supabase_access_token'] ?? ''),
        $cloudPath,
        $cloudMethod,
    );
}
$adminUser = is_array($_SESSION['admin_user'] ?? null) ? $_SESSION['admin_user'] : [];
$profileSync = is_array($_SESSION['cloudflare_profile_sync'] ?? null)
    ? $_SESSION['cloudflare_profile_sync']
    : null;
$adminDisplayName = trim((string) ($adminUser['name'] ?? '')) ?: 'Ezkart Admin';
$adminDisplayEmail = trim((string) ($adminUser['email'] ?? '')) ?: 'Sandbox operator';
$adminInitials = implode('', array_map(
    static fn(string $part): string => mb_strtoupper(mb_substr($part, 0, 1)),
    array_slice(preg_split('/\s+/', $adminDisplayName) ?: [], 0, 2),
)) ?: 'EA';
$adminStorageIdentity = $authenticationMethod === 'supabase'
    ? (string) ($adminUser['id'] ?? '')
    : 'legacy-password-owner';
$adminStorageScope = substr(hash('sha256', $deployment . '|' . $adminStorageIdentity), 0, 24);
$orders = $legacyDataAccess ? ez_admin_orders() : [];
$metrics = [
    'orders' => count($orders),
    'paid_count' => 0,
    'paid_volume' => 0,
    'pending_count' => 0,
    'failed_count' => 0,
    'fulfilled_count' => 0,
    'fulfillment_attention_count' => 0,
];
$integrationStatus = ez_integration_status();
$commerceEnvironment = (string) ($integrationStatus['environment'] ?? 'invalid');
$commerceProduction = $commerceEnvironment === 'production';
$productSales = [];
$productActivity = [];
$statusCounts = ['PAID' => 0, 'PENDING' => 0, 'CREATING' => 0, 'FAILED' => 0];
$paidProductRevenue = 0;
$paidShippingRevenue = 0;
$pendingVolume = 0;
$failedVolume = 0;
foreach ($orders as $order) {
    $status = strtoupper((string) ($order['status'] ?? ''));
    if (isset($statusCounts[$status])) $statusCounts[$status]++;
    if ($status === 'PAID') {
        $metrics['paid_count']++;
        $metrics['paid_volume'] += (int) ($order['total'] ?? 0);
        $paidProductRevenue += max(0, (int) ($order['subtotal'] ?? 0));
        $paidShippingRevenue += max(0, (int) ($order['shipping_price'] ?? 0));
        if (strtoupper((string) ($order['fulfillment_status'] ?? '')) === 'CONFIRMED' && trim((string) ($order['biteship_order_id'] ?? '')) !== '') {
            $metrics['fulfilled_count']++;
        } else {
            $metrics['fulfillment_attention_count']++;
        }
    } elseif (in_array($status, ['CREATING', 'PENDING'], true)) {
        $metrics['pending_count']++;
        $pendingVolume += max(0, (int) ($order['total'] ?? 0));
    } elseif ($status === 'FAILED') {
        $metrics['failed_count']++;
        $failedVolume += max(0, (int) ($order['total'] ?? 0));
    }
    foreach ((array) ($order['items'] ?? []) as $item) {
        if (!is_array($item) || ($item['id'] ?? '') === 'EZK-SHIPPING') continue;
        $name = trim((string) ($item['name'] ?? 'Produk')) ?: 'Produk';
        $quantity = max(0, (int) ($item['quantity'] ?? 0));
        if (!isset($productActivity[$name])) $productActivity[$name] = ['quantity' => 0, 'sales' => 0];
        $productActivity[$name]['quantity'] += $quantity;
        $productActivity[$name]['sales'] += $quantity * max(0, (int) ($item['price'] ?? 0));
        if ($status === 'PAID') {
            if (!isset($productSales[$name])) $productSales[$name] = ['quantity' => 0, 'sales' => 0];
            $productSales[$name]['quantity'] += $quantity;
            $productSales[$name]['sales'] += $quantity * max(0, (int) ($item['price'] ?? 0));
        }
    }
}
uasort($productSales, static fn(array $left, array $right): int => $right['sales'] <=> $left['sales']);
uasort($productActivity, static fn(array $left, array $right): int => $right['quantity'] <=> $left['quantity']);
$displayOrders = array_slice($orders, 0, 7);
$averageOrder = $metrics['paid_count'] > 0 ? (int) round($metrics['paid_volume'] / $metrics['paid_count']) : 0;
$conversionRate = $metrics['orders'] > 0 ? min(99.9, round(($metrics['paid_count'] / $metrics['orders']) * 100, 1)) : 0;
$fulfillmentRate = $metrics['paid_count'] > 0 ? round(($metrics['fulfilled_count'] / $metrics['paid_count']) * 100) : 0;
$refundRate = $metrics['orders'] > 0 ? round(($metrics['failed_count'] / $metrics['orders']) * 100, 1) : 0;
$productDefaults = [
    'Granola Madu Nusantara' => ['quantity' => 0, 'sales' => 0],
    'Kopi Susu Concentrate' => ['quantity' => 0, 'sales' => 0],
    'Sambal Roa Signature' => ['quantity' => 0, 'sales' => 0],
];
$topProducts = array_slice($productSales !== [] ? $productSales : $productDefaults, 0, 5, true);
$catalogProducts = array_slice($productActivity !== [] ? $productActivity : $productDefaults, 0, 3, true);
$paidUnits = array_sum(array_column($productSales, 'quantity'));
$nowJakarta = new DateTimeImmutable('now', new DateTimeZone('Asia/Jakarta'));
$dateRangeStart = $nowJakarta->modify('-6 days');
$salesMonths = [];
for ($offset = 5; $offset >= 0; $offset--) {
    $month = $nowJakarta->modify('-' . $offset . ' months')->modify('first day of this month');
    $salesMonths[$month->format('Y-m')] = ['label' => $month->format('M'), 'value' => 0];
}
foreach ($orders as $order) {
    if (strtoupper((string) ($order['status'] ?? '')) !== 'PAID') continue;
    $timestamp = strtotime((string) ($order['created_at'] ?? ''));
    if ($timestamp === false) continue;
    $monthKey = (new DateTimeImmutable('@' . $timestamp))->setTimezone(new DateTimeZone('Asia/Jakarta'))->format('Y-m');
    if (isset($salesMonths[$monthKey])) $salesMonths[$monthKey]['value'] += max(0, (int) ($order['total'] ?? 0));
}
$chartMaximum = max(1, ...array_column($salesMonths, 'value'));
$chartPoints = [];
$monthCount = max(1, count($salesMonths) - 1);
foreach (array_values($salesMonths) as $index => $month) {
    $x = round(($index / $monthCount) * 600, 1);
    $y = round(160 - (($month['value'] / $chartMaximum) * 145), 1);
    $chartPoints[] = $x . ' ' . $y;
}
$chartLine = 'M' . implode(' L', $chartPoints);
$chartArea = $chartLine . ' L600 170 L0 170 Z';
$latestCustomer = is_array($orders[0]['customer'] ?? null) ? $orders[0]['customer'] : [];
[$mapLatitude, $mapLongitude, $mapLabel] = ez_admin_location_coordinates((string) ($latestCustomer['location'] ?? ''));
$statusTotal = max(1, $metrics['orders']);
$paidEnd = round(($statusCounts['PAID'] / $statusTotal) * 100, 1);
$pendingEnd = round((($statusCounts['PAID'] + $statusCounts['PENDING']) / $statusTotal) * 100, 1);
$creatingEnd = round((($statusCounts['PAID'] + $statusCounts['PENDING'] + $statusCounts['CREATING']) / $statusTotal) * 100, 1);
$allowedPages = ['dashboard', 'orders', 'products', 'product-new', 'sites', 'customers', 'analytics', 'marketing', 'payments', 'reviews', 'messages', 'integrations', 'settings'];
$requestedPage = strtolower(trim((string) ($_GET['page'] ?? 'dashboard')));
$page = in_array($requestedPage, $allowedPages, true) ? $requestedPage : 'dashboard';
$requestedSite = trim((string) ($_GET['edit'] ?? ''));
$siteEditor = $page === 'sites' && $requestedSite !== '' && strlen($requestedSite) <= 180;
$pageTitles = [
    'dashboard' => 'Dashboard', 'orders' => 'Orders', 'products' => 'Products', 'product-new' => 'Create product', 'sites' => 'Landing Pages',
    'customers' => 'Customers', 'analytics' => 'Analytics', 'marketing' => 'Marketing',
    'payments' => 'Payments', 'reviews' => 'Reviews', 'messages' => 'Messages',
    'integrations' => 'Integrations', 'settings' => 'Settings',
];
$allDisplayOrders = array_slice($orders, 0, 200);
$customerProfiles = [];
$paymentMethods = [];
$orderMapPoints = [];
foreach ($orders as $order) {
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $email = strtolower(trim((string) ($customer['email'] ?? '')));
    $customerKey = $email !== '' ? $email : strtolower(trim((string) ($customer['name'] ?? 'guest')));
    if (!isset($customerProfiles[$customerKey])) {
        $customerProfiles[$customerKey] = [
            'name' => (string) ($customer['name'] ?? 'Guest customer'),
            'email' => $email !== '' ? $email : '—',
            'phone' => (string) ($customer['phone'] ?? '—'),
            'location' => (string) ($customer['location'] ?? '—'),
            'orders' => 0, 'paid' => 0, 'spend' => 0,
            'last_order' => (string) ($order['created_at'] ?? ''),
        ];
    }
    $customerProfiles[$customerKey]['orders']++;
    if (strtoupper((string) ($order['status'] ?? '')) === 'PAID') {
        $customerProfiles[$customerKey]['paid']++;
        $customerProfiles[$customerKey]['spend'] += max(0, (int) ($order['total'] ?? 0));
    }
    $method = trim((string) ($order['payment_type'] ?? '')) ?: 'Awaiting method';
    $method = ucwords(str_replace('_', ' ', $method));
    $paymentMethods[$method] = ($paymentMethods[$method] ?? 0) + 1;
    [$lat, $lng, $locationLabel] = ez_admin_location_coordinates((string) ($customer['location'] ?? ''));
    $orderMapPoints[] = ['lat' => $lat, 'lng' => $lng, 'label' => $locationLabel, 'status' => strtoupper((string) ($order['status'] ?? 'PENDING')), 'order' => (string) ($order['order_id'] ?? '')];
}
uasort($customerProfiles, static fn(array $left, array $right): int => $right['spend'] <=> $left['spend']);
arsort($paymentMethods);
$catalogInventory = $legacyDataAccess ? [
    'Granola Madu Nusantara' => ['sku' => 'EZK-DEMO-GRANOLA', 'price' => 58000, 'stock' => 46, 'category' => 'Breakfast'],
    'Kopi Susu Concentrate' => ['sku' => 'EZK-DEMO-COFFEE', 'price' => 79000, 'stock' => 28, 'category' => 'Beverage'],
    'Sambal Roa Signature' => ['sku' => 'EZK-DEMO-SAMBAL', 'price' => 46000, 'stock' => 34, 'category' => 'Condiment'],
] : [];
?>
<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <link rel="icon" href="../../assets/favicon.svg" type="image/svg+xml">
  <?php if ($authenticated): ?><link rel="stylesheet" href="assets/vendor/leaflet.css"><?php endif; ?>
  <link rel="stylesheet" href="admin.css?v=65">
  <title><?= $authenticated ? ez_admin_escape($pageTitles[$page]) : 'Admin Login' ?> · Ezkart</title>
</head>
<body class="<?= $authenticated ? 'dashboard-page page-' . ez_admin_escape($page) . ($page === 'sites' ? ($siteEditor ? ' page-site-editor' : ' page-sites-library') : '') : 'login-page' ?>" data-admin-storage-scope="<?= ez_admin_escape($adminStorageScope) ?>" data-admin-migrate-legacy-storage="<?= $legacyDataAccess ? 'true' : 'false' ?>" data-admin-cloud-enabled="<?= $authenticated && $authenticationMethod === 'supabase' ? 'true' : 'false' ?>" data-admin-csrf-token="<?= ez_admin_escape($csrfToken) ?>">
<?php if (!$authenticated): ?>
  <main class="login-shell">
    <section class="login-card">
      <a class="admin-brand" href="../../"><img src="../../assets/ezkart-logo.svg" alt="Ezkart"></a>
      <p class="eyebrow">Internal order monitor</p>
      <h1><?= $commerceProduction ? 'Production' : 'Sandbox' ?> admin.</h1>
      <p class="login-intro">Sign in with a verified Google account. Store owners can also use their approved email link. Ezkart keeps this device signed in for up to 30 days.</p>
      <?php if ($supabaseSettings['configured']): ?>
        <form class="oauth-form" id="google-sign-in-form" method="post">
          <input type="hidden" name="action" value="google_oauth_start">
          <input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>">
          <button class="oauth-button" id="google-sign-in" type="submit" data-csrf-token="<?= ez_admin_escape($csrfToken) ?>">
            <img class="google-mark" src="https://developers.google.com/static/identity/images/g-logo.png" alt=""><span>Continue with Google</span>
          </button>
        </form>
        <div class="auth-divider"><span>or</span></div>
        <form class="email-auth-form" id="email-sign-in-form">
          <label class="email-auth-label" for="email-sign-in">Email address</label>
          <input id="email-sign-in" name="email" type="email" autocomplete="email" placeholder="Email address" required>
          <button class="email-auth-button" type="submit">Continue with email</button>
        </form>
        <section class="email-sent-panel" id="email-sent-panel" aria-live="polite" hidden>
          <span class="email-sent-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 6.5h16v11H4z"/><path d="m4.5 7 7.5 6 7.5-6"/></svg>
          </span>
          <p>Verification email sent to:</p>
          <strong id="email-sent-address"></strong>
          <small>Open the email and select the secure sign-in link. It can only be used once.</small>
          <button class="email-resend-button" id="email-resend-button" type="button" disabled>Resend in 60s</button>
          <button class="email-change-button" id="email-change-button" type="button">Use another email</button>
        </section>
        <section class="email-sent-panel email-success-panel" id="email-success-panel" aria-live="polite" hidden>
          <span class="email-sent-icon email-success-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg>
          </span>
          <p>Verification successful</p>
          <strong>You&rsquo;re signed in.</strong>
          <small>You may safely close this tab.</small>
        </section>
        <p class="auth-status" id="auth-status" role="status" aria-live="polite"></p>
      <?php else: ?>
        <div class="configuration-note" role="alert">
          <b>Google sign-in needs one server setting.</b>
          <p>Add <code>supabase_url</code> and <code>supabase_publishable_key</code> to the private <code>config.runtime.php</code>.</p>
        </div>
      <?php endif; ?>
      <?php if ($loginError !== ''): ?><p class="form-error" role="alert"><?= ez_admin_escape($loginError) ?></p><?php endif; ?>
      <?php if ($adminConfigured): ?>
        <details class="password-fallback">
          <summary>Use emergency admin password</summary>
          <form method="post" autocomplete="off">
            <input type="hidden" name="action" value="login">
            <input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>">
            <label for="password">Admin password</label>
            <input id="password" name="password" type="password" required autocomplete="current-password">
            <button type="submit">Enter dashboard <span>→</span></button>
          </form>
        </details>
      <?php endif; ?>
      <a class="back-link" href="../">← Kembali ke checkout</a>
    </section>
  </main>
  <script src="auth.js?v=7"></script>
<?php else: ?>
  <svg class="svg-sprite" aria-hidden="true">
    <symbol id="icon-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></symbol>
    <symbol id="icon-cart" viewBox="0 0 24 24"><path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L20.5 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/></symbol>
    <symbol id="icon-box" viewBox="0 0 24 24"><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></symbol>
    <symbol id="icon-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5.5a3 3 0 0 1 0 5.5M17 14a5 5 0 0 1 4 5"/></symbol>
    <symbol id="icon-chart" viewBox="0 0 24 24"><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"/></symbol>
    <symbol id="icon-send" viewBox="0 0 24 24"><path d="m21 3-7 18-4-8-8-4 19-6Z"/><path d="m10 13 11-10"/></symbol>
    <symbol id="icon-wallet" viewBox="0 0 24 24"><path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12"/><path d="M15 11h6v4h-6a2 2 0 0 1 0-4Z"/></symbol>
    <symbol id="icon-star" viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></symbol>
    <symbol id="icon-message" viewBox="0 0 24 24"><path d="M20 15a3 3 0 0 1-3 3H8l-5 3V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v8Z"/><path d="M8 10h8M8 14h5"/></symbol>
    <symbol id="icon-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></symbol>
    <symbol id="icon-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></symbol>
    <symbol id="icon-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></symbol>
    <symbol id="icon-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.7 2c-1 .6-1.5 1-1.5 2.2M12 17h.01"/></symbol>
    <symbol id="icon-calendar" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></symbol>
    <symbol id="icon-trend" viewBox="0 0 24 24"><path d="m3 17 6-6 4 4 8-9"/><path d="M16 6h5v5"/></symbol>
    <symbol id="icon-money" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-.5-1.5-.8-2.5-.8-1.4 0-2.5.7-2.5 1.8 0 2.8 5.2 1.3 5.2 4.3 0 1.2-1.1 2-2.7 2-.9 0-1.9-.3-2.7-.9M12.5 5.8v12.4"/></symbol>
    <symbol id="icon-refund" viewBox="0 0 24 24"><path d="M4 7v5h5M20 17v-5h-5"/><path d="M6.1 16.8A8 8 0 0 0 20 12M17.9 7.2A8 8 0 0 0 4 12"/></symbol>
    <symbol id="icon-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
    <symbol id="icon-sparkles" viewBox="0 0 24 24"><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2ZM5 13l.7 2.1 2.1.7-2.1.7L5 18.6l-.7-2.1-2.1-.7 2.1-.7L5 13Z"/></symbol>
    <symbol id="icon-rocket" viewBox="0 0 24 24"><path d="M14 5c2.5-2.5 5.5-2.2 5.5-2.2s.3 3-2.2 5.5l-5.6 5.6-4.3-4.3L14 5Z"/><path d="m9 8-4.3.5-2 2 4.7 1.2M15.2 11.2l-.5 4.3-2 2-1.2-4.7M8.2 15.2c-1.6 1.6-4.8 1.6-4.8 1.6s0-3.2 1.6-4.8"/><circle cx="15.5" cy="6.8" r="1.4"/></symbol>
    <symbol id="icon-store" viewBox="0 0 24 24"><path d="M4 10v10h16V10M3 4h18l-1 6a3 3 0 0 1-4 1.7A3 3 0 0 1 12 12a3 3 0 0 1-4-.3A3 3 0 0 1 4 10L3 4Z"/><path d="M9 20v-5h6v5"/></symbol>
    <symbol id="icon-granola" viewBox="0 0 24 24"><path d="M4 10h16c0 6-3 10-8 10S4 16 4 10Z"/><path d="M7 10c.6-2 2-3 3.7-3 1.2 0 1.8.6 2.6.6 1 0 1.4-.8 2.6-.8 1.1 0 2 .7 2.4 2M8 5.5l1.2-1M14 5l1-1.5"/></symbol>
    <symbol id="icon-coffee" viewBox="0 0 24 24"><path d="M5 9h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9Z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 6c-1-1 .8-1.7 0-3M12 6c-1-1 .8-1.7 0-3"/></symbol>
    <symbol id="icon-sambal" viewBox="0 0 24 24"><path d="M9 3h6v3H9zM8 6h8l1.5 3v10a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V9L8 6Z"/><path d="M9 13c1-2 2-2.5 3-4 .2 1.7 2.8 2.4 2.8 5A2.8 2.8 0 0 1 12 17a2.8 2.8 0 0 1-3-3c0-.4 0-.7.1-1Z"/></symbol>
    <symbol id="icon-truck" viewBox="0 0 24 24"><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/></symbol>
    <symbol id="icon-map-pin" viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></symbol>
    <symbol id="icon-check-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 8"/></symbol>
    <symbol id="icon-mail" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></symbol>
    <symbol id="icon-smartphone" viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 5h4M11 18h2"/></symbol>
    <symbol id="icon-monitor" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4"/></symbol>
    <symbol id="icon-credit-card" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></symbol>
    <symbol id="icon-plug" viewBox="0 0 24 24"><path d="m8 12 8-8M14 3l7 7M5 15l4 4M3 21l5-5M11 10l3 3-5 5a2.1 2.1 0 0 1-3 0l-1-1a2.1 2.1 0 0 1 0-3l5-5Z"/></symbol>
    <symbol id="icon-chevron-down" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></symbol>
    <symbol id="icon-chevron-left" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></symbol>
    <symbol id="icon-chevron-right" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
    <symbol id="icon-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></symbol>
    <symbol id="icon-layout" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/></symbol>
    <symbol id="icon-link" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></symbol>
    <symbol id="icon-shield" viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/></symbol>
    <symbol id="icon-eye" viewBox="0 0 24 24"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.5"/></symbol>
    <symbol id="icon-palette" viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h3a6 6 0 0 0 0-12h-3Z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="9" cy="6.5" r=".8"/><circle cx="14" cy="6" r=".8"/></symbol>
    <symbol id="icon-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
    <symbol id="icon-x" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></symbol>
    <symbol id="icon-trash" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/></symbol>
    <symbol id="icon-grip" viewBox="0 0 24 24"><circle cx="8" cy="6" r="1"/><circle cx="16" cy="6" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="18" r="1"/><circle cx="16" cy="18" r="1"/></symbol>
    <symbol id="icon-code" viewBox="0 0 24 24"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></symbol>
    <symbol id="icon-undo" viewBox="0 0 24 24"><path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6"/></symbol>
    <symbol id="icon-redo" viewBox="0 0 24 24"><path d="m15 7 5 5-5 5M19 12h-8a6 6 0 0 0-6 6"/></symbol>
    <symbol id="icon-image" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 4"/></symbol>
    <symbol id="icon-layers" viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></symbol>
    <symbol id="icon-play" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></symbol>
    <symbol id="icon-download" viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></symbol>
  </svg>

  <div class="app-shell">
    <aside class="sidebar" id="sidebar">
      <a class="sidebar-brand" href="../../"><img src="../../assets/ezkart-logo.svg" alt="Ezkart"></a>
      <nav class="primary-nav" aria-label="Main navigation">
        <a class="<?= $page === 'dashboard' ? 'active' : '' ?>" href="?page=dashboard"><?= ez_admin_icon('grid') ?><span>Dashboard</span></a>
        <a class="<?= $page === 'orders' ? 'active' : '' ?>" href="?page=orders"><?= ez_admin_icon('cart') ?><span>Orders</span><b><?= $metrics['orders'] ?></b></a>
        <a class="<?= in_array($page, ['products', 'product-new'], true) ? 'active' : '' ?>" href="?page=products"><?= ez_admin_icon('box') ?><span>Products</span></a>
        <a class="<?= $page === 'sites' ? 'active' : '' ?>" href="?page=sites"><?= ez_admin_icon('layout') ?><span>Landing Pages</span><b data-site-count>3</b></a>
        <a class="<?= $page === 'customers' ? 'active' : '' ?>" href="?page=customers"><?= ez_admin_icon('users') ?><span>Customers</span></a>
        <a class="<?= $page === 'analytics' ? 'active' : '' ?>" href="?page=analytics"><?= ez_admin_icon('chart') ?><span>Analytics</span></a>
        <a class="<?= $page === 'marketing' ? 'active' : '' ?>" href="?page=marketing"><?= ez_admin_icon('send') ?><span>Marketing</span></a>
        <a class="<?= $page === 'payments' ? 'active' : '' ?>" href="?page=payments"><?= ez_admin_icon('wallet') ?><span>Payments</span></a>
        <a class="<?= $page === 'reviews' ? 'active' : '' ?>" href="?page=reviews"><?= ez_admin_icon('star') ?><span>Reviews</span></a>
        <a class="<?= $page === 'messages' ? 'active' : '' ?>" href="?page=messages"><?= ez_admin_icon('message') ?><span>Messages</span><b><?= $metrics['pending_count'] ?></b></a>
        <a class="<?= $page === 'integrations' ? 'active' : '' ?>" href="?page=integrations"><?= ez_admin_icon('plug') ?><span>Integrations</span></a>
        <a class="<?= $page === 'settings' ? 'active' : '' ?>" href="?page=settings"><?= ez_admin_icon('settings') ?><span>Settings</span></a>
      </nav>
      <section class="upgrade-card">
        <span class="upgrade-icon"><?= ez_admin_icon('globe') ?></span><div><b>Launch on your<br>own domain</b><p>Hosted pages, checkout,<br>payments &amp; shipping.</p></div>
        <a href="?page=sites">Manage Landing Pages</a>
      </section>
      <div class="store-switcher"><span class="store-icon"><?= ez_admin_icon('store') ?></span><div><b>Ezkart <?= $commerceProduction ? 'Production' : 'Sandbox' ?></b><small>Midtrans <?= $commerceProduction ? 'Live' : 'Demo' ?></small></div><?= ez_admin_icon('chevron-down', 'chevron-icon') ?></div>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <button class="mobile-menu" id="mobile-menu" type="button" aria-label="Open navigation"><?= ez_admin_icon('menu') ?></button>
        <label class="global-search"><?= ez_admin_icon('search') ?><input id="global-search" type="search" placeholder="Search anything..." autocomplete="off"><kbd>⌘ K</kbd></label>
        <div class="top-actions">
          <button class="icon-button" type="button" aria-label="Notifications"><?= ez_admin_icon('bell') ?><i><?= $metrics['pending_count'] ?></i></button>
          <button class="icon-button" type="button" aria-label="Messages"><?= ez_admin_icon('message') ?></button>
          <button class="icon-button" type="button" aria-label="Help"><?= ez_admin_icon('help') ?></button>
          <div class="profile" id="account-menu"><span class="avatar"><?= ez_admin_escape(mb_substr($adminInitials, 0, 2)) ?></span><div><b><?= ez_admin_escape($adminDisplayName) ?></b><small><?= ez_admin_escape($adminDisplayEmail) ?></small></div><?= ez_admin_icon('chevron-down', 'chevron-icon') ?></div>
          <form method="post" class="logout-form">
            <input type="hidden" name="action" value="logout"><input type="hidden" name="csrf_token" value="<?= ez_admin_escape($csrfToken) ?>">
            <button type="submit">Log out</button>
          </form>
        </div>
      </header>
      <?php if ($authenticationMethod === 'supabase' && is_array($profileSync)): ?>
        <div class="identity-sync <?= ($profileSync['ok'] ?? false) === true ? 'connected' : 'attention' ?>" role="status">
          <?= ez_admin_icon(($profileSync['ok'] ?? false) === true ? 'check-circle' : 'help') ?>
          <b>Google identity verified.</b>
          <span><?= ez_admin_escape((string) ($profileSync['message'] ?? 'D1 profile status unavailable.')) ?></span>
        </div>
      <?php endif; ?>

      <?php if ($page === 'dashboard'): ?>
      <main class="dashboard page-canvas" id="overview">
        <section class="welcome-row">
          <div><h1>Welcome back <span class="welcome-mark"><?= ez_admin_icon('sparkles') ?></span></h1><p>Here is what is happening with your store today.</p></div>
          <button class="date-button" type="button"><?= ez_admin_icon('calendar') ?><span><?= $dateRangeStart->format('M j') ?> – <?= $nowJakarta->format('M j, Y') ?></span><?= ez_admin_icon('chevron-down', 'chevron-icon') ?></button>
        </section>

        <section class="kpi-grid" aria-label="Store overview">
          <article><span class="kpi-icon"><?= ez_admin_icon('money') ?></span><div><small>Total Sales</small><strong><?= ez_admin_short_money($metrics['paid_volume']) ?></strong><em class="positive"><?= $metrics['paid_count'] ?> paid</em><p>Provider-confirmed payments</p></div></article>
          <article><span class="kpi-icon"><?= ez_admin_icon('cart') ?></span><div><small>Orders</small><strong><?= number_format($metrics['orders']) ?></strong><em><?= $metrics['pending_count'] ?> open</em><p>All stored orders</p></div></article>
          <article><span class="kpi-icon"><?= ez_admin_icon('trend') ?></span><div><small>Conversion Rate</small><strong><?= number_format($conversionRate, 1) ?>%</strong><p>Paid orders / all orders</p></div></article>
          <article><span class="kpi-icon"><?= ez_admin_icon('chart') ?></span><div><small>Average Order Value</small><strong><?= ez_admin_short_money($averageOrder) ?></strong><p>Across paid transactions</p></div></article>
          <article><span class="kpi-icon"><?= ez_admin_icon('refund') ?></span><div><small>Failure Rate</small><strong><?= number_format($refundRate, 1) ?>%</strong><em class="<?= $metrics['failed_count'] > 0 ? 'negative' : 'positive' ?>"><?= $metrics['failed_count'] ?> failed</em><p>Failed or expired orders</p></div></article>
          <article><span class="kpi-icon"><?= ez_admin_icon('wallet') ?></span><div><small>Confirmed Volume</small><strong><?= ez_admin_short_money($metrics['paid_volume']) ?></strong><p>Settlement remains in Midtrans</p></div></article>
        </section>

        <section class="dashboard-grid primary-grid">
          <article class="panel sales-panel" id="sales-overview">
            <header class="panel-header"><h2>Sales Overview</h2></header>
            <div class="chart-controls"><div><button>Daily</button><button>Weekly</button><button class="active">Monthly</button></div><button class="compare-button">Compare: Previous Period <?= ez_admin_icon('chevron-down') ?></button></div>
            <div class="sales-chart">
              <div class="chart-y"><span><?= ez_admin_short_money($chartMaximum) ?></span><span><?= ez_admin_short_money($chartMaximum * .75) ?></span><span><?= ez_admin_short_money($chartMaximum * .5) ?></span><span><?= ez_admin_short_money($chartMaximum * .25) ?></span><span>Rp0</span></div>
              <svg viewBox="0 0 600 170" preserveAspectRatio="none" aria-label="Confirmed sales over the last six months"><defs><linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4d53" stop-opacity=".27"/><stop offset="1" stop-color="#ff4d53" stop-opacity=".01"/></linearGradient></defs><path class="area" d="<?= ez_admin_escape($chartArea) ?>"/><path class="line" d="<?= ez_admin_escape($chartLine) ?>"/></svg>
              <div class="chart-x"><?php foreach ($salesMonths as $month): ?><span><?= ez_admin_escape($month['label']) ?></span><?php endforeach; ?></div>
              <div class="chart-tip"><small>Current month</small><b><?= ez_admin_short_money(array_values($salesMonths)[5]['value']) ?></b></div>
            </div>
          </article>

          <article class="panel orders-panel" id="recent-orders">
            <header class="panel-header"><h2>Recent Orders</h2><div><label class="table-search"><?= ez_admin_icon('search') ?><input id="order-search" type="search" placeholder="Search"></label><select id="status-filter" aria-label="Filter orders"><option value="all">All orders</option><option value="PAID">Paid</option><option value="PENDING">Pending</option><option value="CREATING">Created</option><option value="FAILED">Failed</option></select></div></header>
            <div class="orders-table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Status</th><th>Amount</th><th>Date</th></tr></thead><tbody id="order-list">
              <?php foreach (array_slice($displayOrders, 0, 5) as $order):
                $status = strtoupper((string) ($order['status'] ?? 'UNKNOWN'));
                $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
                $shipping = is_array($order['shipping'] ?? null) ? $order['shipping'] : [];
                $items = array_values(array_filter((array) ($order['items'] ?? []), static fn($item): bool => is_array($item) && ($item['id'] ?? '') !== 'EZK-SHIPPING'));
                $firstItem = is_array($items[0] ?? null) ? $items[0] : [];
                $searchText = mb_strtolower(implode(' ', [(string) ($order['order_id'] ?? ''), (string) ($customer['name'] ?? ''), (string) ($customer['email'] ?? ''), (string) ($firstItem['name'] ?? '')]));
              ?><tr data-order-card data-status="<?= ez_admin_escape($status) ?>" data-search="<?= ez_admin_escape($searchText) ?>"><td><button class="order-link" type="button" data-order-toggle aria-expanded="false" title="View <?= ez_admin_escape($order['order_id'] ?? 'order') ?>">#<?= ez_admin_escape(str_replace('EZK-', '', (string) ($order['order_id'] ?? '—'))) ?></button></td><td><?= ez_admin_escape($customer['name'] ?? 'Guest customer') ?></td><td><span class="table-product"><?= ez_admin_product_art((string) ($firstItem['name'] ?? '')) ?><?= ez_admin_escape($firstItem['name'] ?? 'Mixed order') ?></span></td><td><span class="status-badge status-<?= ez_admin_escape(strtolower($status)) ?>"><?= ez_admin_escape(ez_admin_status_label($status)) ?></span></td><td><b><?= ez_admin_money($order['total'] ?? 0) ?></b></td><td><?= ez_admin_escape(ez_admin_time($order['created_at'] ?? '')) ?></td></tr>
              <tr class="order-detail-row" hidden><td colspan="6"><div class="order-detail-inline"><section><span>Customer</span><b><?= ez_admin_escape($customer['name'] ?? 'Guest customer') ?></b><p><?= ez_admin_escape($customer['email'] ?? '—') ?><br><?= ez_admin_escape($customer['phone'] ?? '—') ?></p></section><section><span>Delivery</span><b><?= ez_admin_escape(trim((string) ($shipping['courier'] ?? '') . ' ' . (string) ($shipping['service'] ?? '')) ?: 'Not selected') ?></b><p><?= ez_admin_escape($customer['location'] ?? '—') ?><br>Biteship: <?= ez_admin_escape($order['biteship_order_id'] ?? ($order['fulfillment_status'] ?? 'awaiting payment')) ?></p></section><section><span>Payment</span><b><?= ez_admin_escape(str_replace('_', ' ', (string) ($order['payment_type'] ?? 'Awaiting method'))) ?></b><p>Midtrans: <?= ez_admin_escape($order['midtrans_status'] ?? 'pending') ?><br><?= ez_admin_escape($order['midtrans_transaction_id'] ?? 'No transaction ID') ?></p></section><section><span>Price detail</span><b><?= ez_admin_money($order['total'] ?? 0) ?></b><p>Products <?= ez_admin_money($order['subtotal'] ?? 0) ?><br>Shipping <?= ez_admin_money($order['shipping_price'] ?? 0) ?></p></section></div></td></tr><?php endforeach; ?>
              <tr class="table-empty" <?= $displayOrders !== [] ? 'hidden' : '' ?>><td colspan="6"><b>No orders yet</b><span>Complete checkout to see an order here.</span></td></tr>
              <tr class="filter-empty" id="empty-filter" hidden><td colspan="6">No orders match that search.</td></tr>
            </tbody></table></div>
          </article>

          <article class="panel products-panel" id="top-products">
            <header class="panel-header"><h2>Top Selling Products</h2><a href="?page=products">View all</a></header>
            <ol><?php $rank = 0; foreach ($topProducts as $name => $sales): $rank++; ?><li><span class="rank"><?= $rank ?></span><?= ez_admin_product_art($name) ?><div><b><?= ez_admin_escape($name) ?></b><small><?= number_format($sales['quantity']) ?> sold</small></div><strong><?= ez_admin_short_money($sales['sales']) ?></strong></li><?php endforeach; ?></ol>
            <footer class="products-summary"><div><small>Active catalog</small><b><?= count($productDefaults) ?> products</b></div><div><small>Paid units</small><b><?= number_format($paidUnits) ?></b></div></footer>
          </article>
        </section>

        <section class="dashboard-grid secondary-grid">
          <article class="panel feed-panel" id="customer-feed"><header class="panel-header"><h2>Live Customer Feed</h2><span class="live">● Live</span></header><ul>
            <?php foreach (array_slice($displayOrders, 0, 4) as $index => $order): $customer = (array) ($order['customer'] ?? []); ?><li><span class="mini-avatar c<?= $index % 4 ?>"><?= ez_admin_escape(mb_strtoupper(mb_substr((string) ($customer['name'] ?? 'G'), 0, 1))) ?></span><div><b><?= ez_admin_escape($customer['name'] ?? 'Guest customer') ?></b><small><?= strtoupper((string) ($order['status'] ?? '')) === 'PAID' ? 'Completed checkout' : 'Started an order' ?></small></div><time><?= $index === 0 ? 'Just now' : ($index * 3) . ' min ago' ?></time></li><?php endforeach; ?>
            <?php if ($displayOrders === []): ?><li><span class="mini-avatar c0">E</span><div><b>Your first customer</b><small>will appear here live</small></div><time>Waiting</time></li><?php endif; ?>
          </ul></article>

          <article class="panel revenue-panel"><header class="panel-header"><h2>Revenue Breakdown</h2><a href="?page=payments">View Report</a></header><div class="revenue-rows">
            <?php $trackedVolume = max(1, $metrics['paid_volume'] + $pendingVolume + $failedVolume); foreach ([['Product Sales', $paidProductRevenue, 'orange'], ['Shipping Fees', $paidShippingRevenue, 'pink'], ['Pending Volume', $pendingVolume, 'purple'], ['Failed Volume', $failedVolume, 'blue']] as $row): $percentage = round(($row[1] / $trackedVolume) * 100, 1); ?><div><span><b><?= $row[0] ?></b><em><?= ez_admin_money($row[1]) ?> <small><?= $percentage ?>%</small></em></span><i><b class="<?= $row[2] ?>" style="width:<?= min(100, max(2, $percentage)) ?>%"></b></i></div><?php endforeach; ?>
            <footer><b>Total Revenue</b><strong><?= ez_admin_money($metrics['paid_volume']) ?></strong></footer>
          </div></article>

          <article class="panel traffic-panel"><header class="panel-header"><h2>Order Status</h2><a href="?page=orders">View orders</a></header><div class="traffic-content"><div class="donut<?= $metrics['orders'] === 0 ? ' empty' : '' ?>" style="--paid-end:<?= $paidEnd ?>%;--pending-end:<?= $pendingEnd ?>%;--creating-end:<?= $creatingEnd ?>%"><span><small>Total Orders</small><b><?= number_format($metrics['orders']) ?></b></span></div><ul><li><i class="orange"></i>Paid <b><?= $statusCounts['PAID'] ?></b></li><li><i class="pink"></i>Pending <b><?= $statusCounts['PENDING'] ?></b></li><li><i class="purple"></i>Creating <b><?= $statusCounts['CREATING'] ?></b></li><li><i class="blue"></i>Failed <b><?= $statusCounts['FAILED'] ?></b></li></ul></div></article>

          <article class="panel stock-panel"><header class="panel-header"><h2>Catalog Activity</h2><a href="?page=products">Open catalog</a></header><ul><?php foreach ($catalogProducts as $name => $sales): $activity = min(100, max(5, $sales['quantity'] * 12)); ?><li><?= ez_admin_product_art($name) ?><div><b><?= ez_admin_escape($name) ?></b><span><em style="width:<?= $activity ?>%"></em></span></div><small><?= number_format($sales['quantity']) ?> ordered</small></li><?php endforeach; ?></ul></article>

          <article class="panel fulfillment-panel fulfillment-pulse"><header class="panel-header"><h2>Fulfillment Pulse</h2><a href="?page=orders">Open operations</a></header><div class="fulfillment-summary"><span class="fulfillment-icon"><?= ez_admin_icon('truck') ?></span><div><small>Latest destination</small><b><?= ez_admin_escape($mapLabel) ?></b><p><?= $metrics['fulfillment_attention_count'] ?> paid orders need a Biteship handoff</p></div><strong><?= $metrics['fulfilled_count'] ?><small>Biteship orders</small></strong></div><div class="fulfillment-stages"><span><i style="--stage-progress:100%"></i><b>Confirmed</b><small><?= $metrics['orders'] ?></small></span><span><i style="--stage-progress:<?= $metrics['orders'] > 0 ? round(($metrics['paid_count'] / $metrics['orders']) * 100) : 0 ?>%"></i><b>Paid</b><small><?= $metrics['paid_count'] ?></small></span><span><i style="--stage-progress:<?= $metrics['orders'] > 0 ? round(($metrics['fulfilled_count'] / $metrics['orders']) * 100) : 0 ?>%"></i><b>Biteship</b><small><?= $metrics['fulfilled_count'] ?></small></span></div></article>
        </section>

        <section class="dashboard-grid footer-grid">
          <article class="panel reviews-panel" id="customer-reviews"><header class="panel-header"><h2>Customer Reviews</h2><a href="?page=reviews">Open reviews</a></header><div class="review-body"><div><strong>4.8</strong><p class="review-stars"><?= str_repeat(ez_admin_icon('star'), 5) ?></p><small>Sandbox review preview</small></div><ul><?php foreach ([5 => 82, 4 => 12, 3 => 4, 2 => 1, 1 => 1] as $stars => $width): ?><li><span><?= $stars ?> <?= ez_admin_icon('star') ?></span><i><b style="width:<?= $metrics['paid_count'] > 0 ? $width : 0 ?>%"></b></i><small><?= $metrics['paid_count'] > 0 ? max(0, (int) round($metrics['paid_count'] * $width / 100)) : 0 ?></small></li><?php endforeach; ?></ul></div></article>

          <article class="panel storefront-panel"><header class="panel-header"><h2>Landing Page &amp; Domain</h2><a href="?page=sites">Open builder</a></header><div class="storefront-summary"><span class="storefront-preview"><?= ez_admin_product_art('Granola Madu Nusantara') ?><i>Live</i></span><div><small>Primary storefront</small><b>Granola Morning Ritual</b><p><?= ez_admin_icon('globe') ?> madu-nusantara.id</p><em><?= ez_admin_icon('shield') ?> SSL active</em></div></div><div class="storefront-pipeline"><span><?= ez_admin_icon('box') ?><small>Product</small></span><i></i><span><?= ez_admin_icon('layout') ?><small>Page</small></span><i></i><span><?= ez_admin_icon('credit-card') ?><small>Midtrans</small></span><i></i><span><?= ez_admin_icon('truck') ?><small>Shipping</small></span></div></article>

          <article class="panel payout-panel" id="payout-summary"><header class="panel-header"><h2>Payment Summary</h2><a href="?page=payments">View all payments</a></header><div class="payout-body"><small>Provider-confirmed Volume</small><div><strong><?= ez_admin_money($metrics['paid_volume']) ?></strong><em class="positive"><?= ez_admin_icon('check-circle') ?> Verified</em><span>signed Midtrans notifications</span></div></div><footer><div><small>Environment</small><b>Midtrans <?= $commerceProduction ? 'Production' : 'Sandbox' ?></b></div><div><small>Paid Orders</small><b><?= number_format($metrics['paid_count']) ?></b></div><a href="../">Open Checkout</a></footer></article>
        </section>
      </main>
      <?php else: require __DIR__ . '/pages.php'; endif; ?>
    </div>
  </div>
  <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
  <script src="assets/vendor/leaflet.js"></script>
  <script src="admin.js?v=40"></script>
<?php endif; ?>
</body>
</html>
