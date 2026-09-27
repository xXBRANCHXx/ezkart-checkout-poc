<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/doku-payout.php';

$input = json_decode(stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);
$requests = []; $results = []; $inquiry = null; $time = $input['time'] ?? 1790496000;
try {
    $responses = $input['responses'] ?? [];
    $client = new EzDokuPayoutClient($input['credentials'], static function ($url, $headers, $body) use (&$responses, &$requests): array {
        $requests[] = ['url' => $url, 'headers' => $headers, 'body' => $body];
        $response = array_shift($responses);
        if (!$response || isset($response['throw'])) throw new RuntimeException('Fixture-only private diagnostic.');
        return [$response['status'] ?? 200, $response['body']];
    }, static function () use (&$time): int { return $time; });
    $original = $input['binding'] ?? [];
    if (!array_key_exists('credentialFingerprint', $original)) $original['credentialFingerprint'] = $client->credentialFingerprint;
    foreach ($input['actions'] ?? [] as $action) {
        try {
            $binding = array_replace($original, $action['binding'] ?? []);
            $evidence = array_replace($inquiry['evidence'] ?? [], $action['evidence'] ?? []);
            $digest = $action['digest'] ?? ($inquiry['data']['inquiryDigest'] ?? '');
            if (isset($action['time'])) $time = $action['time'];
            if ($action['operation'] === 'inquire') {
                $inquiry = $client->inquire($binding); $result = $inquiry;
            } else {
                $result = match ($action['operation']) {
                    'payload' => $client->inquiryPayload($binding),
                    'paymentPayload' => $client->paymentPayload($binding, $evidence, $digest),
                    'pay' => $client->pay($binding, $evidence, $digest),
                    'receipt' => $client->inquiryReceipt($binding, $evidence),
                    'debug' => $client->__debugInfo(),
                };
            }
            $results[] = ['ok' => true, 'result' => $result];
        } catch (Throwable $error) {
            $results[] = ['ok' => false, 'reason' => $error instanceof EzDokuReadException ? $error->reason : get_class($error),
                'providerStatus' => $error instanceof EzDokuReadException ? $error->providerStatus : 0, 'error' => $error->getMessage()];
        }
    }
    echo json_encode(['results' => $results, 'requests' => $requests, 'fingerprint' => $client->credentialFingerprint], JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    echo json_encode(['error' => $error->getMessage(), 'reason' => $error instanceof EzDokuReadException ? $error->reason : get_class($error), 'requests' => $requests], JSON_THROW_ON_ERROR);
}
