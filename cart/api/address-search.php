<?php
declare(strict_types=1);
require_once __DIR__ . '/customer-auth.php';
require_once __DIR__ . '/tracking-address-service.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') ez_api_json(['ok' => false], 405);
    if (ez_customer_current() === null) ez_api_json(['ok' => false], 401);
    if (!ez_request_origin_allowed() || !hash_equals(ez_customer_csrf(), (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? ''))) ez_api_json(['ok' => false], 403);
    $input = json_decode((string) file_get_contents('php://input', false, null, 0, 4096), true);
    $query = is_string($input['address'] ?? null) ? trim(preg_replace('/\s+/u', ' ', $input['address']) ?? '') : '';
    if (mb_strlen($query) < 3 || mb_strlen($query) > 500) throw new InvalidArgumentException('Enter an address between 3 and 500 characters.');
    session_write_close();
    ez_api_json(['ok' => true, 'results' => ez_tracking_address_search($query)]);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'Address search is temporarily unavailable. You can choose the location on the map.'], 503);
}
