<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/doku-financial-json.php';

final class EzDokuReadException extends RuntimeException
{
    public function __construct(public readonly string $reason, public readonly int $providerStatus = 0)
    {
        parent::__construct('DOKU financial request was not confirmed (' . $reason . ').');
    }
}

/** Shared server-side SNAP transport. Operations are exposed by typed adapters. */
abstract class EzDokuSnapClient
{
    private readonly string $origin;
    private readonly OpenSSLAsymmetricKey $privateKey;
    private readonly Closure $transport;
    private readonly Closure $clock;
    private string $accessToken = '';
    private int $expiresAt = 0;
    public readonly string $credentialFingerprint;

    public static function configured(string $environment): static
    {
        return new static([
            'environment' => $environment,
            'clientId' => ez_provider_config('doku', 'client_id', $environment),
            'secretKey' => ez_provider_config('doku', 'secret_key', $environment),
            'privateKey' => ez_provider_config('doku', 'snap_private_key', $environment),
        ]);
    }

    public function __construct(
        #[SensitiveParameter] protected readonly array $credentials,
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
        } finally { unset($handle); }
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

    protected function request(string $operation, array $payload): array
    {
        // The target is selected by these methods, never by an HTTP caller.
        if (!in_array($operation, ['balance-inquiries', 'transaction-history-list', 'transactions-status', 'register'], true)) throw new EzDokuReadException('operation');
        return $this->signedPost($operation, '/sub-account/v2.0/' . $operation, $payload);
    }

    /** A create uses the caller's durable dispatch identity, never a fresh retry ID. */
    protected function bcaRequest(string $operation, array $payload, ?string $externalId = null): array
    {
        $path = match ($operation) {
            'bca-create' => '/virtual-accounts/bi-snap-va/v1.1/transfer-va/create-va',
            'bca-status' => '/orders/v1.0/transfer-va/status',
            default => throw new EzDokuReadException('operation'),
        };
        if (($operation === 'bca-create' && $externalId === null)
            || ($externalId !== null && preg_match('/^[0-9]{32}$/D', $externalId) !== 1)) throw new EzDokuReadException('external_id');
        return $this->signedPost($operation, $path, $payload, $externalId, $operation === 'bca-create' ? 'H2H' : null);
    }

    protected function now(): int { return ($this->clock)(); }

    private function signedPost(string $operation, string $path, array $payload, ?string $externalId = null, ?string $channel = null): array
    {
        $token = $this->token(); $timestamp = gmdate('Y-m-d\TH:i:s\Z', ($this->clock)());
        $body = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if ($externalId === null) { $externalId = ''; for ($i = 0; $i < 32; $i++) $externalId .= (string) random_int(0, 9); }
        $canonical = 'POST:' . $path . ':' . $token . ':' . hash('sha256', $body) . ':' . $timestamp;
        try {
            [$response, $raw] = $this->send($path, [
                'Authorization: Bearer ' . $token, 'X-PARTNER-ID: ' . $this->credentials['clientId'], 'X-TIMESTAMP: ' . $timestamp,
                'X-EXTERNAL-ID: ' . $externalId, 'X-SIGNATURE: ' . base64_encode(hash_hmac('sha512', $canonical, $this->credentials['secretKey'], true)),
                ...($channel === null ? [] : ['CHANNEL-ID: ' . $channel]),
            ], $body);
        } catch (EzDokuReadException $error) {
            if ($error->providerStatus === 401) { $this->accessToken = ''; $this->expiresAt = 0; }
            throw $error;
        }
        return [$response, ['environment' => $this->credentials['environment'], 'credentialFingerprint' => $this->credentialFingerprint,
            'operation' => $operation, 'externalId' => $externalId, 'requestedAt' => $timestamp,
            'observedAt' => gmdate('Y-m-d\TH:i:s\Z', ($this->clock)()), 'requestBody' => $body, 'responseBody' => $raw]];
    }

    public function providerIdentity(): array
    {
        return ['environment' => $this->credentials['environment'], 'clientId' => $this->credentials['clientId'], 'credentialFingerprint' => $this->credentialFingerprint];
    }

    /** Authentication only; never exposes the bearer token or claims service activation. */
    public function verifyAuthentication(): array
    {
        $this->token();
        return ['authenticated' => true, 'environment' => $this->credentials['environment'],
            'credentialFingerprint' => $this->credentialFingerprint,
            'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', $this->expiresAt)];
    }
}
