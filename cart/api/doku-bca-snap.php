<?php
declare(strict_types=1);
require_once __DIR__ . '/doku-payment-routing.php';

/** BCA SNAP 1.1, aggregator/DGPC, closed amount, non-reusable. */
final class EzDokuBcaSnapClient extends EzDokuPaymentRoutingClient
{
    public const NOTIFICATION_PATH = '/cart/api/doku-snap-webhook.php';

    private static function date(mixed $value): DateTimeImmutable
    {
        if (!is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/D', $value) !== 1) throw new EzDokuReadException('date');
        try { $date = new DateTimeImmutable($value); }
        catch (Throwable) { throw new EzDokuReadException('date'); }
        if ($date->format('Y-m-d\TH:i:s') !== substr($value, 0, 19)) throw new EzDokuReadException('date');
        return $date->setTimezone(new DateTimeZone('UTC'));
    }

    private static function text(mixed $value, int $maximum): string
    {
        if (!is_string($value) || trim($value) === '' || strlen($value) > $maximum * 4
            || preg_match('/[\x00-\x1f\x7f]/', $value) || preg_match('/^.{1,' . $maximum . '}$/uD', $value) !== 1) throw new EzDokuReadException('fields');
        return $value;
    }

    private static function money(mixed $amount, int $expected): void
    {
        if (!$amount instanceof stdClass || ($amount->currency ?? null) !== 'IDR'
            || ($amount->value ?? null) !== (string) $expected . '.00') throw new EzDokuReadException('amount');
    }

    /** Validate the original immutable dispatch record before any token/provider call. */
    public function paymentPayload(array $binding): array
    {
        $allowed = ['environment', 'credentialFingerprint', 'externalId', 'orderId', 'partnerServiceId', 'customerPrefix', 'amount', 'name', 'email', 'expiresAt'];
        if (array_key_exists('routing', $binding)) $allowed[] = 'routing';
        $prefix = $this->credentials['environment'] === 'sandbox' ? 'S' : 'P';
        if (count($binding) !== count($allowed) || array_diff(array_keys($binding), $allowed)
            || ($binding['environment'] ?? null) !== $this->credentials['environment']
            || ($binding['credentialFingerprint'] ?? null) !== $this->credentialFingerprint
            || !is_string($binding['externalId'] ?? null) || preg_match('/^[0-9]{32}$/D', $binding['externalId']) !== 1
            || !is_string($binding['orderId'] ?? null) || preg_match('/^EZK-' . $prefix . '-[A-F0-9]{24}$/D', $binding['orderId']) !== 1
            || !is_string($binding['partnerServiceId'] ?? null) || preg_match('/^ *[0-9]{1,8}$/D', $binding['partnerServiceId']) !== 1
            || strlen($binding['partnerServiceId']) !== 8
            || !is_string($binding['customerPrefix'] ?? null) || preg_match('/^[0-9]{1,10}$/D', $binding['customerPrefix']) !== 1
            || strlen(ltrim($binding['partnerServiceId'], ' ') . $binding['customerPrefix']) >= 16
            || !is_int($binding['amount'] ?? null) || $binding['amount'] < 1 || $binding['amount'] > 100000000000
            || !is_string($binding['email'] ?? null) || strlen($binding['email']) > 255 || filter_var($binding['email'], FILTER_VALIDATE_EMAIL) === false) throw new EzDokuReadException('payment_binding');
        $name = self::text($binding['name'] ?? null, 255);
        $expiry = self::date($binding['expiresAt'] ?? null);
        $routing = [];
        if (array_key_exists('routing', $binding)) {
            $route = $binding['routing'];
            if (!is_array($route) || count($route) !== 2 || array_diff(array_keys($route), ['profileId', 'splitRuleId'])
                || !is_string($route['profileId'] ?? null) || preg_match('/^SAC-[A-Za-z0-9_-]{1,18}$/D', $route['profileId']) !== 1
                || !is_string($route['splitRuleId'] ?? null) || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/D', $route['splitRuleId']) !== 1) throw new EzDokuReadException('routing_binding');
            $routing = ['account' => ['id' => $route['profileId'], 'split_rule_id' => $route['splitRuleId']]];
        }
        return ['partnerServiceId' => $binding['partnerServiceId'], 'customerNo' => $binding['customerPrefix'],
            'virtualAccountNo' => $binding['partnerServiceId'] . $binding['customerPrefix'], 'virtualAccountName' => $name,
            'virtualAccountEmail' => $binding['email'], 'trxId' => $binding['orderId'],
            'totalAmount' => ['value' => (string) $binding['amount'] . '.00', 'currency' => 'IDR'],
            'virtualAccountTrxType' => 'C', 'expiredDate' => $expiry->format('Y-m-d\TH:i:s\Z'),
            'additionalInfo' => ['channel' => 'VIRTUAL_ACCOUNT_BCA', 'virtualAccountConfig' => ['reusableStatus' => false], ...$routing]];
    }

    /** Padding never changes digits. Only the documented 16-digit aggregator DGPC is supported. */
    private static function account(stdClass $data, array $binding, ?string $expectedAccount = null): array
    {
        $service = $binding['partnerServiceId']; $bin = ltrim($service, ' ');
        $customer = $data->customerNo ?? null; $number = $data->virtualAccountNo ?? null;
        if (($data->partnerServiceId ?? null) !== $service || !is_string($customer)
            || preg_match('/^[0-9]{1,20}$/D', $customer) !== 1 || !str_starts_with($customer, $binding['customerPrefix'])
            || !is_string($number) || preg_match('/^ {0,' . (8 - strlen($bin)) . '}[0-9]{16}$/D', $number) !== 1
            || ltrim($number, ' ') !== $bin . $customer
            || ($expectedAccount !== null && ltrim($number, ' ') !== $expectedAccount)) throw new EzDokuReadException('account');
        return ['partnerServiceId' => $service, 'customerNo' => $customer, 'virtualAccountNo' => $service . $customer,
            'accountNumber' => $bin . $customer];
    }

    /** Caller must durably fence dispatch before this call. Never retry an unknown result. */
    public function createAccount(array $binding): array
    {
        if (!isset($binding['routing'])) throw new EzDokuReadException('routing_required');
        $payload = $this->paymentPayload($binding);
        $expiry = self::date($binding['expiresAt'])->getTimestamp();
        if ($expiry <= $this->now() || $expiry > $this->now() + 86400) throw new EzDokuReadException('expiry');
        [$response, $evidence] = $this->bcaRequest('bca-create', $payload, $binding['externalId']);
        if (strlen($evidence['responseBody']) > 262144) throw new EzDokuReadException('response_size');
        $data = $response->virtualAccountData ?? null;
        if ($response->responseCode !== '2002700' || !$data instanceof stdClass
            || ($data->trxId ?? null) !== $binding['orderId'] || ($data->virtualAccountName ?? null) !== $binding['name']
            || ($data->virtualAccountTrxType ?? null) !== 'C' || ($data->additionalInfo->channel ?? null) !== 'VIRTUAL_ACCOUNT_BCA'
            || (property_exists($data, 'virtualAccountEmail') && $data->virtualAccountEmail !== $binding['email'])
            || (isset($data->additionalInfo->virtualAccountConfig->reusableStatus) && $data->additionalInfo->virtualAccountConfig->reusableStatus !== false)) throw new EzDokuReadException('payment_response');
        if (property_exists($data->additionalInfo, 'account') && (!($data->additionalInfo->account instanceof stdClass)
            || ($data->additionalInfo->account->id ?? null) !== $binding['routing']['profileId']
            || ($data->additionalInfo->account->split_rule_id ?? null) !== $binding['routing']['splitRuleId'])) throw new EzDokuReadException('routing_response');
        self::money($data->totalAmount ?? null, $binding['amount']);
        $returnedExpiry = self::date($data->expiredDate ?? null);
        if ($returnedExpiry->getTimestamp() !== $expiry || $expiry <= $this->now()) throw new EzDokuReadException('expiry');
        return ['data' => ['orderId' => $binding['orderId'], 'externalId' => $binding['externalId'],
            ...self::account($data, $binding), 'amount' => $binding['amount'], 'currency' => 'IDR',
            'expiresAt' => $returnedExpiry->format('Y-m-d\TH:i:s\Z')], 'evidence' => $evidence];
    }

    /** Authenticate before any order lookup. This alone does not confirm a payment. */
    public function authenticateNotification(#[SensitiveParameter] string $body, #[SensitiveParameter] array $headers, string $target): stdClass
    {
        if ($target !== self::NOTIFICATION_PATH || strlen($body) > 262144) throw new EzDokuReadException('notification');
        foreach (['authorization' => 2055, 'x-partner-id' => 128, 'x-external-id' => 36, 'x-timestamp' => 25, 'x-signature' => 88, 'channel-id' => 3] as $key => $limit) {
            if (!is_string($headers[$key] ?? null) || $headers[$key] === '' || strlen($headers[$key]) > $limit
                || preg_match('/[\x00-\x1f\x7f]/', $headers[$key])) throw new EzDokuReadException('notification_headers');
        }
        if ($headers['x-partner-id'] !== $this->credentials['clientId'] || $headers['channel-id'] !== 'H2H'
            || preg_match('/^[0-9]{1,36}$/D', $headers['x-external-id']) !== 1
            || preg_match('/^Bearer ([A-Za-z0-9._~+\/-]{1,2048}=*)$/D', $headers['authorization'], $token) !== 1
            || preg_match('/^[A-Za-z0-9+\/]{86}==$/D', $headers['x-signature']) !== 1) throw new EzDokuReadException('notification_headers');
        $sentAt = self::date($headers['x-timestamp']);
        if ($sentAt->getTimestamp() > $this->now() + 300) throw new EzDokuReadException('notification_time');
        try { $minified = EzDokuFinancialJson::minify($body); $data = EzDokuFinancialJson::decode($minified); }
        catch (Throwable) { throw new EzDokuReadException('notification_json'); }
        $canonical = 'POST:' . $target . ':' . $token[1] . ':' . hash('sha256', $minified) . ':' . $headers['x-timestamp'];
        if (!hash_equals(base64_encode(hash_hmac('sha512', $canonical, $this->credentials['secretKey'], true)), $headers['x-signature'])) throw new EzDokuReadException('notification_signature');
        return $data;
    }

    /** Authenticated evidence only. The caller acknowledges after its durable capture commit. */
    public function paymentNotification(#[SensitiveParameter] string $body, #[SensitiveParameter] array $headers,
        string $target, array $binding, ?string $expectedAccount = null): array
    {
        $this->paymentPayload($binding);
        $data = $this->authenticateNotification($body, $headers, $target);
        if (($data->trxId ?? null) !== $binding['orderId'] || ($data->additionalInfo->channel ?? null) !== 'VIRTUAL_ACCOUNT_BCA'
            || (property_exists($data, 'virtualAccountTrxType') && $data->virtualAccountTrxType !== 'C')
            || !is_string($data->paymentRequestId ?? null) || preg_match('/^[A-Za-z0-9_-]{1,30}$/D', $data->paymentRequestId) !== 1) throw new EzDokuReadException('notification_payment');
        self::money($data->paidAmount ?? null, $binding['amount']);
        self::text($data->virtualAccountName ?? null, 255);
        $account = self::account($data, $binding, $expectedAccount);
        $paidAt = property_exists($data, 'trxDateTime') ? self::date($data->trxDateTime) : null;
        if ($paidAt !== null && $paidAt->getTimestamp() > $this->now() + 300) throw new EzDokuReadException('notification_time');
        // Notification IDs can change on redelivery; the PJP payment ID identifies the charge.
        $reference = 'doku_snap_bca_' . hash('sha256', json_encode([$binding['environment'], $this->credentials['clientId'],
            'VIRTUAL_ACCOUNT_BCA', $data->paymentRequestId], JSON_THROW_ON_ERROR));
        return ['data' => ['orderId' => $binding['orderId'], ...$account, 'paymentRequestId' => $data->paymentRequestId,
            'reference' => $reference, 'amount' => $binding['amount'], 'currency' => 'IDR', 'providerPaidAt' => $paidAt?->format('Y-m-d\TH:i:s\Z')],
            'acknowledgement' => ['responseCode' => '2002500', 'responseMessage' => 'Success', 'virtualAccountData' => [
                'partnerServiceId' => $data->partnerServiceId, 'customerNo' => $data->customerNo, 'virtualAccountNo' => $data->virtualAccountNo,
                'virtualAccountName' => $data->virtualAccountName, 'paymentRequestId' => $data->paymentRequestId,
                'paidAmount' => ['value' => (string) $binding['amount'] . '.00', 'currency' => 'IDR']]],
            'evidence' => ['environment' => $binding['environment'], 'credentialFingerprint' => $this->credentialFingerprint,
                'operation' => 'bca-notification', 'externalId' => $headers['x-external-id'], 'sentAt' => $headers['x-timestamp'],
                'observedAt' => gmdate('Y-m-d\TH:i:s\Z', $this->now()), 'bodyHash' => hash('sha256', EzDokuFinancialJson::minify($body)), 'body' => $body]];
    }

    /** Preserve status evidence; HTTP 200 and paidAmount alone do not confirm a payment. */
    public function observeStatus(array $binding, string $accountNumber, ?string $paymentRequestId = null): array
    {
        $this->paymentPayload($binding);
        $bin = ltrim($binding['partnerServiceId'], ' ');
        if (preg_match('/^[0-9]{16}$/D', $accountNumber) !== 1 || !str_starts_with($accountNumber, $bin . $binding['customerPrefix'])
            || ($paymentRequestId !== null && preg_match('/^[A-Za-z0-9_-]{1,30}$/D', $paymentRequestId) !== 1)) throw new EzDokuReadException('account');
        [$response, $evidence] = $this->bcaRequest('bca-status', ['partnerServiceId' => $binding['partnerServiceId'],
            'customerNo' => substr($accountNumber, strlen($bin)), 'virtualAccountNo' => $binding['partnerServiceId'] . substr($accountNumber, strlen($bin)),
            ...($paymentRequestId === null ? [] : ['paymentRequestId' => $paymentRequestId])]);
        if (strlen($evidence['responseBody']) > 262144) throw new EzDokuReadException('response_size');
        if ($response->responseCode !== '2002600') throw new EzDokuReadException('status');
        $rows = $response->virtualAccountData ?? null;
        if ($rows instanceof stdClass) $rows = [$rows];
        if (!is_array($rows) || count($rows) > 100) throw new EzDokuReadException('status');
        foreach ($rows as $row) {
            if (!$row instanceof stdClass) throw new EzDokuReadException('status');
            self::account($row, $binding, $accountNumber);
            $invoice = $row->trxId ?? $response->additionalInfo->trxId ?? null;
            if ($invoice !== $binding['orderId'] || (isset($row->trxId, $response->additionalInfo->trxId) && $row->trxId !== $response->additionalInfo->trxId)
                || ($paymentRequestId !== null && ($row->paymentRequestId ?? null) !== $paymentRequestId)) throw new EzDokuReadException('status');
            self::money($row->paidAmount ?? null, $binding['amount']);
        }
        return ['data' => ['orderId' => $binding['orderId'], 'accountNumber' => $accountNumber, 'records' => count($rows),
            'paymentConfirmed' => false, 'createRetryAllowed' => false, 'settlementVerified' => false], 'evidence' => $evidence];
    }
}
