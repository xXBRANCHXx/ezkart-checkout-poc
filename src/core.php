<?php
declare(strict_types=1);

final class EzkartProviderException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $httpStatus = 0,
        public readonly array $providerPayload = []
    ) {
        parent::__construct($message);
    }
}

function ez_root(): string
{
    return dirname(__DIR__);
}

function ez_config_all(): array
{
    static $config = null;
    if (is_array($config)) {
        return $config;
    }
    $config = [];
    foreach ([ez_root() . '/config.runtime.php', '/public_html/config.runtime.php'] as $path) {
        if (!is_file($path)) {
            continue;
        }
        $loaded = require $path;
        if (is_array($loaded)) {
            $config = array_merge($config, $loaded);
        }
    }
    return $config;
}

function ez_config(string $key, string $default = ''): string
{
    $envKey = 'EZKART_' . strtoupper($key);
    foreach ([getenv($envKey), $_SERVER[$envKey] ?? null, $_ENV[$envKey] ?? null] as $value) {
        if (is_string($value) && trim($value) !== '') {
            return trim($value);
        }
    }
    $value = ez_config_all()[$key] ?? null;
    return is_string($value) && trim($value) !== '' ? trim($value) : $default;
}

function ez_config_bool(string $key, bool $default = false): bool
{
    $value = strtolower(ez_config($key, $default ? 'true' : 'false'));
    return in_array($value, ['1', 'true', 'yes', 'on'], true);
}

function ez_mode(): string
{
    return strtolower(ez_config('app_mode', 'sandbox')) === 'production' ? 'production' : 'sandbox';
}

function ez_require_enabled(): void
{
    if (!ez_config_bool('app_enabled')) {
        throw new RuntimeException('Ezkart checkout is not enabled.');
    }
}

function ez_signing_secret(): string
{
    $secret = ez_config('app_signing_secret');
    if (strlen($secret) < 32) {
        throw new RuntimeException('Ezkart signing secret must contain at least 32 characters.');
    }
    return $secret;
}

function ez_now(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d H:i:s.u');
}

function ez_iso(string $date): string
{
    return (new DateTimeImmutable($date, new DateTimeZone('UTC')))
        ->setTimezone(new DateTimeZone('Asia/Jakarta'))
        ->format(DATE_ATOM);
}

function ez_id(string $prefix, int $bytes = 16): string
{
    return $prefix . '_' . bin2hex(random_bytes($bytes));
}

function ez_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $host = ez_config('db_host');
    $name = ez_config('db_name');
    $user = ez_config('db_user');
    $password = ez_config('db_password');
    $port = ez_config('db_port', '3306');
    if ($host === '' || $name === '' || $user === '') {
        throw new RuntimeException('Ezkart database is not configured.');
    }
    $pdo = new PDO(
        "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4",
        $user,
        $password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
    return $pdo;
}

function ez_ensure_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $schema = file_get_contents(ez_root() . '/schema.sql');
    if (!is_string($schema)) {
        throw new RuntimeException('Ezkart database schema is unavailable.');
    }
    $statements = preg_split('/;\s*(?:\R|$)/', $schema) ?: [];
    foreach ($statements as $statement) {
        if (trim($statement) !== '') {
            $pdo->exec($statement);
        }
    }
    $done = true;
}

function ez_raw_body(): string
{
    static $body = null;
    if (is_string($body)) {
        return $body;
    }
    $value = file_get_contents('php://input');
    $body = is_string($value) ? $value : '';
    return $body;
}

function ez_json_body(): array
{
    $decoded = json_decode(ez_raw_body(), true);
    return is_array($decoded) ? $decoded : [];
}

