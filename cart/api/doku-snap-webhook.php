<?php
declare(strict_types=1);
require_once __DIR__ . '/commerce-snap-payments.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') ez_api_json(['responseCode' => '4052500', 'responseMessage' => 'Method not allowed'], 405);
    $target = (string) ($_SERVER['REQUEST_URI'] ?? '');
    if ($target !== EzDokuBcaSnapClient::NOTIFICATION_PATH) throw new EzDokuReadException('notification_path');
    $body = file_get_contents('php://input', false, null, 0, 262145);
    if (!is_string($body) || strlen($body) > 262144) ez_api_json(['responseCode' => '4002500', 'responseMessage' => 'Invalid request'], 413);
    $acknowledgement = ez_apply_snap_payment_notification($body, [
        'authorization' => $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '',
        'x-partner-id' => $_SERVER['HTTP_X_PARTNER_ID'] ?? '', 'x-external-id' => $_SERVER['HTTP_X_EXTERNAL_ID'] ?? '',
        'x-timestamp' => $_SERVER['HTTP_X_TIMESTAMP'] ?? '', 'x-signature' => $_SERVER['HTTP_X_SIGNATURE'] ?? '',
        'channel-id' => $_SERVER['HTTP_CHANNEL_ID'] ?? '',
    ], $target);
    // Success is sent only after the original receipt and capture are durable.
    ez_api_json($acknowledgement);
} catch (EzDokuReadException $error) {
    error_log('Ezkart SNAP notification rejected: ' . $error->reason);
    $status = in_array($error->reason, ['configuration', 'transport'], true) ? 503 : 400;
    if ($status === 503) header('Retry-After: 30');
    ez_api_json(['responseCode' => $status === 503 ? '5002500' : '4002500', 'responseMessage' => $status === 503 ? 'Service unavailable' : 'Invalid request'], $status);
} catch (Throwable $error) {
    error_log('Ezkart SNAP notification not committed: ' . get_class($error));
    header('Retry-After: 30');
    ez_api_json(['responseCode' => '5002500', 'responseMessage' => 'Service unavailable'], 503);
}
