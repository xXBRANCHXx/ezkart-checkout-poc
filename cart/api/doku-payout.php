<?php
declare(strict_types=1);
require_once __DIR__ . '/doku-snap.php';

/**
 * Bank-only Sub-Account V2 transport. No HTTP route or scheduled caller.
 * The caller must persist the owner request, reserve released funds, obtain fresh
 * Wallet verification and commit each dispatch grant before invoking this client.
 * A receipt digest binds a confirmation to the inquiry; it is not authorization.
 */
final class EzDokuPayoutClient extends EzDokuSnapClient
{
    private static function text(mixed $value, int $maximum): string
    {
        if (!is_string($value) || strlen($value) > 4 * $maximum || trim($value) === ''
            || preg_match('/^[^\x00-\x1f\x7f]{1,' . $maximum . '}$/uD', $value) !== 1) throw new EzDokuReadException('payout_fields');
        return $value;
    }

    private static function date(mixed $value): DateTimeImmutable
    {
        if (!is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/D', $value) !== 1) throw new EzDokuReadException('payout_date');
        try { $date = new DateTimeImmutable($value); }
        catch (Throwable) { throw new EzDokuReadException('payout_date'); }
        if ($date->format('Y-m-d\TH:i:s') !== substr($value, 0, 19)) throw new EzDokuReadException('payout_date');
        return $date->setTimezone(new DateTimeZone('UTC'));
    }

    /** Exact whole-rupiah string. No float conversion, estimates or fee deduction. */
    private static function amount(mixed $value, bool $treasury = false): string
    {
        if (!is_string($value) || preg_match('/^[1-9][0-9]{0,18}$/D', $value) !== 1
            || (!$treasury && (strlen($value) < 6 || (strlen($value) === 6 && strcmp($value, '250000') < 0)))
            || (strlen($value) === 19 && strcmp($value, '9223372036854775807') > 0)) throw new EzDokuReadException('payout_amount');
        return $value;
    }

    public function inquiryPayload(array $binding): array
    {
        $fields = ['environment', 'credentialFingerprint', 'partnerReferenceNo', 'fromAccount', 'beneficiaryBankCode',
            'beneficiaryAccountNumber', 'amount', 'channel', 'inquiryExternalId', 'paymentExternalId'];
        $prefix = $this->credentials['environment'] === 'sandbox' ? 'S' : 'P';
        if (count($binding) !== count($fields) || array_diff(array_keys($binding), $fields) !== []
            || ($binding['environment'] ?? null) !== $this->credentials['environment']
            || ($binding['credentialFingerprint'] ?? null) !== $this->credentialFingerprint
            || !is_string($binding['partnerReferenceNo'] ?? null)
            || preg_match('/^EZK-(?:PAYOUT|TREASURY)-' . $prefix . '-[a-f0-9]{40}$/D', $binding['partnerReferenceNo']) !== 1
            || !is_string($binding['fromAccount'] ?? null) || preg_match('/^[0-9]{1,10}$/D', $binding['fromAccount']) !== 1
            || !is_string($binding['beneficiaryAccountNumber'] ?? null) || preg_match('/^[0-9]{1,22}$/D', $binding['beneficiaryAccountNumber']) !== 1
            || !is_string($binding['beneficiaryBankCode'] ?? null) || preg_match('/^[A-Z0-9]{4,16}$/D', $binding['beneficiaryBankCode']) !== 1
            || !in_array($binding['channel'] ?? null, ['BI_FAST', 'ONLINE'], true)
            || !is_string($binding['inquiryExternalId'] ?? null) || preg_match('/^[0-9]{32}$/D', $binding['inquiryExternalId']) !== 1
            || !is_string($binding['paymentExternalId'] ?? null) || preg_match('/^[0-9]{32}$/D', $binding['paymentExternalId']) !== 1
            || $binding['inquiryExternalId'] === $binding['paymentExternalId']) throw new EzDokuReadException('payout_binding');
        return ['partnerReferenceNo' => $binding['partnerReferenceNo'], 'type' => 'BANK_ACCOUNT', 'channel' => $binding['channel'],
            'amount' => ['value' => self::amount($binding['amount'], str_starts_with($binding['partnerReferenceNo'], 'EZK-TREASURY-')) . '.00', 'currency' => 'IDR'],
            'fromAccount' => $binding['fromAccount'], 'beneficiaryBankCode' => $binding['beneficiaryBankCode'],
            'beneficiaryAccountNumber' => $binding['beneficiaryAccountNumber']];
    }

    /** A successful response must describe the exact transfer that was requested. */
    private static function response(stdClass $response, array $payload): array
    {
        if (!is_string($response->responseCode ?? null) || preg_match('/^200[0-9]{4}$/D', $response->responseCode) !== 1) throw new EzDokuReadException('payout_response');
        foreach (['partnerReferenceNo', 'type', 'channel', 'beneficiaryBankCode', 'beneficiaryAccountNumber'] as $field) {
            if (($response->{$field} ?? null) !== $payload[$field]) throw new EzDokuReadException('payout_scope');
        }
        // DOKU's live account reads can use numeric IDs. Preserve the exact token;
        // bank account numbers remain strings because leading zeroes are meaningful.
        $source = $response->fromAccount ?? null;
        $source = $source instanceof EzDokuJsonNumber ? $source->value : $source;
        if ($source !== $payload['fromAccount'] || !($response->amount ?? null) instanceof stdClass
            || ($response->amount->value ?? null) !== $payload['amount']['value']
            || ($response->amount->currency ?? null) !== 'IDR') throw new EzDokuReadException('payout_scope');
        $name = self::text($response->beneficiaryAccountName ?? null, 256);
        if (isset($payload['beneficiaryAccountName']) && $name !== $payload['beneficiaryAccountName']) throw new EzDokuReadException('payout_scope');
        return ['partnerReferenceNo' => $payload['partnerReferenceNo'], 'referenceNo' => self::text($response->referenceNo ?? null, 64),
            'fromAccount' => $payload['fromAccount'], 'beneficiaryBankCode' => $payload['beneficiaryBankCode'],
            'beneficiaryAccountNumber' => $payload['beneficiaryAccountNumber'], 'beneficiaryAccountName' => $name,
            'channel' => $payload['channel'], 'amount' => substr($payload['amount']['value'], 0, -3), 'currency' => 'IDR'];
    }

    /** Re-validate the original private receipt before preparing any transfer. */
    public function inquiryReceipt(array $binding, array $evidence): array
    {
        $payload = $this->inquiryPayload($binding);
        $fields = ['environment', 'credentialFingerprint', 'operation', 'externalId', 'requestedAt', 'observedAt', 'requestBody', 'responseBody'];
        if (count($evidence) !== count($fields) || array_diff(array_keys($evidence), $fields) !== []
            || ($evidence['environment'] ?? null) !== $binding['environment']
            || ($evidence['credentialFingerprint'] ?? null) !== $binding['credentialFingerprint']
            || ($evidence['operation'] ?? null) !== 'transfer-inquiry'
            || ($evidence['externalId'] ?? null) !== $binding['inquiryExternalId']
            || ($evidence['requestBody'] ?? null) !== json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)
            || !is_string($evidence['responseBody'] ?? null)) throw new EzDokuReadException('payout_inquiry');
        $requested = self::date($evidence['requestedAt'] ?? null);
        $observed = self::date($evidence['observedAt'] ?? null);
        if ($requested > $observed || $observed->getTimestamp() > $this->now() + 300) throw new EzDokuReadException('payout_date');
        try { $response = EzDokuFinancialJson::decode($evidence['responseBody']); }
        catch (Throwable) { throw new EzDokuReadException('payout_inquiry'); }
        $data = self::response($response, $payload);
        // Explicit field order makes persisted/decoded object ordering irrelevant.
        $values = array_map(static fn(string $key) => $evidence[$key], $fields);
        $values[] = $binding['paymentExternalId'];
        return [...$data, 'inquiryDigest' => hash('sha256', "ezkart.doku.bank-inquiry.v1\n" . json_encode($values, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR))];
    }

