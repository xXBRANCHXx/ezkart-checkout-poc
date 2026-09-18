<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    $environment = (string) ($_GET['environment'] ?? ez_commerce_environment());
    if (!in_array($environment, ['sandbox', 'production'], true)) throw new InvalidArgumentException('Invalid webhook environment.');
    if (!ez_biteship_webhook_authorized($environment)) {
        error_log('Ezkart Biteship webhook rejected: invalid authorization.');
        ez_api_json(['ok' => false], 401);
    }
    $payload = json_decode((string) file_get_contents('php://input'), true);
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
