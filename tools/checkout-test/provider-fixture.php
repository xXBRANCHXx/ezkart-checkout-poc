<?php
declare(strict_types=1);
// Test-only transport loaded by PHP -n. No provider network calls are possible.
if (extension_loaded('curl') || !getenv('EZKART_TEST_CAPTURE')) throw new RuntimeException('Unsafe test transport setup.');
foreach (['CURLOPT_POST', 'CURLOPT_POSTFIELDS', 'CURLOPT_HTTPHEADER', 'CURLOPT_RETURNTRANSFER', 'CURLOPT_CONNECTTIMEOUT', 'CURLOPT_TIMEOUT', 'CURLOPT_SSL_VERIFYPEER', 'CURLINFO_HTTP_CODE'] as $index => $constant) define($constant, $index + 1);
function curl_init(string $url): object { return (object) ['url' => $url, 'options' => [], 'status' => 200]; }
function curl_setopt_array(object $handle, array $options): bool { $handle->options = $options; return true; }
function curl_exec(object $handle): string {
    $payload = json_decode($handle->options[CURLOPT_POSTFIELDS] ?? '{}', true);
    file_put_contents(getenv('EZKART_TEST_CAPTURE'), json_encode(['url' => $handle->url, 'body' => $handle->options[CURLOPT_POSTFIELDS] ?? '', 'headers' => $handle->options[CURLOPT_HTTPHEADER] ?? []]) . "\n", FILE_APPEND | LOCK_EX);
    if ($handle->url === 'https://api.biteship.com/v1/rates/couriers') return json_encode(['success' => true, 'pricing' => [['courier_code' => 'jne', 'courier_service_code' => 'reg', 'courier_name' => 'JNE', 'courier_service_name' => 'Regular', 'price' => 18000, 'duration' => '2-3', 'shipment_duration_unit' => 'days']]]);
    if (in_array($handle->url, ['https://api-sandbox.doku.com/checkout/v1/payment', 'https://api.doku.com/checkout/v1/payment'], true)) {
        if (getenv('EZKART_TEST_DOKU_FAILURE')) { $handle->status = 503; return '{"error_messages":["Fixture unavailable"]}'; }
        $host = str_contains($handle->url, 'api-sandbox') ? 'sandbox.doku.com' : 'jokul.doku.com';
        return json_encode(['response' => ['order' => $payload['order'], 'payment' => ['url' => 'https://' . $host . '/checkout-link-v2/fixture', 'expired_date' => '20301231235959']]]);
    }
    if ($handle->url === 'https://api.biteship.com/v1/orders') return json_encode(['success' => true, 'id' => 'test-shipment-' . $payload['reference_id'], 'status' => 'confirmed', 'courier' => ['tracking_id' => 'test-tracking', 'waybill_id' => 'TEST-AWB']]);
    throw new RuntimeException('Unexpected external request: ' . $handle->url);
}
function curl_getinfo(object $handle, int $option): int { return $handle->status; }
function curl_error(object $handle): string { return ''; }
