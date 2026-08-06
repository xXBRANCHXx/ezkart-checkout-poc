<?php
declare(strict_types=1);

if (PHP_SAPI === 'cli-server') {
    $staticPath = __DIR__ . parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if (is_file($staticPath)) {
        return false;
    }
}

require_once __DIR__ . '/src/core.php';
require_once __DIR__ . '/src/commerce.php';
require_once __DIR__ . '/src/label.php';
require_once __DIR__ . '/src/views.php';

header_remove('X-Powered-By');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header(
    "Content-Security-Policy: default-src 'self'; img-src 'self' data:; "
    . "style-src 'self'; script-src 'self'; connect-src 'self'; "
    . "frame-ancestors 'none'; base-uri 'self'; "
    . "form-action 'self' https://*.duitku.com"
);

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$path = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
$path = rtrim($path, '/') ?: '/';
$isApi = str_starts_with($path, '/api/');

try {
    if ($method === 'GET' && $path === '/') {
        ez_render_home();
    }

    if ($method === 'GET' && $path === '/api/v1/health') {
        $database = false;
        $databaseError = '';
        try {
            $pdo = ez_db();
            $pdo->query('SELECT 1');
            $database = true;
        } catch (Throwable $error) {
            $databaseError = $error->getMessage();
        }
        ez_json([
            'ok' => ez_config_bool('app_enabled') && $database,
            'service' => 'ezkart-hosted-checkout',
            'mode' => ez_mode(),
            'enabled' => ez_config_bool('app_enabled'),
            'database' => $database,
            'providers' => [
                'biteship_configured' => ez_config('biteship_api_token') !== '',
                'duitku_configured' => ez_config('duitku_merchant_code') !== '' && ez_config('duitku_merchant_key') !== '',
            ],
            'database_error' => $database ? null : 'Database unavailable.',
            'time' => (new DateTimeImmutable('now'))->format(DATE_ATOM),
        ], ez_config_bool('app_enabled') && $database ? 200 : 503);
    }

    // Biteship tests a new URL with an empty application/json request before saving it.
    if ($method === 'POST' && $path === '/api/v1/webhooks/biteship' && ez_biteship_installation_probe(ez_raw_body())) {
        ez_json(['ok' => true, 'installation_probe' => true]);
    }

    if ($method === 'GET' && preg_match('#^/c/(cs_[a-f0-9]{32})$#', $path, $match)) {
        ez_render_checkout($match[1]);
    }

    if ($method === 'GET' && $path === '/payment/return') {
        $sessionId = trim((string) ($_GET['session'] ?? ''));
        if (!preg_match('/^cs_[a-f0-9]{32}$/', $sessionId)) {
            ez_render_error_page(400, 'The payment return link is invalid.');
        }
        ez_render_return($sessionId);
    }

    if ($path === '/ops' && $method === 'GET') {
        if (!ez_admin_authenticated()) {
            ez_render_ops_login();
        }
        ez_require_enabled();
        $pdo = ez_db();
        ez_ensure_schema($pdo);
        ez_render_ops($pdo);
    }

    if ($path === '/ops/login' && $method === 'POST') {
        if (!ez_admin_login((string) ($_POST['password'] ?? ''))) {
            ez_render_ops_login('The operations password is incorrect.');
        }
        header('Location: /ops', true, 303);
        exit;
    }

    if ($path === '/ops/logout' && $method === 'POST') {
        ez_admin_authenticated();
        if (!ez_admin_verify_csrf((string) ($_POST['csrf'] ?? ''))) {
            ez_render_error_page(403, 'The operations form expired. Please try again.');
        }
        $_SESSION = [];
        session_destroy();
        header('Location: /ops', true, 303);
        exit;
    }

    if ($path === '/sandbox/cart' && $method === 'POST') {
        if (ez_mode() !== 'sandbox') {
            ez_render_error_page(403, 'The public demo checkout is available only in sandbox mode.');
        }
        ez_require_sandbox_cart_origin(
            (string) ($_SERVER['HTTP_ORIGIN'] ?? ''),
            (string) ($_SERVER['HTTP_REFERER'] ?? '')
        );
        $requestOrigin = rtrim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), '/');
        if (in_array($requestOrigin, ['https://ezkart.id', 'https://www.ezkart.id'], true)) {
            header('Access-Control-Allow-Origin: ' . $requestOrigin);
            header('Vary: Origin');
        }
        ez_require_enabled();
        $pdo = ez_db();
        ez_ensure_schema($pdo);
        $rateLimit = $pdo->prepare(
            'SELECT COUNT(*) FROM ezkart_checkout_sessions
             WHERE merchant_slug = :merchant AND created_at >= DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 MINUTE)'
        );
        $rateLimit->execute([':merchant' => 'ezkart-demo']);
        if ((int) $rateLimit->fetchColumn() >= 30) {
            ez_render_error_page(429, 'The sandbox demo is busy. Please wait one minute and try again.');
        }
        $payload = ez_sandbox_cart_payload($_POST);
        $session = ez_create_session(
            $pdo,
            'ezkart-demo',
            $payload,
            'ezkart-public-sandbox-' . strtolower((string) $payload['merchant_order_reference'])
        );
        if (str_contains(strtolower((string) ($_SERVER['HTTP_ACCEPT'] ?? '')), 'application/json')) {
            ez_json($session, 201);
        }
        header('Location: ' . $session['checkout_url'], true, 303);
        exit;
    }

    ez_require_enabled();
    $pdo = ez_db();
    ez_ensure_schema($pdo);

    if ($method === 'POST' && $path === '/api/v1/checkout-sessions') {
        $raw = ez_raw_body();
        $merchant = ez_authenticate_merchant($raw);
        $idempotencyKey = ez_header('Idempotency-Key');
        ez_json(ez_create_session($pdo, $merchant, ez_json_body(), $idempotencyKey), 201);
    }

    if ($method === 'GET' && preg_match('#^/api/v1/checkout-sessions/(cs_[a-f0-9]{32})$#', $path, $match)) {
        ez_json(ez_public_session($pdo, $match[1]));
    }

    if ($method === 'GET' && $path === '/api/v1/locations') {
        ez_json(['areas' => ez_biteship_areas((string) ($_GET['q'] ?? ''))]);
    }

    if ($method === 'POST' && $path === '/api/v1/shipping/rates') {
        ez_json(ez_shipping_rates($pdo, ez_json_body()));
    }

    if ($method === 'POST' && $path === '/api/v1/payments') {
        ez_json(ez_start_payment($pdo, ez_json_body()), 201);
    }

    if ($method === 'POST' && $path === '/api/v1/webhooks/duitku') {
        $result = ez_duitku_callback($pdo, $_POST, ez_raw_body());
        ez_json(['ok' => true] + $result);
    }

    if ($method === 'POST' && $path === '/api/v1/webhooks/biteship') {
        if (!ez_biteship_webhook_authorized()) {
            ez_json(['ok' => false, 'error' => 'Biteship webhook authentication failed.'], 401);
        }
        ez_json(ez_biteship_webhook($pdo, ez_json_body(), ez_raw_body()));
    }

    if ($method === 'GET' && preg_match('#^/api/v1/orders/(cs_[a-f0-9]{32})/label$#', $path, $match)) {
        if (!ez_admin_authenticated()) {
            ez_json(['ok' => false, 'error' => 'Operations login is required.'], 401);
        }
        ez_render_a5_label($pdo, $match[1]);
    }

    if ($method === 'POST' && $path === '/ops/shipments/retry') {
        if (!ez_admin_authenticated()) {
            ez_render_ops_login();
        }
        if (!ez_admin_verify_csrf((string) ($_POST['csrf'] ?? ''))) {
            ez_render_error_page(403, 'The operations form expired. Please try again.');
        }
        $sessionId = trim((string) ($_POST['session_id'] ?? ''));
        ez_create_shipment($pdo, $sessionId);
        header('Location: /ops', true, 303);
        exit;
    }

    if ($method === 'POST' && $path === '/ops/test-checkout') {
        if (!ez_admin_authenticated()) {
            ez_render_ops_login();
        }
        if (!ez_admin_verify_csrf((string) ($_POST['csrf'] ?? ''))) {
            ez_render_error_page(403, 'The operations form expired. Please try again.');
        }
        if (ez_mode() !== 'sandbox') {
            ez_render_error_page(403, 'Test checkouts can only be created in sandbox mode.');
        }
        $testReference = 'ZERO-TEST-' . gmdate('Ymd-His') . '-' . strtoupper(bin2hex(random_bytes(2)));
        $testPayload = [
            'merchant_order_reference' => $testReference,
            'currency' => 'IDR',
            'items' => [[
                'sku' => 'ZERO-SANDBOX-001',
                'name' => 'ZERO Sandbox Test Product',
                'quantity' => 1,
                'unit_price' => 100000,
                'unit_weight_grams' => 1000,
            ]],
            'declared_totals' => [
                'merchandise' => 100000,
                'weight_grams' => 1000,
            ],
            'customer' => ['name' => '', 'email' => '', 'phone' => ''],
            'return_urls' => [
                'success' => 'https://zerofoods.id/order/success',
                'cancel' => 'https://zerofoods.id/cart',
            ],
        ];
        $testSession = ez_create_session(
            $pdo,
            'zerofoods',
            $testPayload,
            'sandbox-checkout-' . strtolower($testReference)
        );
        header('Location: ' . $testSession['checkout_url'], true, 303);
        exit;
    }

    if ($isApi) {
        ez_json(['ok' => false, 'error' => 'API route not found.'], 404);
    }
    ez_render_error_page(404, 'That Ezkart page does not exist.');
} catch (InvalidArgumentException $error) {
    if ($isApi) {
        ez_json(['ok' => false, 'error' => $error->getMessage()], 422);
    }
    ez_render_error_page(422, $error->getMessage());
} catch (EzkartProviderException $error) {
    error_log('Ezkart provider error: ' . $error->getMessage());
    if ($isApi) {
        ez_json([
            'ok' => false,
            'error' => $error->getMessage(),
            'provider_status' => $error->httpStatus,
        ], 502);
    }
    ez_render_error_page(502, 'A payment or shipping provider is temporarily unavailable.');
} catch (RuntimeException $error) {
    error_log('Ezkart runtime error: ' . $error->getMessage());
    if ($isApi) {
        ez_json(['ok' => false, 'error' => $error->getMessage()], 409);
    }
    ez_render_error_page(409, $error->getMessage());
} catch (Throwable $error) {
    error_log('Ezkart unhandled error: ' . $error->getMessage());
    if ($isApi) {
        ez_json(['ok' => false, 'error' => 'Unexpected server error.'], 500);
    }
    ez_render_error_page(500, 'Unexpected server error.');
}
