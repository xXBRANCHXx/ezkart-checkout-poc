<?php
declare(strict_types=1);
// Test-only transport loaded by PHP -n. No provider network calls are possible.
if (extension_loaded('curl') || !getenv('EZKART_TEST_CAPTURE')) throw new RuntimeException('Unsafe test transport setup.');
foreach (['CURLOPT_ENCODING', 'CURLOPT_POST', 'CURLOPT_POSTFIELDS', 'CURLOPT_HTTPHEADER', 'CURLOPT_RETURNTRANSFER', 'CURLOPT_CONNECTTIMEOUT', 'CURLOPT_TIMEOUT', 'CURLOPT_SSL_VERIFYPEER', 'CURLINFO_HTTP_CODE', 'CURLINFO_RESPONSE_CODE', 'CURLOPT_FOLLOWLOCATION', 'CURLOPT_CUSTOMREQUEST', 'CURLOPT_HEADERFUNCTION', 'CURLINFO_CONTENT_TYPE', 'CURLOPT_SSL_VERIFYHOST', 'CURLOPT_WRITEFUNCTION', 'CURLOPT_PROTOCOLS', 'CURLPROTO_HTTPS', 'CURLOPT_NOBODY'] as $index => $constant) define($constant, $index + 1);
function curl_init(string $url): object { return (object) ['url' => $url, 'options' => [], 'status' => 200]; }
function curl_setopt_array(object $handle, array $options): bool { $handle->options = $options; return true; }
function curl_setopt(object $handle, int $option, mixed $value): bool { $handle->options[$option] = $value; return true; }
function curl_close(object $handle): void {}
function curl_exec(object $handle): string|bool {
    $payload = json_decode($handle->options[CURLOPT_POSTFIELDS] ?? '{}', true);
    file_put_contents(getenv('EZKART_TEST_CAPTURE'), json_encode(['url' => $handle->url, 'method' => $handle->options[CURLOPT_CUSTOMREQUEST] ?? (!empty($handle->options[CURLOPT_POST]) ? 'POST' : 'GET'), 'body' => $handle->options[CURLOPT_POSTFIELDS] ?? '', 'headers' => $handle->options[CURLOPT_HTTPHEADER] ?? []]) . "\n", FILE_APPEND | LOCK_EX);
    $barrierDirectory = dirname(getenv('EZKART_TEST_CAPTURE'));
    $barrier = is_file($barrierDirectory . '/provider-barrier.json') ? json_decode((string) file_get_contents($barrierDirectory . '/provider-barrier.json'), true) : null;
    if (is_array($barrier) && is_string($barrier['match'] ?? null) && $barrier['match'] !== '' && str_contains($handle->url, $barrier['match'])) {
        file_put_contents($barrierDirectory . '/provider-entered', 'ready');
        $deadline = microtime(true) + 10;
        do {
            clearstatcache(true, $barrierDirectory . '/provider-release');
            if (is_file($barrierDirectory . '/provider-release')) break;
            if (microtime(true) > $deadline) throw new RuntimeException('Test provider barrier timed out.');
            usleep(10000);
        } while (true);
    }
    $relay = getenv('EZKART_TEST_COMMERCE_RELAY');
    if ($relay && preg_match('#^https://ezkart-api-(?:test|beta)\.fixture\.workers\.dev(/.*)$#D', $handle->url, $relayMatch)) {
        if (preg_match('#^http://127\.0\.0\.1:\d+$#D', $relay) !== 1) throw new RuntimeException('Test relay must be local.');
        $path = $relayMatch[1];
        $context = stream_context_create(['http' => ['method' => $handle->options[CURLOPT_CUSTOMREQUEST] ?? (!empty($handle->options[CURLOPT_POST]) ? 'POST' : 'GET'),
            'header' => implode("\r\n", $handle->options[CURLOPT_HTTPHEADER] ?? []), 'content' => $handle->options[CURLOPT_POSTFIELDS] ?? '', 'ignore_errors' => true, 'timeout' => $handle->options[CURLOPT_TIMEOUT] ?? 20]]);
        // Match cURL's incremental write callback. Buffering an entire private
        // attachment here bypasses the application's bounded spool and exhausts
        // PHP's memory limit even when the real transfer uses constant memory.
        $stream = @fopen($relay . $path, 'rb', false, $context);
        $responseHeaders = http_get_last_response_headers() ?? [];
        $handle->status = preg_match('#^HTTP/\S+ (\d+)#', $responseHeaders[0] ?? '', $matches) ? (int) $matches[1] : 503;
        foreach ($responseHeaders as $header) {
            if (stripos($header, 'Content-Type:') === 0) $handle->contentType = trim(substr($header, 13));
            if (isset($handle->options[CURLOPT_HEADERFUNCTION])) ($handle->options[CURLOPT_HEADERFUNCTION])($handle, $header . "\r\n");
        }
        if ($stream === false) return false;
        $response = '';
        try {
            while (!feof($stream)) {
                $bytes = fread($stream, 8192);
                if ($bytes === false || stream_get_meta_data($stream)['timed_out']) return false;
                if (isset($handle->options[CURLOPT_WRITEFUNCTION])) {
                    if (($handle->options[CURLOPT_WRITEFUNCTION])($handle, $bytes) !== strlen($bytes)) return false;
                } else $response .= $bytes;
            }
        } finally { fclose($stream); }
        return isset($handle->options[CURLOPT_WRITEFUNCTION]) ? true : $response;
    }
    if (getenv('EZKART_TEST_SNAP') && preg_match('#^https://api(?:-sandbox)?\.doku\.com/(authorization/v1/access-token/b2b|virtual-accounts/bi-snap-va/v1.1/transfer-va/create-va|orders/v1.0/transfer-va/status)$#D', $handle->url, $snapMatch)) {
        $directory = dirname(getenv('EZKART_TEST_CAPTURE'));
        $control = is_file($directory . '/snap-control.json') ? json_decode((string) file_get_contents($directory . '/snap-control.json'), true) : [];
        if (str_starts_with($snapMatch[1], 'authorization/')) {
            $response = ['responseCode' => '2007300', 'tokenType' => 'Bearer', 'accessToken' => 'fixture-snap-payment-token', 'expiresIn' => 900];
            if (!empty($control['tokenDenied'])) { $handle->status = 401; $response = ['responseCode' => '4017300']; }
        } elseif (str_starts_with($snapMatch[1], 'virtual-accounts/')) {
            $file = $directory . '/snap-accounts.json';
            $accounts = is_file($file) ? json_decode((string) file_get_contents($file), true) : [];
            if (isset($accounts[$payload['trxId']])) { $handle->status = 409; $response = ['responseCode' => '4092700']; }
            else {
                $data = $payload; $data['customerNo'] = '00000347140'; $data['virtualAccountNo'] = $payload['partnerServiceId'] . $data['customerNo'];
                $response = ['responseCode' => '2002700', 'responseMessage' => 'Successful', 'virtualAccountData' => $data];
                $accounts[$payload['trxId']] = $response; file_put_contents($file, json_encode($accounts));
                if (!empty($control['loseCreate'])) { $handle->status = 503; $response = ['responseCode' => '5032700']; }
                if (!empty($control['wrongAmount'])) $response['virtualAccountData']['totalAmount']['value'] = '1.00';
            }
        } else $response = ['responseCode' => '2002600', 'virtualAccountData' => []];
        $body = json_encode($response);
        if (isset($handle->options[CURLOPT_WRITEFUNCTION])) return ($handle->options[CURLOPT_WRITEFUNCTION])($handle, $body) === strlen($body);
        return $body;
    }
    if (getenv('EZKART_TEST_WALLET') && preg_match('#^https://api-sandbox.doku.com/(authorization/v1/access-token/b2b|sub-account/v2.0/(register|balance-inquiries|transaction-history-list))$#D', $handle->url, $walletMatch)) {
        $directory = dirname(getenv('EZKART_TEST_CAPTURE'));
        $control = is_file($directory . '/wallet-control.json') ? json_decode((string) file_get_contents($directory . '/wallet-control.json'), true) : [];
        $profilesFile = $directory . '/wallet-profiles.json';
        $profiles = is_file($profilesFile) ? json_decode((string) file_get_contents($profilesFile), true) : [];
        $parent = getenv('EZKART_DOKU_SANDBOX_PARENT_PROFILE_ID');
        if (str_starts_with($walletMatch[1], 'authorization/')) {
            $response = ['responseCode' => '2007300', 'responseMessage' => 'Successful', 'accessToken' => 'fixture-snap-wallet-token', 'tokenType' => 'Bearer', 'expiresIn' => 900];
            if (!empty($control['tokenDenied'])) { $handle->status = 401; $response = ['responseCode' => '4017300']; }
        } elseif ($walletMatch[2] === 'register') {
            $reference = $payload['partnerReferenceNo'];
            if (isset($profiles[$reference]) || !empty($control['duplicate'])) { $handle->status = 409; $response = ['responseCode' => '4090000']; }
            else {
                $number = str_pad((string) hexdec(substr(hash('sha256', $reference), 0, 7)), 9, '0', STR_PAD_LEFT);
                $response = ['responseCode' => '2000000', 'responseMessage' => 'Successful', 'profileId' => 'SAC-' . substr(hash('sha256', $reference), 0, 18), 'parentProfileId' => $parent, 'accounts' => [
                    ['type' => 'DOKU_MERCHANT_IDR', 'currency' => 'IDR', 'accountNo' => '1' . $number],
                    ['type' => 'DOKU_MERCHANT_PENDING_IDR', 'currency' => 'IDR', 'accountNo' => '2' . $number],
                ]];
                if (!empty($control['numericAccounts'])) {
                    foreach ($response['accounts'] as &$providerAccount) $providerAccount['accountNo'] = (int) $providerAccount['accountNo'];
                    unset($providerAccount);
                }
                $profiles[$reference] = $response; file_put_contents($profilesFile, json_encode($profiles));
                if (!empty($control['loseRegister'])) { $handle->status = 503; $response = ['responseCode' => '5030000']; }
                if (!empty($control['wrongParent'])) $response['parentProfileId'] = 'BRN-foreign';
            }
        } elseif ($walletMatch[2] === 'transaction-history-list') {
            $historyFile = $directory . '/wallet-history.json';
            $history = is_file($historyFile) ? json_decode((string) file_get_contents($historyFile), true) : [];
            $rows = $history[$payload['accountNo']] ?? [];
            $response = ['responseCode' => '2000000', 'detailData' => array_slice($rows, (int) $payload['pageSize'] * (int) $payload['pageNumber'], (int) $payload['pageSize'])];
            if (!empty($control['historyUnavailable'])) { $handle->status = 503; $response = ['responseCode' => '5030000']; }
        } else {
            $response = null;
            foreach ($profiles as $profile) if ($profile['profileId'] === $payload['profileId']) $response = $profile;
            if ($payload['profileId'] === $parent) $response = ['responseCode' => '2000000', 'profileId' => $parent, 'accounts' => [
                ['type' => 'DOKU_MERCHANT_IDR', 'currency' => 'IDR', 'accountNo' => 1000000001], ['type' => 'DOKU_MERCHANT_POINT', 'currency' => 'POINT', 'accountNo' => 1000000002],
            ]];
            if ($response === null) { $handle->status = 404; $response = ['responseCode' => '4040000']; }
            else {
                $response['name'] = 'Fixture account';
                foreach ($response['accounts'] as &$walletAccount) $walletAccount['balance'] = ['available' => '0.00', 'reserved' => '0.00'];
                unset($walletAccount);
                if ($payload['profileId'] !== $parent && !empty($control['wrongConfirmation'])) $response['accounts'][0]['accountNo'] = '1999999999';
                if ($payload['profileId'] !== $parent && !empty($control['confirmationUnavailable'])) { $handle->status = 503; $response = ['responseCode' => '5030000']; }
            }
        }
        $body = json_encode($response);
        if (isset($handle->options[CURLOPT_WRITEFUNCTION])) return ($handle->options[CURLOPT_WRITEFUNCTION])($handle, $body) === strlen($body);
        return $body;
    }
    if (preg_match('#^https://api-sandbox.doku.com/orders/v1/status/EZK-S-[A-F0-9]{24}$#D', $handle->url)) {
        $file = dirname(getenv('EZKART_TEST_CAPTURE')) . '/provider-status.json';
        $response = is_file($file) ? (string) file_get_contents($file) : '{"error":"not_found"}';
        $handle->status = is_file($file) ? 200 : 404;
        if (isset($handle->options[CURLOPT_WRITEFUNCTION])) return ($handle->options[CURLOPT_WRITEFUNCTION])($handle, $response) === strlen($response);
        return $response;
    }
    if (preg_match('#^https://ezkart-api-test.fixture.workers.dev/internal/commerce/orders/(EZK-[SP]-[A-F0-9]{24})/claim$#D', $handle->url, $claimMatch)) {
        $returnFile = dirname(getenv('EZKART_TEST_CAPTURE')) . '/returns.json';
        $returnFixture = is_file($returnFile) ? json_decode((string) file_get_contents($returnFile), true) : [];
        $allowed = ($returnFixture['orderId'] ?? '') === $claimMatch[1] && ($payload['customer']['id'] ?? '') === ($returnFixture['owner'] ?? 'fixture-google-customer');
        $handle->status = $allowed ? 200 : 404;
        $response = $allowed ? json_encode(['ok' => true, 'orderId' => $claimMatch[1], 'authUserId' => $payload['customer']['id']]) : '{"ok":false,"error":"Order not found"}';
        if (isset($handle->options[CURLOPT_WRITEFUNCTION])) return ($handle->options[CURLOPT_WRITEFUNCTION])($handle, $response) === strlen($response);
        return $response;
    }
    if (preg_match('#^https://ezkart-api-test.fixture.workers.dev/v1/customer/orders/(EZK-[SP]-[A-F0-9]{24})/returns(?:/(ret_[a-f0-9]{32}))?(?:\\?.*)?$#D', $handle->url, $returnMatch)) {
        $fixture = json_decode((string) file_get_contents(dirname(getenv('EZKART_TEST_CAPTURE')) . '/returns.json'), true);
        if (($fixture['orderId'] ?? '') !== $returnMatch[1]) { $handle->status = 404; return '{"ok":false,"error":"Order not found"}'; }
        return json_encode(['ok' => true] + ($fixture['response'] ?? []));
    }
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
            return json_encode(['ok' => true, 'products' => $shop['catalog'], 'drafts' => $shop['drafts'] ?? []]);
        }
        if ($path === '/v1/inventory' && isset($shop['inventory'])) return json_encode(['ok' => true] + $shop['inventory']);
        if ($path === '/v1/inventory/history' && isset($shop['inventory'])) return json_encode(['ok' => true, 'items' => [], 'nextCursor' => null]);
        if ($path === '/v1/returns') return json_encode(['ok' => true, 'items' => [], 'nextCursor' => null, 'sellerId' => 'seller_fixture', 'canCreate' => true, 'enabled' => true]);
        if ($path === '/v1/inventory/reviews' && isset($shop['inventory'])) return json_encode(['ok' => true, 'items' => [], 'nextCursor' => null]);
        if ($path === '/v1/inventory/draft' && isset($shop['inventory'])) return json_encode(['ok' => true, 'draft' => null]);
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
        $tokens = static function (string $aal = 'aal1', string $suffix = 'fixture-signature') use ($config): array {
            if (isset($config['wallet_tokens']) && $suffix === 'wallet-verified') return $config['wallet_tokens'];
            $token = 'fixture.' . rtrim(strtr(base64_encode(json_encode(['aal' => $aal, 'exp' => time() + 3600, 'sub' => 'fixture-google-customer'])), '+/', '-_'), '=') . '.' . $suffix;
            return ['access_token' => $token, 'refresh_token' => 'fixture-refresh-token', 'expires_in' => 3600];
        };
        if ($path === 'token?grant_type=refresh_token' && isset($config['refresh_error'])) {
            $handle->status = $config['refresh_error']; return '{"error":"fixture_refresh_error"}';
        }
        if (str_starts_with($path, 'token?grant_type=')) return json_encode($tokens());
        if ($path === 'user') {
            if (!empty($config['user_error'])) { $handle->status = 503; return '{"error":"unavailable"}'; }
            $verified = str_contains(implode(' ', $handle->options[CURLOPT_HTTPHEADER] ?? []), '.wallet-verified');
            return json_encode(array_replace([
            'id' => 'fixture-google-customer', 'email' => 'checkout@example.com', 'email_confirmed_at' => '2026-09-01T00:00:00Z',
            'identities' => [['provider' => 'google']], 'factors' => [],
            ], $config['user'] ?? [], $verified ? ($config['verified_user'] ?? []) : []));
        }
        if ($path === 'otp') {
            if (!empty($config['otp_send_error'])) { $handle->status = 429; return '{"error":"email_rate_limit_exceeded"}'; }
            file_put_contents(dirname($file) . '/email-otp.json', json_encode(['email' => $payload['email'], 'code' => '654321', 'used' => false]));
            return '{}';
        }
        if ($path === 'verify') {
            $otpFile = dirname($file) . '/email-otp.json';
            $otp = is_file($otpFile) ? json_decode((string) file_get_contents($otpFile), true) : [];
            if (($payload['type'] ?? '') !== 'email' || ($payload['email'] ?? '') !== ($otp['email'] ?? '') || ($payload['token'] ?? '') !== ($otp['code'] ?? '') || !empty($otp['used'])) { $handle->status = 400; return '{"error":"invalid_otp"}'; }
            $otp['used'] = true; file_put_contents($otpFile, json_encode($otp));
            return json_encode($tokens('aal1', 'wallet-verified'));
        }
        if (preg_match('#^factors/[a-f0-9-]{36}/challenge$#i', $path)) return '{"id":"22222222-2222-4222-8222-222222222222"}';
        if (preg_match('#^factors/[a-f0-9-]{36}/verify$#i', $path)) {
            if (($payload['code'] ?? '') !== '123456' || ($payload['challenge_id'] ?? '') !== '22222222-2222-4222-8222-222222222222') { $handle->status = 400; return '{"error":"bad_code"}'; }
            return json_encode($tokens(!empty($config['mfa_downgrade']) ? 'aal1' : 'aal2', 'wallet-verified'));
        }
        if ($path === 'factors/fixture-totp/challenge') return '{"id":"fixture-challenge"}';
        if ($path === 'factors/fixture-totp/verify') {
            if (($payload['code'] ?? '') !== '123456') { $handle->status = 400; return '{"error":"bad_code"}'; }
            return json_encode($tokens('aal2'));
        }
        if ($path === 'logout?scope=local') { $handle->status = 204; return ''; }
        throw new RuntimeException('Unexpected auth fixture request: ' . $path);
    }
    if (getenv('EZKART_TEST_CENTRAL_COURIER') && str_starts_with($handle->url, 'https://api.biteship.com/v1/orders')) {
        // Persist a provider-side shipment even when its HTTP response is lost.
        $directory = dirname(getenv('EZKART_TEST_CAPTURE'));
        $path = substr($handle->url, strlen('https://api.biteship.com/v1/orders'));
        $configFile = $directory . '/courier-control.json';
        $control = is_file($configFile) ? json_decode((string) file_get_contents($configFile), true) : [];
        $storeFile = $directory . '/courier-orders.json';
        $orders = is_file($storeFile) ? json_decode((string) file_get_contents($storeFile), true) : [];
        if ($path === '') {
            $id = 'courier_' . hash('md5', $payload['reference_id']);
            if (isset($orders[$id])) {
                $handle->status = 400; $response = ['success' => false, 'code' => 40002060, 'details' => ['order_id' => $id, 'reference_id' => $payload['reference_id']]];
            } else {
                $response = ['success' => true, 'id' => $id, 'reference_id' => $payload['reference_id'], 'status' => 'confirmed', 'courier' => ['tracking_id' => 'tracking_fixture', 'waybill_id' => 'WB-FIXTURE'], 'price' => 18000];
                $orders[$id] = $response; file_put_contents($storeFile, json_encode($orders));
                if (!empty($control['earlyEvent'])) ez_central_courier_webhook(['event' => 'order.status', 'order_id' => $id] + $control['earlyEvent'], 'sandbox');
                if (!empty($control['loseCreate'])) { $handle->status = 503; $response = ['success' => false]; }
                if (!empty($control['omitReference'])) unset($response['reference_id']);
            }
        } else {
            $id = explode('/', ltrim($path, '/'))[0];
            $response = $orders[$id] ?? ['success' => false];
            if (!isset($orders[$id])) $handle->status = 404;
            if (str_ends_with($path, '/cancel')) {
                $orders[$id]['status'] = 'cancelled'; file_put_contents($storeFile, json_encode($orders));
                $response = ['success' => true, 'id' => $id, 'status' => 'cancelled'];
                if (!empty($control['loseCancel'])) { $handle->status = 503; $response = ['success' => false]; }
            } else {
                if (!empty($control['readUnavailable'])) { $handle->status = 503; $response = ['success' => false]; }
                if (!empty($control['wrongReference'])) $response['reference_id'] = 'ANOTHER-ORDER';
                if (!empty($control['concurrentEvent'])) {
                    ez_central_courier_webhook(['event' => 'order.status', 'order_id' => $id] + $control['concurrentEvent'], 'sandbox');
                    unset($control['concurrentEvent']); file_put_contents($configFile, json_encode($control));
                }
            }
        }
        $body = json_encode($response);
        if (isset($handle->options[CURLOPT_WRITEFUNCTION])) return ($handle->options[CURLOPT_WRITEFUNCTION])($handle, $body) === strlen($body);
        return $body;
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
    if ($handle->url === 'https://api.biteship.com/v1/rates/couriers') {
        $controlFile = dirname(getenv('EZKART_TEST_CAPTURE')) . '/rates-control.json';
        if (is_file($controlFile)) {
            $rates = json_decode(file_get_contents($controlFile), true);
            $request = json_decode($handle->options[CURLOPT_POSTFIELDS] ?? '{}', true);
            return json_encode(['success' => true, 'pricing' => $rates[$request['couriers'] ?? ''] ?? $rates['default'] ?? []]);
        }
        return json_encode(['success' => true, 'pricing' => [['courier_code' => 'jne', 'courier_service_code' => 'reg', 'courier_name' => 'JNE', 'courier_service_name' => 'Regular', 'price' => 18000, 'duration' => '2-3', 'shipment_duration_unit' => 'days']]]);
    }
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
        return json_encode(['response' => ['order' => $payload['order'], 'payment' => ['url' => 'https://' . $host . '/checkout-link-v2/fixture', 'expired_date' => (new DateTimeImmutable('+1 hour', new DateTimeZone('Asia/Jakarta')))->format('YmdHis')]]]);
    }
    if ($handle->url === 'https://api.biteship.com/v1/orders') return json_encode(['success' => true, 'id' => 'test-shipment-' . $payload['reference_id'], 'status' => 'confirmed', 'courier' => ['tracking_id' => 'test-tracking', 'waybill_id' => 'TEST-AWB']]);
    throw new RuntimeException('Unexpected external request: ' . $handle->url);
}
function curl_getinfo(object $handle, int $option): int|string { return $option === CURLINFO_CONTENT_TYPE ? ($handle->contentType ?? 'application/json') : $handle->status; }
function curl_error(object $handle): string { return ''; }
