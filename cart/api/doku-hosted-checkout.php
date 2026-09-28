<?php
declare(strict_types=1);
require_once __DIR__ . '/doku-payment-routing.php';
/** DOKU Checkout with original Sub-Account routing. Never receives shopper card data. */
final class EzDokuHostedCheckoutClient extends EzDokuPaymentRoutingClient
{
    public function paymentPayload(array $b): array
    {
        $keys = ['environment','credentialFingerprint','externalId','orderId','amount','name','email','expiresAt','paymentDueMinutes','methods','returnUrl','notificationUrl','routing'];
        if (count($b) !== count($keys) || array_diff(array_keys($b), $keys) || ($b['environment'] ?? null) !== $this->credentials['environment']
            || ($b['credentialFingerprint'] ?? null) !== $this->credentialFingerprint
            || !is_string($b['externalId'] ?? null) || preg_match('/^[A-Za-z0-9_-]{1,128}$/D', $b['externalId']) !== 1
            || !is_string($b['orderId'] ?? null) || preg_match('/^EZK-' . ($b['environment'] === 'sandbox' ? 'S' : 'P') . '-[A-F0-9]{24}$/D', $b['orderId']) !== 1
            || !is_int($b['amount'] ?? null) || $b['amount'] < 1 || $b['amount'] > 999999999999
            || !is_string($b['name'] ?? null) || $b['name'] === '' || strlen($b['name']) > 1020
            || !is_string($b['email'] ?? null) || strlen($b['email']) > 128 || !filter_var($b['email'], FILTER_VALIDATE_EMAIL)
            || !is_int($b['paymentDueMinutes'] ?? null) || $b['paymentDueMinutes'] < 1 || $b['paymentDueMinutes'] > 1440
            || !is_array($b['methods'] ?? null) || count($b['methods']) < 1 || count($b['methods']) > 3
            || array_diff($b['methods'], ['QRIS','CREDIT_CARD','VIRTUAL_ACCOUNT_BCA']) || count(array_unique($b['methods'])) !== count($b['methods'])
            || preg_match('/^SAC-[A-Za-z0-9_-]{1,18}$/D', $b['routing']['profileId'] ?? '') !== 1
            || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/D', $b['routing']['splitRuleId'] ?? '') !== 1) throw new EzDokuReadException('checkout_binding');
        $origin = parse_url($b['returnUrl'], PHP_URL_SCHEME) . '://' . parse_url($b['returnUrl'], PHP_URL_HOST);
        if (!in_array($origin, ['https://test.ezkart.id','https://ezkart.id'], true)
            || $b['returnUrl'] !== $origin . '/cart/payment.php?order=' . $b['orderId']
            || $b['notificationUrl'] !== $origin . '/cart/api/doku-hosted-webhook.php'
            || ($b['environment'] === 'sandbox' && $origin !== 'https://test.ezkart.id')) throw new EzDokuReadException('checkout_origin');
        return ['order' => ['invoice_number' => $b['orderId'], 'amount' => $b['amount'], 'currency' => 'IDR',
            'callback_url' => $b['returnUrl'], 'callback_url_result' => $b['returnUrl'], 'auto_redirect' => false,
            'disable_retry_payment' => true, 'recover_abandoned_cart' => false],
            'payment' => ['payment_due_date' => $b['paymentDueMinutes'], 'type' => 'SALE', 'payment_method_types' => $b['methods']],
            'customer' => ['name' => $b['name'], 'email' => $b['email']],
            'additional_info' => ['override_notification_url' => $b['notificationUrl']],
            // Current Collect & Route V2 documents camelCase for Checkout too.
            'additionalInfo' => ['account' => ['id' => $b['routing']['profileId'], 'split_rule_id' => $b['routing']['splitRuleId']]]];
    }
    public function createSession(array $binding): array
    {
        [$response, $evidence] = $this->checkoutRequest($this->paymentPayload($binding), $binding['externalId']);
        $order = $response->response->order ?? null; $payment = $response->response->payment ?? null;
        $amount = $order->amount ?? null; $amount = $amount instanceof EzDokuJsonNumber ? $amount->value : $amount;
        if (($response->message ?? null) !== ['SUCCESS'] || ($order->invoice_number ?? null) !== $binding['orderId']
            || !is_string($amount) || !in_array($amount, [(string) $binding['amount'], $binding['amount'] . '.00'], true)
            || (isset($order->currency) && $order->currency !== 'IDR') || !is_string($payment->url ?? null)
            || !ez_doku_payment_url_valid($payment->url, $binding['environment']) || preg_match('~^https://[^/]+/(?:checkout-link(?:-v2)?|checkout/link)/[A-Za-z0-9_-]+$~D', $payment->url) !== 1
            || !is_string($payment->token_id ?? null) || basename(parse_url($payment->url, PHP_URL_PATH)) !== $payment->token_id
            || !is_string($payment->expired_date ?? null) || preg_match('/^[0-9]{14}$/D', $payment->expired_date) !== 1) throw new EzDokuReadException('checkout_session');
        return ['evidence' => $evidence];
    }
    public function authenticateNotification(string $body, array $headers, string $target): stdClass
    {
        if ($target !== '/cart/api/doku-hosted-webhook.php' || strlen($body) > 262144) throw new EzDokuReadException('notification_target');
        foreach (['client-id','request-id','request-timestamp','signature'] as $key) {
            if (!is_string($headers[$key] ?? null) || $headers[$key] === '' || strlen($headers[$key]) > 256 || preg_match('/[\x00-\x1f\x7f]/', $headers[$key])) throw new EzDokuReadException('notification_headers');
        }
        $stamp = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z', $headers['request-timestamp'], new DateTimeZone('UTC'));
        if (!$stamp || $stamp->format('Y-m-d\TH:i:s\Z') !== $headers['request-timestamp'] || $stamp->getTimestamp() > $this->now() + 300
            || !hash_equals($this->credentials['clientId'], $headers['client-id'])
            || !hash_equals(ez_doku_signature($headers['client-id'], $headers['request-id'], $headers['request-timestamp'], $target, $body, $this->credentials['secretKey']), $headers['signature'])) throw new EzDokuReadException('notification_signature');
        try { $raw = EzDokuFinancialJson::decode($body); } catch (Throwable) { throw new EzDokuReadException('notification_json'); }
        // Provider masks card numbers; never retain an unexpected raw PAN/CVV.
        $visit = static function (mixed $value) use (&$visit): void {
            if ($value instanceof stdClass) foreach (get_object_vars($value) as $key => $child) {
                if (preg_match('/^(?:card_number|pan|cvv|cvc|security_code)$/iD', $key)
                    || ($key === 'masked_card_number' && (!is_string($child) || preg_match('/^[0-9]{0,8}[*Xx]{4,12}[0-9]{0,4}$/D', $child) !== 1))) throw new EzDokuReadException('notification_card_data');
                $visit($child);
            } elseif (is_array($value)) foreach ($value as $child) $visit($child);
        }; $visit($raw);
        return $raw;
    }
    public function notificationEvidence(string $body, array $headers): array
    {
        return ['environment'=>$this->credentials['environment'],'credentialFingerprint'=>$this->credentialFingerprint,'operation'=>'checkout-notification',
            'externalId'=>$headers['request-id'],'sentAt'=>$headers['request-timestamp'],'observedAt'=>gmdate('Y-m-d\TH:i:s\Z',$this->now()),'requestBody'=>null,'body'=>$body];
    }
}