    public function inquire(array $binding): array
    {
        $payload = $this->inquiryPayload($binding);
        [, $evidence] = $this->transferRequest('transfer-inquiry', $payload, $binding['inquiryExternalId']);
        return ['data' => $this->inquiryReceipt($binding, $evidence), 'evidence' => $evidence];
    }

    public function paymentPayload(array $binding, array $inquiryEvidence, string $confirmedInquiryDigest): array
    {
        $inquiry = $this->inquiryReceipt($binding, $inquiryEvidence);
        if (preg_match('/^[a-f0-9]{64}$/D', $confirmedInquiryDigest) !== 1
            || !hash_equals($inquiry['inquiryDigest'], $confirmedInquiryDigest)) throw new EzDokuReadException('payout_confirmation');
        return [...$this->inquiryPayload($binding), 'referenceNo' => $inquiry['referenceNo'],
            'beneficiaryAccountName' => $inquiry['beneficiaryAccountName']];
    }

    /** A timeout, conflict or invalid receipt is unknown, never safe to resend. */
    public function pay(array $binding, array $inquiryEvidence, string $confirmedInquiryDigest): array
    {
        $payload = $this->paymentPayload($binding, $inquiryEvidence, $confirmedInquiryDigest);
        [$response, $evidence] = $this->transferRequest('transfer-payment', $payload, $binding['paymentExternalId']);
        $data = self::response($response, $payload);
        $processed = self::date($response->transactionDate ?? null);
        if ($processed->getTimestamp() > $this->now() + 300
            || $processed->getTimestamp() < self::date($inquiryEvidence['requestedAt'])->getTimestamp() - 300) throw new EzDokuReadException('payout_date');
        return ['data' => [...$data, 'inquiryReferenceNo' => $payload['referenceNo'],
            'bankReferenceNo' => self::text($response->referenceNumber ?? null, 64),
            'transactionDate' => $processed->format('Y-m-d\TH:i:s.u\Z'),
            'payoutConfirmed' => false, 'actualProviderFee' => null], 'evidence' => $evidence];
    }
}
