<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    if (!ez_biteship_webhook_authorized()) {
        error_log('Ezkart Biteship webhook rejected: invalid authorization.');
        ez_api_json(['ok' => false], 401);
    }
    $payload = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($payload)) {
        throw new InvalidArgumentException('Invalid webhook body.');
    }
    $matched = ez_apply_biteship_webhook($payload);
    ez_api_json(['ok' => true, 'matched' => $matched]);
} catch (InvalidArgumentException $error) {
    error_log('Ezkart Biteship webhook rejected: ' . $error->getMessage());
    ez_api_json(['ok' => false], 400);
} catch (Throwable $error) {
    error_log('Ezkart Biteship webhook error: ' . $error->getMessage());
    ez_api_json(['ok' => false], 500);
}
