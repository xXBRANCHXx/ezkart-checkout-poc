<?php
declare(strict_types=1);

/**
 * Validate the branch-specific Cloudflare Worker endpoint. Supabase is used
 * for Auth only; structured records live in D1 and file bodies live in R2.
 */
function ez_database_configuration(): array
{
    $environment = strtolower(ez_config('deployment_environment'));
    $url = rtrim(ez_config('cloudflare_api_url'), '/');

    if (!in_array($environment, ['test', 'production'], true)) {
        throw new RuntimeException('deployment_environment must be test or production.');
    }
    if ($url === '') {
        throw new RuntimeException('cloudflare_api_url is required.');
    }

    $parts = parse_url($url);
    $host = strtolower((string) ($parts['host'] ?? ''));
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    $expectedHost = $environment === 'test' ? 'api-test.ezkart.id' : 'api.ezkart.id';
    if ($scheme !== 'https' || !hash_equals($expectedHost, $host)) {
        throw new RuntimeException('Cloudflare API hostname does not match this deployment environment.');
    }

    $requestHost = strtolower(preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')) ?? '');
    if ($requestHost !== '') {
        if ($environment === 'test' && $requestHost !== 'test.ezkart.id') {
            throw new RuntimeException('Test data configuration is only allowed on test.ezkart.id.');
        }
        if ($environment === 'production' && !in_array($requestHost, ['ezkart.id', 'www.ezkart.id'], true)) {
            throw new RuntimeException('Production data configuration is only allowed on ezkart.id.');
        }
    }

    return ['environment' => $environment, 'url' => $url];
}

function ez_database_status(): array
{
    try {
        $database = ez_database_configuration();
    } catch (Throwable $error) {
        return [
            'configured' => false,
            'connected' => false,
            'environment' => ez_config('deployment_environment') ?: 'unset',
            'provider' => 'cloudflare',
            'message' => $error->getMessage(),
        ];
    }

    if (!function_exists('curl_init')) {
        return [
            'configured' => true,
            'connected' => false,
            'environment' => $database['environment'],
            'provider' => 'cloudflare',
            'message' => 'PHP cURL is unavailable.',
        ];
    }

    $handle = curl_init($database['url'] . '/health');
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 6,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_error($handle);
    $payload = is_string($body) ? json_decode($body, true) : null;
    $checks = is_array($payload['checks'] ?? null) ? $payload['checks'] : [];
    $connected = $status >= 200 && $status < 300
        && ($payload['ok'] ?? false) === true
        && ($checks['d1'] ?? false) === true
        && ($checks['public_r2'] ?? false) === true
        && ($checks['private_r2'] ?? false) === true
        && (int) ($payload['table_count'] ?? 0) >= 16;

    return [
        'configured' => true,
        'connected' => $connected,
        'environment' => $database['environment'],
        'provider' => 'cloudflare',
        'd1' => ($checks['d1'] ?? false) === true,
        'public_r2' => ($checks['public_r2'] ?? false) === true,
        'private_r2' => ($checks['private_r2'] ?? false) === true,
        'table_count' => (int) ($payload['table_count'] ?? 0),
        'message' => $connected
            ? 'Cloudflare Worker, D1, and R2 are reachable.'
            : ($error !== '' ? $error : 'Cloudflare data API is not ready yet.'),
    ];
}
