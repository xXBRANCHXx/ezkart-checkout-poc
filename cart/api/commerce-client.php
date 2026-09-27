<?php
declare(strict_types=1);

require_once __DIR__ . '/database.php';

final class EzCommerceStorageException extends RuntimeException
{
    public function __construct(string $message, public readonly int $httpStatus)
    {
        parent::__construct($message);
    }
}

final class EzCheckoutPausedException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('Checkout is temporarily paused. Please try again later.');
    }
}

function ez_central_commerce_enabled(): bool
{
    if (ez_config('commerce_storage') !== 'd1') return false;
    // A flag change cannot bypass an in-progress source handover.
    ez_legacy_storage_assert_routing(ez_deployment_profile()['commerce_environment']);
    return true;
}

/** New sales can pause while existing orders and merchant operations stay usable. */
function ez_new_checkout_enabled(): bool
{
    $setting = ez_config('commerce_checkout');
    return $setting === 'enabled' || ($setting === '' && ez_deployment_profile()['environment'] !== 'beta');
}

/** Signing is shared by ordinary requests and the provider-job dispatcher. */
function ez_commerce_request_headers(string $method, string $target, string $body, string $environment, string $secret, ?int $timestamp = null, ?string $nonce = null): array
{
    $maximum = $method === 'POST' && preg_match('~^/internal/commerce/snap-payments/EZK-[SP]-[A-F0-9]{24}/receipt$~D', $target) === 1 ? 600000 : 64000;
    if (!in_array($method, ['GET', 'POST'], true) || !in_array($environment, ['test', 'beta', 'production'], true)
        || !preg_match('~^/internal/commerce/[A-Za-z0-9_/?=&%.:-]+$~D', $target)
        || strlen($secret) < 32 || strlen($body) > $maximum) {
        throw new InvalidArgumentException('Invalid central commerce request.');
    }
    $timestamp ??= time();
    $nonce ??= bin2hex(random_bytes(16));
    if (preg_match('/^[a-f0-9]{32}$/D', $nonce) !== 1) throw new InvalidArgumentException('Invalid commerce request ID.');
    $canonical = implode("\n", ['v1', $environment, $method, $target, (string) $timestamp, $nonce, hash('sha256', $body)]);
    return [
        'Accept: application/json',
        'Content-Type: application/json',
        'X-Ezkart-Environment: ' . $environment,
        'X-Ezkart-Timestamp: ' . $timestamp,
        'X-Ezkart-Request-Id: ' . $nonce,
        'X-Ezkart-Signature: ' . hash_hmac('sha256', $canonical, $secret),
    ];
}

/**
 * Never fall back to local JSON if central storage is unavailable. Callers keep
 * the same checkout/event/job key when retrying an uncertain request.
 */
function ez_commerce_request(string $method, string $target, ?array $payload = null): array
{
    if (!ez_central_commerce_enabled()) throw new EzCommerceStorageException('Central commerce storage is not enabled.', 503);
    $database = ez_database_configuration();
    $parts = parse_url($database['url']);
    if (isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])
        || isset($parts['query']) || isset($parts['fragment']) || !in_array($parts['path'] ?? '', ['', '/'], true)) {
        throw new EzCommerceStorageException('The commerce API must use its configured HTTPS origin.', 503);
    }
    $body = $payload === null ? '' : json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $headers = ez_commerce_request_headers($method, $target, $body, $database['environment'], ez_config('commerce_service_secret'));
    if ($method === 'GET' && $body !== '') throw new InvalidArgumentException('Commerce reads cannot contain a body.');
    if (!function_exists('curl_init')) throw new EzCommerceStorageException('Central commerce storage requires PHP cURL.', 503);
    $handle = curl_init($database['url'] . $target);
    if ($handle === false) throw new EzCommerceStorageException('Central commerce storage is unavailable.', 503);
    $response = '';
    curl_setopt_array($handle, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$response): int {
            if (strlen($response) + strlen($chunk) > 2000000) return 0;
            $response .= $chunk;
            return strlen($chunk);
        },
    ]);
    if ($method === 'POST') curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
    $sent = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $decoded = json_decode($response, true);
    if ($sent === false || !is_array($decoded)) {
        throw new EzCommerceStorageException('Central commerce storage did not confirm the request. Retry with the same request key.', 503);
    }
    if ($status < 200 || $status >= 300 || ($decoded['ok'] ?? false) !== true) {
        $message = is_string($decoded['error'] ?? null) ? mb_substr($decoded['error'], 0, 250) : 'Central commerce storage could not complete the request.';
        throw new EzCommerceStorageException($message, $status >= 400 && $status <= 599 ? $status : 503);
    }
    return $decoded;
}
