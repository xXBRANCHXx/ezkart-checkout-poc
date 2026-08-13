<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    if (!ez_request_origin_allowed()) {
        ez_api_json(['ok' => false, 'error' => 'Invalid checkout origin.'], 403);
    }
    $input = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($input)) {
        throw new InvalidArgumentException('Invalid shipping-rate request.');
    }
    $cart = is_array($input['cart'] ?? null) ? $input['cart'] : [];
    $postalCode = trim((string) ($input['postal_code'] ?? ''));
    $quotes = ez_biteship_quotes($cart, $postalCode);
    ez_api_json([
        'ok' => true,
        'provider' => ez_commerce_is_production() ? 'Biteship' : 'Biteship Test',
        'quotes' => $quotes,
    ]);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable $error) {
    error_log('Ezkart Biteship rates error: ' . $error->getMessage());
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 503);
}
