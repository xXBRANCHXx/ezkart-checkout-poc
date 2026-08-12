<?php
declare(strict_types=1);

/**
 * Validate the branch-specific Supabase settings without exposing credentials.
 * The same code can be merged; each Hostinger site keeps its own ignored
 * config.runtime.php and therefore its own database.
 */
function ez_database_configuration(): array
{
    $environment = strtolower(ez_config('deployment_environment'));
    $url = rtrim(ez_config('supabase_url'), '/');
    $anonKey = ez_config('supabase_anon_key');
    $expectedRef = strtolower(ez_config('supabase_expected_project_ref'));

    if (!in_array($environment, ['test', 'production'], true)) {
        throw new RuntimeException('EZKART_DEPLOYMENT_ENVIRONMENT must be test or production.');
    }
    if ($url === '' || $anonKey === '' || $expectedRef === '') {
        throw new RuntimeException('Supabase URL, anon key, and expected project ref are required.');
    }

    $parts = parse_url($url);
    $host = strtolower((string) ($parts['host'] ?? ''));
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    if ($scheme !== 'https' || !preg_match('/^[a-z0-9-]+\.supabase\.co$/', $host)) {
        throw new RuntimeException('Supabase URL must be an HTTPS supabase.co project URL.');
    }
    $actualRef = explode('.', $host, 2)[0];
    if (!hash_equals($expectedRef, $actualRef)) {
        throw new RuntimeException('Supabase project ref does not match the expected ref for this deployment.');
    }

    $requestHost = strtolower(preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')) ?? '');
    if ($requestHost !== '') {
        if ($environment === 'test' && $requestHost !== 'test.ezkart.id') {
            throw new RuntimeException('Test database configuration is only allowed on test.ezkart.id.');
        }
        if ($environment === 'production' && !in_array($requestHost, ['ezkart.id', 'www.ezkart.id'], true)) {
            throw new RuntimeException('Production database configuration is only allowed on ezkart.id.');
        }
    }

    return [
        'environment' => $environment,
        'url' => $url,
        'anon_key' => $anonKey,
        'project_ref' => $actualRef,
    ];
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
            'message' => $error->getMessage(),
        ];
    }

    if (!function_exists('curl_init')) {
        return [
            'configured' => true,
            'connected' => false,
            'environment' => $database['environment'],
            'project_ref' => $database['project_ref'],
            'message' => 'PHP cURL is unavailable.',
        ];
    }

    $handle = curl_init($database['url'] . '/rest/v1/sellers?select=id&limit=1');
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'apikey: ' . $database['anon_key'],
            'Authorization: Bearer ' . $database['anon_key'],
        ],
    ]);
    curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_error($handle);
    curl_close($handle);

    return [
        'configured' => true,
        'connected' => $status >= 200 && $status < 300,
        'environment' => $database['environment'],
        'project_ref' => $database['project_ref'],
        'message' => $status >= 200 && $status < 300
            ? 'Database API reachable.'
            : ($error !== '' ? $error : 'Database API returned HTTP ' . $status . '.'),
    ];
}
