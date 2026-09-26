<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/doku-financial-json.php';

final class EzDokuReadException extends RuntimeException
{
    public function __construct(public readonly string $reason, public readonly int $providerStatus = 0)
    {
        parent::__construct('DOKU financial read was not confirmed (' . $reason . ').');
    }
}

/** Server-only, read-only SNAP client. No transfer, registration or split writes. */
final class EzDokuSubAccountReader
{
    private readonly string $origin;
    private readonly OpenSSLAsymmetricKey $privateKey;
    private readonly Closure $transport;
    private readonly Closure $clock;
    private string $accessToken = '';
    private int $expiresAt = 0;
    public readonly string $credentialFingerprint;

    public static function configured(string $environment): self
    {
        return new self([
            'environment' => $environment,
            'clientId' => ez_provider_config('doku', 'client_id', $environment),
            'secretKey' => ez_provider_config('doku', 'secret_key', $environment),
            'privateKey' => ez_provider_config('doku', 'snap_private_key', $environment),
        ]);
    }

    public function __construct(
        #[SensitiveParameter] private readonly array $credentials,
        ?Closure $transport = null,
        ?Closure $clock = null,
    ) {
        if (!in_array($credentials['environment'] ?? null, ['sandbox', 'production'], true)
            || !is_string($credentials['clientId'] ?? null) || preg_match('/^[A-Za-z0-9_-]{3,128}$/D', $credentials['clientId']) !== 1
            || !is_string($credentials['secretKey'] ?? null) || strlen($credentials['secretKey']) < 16 || strlen($credentials['secretKey']) > 1024
            || !is_string($credentials['privateKey'] ?? null) || strlen($credentials['privateKey']) > 16000) {
            throw new EzDokuReadException('configuration');
        }
        $key = @openssl_pkey_get_private($credentials['privateKey']);
        $details = $key === false ? false : openssl_pkey_get_details($key);
        if (!$details || $details['type'] !== OPENSSL_KEYTYPE_RSA || $details['bits'] < 2048) throw new EzDokuReadException('configuration');
        $this->privateKey = $key;
        $this->origin = $credentials['environment'] === 'sandbox' ? 'https://api-sandbox.doku.com' : 'https://api.doku.com';
        $this->transport = $transport ?? self::http(...);
        $this->clock = $clock ?? static fn(): int => time();
        $this->credentialFingerprint = hash('sha256', json_encode([$credentials['environment'], $credentials['clientId'],
            hash('sha256', $credentials['secretKey']), hash('sha256', $details['key'])], JSON_THROW_ON_ERROR));
    }

    public function __debugInfo(): array { return ['environment' => $this->credentials['environment'], 'credentialFingerprint' => $this->credentialFingerprint]; }

