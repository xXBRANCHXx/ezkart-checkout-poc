<?php
declare(strict_types=1);
// Test-only transport loaded by PHP -n. No provider network calls are possible.
if (extension_loaded('curl') || !getenv('EZKART_TEST_CAPTURE')) throw new RuntimeException('Unsafe test transport setup.');
foreach (['CURLOPT_POST', 'CURLOPT_POSTFIELDS', 'CURLOPT_HTTPHEADER', 'CURLOPT_RETURNTRANSFER', 'CURLOPT_CONNECTTIMEOUT', 'CURLOPT_TIMEOUT', 'CURLOPT_SSL_VERIFYPEER', 'CURLINFO_HTTP_CODE', 'CURLINFO_RESPONSE_CODE', 'CURLOPT_FOLLOWLOCATION', 'CURLOPT_CUSTOMREQUEST', 'CURLOPT_HEADERFUNCTION', 'CURLINFO_CONTENT_TYPE'] as $index => $constant) define($constant, $index + 1);
function curl_init(string $url): object { return (object) ['url' => $url, 'options' => [], 'status' => 200]; }
function curl_setopt_array(object $handle, array $options): bool { $handle->options = $options; return true; }
function curl_exec(object $handle): string {
    $payload = json_decode($handle->options[CURLOPT_POSTFIELDS] ?? '{}', true);
    file_put_contents(getenv('EZKART_TEST_CAPTURE'), json_encode(['url' => $handle->url, 'method' => !empty($handle->options[CURLOPT_POST]) ? 'POST' : 'GET', 'body' => $handle->options[CURLOPT_POSTFIELDS] ?? '', 'headers' => $handle->options[CURLOPT_HTTPHEADER] ?? []]) . "\n", FILE_APPEND | LOCK_EX);
    $shopFile = dirname(getenv('EZKART_TEST_CAPTURE')) . '/storefront.json';
    if (str_starts_with($handle->url, 'https://ezkart-api-test.fixture.workers.dev/v1/') && is_file($shopFile)) {
        $shop = json_decode((string) file_get_contents($shopFile), true);
        $path = parse_url($handle->url, PHP_URL_PATH);
        parse_str((string) parse_url($handle->url, PHP_URL_QUERY), $query);
        if ($path === '/v1/storefront/view') {
            if (empty($query['product']) && empty($shop['store']['enabled']) && ($query['mode'] ?? '') !== 'checkout') { $handle->status = 404; return '{"ok":false}'; }
            $products = array_values(array_filter($shop['products'], static fn($product) => empty($query['product']) || $product['id'] === $query['product']));
            return json_encode(['ok' => true, 'store' => $shop['store'], 'products' => ($query['mode'] ?? '') === 'checkout' ? [] : $products]);
        }
        if ($path === '/v1/storefront/products') return json_encode(['ok' => true, 'products' => array_values(array_filter($shop['selections'], static fn($product) => in_array($product['id'], explode(',', $query['ids']), true)))]);
        if ($path === '/v1/me') {
            if (!empty($shop['identityUnavailable'])) { $handle->status = 503; return '{"ok":false}'; }
            return json_encode(['ok' => true, 'user' => ['active_seller' => ['id' => $shop['store']['sellerId'] ?? 'seller_fixture']]]);
        }
        if ($path === '/v1/catalog') {
            if (!empty($shop['catalogUnavailable'])) { $handle->status = 503; return '{"ok":false}'; }
            return json_encode(['ok' => true, 'products' => $shop['catalog'], 'drafts' => []]);
        }
        if ($path === '/v1/storefront') {
            if (($handle->options[CURLOPT_CUSTOMREQUEST] ?? '') === 'PUT') {
                $shop['store'] = array_replace($shop['store'], $payload);
                foreach (['logo', 'background'] as $kind) $shop['store'][$kind . 'Path'] = !empty($payload[$kind . 'Id']) ? '/v1/public/media/' . $payload[$kind . 'Id'] : '';
                file_put_contents($shopFile, json_encode($shop));
            }
            return json_encode(['ok' => true, 'store' => $shop['store']]);
        }
        if ($path === '/v1/media') return '{"ok":true,"media":{"id":"media_fixture","path":"/v1/media/media_fixture"}}';
        if ($path === '/v1/landing-pages' || $path === '/v1/components') return '{"ok":true,"pages":[],"components":[]}';
    }
    if ($handle->url === 'https://ezkart-api-test.fixture.workers.dev/v1/customer/addresses') {
        $file = dirname(getenv('EZKART_TEST_CAPTURE')) . '/address-book.json';
        $book = is_file($file) ? json_decode((string) file_get_contents($file), true) : ['addresses' => [], 'default_id' => '', 'revision' => 0, 'limit' => 3];
        if (!empty($handle->options[CURLOPT_POST])) {
            if (($payload['revision'] ?? -1) !== $book['revision']) { $handle->status = 409; return '{"ok":false,"error":"Addresses changed. Please try again."}'; }
            $index = array_search($payload['id'] ?? '', array_column($book['addresses'], 'id'), true);
            if ($payload['action'] === 'save') {
                if ($index === false && count($book['addresses']) >= 3) { $handle->status = 409; return '{"ok":false,"error":"Three addresses maximum."}'; }
                $address = $payload['address']; $address['id'] = $index === false ? bin2hex(random_bytes(12)) : $payload['id'];
                if ($index === false) $book['addresses'][] = $address; else $book['addresses'][$index] = $address;
                if ($book['default_id'] === '' || !empty($payload['make_default'])) $book['default_id'] = $address['id'];
            } elseif ($index !== false && $payload['action'] === 'pin') $book['addresses'][$index]['coordinate'] = $payload['coordinate'];
            elseif ($index !== false && $payload['action'] === 'default') $book['default_id'] = $payload['id'];
            elseif ($index !== false && $payload['action'] === 'delete') {
                array_splice($book['addresses'], $index, 1);
                if ($book['default_id'] === $payload['id']) $book['default_id'] = $book['addresses'][0]['id'] ?? '';
            }
            $book['revision']++; file_put_contents($file, json_encode($book));
        }
        return json_encode(['ok' => true, 'book' => $book]);
    }
    if (str_starts_with($handle->url, 'https://photon.komoot.io/api/?')) {
        $file = dirname(getenv('EZKART_TEST_CAPTURE')) . '/address-response.json';
        if (is_file($file)) return (string) file_get_contents($file);
        return json_encode(['type' => 'FeatureCollection', 'features' => [
            ['type' => 'Feature', 'geometry' => ['type' => 'Point', 'coordinates' => [106.8214547, -6.1957601]], 'properties' => ['name' => 'Example delivery building', 'street' => 'Jalan Teluk Betung', 'housenumber' => '12', 'city' => 'Jakarta', 'countrycode' => 'ID', 'type' => 'house']],
            ['type' => 'Feature', 'geometry' => ['type' => 'Point', 'coordinates' => [106.82, -6.19]], 'properties' => ['name' => '<img src=x onerror="window.addressInjected=true"> Example road', 'city' => 'Jakarta', 'countrycode' => 'ID', 'type' => 'street']],
        ]]);
    }
    if (str_starts_with($handle->url, 'https://routing.openstreetmap.de/routed-car/route/v1/driving/')) {
        $file = dirname(getenv('EZKART_TEST_CAPTURE')) . '/route-response.json';
        if (is_file($file)) return (string) file_get_contents($file);
        $path = explode('/', parse_url($handle->url, PHP_URL_PATH));
        $points = array_map(static fn($p) => array_map('floatval', explode(',', $p)), explode(';', end($path)));
        return json_encode(['code' => 'Ok', 'routes' => [['geometry' => ['type' => 'LineString', 'coordinates' => $points]]]]);
    }
    if (str_starts_with($handle->url, 'https://auth.ezkart.test/auth/v1/')) {
        $file = dirname(getenv('EZKART_TEST_CAPTURE')) . '/auth-response.json';
        $config = is_file($file) ? json_decode((string) file_get_contents($file), true) : [];
        $path = substr($handle->url, strlen('https://auth.ezkart.test/auth/v1/'));
        $tokens = static function (string $aal = 'aal1'): array {
            $token = 'fixture.' . rtrim(strtr(base64_encode(json_encode(['aal' => $aal, 'exp' => time() + 3600, 'sub' => 'fixture-google-customer'])), '+/', '-_'), '=') . '.fixture-signature';
            return ['access_token' => $token, 'refresh_token' => 'fixture-refresh-token', 'expires_in' => 3600];
        };
        if ($path === 'token?grant_type=refresh_token' && isset($config['refresh_error'])) {
            $handle->status = $config['refresh_error']; return '{"error":"fixture_refresh_error"}';
        }
        if (str_starts_with($path, 'token?grant_type=')) return json_encode($tokens());
        if ($path === 'user') return json_encode(array_replace([
            'id' => 'fixture-google-customer', 'email' => 'checkout@example.com', 'email_confirmed_at' => '2026-09-01T00:00:00Z',
            'identities' => [['provider' => 'google']], 'factors' => [],
        ], $config['user'] ?? []));
        if ($path === 'factors/fixture-totp/challenge') return '{"id":"fixture-challenge"}';
        if ($path === 'factors/fixture-totp/verify') {
            if (($payload['code'] ?? '') !== '123456') { $handle->status = 400; return '{"error":"bad_code"}'; }
            return json_encode($tokens('aal2'));
        }
        if ($path === 'logout?scope=local') { $handle->status = 204; return ''; }
        throw new RuntimeException('Unexpected auth fixture request: ' . $path);
    }
    if (str_starts_with($handle->url, 'https://api.biteship.com/v1/orders/')) {
        // Simulate a webhook arriving while a provider read is in flight.
        $eventPath = dirname(getenv('EZKART_TEST_CAPTURE')) . '/tracking-concurrent-event.json';
        if (is_file($eventPath)) {
            $event = json_decode((string) file_get_contents($eventPath), true);
            unlink($eventPath);
            ez_apply_biteship_webhook($event, 'sandbox');
        }
        $fixturePath = dirname(getenv('EZKART_TEST_CAPTURE')) . '/tracking-response.json';
        if (!is_file($fixturePath)) { $handle->status = 503; return '{"success":false}'; }
        $response = (string) file_get_contents($fixturePath);
        if ($response === 'unavailable') { $handle->status = 503; return '{"success":false}'; }
        return $response;
    }
    if ($handle->url === 'https://api.biteship.com/v1/rates/couriers') return json_encode(['success' => true, 'pricing' => [['courier_code' => 'jne', 'courier_service_code' => 'reg', 'courier_name' => 'JNE', 'courier_service_name' => 'Regular', 'price' => 18000, 'duration' => '2-3', 'shipment_duration_unit' => 'days']]]);
    if ($handle->url === 'https://api-sandbox.doku.com/bca-virtual-account/v2/payment-code') {
        if (getenv('EZKART_TEST_DOKU_FAILURE')) { $handle->status = 503; return '{"error_messages":["Fixture unavailable"]}'; }
        // DOKU's direct response echoes the invoice; it does not normally echo an amount.
        $response = ['order' => ['invoice_number' => $payload['order']['invoice_number']], 'virtual_account_info' => ['virtual_account_number' => '1900800000999999', 'expired_date_utc' => gmdate('Y-m-d\TH:i:s\Z', time() + 3600)]];
        switch (getenv('EZKART_TEST_DIRECT_RESPONSE')) {
            case 'invoice': $response['order']['invoice_number'] = 'WRONG'; break;
            case 'amount': $response['order']['amount'] = 1; break;
            case 'currency': $response['order']['currency'] = 'USD'; break;
            case 'number': $response['virtual_account_info']['virtual_account_number'] = '<script>123</script>'; break;
            case 'expiry': $response['virtual_account_info']['expired_date_utc'] = '2026-99-99T12:00:00Z'; break;
            case 'expired': $response['virtual_account_info']['expired_date_utc'] = '2020-01-01T00:00:00Z'; break;
            case 'local_expiry': unset($response['virtual_account_info']['expired_date_utc']); $response['virtual_account_info']['expired_date'] = (new DateTimeImmutable('+1 hour', new DateTimeZone('Asia/Jakarta')))->format('YmdHis'); break;
        }
        return json_encode($response);
    }
    if (in_array($handle->url, ['https://api-sandbox.doku.com/checkout/v1/payment', 'https://api.doku.com/checkout/v1/payment'], true)) {
        if (getenv('EZKART_TEST_DOKU_FAILURE')) { $handle->status = 503; return '{"error_messages":["Fixture unavailable"]}'; }
        $host = str_contains($handle->url, 'api-sandbox') ? 'staging.doku.com' : 'jokul.doku.com';
        return json_encode(['response' => ['order' => $payload['order'], 'payment' => ['url' => 'https://' . $host . '/checkout-link-v2/fixture', 'expired_date' => '20301231235959']]]);
    }
    if ($handle->url === 'https://api.biteship.com/v1/orders') return json_encode(['success' => true, 'id' => 'test-shipment-' . $payload['reference_id'], 'status' => 'confirmed', 'courier' => ['tracking_id' => 'test-tracking', 'waybill_id' => 'TEST-AWB']]);
    throw new RuntimeException('Unexpected external request: ' . $handle->url);
}
function curl_getinfo(object $handle, int $option): int|string { return $option === CURLINFO_CONTENT_TYPE ? 'application/json' : $handle->status; }
function curl_error(object $handle): string { return ''; }
