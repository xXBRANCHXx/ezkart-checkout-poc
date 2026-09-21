<?php
declare(strict_types=1);
require_once __DIR__ . '/customer-auth.php';
require_once __DIR__ . '/tracking-address-service.php';

try {
    if (ez_config('deployment_environment') !== 'test' || ez_commerce_environment() !== 'sandbox') ez_api_json(['ok' => false], 404);
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') ez_api_json(['ok' => false], 405);
    $customer = ez_customer_current();
    if ($customer === null) ez_api_json(['ok' => false], 401);
    if (!ez_request_origin_allowed() || !hash_equals(ez_customer_csrf(), (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? ''))) ez_api_json(['ok' => false], 403);
    $input = json_decode((string) file_get_contents('php://input', false, null, 0, 4096), true);
    $query = is_string($input['address'] ?? null) ? trim(preg_replace('/\s+/u', ' ', $input['address']) ?? '') : '';
    if (mb_strlen($query) < 3 || mb_strlen($query) > 500) ez_api_json(['ok' => false, 'error' => 'Enter an address between 3 and 500 characters.'], 422);
    // A small session lookup keeps arbitrary coordinates out of the routing endpoint.
    $places = array_filter($_SESSION['tracking_preview_places'] ?? [], static fn(array $place): bool => ($place['until'] ?? 0) > time());
    $results = ez_tracking_address_search($query);
    foreach ($results as &$result) {
        $id = bin2hex(random_bytes(12));
        $places[$id] = $result + ['until' => time() + 3600, 'owner' => $customer['id']];
        $result['id'] = $id;
    }
    unset($result);
    $_SESSION['tracking_preview_places'] = array_slice($places, -30, null, true);
    session_write_close();
    ez_api_json(['ok' => true, 'results' => $results]);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'Address search is temporarily unavailable. Please try again shortly.'], 503);
}