function ez_json(array $payload, int $status = 200): never
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function ez_http_json(string $method, string $url, ?array $payload = null, array $headers = []): array
{
    $curl = curl_init($url);
    if ($curl === false) {
        throw new RuntimeException('Unable to initialize provider request.');
    }
    $requestHeaders = array_merge(['Accept: application/json'], $headers);
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_HTTPHEADER => $requestHeaders,
    ]);
    if ($payload !== null) {
        $encoded = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($encoded)) {
            throw new RuntimeException('Unable to encode provider request.');
        }
        curl_setopt($curl, CURLOPT_POSTFIELDS, $encoded);
    }
    $raw = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($curl);
    curl_close($curl);
    $decoded = is_string($raw) ? json_decode($raw, true) : null;
    if ($status < 200 || $status >= 300 || !is_array($decoded)) {
        $message = is_array($decoded)
            ? trim((string) ($decoded['error'] ?? $decoded['message'] ?? ''))
            : trim($curlError);
        throw new EzkartProviderException(
            $message !== '' ? $message : 'Provider request failed.',
            $status,
            is_array($decoded) ? $decoded : []
        );
    }
    return $decoded;
}

function ez_base64url_encode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function ez_base64url_decode(string $value): string
{
    $padding = strlen($value) % 4;
    if ($padding > 0) {
        $value .= str_repeat('=', 4 - $padding);
    }
    $decoded = base64_decode(strtr($value, '-_', '+/'), true);
    if (!is_string($decoded)) {
        throw new InvalidArgumentException('Signed token is invalid.');
    }
    return $decoded;
}

function ez_signed_token(array $payload): string
{
    $encoded = ez_base64url_encode((string) json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    return $encoded . '.' . hash_hmac('sha256', $encoded, ez_signing_secret());
}

function ez_verify_token(string $token, ?int $now = null): array
{
    [$encoded, $signature] = array_pad(explode('.', trim($token), 2), 2, '');
    $expected = hash_hmac('sha256', $encoded, ez_signing_secret());
    if ($encoded === '' || $signature === '' || !hash_equals($expected, $signature)) {
        throw new InvalidArgumentException('Signed token is invalid.');
    }
    $payload = json_decode(ez_base64url_decode($encoded), true);
    $now ??= time();
    if (!is_array($payload) || (int) ($payload['expires_at'] ?? 0) < $now) {
        throw new InvalidArgumentException('Signed token has expired.');
    }
    return $payload;
}

function ez_header(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return trim((string) ($_SERVER[$key] ?? ''));
}

function ez_merchant_secret(string $merchant): string
{
    if ($merchant !== 'zerofoods') {
        throw new InvalidArgumentException('Unknown Ezkart merchant.');
    }
    $secret = ez_config('zero_merchant_secret');
    if (strlen($secret) < 32) {
        throw new RuntimeException('ZERO merchant integration secret is not configured.');
    }
    return $secret;
}

function ez_authenticate_merchant(string $rawBody, ?int $nowMs = null): string
{
    $merchant = strtolower(ez_header('X-Ezkart-Merchant'));
    $timestamp = ez_header('X-Ezkart-Timestamp');
    $signature = strtolower(ez_header('X-Ezkart-Signature'));
    $nowMs ??= (int) round(microtime(true) * 1000);
    if (!ctype_digit($timestamp) || abs($nowMs - (int) $timestamp) > 300000) {
        throw new InvalidArgumentException('Merchant request timestamp is invalid.');
    }
    $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, ez_merchant_secret($merchant));
    if ($signature === '' || !hash_equals($expected, $signature)) {
        throw new InvalidArgumentException('Merchant request signature is invalid.');
    }
    return $merchant;
}

function ez_allowed_return_url(string $url): string
{
    $url = trim($url);
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
    $allowed = array_filter(array_map('trim', explode(',', ez_config('allowed_return_hosts', 'zerofoods.id,www.zerofoods.id'))));
    if ($scheme !== 'https' || !in_array($host, $allowed, true)) {
        throw new InvalidArgumentException('Merchant return URL is not allowed.');
    }
    return mb_substr($url, 0, 500);
}

function ez_client_ip(): string
{
    return trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
}

function ez_biteship_installation_probe(string $raw): bool
{
    if (trim($raw) === '') {
        return true;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) && $decoded === [];
}

function ez_html(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
