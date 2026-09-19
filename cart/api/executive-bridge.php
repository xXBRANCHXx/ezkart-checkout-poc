<?php
declare(strict_types=1);

function ez_executive_directory(): string
{
    $configured = ez_config('executive_storage');
    $root = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    if ($root === '') $root = dirname(__DIR__, 2);
    $path = $configured !== '' ? $configured : dirname($root) . '/.ezkart-executive-bridge';
    if ($path === '' || $path[0] !== '/') throw new RuntimeException('Executive storage must be private.');
    if (!is_dir($path) && !mkdir($path, 0700, true) && !is_dir($path)) throw new RuntimeException('Executive storage unavailable.');
    $real = realpath($path); $public = realpath($root);
    if (!$real || ($public && str_starts_with($real . '/', $public . '/'))) throw new RuntimeException('Executive storage must be outside the public directory.');
    return $real;
}
function ez_executive_secret(): string
{
    $secret = ez_config('executive_bridge_secret');
    if ($secret === '') {
        $path = ez_executive_directory() . '/secret.php';
        $config = is_file($path) ? require $path : [];
        $secret = is_array($config) ? (string) ($config['secret'] ?? '') : '';
    }
    if (strlen($secret) < 43 || str_contains(strtoupper($secret), 'REPLACE')) throw new RuntimeException('Executive connector is not configured.');
    return $secret;
}
function ez_executive_workbench_mode(): ?string
{
    $path = ez_executive_directory() . '/mode.json';
    if (!is_file($path)) return null;
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data) || !in_array($data['mode'] ?? '', ['sandbox','production'], true)) throw new RuntimeException('Invalid workbench mode configuration.');
    return $data['mode'];
}
function ez_executive_readiness(string $environment): array
{
    $checks = [];
    foreach ([
        ['DOKU credentials', static fn() => ez_doku_credentials($environment)],
        ['DOKU payment integration', static fn() => ez_doku_payment_flow($environment)],
        ['Biteship credentials', static fn() => ez_biteship_credentials($environment)],
        ['Biteship pickup details', static fn() => ez_biteship_fulfillment_credentials($environment)],
        ['Biteship webhook', static function () use ($environment) { if (!ez_biteship_webhook_configured($environment)) throw new RuntimeException('Webhook secret needed'); }],
    ] as [$label, $check]) {
        try { $check(); $checks[] = ['label' => $label, 'ok' => true]; }
        catch (Throwable $error) { $checks[] = ['label' => $label, 'ok' => false, 'reason' => $error->getMessage()]; }
    }
    return ['ready' => count(array_filter($checks, static fn($c) => !$c['ok'])) === 0, 'checks' => $checks];
}
function ez_executive_authorize(string $body): void
{
    $timestamp = (string) ($_SERVER['HTTP_X_EXECUTIVE_TIME'] ?? ''); $nonce = (string) ($_SERVER['HTTP_X_EXECUTIVE_NONCE'] ?? '');
    $signature = (string) ($_SERVER['HTTP_X_EXECUTIVE_SIGNATURE'] ?? '');
    if (!preg_match('/^\d{10}$/D', $timestamp) || abs(time() - (int) $timestamp) > 90 || !preg_match('/^[a-f0-9]{48}$/D', $nonce) || !preg_match('/^[a-f0-9]{64}$/D', $signature)) ez_api_json(['ok' => false, 'error' => 'Executive authorization required.'], 401);
    $target = (string) ($_SERVER['REQUEST_URI'] ?? '');
    $message = "ezkart-executive-bridge\nPOST\n{$target}\n{$timestamp}\n{$nonce}\n" . hash('sha256', $body);
    if (!hash_equals(hash_hmac('sha256', $message, ez_executive_secret()), $signature)) ez_api_json(['ok' => false, 'error' => 'Invalid executive signature.'], 403);
    $directory = ez_executive_directory() . '/nonces'; if (!is_dir($directory)) mkdir($directory, 0700, true);
    $path = $directory . '/' . $nonce;
    $old = umask(0077); $handle = @fopen($path, 'x'); umask($old);
    if (!$handle) ez_api_json(['ok' => false, 'error' => 'Request already used.'], 409);
    fclose($handle);
    if (random_int(1,30) === 1) foreach (glob($directory . '/*') ?: [] as $file) if (filemtime($file) < time() - 300) unlink($file);
}
function ez_executive_orders(string $environment): array
{
    $orders = []; $truncated = false;
    // Old sandbox stores are supported by the existing storage resolver.
    $directory = ez_order_directory($environment);
    foreach (new DirectoryIterator($directory) as $file) {
        if (!$file->isFile() || $file->getExtension() !== 'json' || $file->getSize() > 2000000) continue;
        $row = json_decode((string) file_get_contents($file->getPathname()), true);
        if (!is_array($row) || ($row['commerce_environment'] ?? 'sandbox') !== $environment) continue;
        if (count($orders) >= 50000) { $truncated = true; break; }
        $orders[] = [
            'id' => (string) ($row['order_id'] ?? ''), 'environment' => $environment, 'source' => 'checkout',
            'seller_id' => (string) ($row['seller_id'] ?? ''), // Only server-validated catalog ownership, never client-supplied shop.
            'name' => (string) ($row['customer']['name'] ?? ''), 'email' => (string) ($row['customer']['email'] ?? ''),
            'status' => (string) ($row['status'] ?? ''), 'currency' => 'IDR', 'subtotal' => (int) ($row['subtotal'] ?? 0),
            'shipping' => (int) ($row['shipping_price'] ?? 0), 'total' => (int) ($row['total'] ?? 0),
            'created_at' => (string) ($row['created_at'] ?? ''), 'updated_at' => (string) ($row['updated_at'] ?? ''), 'paid_at' => (string) ($row['paid_at'] ?? ''),
            'provider' => (string) ($row['payment_provider'] ?? ''), 'method' => (string) (($row['payment_type'] ?? '') ?: ($row['payment_flow'] ?? 'Unspecified')),
        ];
    }
    return ['orders' => $orders, 'truncated' => $truncated];
}
