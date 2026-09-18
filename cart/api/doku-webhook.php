<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') ez_api_json(['ok' => false], 405);
    $body = file_get_contents('php://input', false, null, 0, 262145);
    if (!is_string($body) || strlen($body) > 262144) throw new InvalidArgumentException('Invalid notification size.');
    ez_apply_doku_notification($body, [
        'client-id' => $_SERVER['HTTP_CLIENT_ID'] ?? '',
        'request-id' => $_SERVER['HTTP_REQUEST_ID'] ?? '',
        'request-timestamp' => $_SERVER['HTTP_REQUEST_TIMESTAMP'] ?? '',
        'signature' => $_SERVER['HTTP_SIGNATURE'] ?? '',
    ], (string) (parse_url($_SERVER['REQUEST_URI'] ?? '/cart/api/doku-webhook.php', PHP_URL_PATH) ?: ''));
    ez_api_json(['ok' => true]);
} catch (InvalidArgumentException $error) {
    error_log('Ezkart DOKU notification rejected: ' . $error->getMessage());
    ez_api_json(['ok' => false], 400);
} catch (Throwable $error) {
    error_log('Ezkart DOKU notification error: ' . $error->getMessage());
    ez_api_json(['ok' => false], 500);
}
