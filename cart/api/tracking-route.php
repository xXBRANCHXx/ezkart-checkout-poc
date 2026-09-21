<?php
declare(strict_types=1);
require_once __DIR__ . '/customer-auth.php';
require_once __DIR__ . '/tracking-route-service.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') ez_api_json(['ok' => false], 405);
    $customer = ez_customer_current();
    if ($customer === null) ez_api_json(['ok' => false], 401);
    if (($_GET['sandbox'] ?? '') === '1') {
        if (ez_config('deployment_environment') !== 'test' || ez_commerce_environment() !== 'sandbox') ez_api_json(['ok' => false], 404);
        require_once __DIR__ . '/tracking-sandbox-data.php';
        $scenarios = ez_tracking_sandbox_scenarios();
        $tracking = $scenarios[(string) ($_GET['stage'] ?? '')]['data']['tracking'] ?? null;
        if (!is_array($tracking)) ez_api_json(['ok' => false], 404);
        if (isset($_GET['place'])) {
            $id = is_string($_GET['place']) ? $_GET['place'] : '';
            $place = $_SESSION['tracking_preview_places'][$id] ?? null;
            if (!is_array($place) || ($place['until'] ?? 0) <= time() || ($place['owner'] ?? '') !== $customer['id']) ez_api_json(['ok' => false], 422);
            $tracking['locations']['destination'] = $place['coordinate'];
        }
    } else {
        session_write_close();
        // Derive coordinates from the authorized order, never from caller-supplied points.
        $order = ez_customer_claim_order(trim((string) ($_GET['order'] ?? '')), $customer);
        $tracking = ez_public_order_tracking($order);
    }
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    $route = ez_tracking_road_route($tracking);
    ez_api_json(['ok' => true, 'route' => $route]);
} catch (InvalidArgumentException) {
    ez_api_json(['ok' => false], 404);
} catch (Throwable $error) {
    error_log('Ezkart road route unavailable: ' . $error->getMessage());
    ez_api_json(['ok' => false, 'error' => 'Road route unavailable.'], 503);
}
