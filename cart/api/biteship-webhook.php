<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    $environment = (string) ($_GET['environment'] ?? ez_commerce_environment());
    if (!in_array($environment, ['sandbox', 'production'], true)) throw new InvalidArgumentException('Invalid webhook environment.');
    $body = (string) file_get_contents('php://input', false, null, 0, 262145);
    if (strlen($body) > 262144) throw new InvalidArgumentException('Webhook body is too large.');
    // Biteship checks reachability with an empty POST when registering a webhook.
    // This probe cannot read or change orders; every event still requires authentication.
    if (trim($body) === '' || preg_match('/^\s*\{\s*\}\s*$/D', $body) === 1) {
        ez_api_json(['ok' => true, 'matched' => false]);
    }
    if (!ez_biteship_webhook_authorized($environment)) {
        error_log('Ezkart Biteship webhook rejected: invalid authorization.');
        ez_api_json(['ok' => false], 401);
    }
    $payload = json_decode($body, true);
    if (!is_array($payload)) {
        throw new InvalidArgumentException('Invalid webhook body.');
    }
    $matched = ez_apply_biteship_webhook($payload, $environment);
    ez_api_json(['ok' => true, 'matched' => $matched]);
} catch (InvalidArgumentException $error) {
    error_log('Ezkart Biteship webhook rejected: ' . $error->getMessage());
    ez_api_json(['ok' => false], 400);
} catch (Throwable $error) {
    error_log('Ezkart Biteship webhook error: ' . $error->getMessage());
    ez_api_json(['ok' => false], 500);
}
