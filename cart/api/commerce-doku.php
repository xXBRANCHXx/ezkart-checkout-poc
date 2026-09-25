<?php
declare(strict_types=1);

require_once __DIR__ . '/commerce-checkout.php';

/** Normalizes only verified DOKU responses. Notification signatures are checked by doku.php first. */
function ez_apply_central_doku_result(array $order, array $notification): array
{
    if (($notification['order']['invoice_number'] ?? '') !== $order['id']
        || !ez_doku_amount_matches($notification['order']['amount'] ?? null, $order['total'])
        || (isset($notification['order']['currency']) && $notification['order']['currency'] !== 'IDR')) {
        throw new InvalidArgumentException('Notification order mismatch.');
    }
    $status = $notification['transaction']['status'] ?? '';
    // Failed attempts and channel expiration do not reverse a captured payment or close a hosted session.
    if (in_array($status, ['PENDING', 'FAILED', 'TIMEOUT', 'EXPIRED', 'REDIRECT'], true)) return $order;
    if ($status !== 'SUCCESS' || (isset($notification['transaction']['type']) && !in_array($notification['transaction']['type'], ['SALE', 'CAPTURE'], true))) {
        throw new RuntimeException('This provider result requires a supported payment or refund adapter.');
    }
    $channel = $notification['channel']['id'] ?? '';
    $original = $notification['transaction']['original_request_id'] ?? '';
    $account = $notification['virtual_account_info']['virtual_account_number'] ?? '';
    if ($channel !== 'VIRTUAL_ACCOUNT_BCA' || !is_string($original) || $original === '' || strlen($original) > 128
        || preg_match('/[\x00-\x1f]/', $original) || !is_string($account) || preg_match('/^\d{8,23}$/D', $account) !== 1) {
        throw new RuntimeException('Verified transaction identity is unavailable for this payment channel.');
    }
    // DOKU documents both spellings. A changing notification ID is not a charge identity.
    $identifiers = $notification['virtual_account_payment']['identifier'] ?? $notification['virtual_account_payment']['identifer'] ?? [];
    $references = [];
    if (is_array($identifiers)) foreach ($identifiers as $identifier) {
        if (!is_array($identifier) || ($identifier['name'] ?? '') !== 'REFERENCE') continue;
        $value = $identifier['value'] ?? null;
        if (!is_string($value) || trim($value) === '' || strlen($value) > 128 || preg_match('/[\x00-\x1f]/', $value)) {
            throw new RuntimeException('Provider payment reference is invalid.');
        }
        $references[] = trim($value);
    }
    if (count(array_unique($references)) !== 1) throw new RuntimeException('A unique provider charge reference is required.');
    $reference = 'doku_bca_' . hash('sha256', ez_json_encode([$channel, $original, $references[0]]));
    require_once __DIR__ . '/commerce-payment-jobs.php';
    return ez_central_payment_event($order, 'capture:' . $reference, 'payment.succeeded', [
        'provider' => 'doku', 'verified' => true, 'amount' => $order['total'], 'currency' => 'IDR',
        'reference' => $reference, 'bankReference' => $references[0], 'originalRequestId' => $original, 'channel' => $channel, 'accountNumber' => $account,
    ]);
}

function ez_doku_central_status(array $order): array
{
    if (strtotime($order['createdAt']) > time() - 60) throw new RuntimeException('Wait before checking provider status.');
    $credentials = ez_doku_credentials($order['environment']);
    $target = '/orders/v1/status/' . rawurlencode($order['id']);
    $requestId = bin2hex(random_bytes(16)); $timestamp = gmdate('Y-m-d\TH:i:s\Z');
    $canonical = 'Client-Id:' . $credentials['client_id'] . "\nRequest-Id:" . $requestId
        . "\nRequest-Timestamp:" . $timestamp . "\nRequest-Target:" . $target;
    $signature = 'HMACSHA256=' . base64_encode(hash_hmac('sha256', $canonical, $credentials['secret_key'], true));
    $host = $order['environment'] === 'production' ? 'https://api.doku.com' : 'https://api-sandbox.doku.com';
    $handle = curl_init($host . $target);
    if ($handle === false) throw new RuntimeException('Provider status is unavailable.');
    $body = '';
    curl_setopt_array($handle, [CURLOPT_HTTPHEADER => ['Accept: application/json', 'Client-Id: ' . $credentials['client_id'],
        'Request-Id: ' . $requestId, 'Request-Timestamp: ' . $timestamp, 'Signature: ' . $signature],
        CURLOPT_CUSTOMREQUEST => 'GET', CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body): int {
            if (strlen($body) + strlen($chunk) > 262144) return 0;
            $body .= $chunk; return strlen($chunk);
        },
    ]);
    $sent = curl_exec($handle); $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $result = json_decode($body, true);
    // In particular, 404 is not documented proof that creating another payment is safe.
    if ($sent === false || $status !== 200 || !is_array($result)) throw new RuntimeException('Provider status did not confirm the payment.');
    return $result;
}