    private static function http(string $url, array $headers, string $body): array
    {
        if (!function_exists('curl_init')) throw new EzDokuReadException('transport');
        $handle = curl_init($url);
        if ($handle === false) throw new EzDokuReadException('transport');
        $response = '';
        try {
            curl_setopt_array($handle, [
                CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers,
                CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 20,
                CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$response): int {
                    if (strlen($response) + strlen($chunk) > 2000000) return 0;
                    $response .= $chunk; return strlen($chunk);
                },
            ]);
            $sent = curl_exec($handle); $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            if ($sent === false) throw new EzDokuReadException('transport', $status);
            return [$status, $response];
        } finally { curl_close($handle); }
    }

    private function send(string $path, array $headers, string $body): array
    {
        try { $result = ($this->transport)($this->origin . $path, ['Accept: application/json', 'Content-Type: application/json', ...$headers], $body); }
        catch (Throwable) { throw new EzDokuReadException('transport'); }
        if (!is_array($result) || count($result) !== 2 || !is_int($result[0]) || !is_string($result[1])) throw new EzDokuReadException('transport');
        [$status, $raw] = $result;
        if ($status !== 200) throw new EzDokuReadException('http', $status);
        try { $decoded = EzDokuFinancialJson::decode($raw); }
        catch (Throwable) { throw new EzDokuReadException('response', $status); }
        if (!is_string($decoded->responseCode ?? null) || preg_match('/^200[0-9]{4}$/D', $decoded->responseCode) !== 1) throw new EzDokuReadException('provider', $status);
        return [$decoded, $raw];
    }

    private function token(): string
    {
        $now = ($this->clock)();
        if ($this->accessToken !== '' && $now < $this->expiresAt - 30) return $this->accessToken;
        $this->accessToken = ''; $this->expiresAt = 0;
        $timestamp = gmdate('Y-m-d\TH:i:s\Z', $now);
        if (!openssl_sign($this->credentials['clientId'] . '|' . $timestamp, $signature, $this->privateKey, OPENSSL_ALGO_SHA256)) throw new EzDokuReadException('signing');
        [$response] = $this->send('/authorization/v1/access-token/b2b', [
            'X-CLIENT-KEY: ' . $this->credentials['clientId'], 'X-TIMESTAMP: ' . $timestamp, 'X-SIGNATURE: ' . base64_encode($signature),
        ], '{"grantType":"client_credentials"}');
        $expiry = $response->expiresIn ?? null;
        $expiry = $expiry instanceof EzDokuJsonNumber ? $expiry->value : $expiry;
        if ($response->responseCode !== '2007300' || ($response->tokenType ?? null) !== 'Bearer'
            || !is_string($response->accessToken ?? null) || preg_match('/^[A-Za-z0-9._~+\/-]{1,2048}=*$/D', $response->accessToken) !== 1
            || !is_string($expiry) || preg_match('/^[1-9][0-9]{0,4}$/D', $expiry) !== 1 || (int) $expiry > 86400
            || $now + (int) $expiry <= ($this->clock)() + 30) throw new EzDokuReadException('token');
        $this->accessToken = $response->accessToken; $this->expiresAt = $now + (int) $expiry;
        return $this->accessToken;
    }

    private function request(string $operation, array $payload): array
    {
        // The target is selected by these methods, never by an HTTP caller.
        if (!in_array($operation, ['balance-inquiries', 'transaction-history-list', 'transactions-status'], true)) throw new EzDokuReadException('operation');
        $token = $this->token(); $timestamp = gmdate('Y-m-d\TH:i:s\Z', ($this->clock)());
        $path = '/sub-account/v2.0/' . $operation;
        $body = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $externalId = ''; for ($i = 0; $i < 32; $i++) $externalId .= (string) random_int(0, 9);
        $canonical = 'POST:' . $path . ':' . $token . ':' . hash('sha256', $body) . ':' . $timestamp;
        try {
            [$response, $raw] = $this->send($path, [
                'Authorization: Bearer ' . $token, 'X-PARTNER-ID: ' . $this->credentials['clientId'], 'X-TIMESTAMP: ' . $timestamp,
                'X-EXTERNAL-ID: ' . $externalId, 'X-SIGNATURE: ' . base64_encode(hash_hmac('sha512', $canonical, $this->credentials['secretKey'], true)),
            ], $body);
        } catch (EzDokuReadException $error) {
            if ($error->providerStatus === 401) { $this->accessToken = ''; $this->expiresAt = 0; }
            throw $error;
        }
        return [$response, ['environment' => $this->credentials['environment'], 'credentialFingerprint' => $this->credentialFingerprint,
            'operation' => $operation, 'externalId' => $externalId, 'requestedAt' => $timestamp,
            'observedAt' => gmdate('Y-m-d\TH:i:s\Z', ($this->clock)()), 'requestBody' => $body, 'responseBody' => $raw]];
    }

    private static function text(mixed $value, int $maximum, bool $empty = false): string
    {
        if (!is_string($value) || (!$empty && trim($value) === '') || strlen($value) > $maximum * 4 || preg_match('/[\x00-\x1f\x7f]/', $value)
            || preg_match('/^.{0,' . $maximum . '}$/usD', $value) !== 1) throw new EzDokuReadException('fields');
        return $value;
    }

    private static function account(mixed $value): string
    {
        if (!is_string($value) || preg_match('/^[0-9]{1,10}$/D', $value) !== 1) throw new EzDokuReadException('account');
        return $value;
    }

    /** Whole rupiah, with an exact decimal-string result even above 2^53. */
    private static function money(mixed $value, bool $negative = false): string
    {
        $value = $value instanceof EzDokuJsonNumber ? $value->value : $value;
        if (!is_string($value) || preg_match('/^(-?)(0|[1-9][0-9]{0,18})(?:\.0{1,2})?$/D', $value, $match) !== 1
            || (!$negative && $match[1] !== '') || (strlen($match[2]) === 19 && strcmp($match[2], '9223372036854775807') > 0)) throw new EzDokuReadException('amount');
        return $match[2] === '0' ? '0' : $match[1] . $match[2];
    }

    private static function date(mixed $value, bool $fraction = true): DateTimeImmutable
    {
        $pattern = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' . ($fraction ? '(?:\.\d{1,6})?' : '') . '(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/D';
        if (!is_string($value) || preg_match($pattern, $value) !== 1) throw new EzDokuReadException('date');
        try { $date = new DateTimeImmutable($value); }
        catch (Throwable) { throw new EzDokuReadException('date'); }
        if ($date->format('Y-m-d\TH:i:s') !== substr($value, 0, 19)) throw new EzDokuReadException('date');
        return $date->setTimezone(new DateTimeZone('UTC'));
    }

    public function balances(string $profileId): array
    {
        if (preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{1,21}$/D', $profileId) !== 1) throw new EzDokuReadException('profile');
        [$response, $evidence] = $this->request('balance-inquiries', ['profileId' => $profileId]);
        if (($response->profileId ?? null) !== $profileId || !is_array($response->accounts ?? null) || count($response->accounts) > 10) throw new EzDokuReadException('scope');
        $accounts = []; $seen = [];
        foreach ($response->accounts as $item) {
            if (!$item instanceof stdClass) throw new EzDokuReadException('account');
            $number = self::account($item->accountNo ?? null);
            if (isset($seen[$number])) throw new EzDokuReadException('account');
            $seen[$number] = true;
            if (in_array($item->type ?? null, ['DOKU_MERCHANT_POINT', 'DOKU_SYSTEM_POINT'], true) && ($item->currency ?? null) === 'POINT') continue;
            if (!in_array($item->type ?? null, ['DOKU_MERCHANT_IDR', 'DOKU_MERCHANT_PENDING_IDR'], true)
                || ($item->currency ?? null) !== 'IDR' || isset($accounts[$item->type]) || !($item->balance ?? null) instanceof stdClass) throw new EzDokuReadException('account');
            $accounts[$item->type] = ['accountNo' => $number, 'currency' => 'IDR',
                'available' => self::money($item->balance->available ?? null, true), 'reserved' => self::money($item->balance->reserved ?? null, true)];
        }
        if (count($accounts) !== 2) throw new EzDokuReadException('account');
        return ['data' => ['profileId' => $profileId, 'name' => self::text($response->name ?? null, 128), 'accounts' => $accounts], 'evidence' => $evidence];
    }

    public function historyPage(string $accountNo, string $from, string $to, int $page = 0, int $size = 100): array
    {
        self::account($accountNo); [$start, $end] = self::window($from, $to);
        if ($page < 0 || $page > 999 || $size < 1 || $size > 100) throw new EzDokuReadException('window');
        [$response, $evidence] = $this->request('transaction-history-list', ['accountNo' => $accountNo,
            'fromDateTime' => $start->format('Y-m-d\TH:i:s\Z'), 'toDateTime' => $end->format('Y-m-d\TH:i:s\Z'), 'pageSize' => (string) $size, 'pageNumber' => (string) $page]);
        if (!is_array($response->detailData ?? null) || count($response->detailData) > $size) throw new EzDokuReadException('history');
        $items = []; $previous = null;
        foreach ($response->detailData as $item) {
            if (!$item instanceof stdClass || ($item->currency ?? null) !== 'IDR' || !in_array($item->mutationType ?? null, ['CREDIT', 'DEBIT'], true)
                || !in_array($item->status ?? null, ['SUCCESS', 'PENDING', 'FAILED', 'VOID'], true)) throw new EzDokuReadException('history');
            $date = self::date($item->dateTime ?? null);
            if ($date < $start || $date > $end || ($previous !== null && $date > $previous)) throw new EzDokuReadException('history_order');
            $previous = $date;
            $type = self::text($item->transactionType ?? null, 32);
            if (preg_match('/^[A-Z][A-Z0-9_]*$/D', $type) !== 1) throw new EzDokuReadException('history');
            $items[] = ['accountNo' => $accountNo, 'referenceNo' => self::text($item->referenceNo ?? null, 64),
                'partnerReferenceNo' => self::text($item->partnerReferenceNo ?? null, 64), 'transactionType' => $type,
                'mutationType' => $item->mutationType, 'amount' => self::money($item->amount ?? null), 'currency' => 'IDR', 'status' => $item->status,
                'dateTime' => $date->format('Y-m-d\TH:i:s.u\Z'), 'channel' => self::text($item->channel ?? '', 64, true), 'remark' => self::text($item->remark ?? '', 256, true)];
        }
        // A short page is only this read's exhaustion signal, not a provider snapshot or settled balance.
        return ['data' => ['accountNo' => $accountNo, 'page' => $page, 'items' => $items, 'exhausted' => count($items) < $size], 'evidence' => $evidence];
    }

    public static function window(string $from, string $to): array
    {
        $start = self::date($from, false); $end = self::date($to, false);
        if ($end <= $start || $end->getTimestamp() - $start->getTimestamp() > 31 * 86400) throw new EzDokuReadException('window');
        return [$start, $end];
    }

    public function transactionStatus(string $partnerReference): array
    {
        self::text($partnerReference, 64);
        [$response, $evidence] = $this->request('transactions-status', ['partnerReferenceNo' => $partnerReference]);
        if (($response->partnerReferenceNo ?? null) !== $partnerReference || !in_array($response->latestTransactionStatus ?? null, ['00', '03', '04', '05', '06'], true)
            || !($response->amount ?? null) instanceof stdClass || ($response->amount->currency ?? null) !== 'IDR') throw new EzDokuReadException('status');
        $refunds = $response->refundHistory ?? [];
        if (!is_array($refunds) || count($refunds) > 1000) throw new EzDokuReadException('status');
        $history = []; $seen = [];
        foreach ($refunds as $refund) {
            if (!$refund instanceof stdClass || !($refund->refundAmount ?? null) instanceof stdClass || ($refund->refundAmount->currency ?? null) !== 'IDR') throw new EzDokuReadException('status');
            $number = self::text($refund->refundNo ?? null, 64);
            if (isset($seen[$number])) throw new EzDokuReadException('status');
            $seen[$number] = true;
            $history[] = ['refundNo' => $number, 'refundStatus' => self::text($refund->refundStatus ?? null, 4),
                'amount' => self::money($refund->refundAmount->value ?? null), 'currency' => 'IDR',
                'transactionDate' => self::date($refund->transactionDate ?? null)->format('Y-m-d\TH:i:s.u\Z'), 'reason' => self::text($refund->reason ?? '', 128, true)];
        }
        $description = self::text($response->latestTransactionDesc ?? '', 32, true);
        if ($response->latestTransactionStatus === '00' && in_array(strtolower($description), ['void', 'voided'], true)) throw new EzDokuReadException('status');
        return ['data' => ['partnerReferenceNo' => $partnerReference, 'transactionType' => self::text($response->transactionType ?? null, 32),
            'latestTransactionStatus' => $response->latestTransactionStatus, 'latestTransactionDesc' => $description,
            'amount' => self::money($response->amount->value ?? null), 'currency' => 'IDR',
            'transactionDate' => self::date($response->transactionDate ?? null)->format('Y-m-d\TH:i:s.u\Z'), 'refundHistory' => $history], 'evidence' => $evidence];
    }
}
