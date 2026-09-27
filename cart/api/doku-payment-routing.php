<?php
declare(strict_types=1);
require_once __DIR__ . '/doku-snap.php';

/** A single original flat allocation; the central caller owns dispatch fencing. */
class EzDokuPaymentRoutingClient extends EzDokuSnapClient
{
    public function splitPayload(array $binding): array
    {
        $allowed = ['environment', 'credentialFingerprint', 'externalId', 'orderId', 'sellerProfileId', 'platformCashAccount', 'grossAmount', 'platformAmount'];
        if (count($binding) !== count($allowed) || array_diff(array_keys($binding), $allowed)
            || ($binding['environment'] ?? null) !== $this->credentials['environment']
            || ($binding['credentialFingerprint'] ?? null) !== $this->credentialFingerprint
            || !is_string($binding['externalId'] ?? null) || preg_match('/^[0-9]{32}$/D', $binding['externalId']) !== 1
            || !is_string($binding['orderId'] ?? null) || preg_match('/^EZK-' . ($this->credentials['environment'] === 'sandbox' ? 'S' : 'P') . '-[A-F0-9]{24}$/D', $binding['orderId']) !== 1
            || !is_string($binding['sellerProfileId'] ?? null) || preg_match('/^SAC-[A-Za-z0-9_-]{1,18}$/D', $binding['sellerProfileId']) !== 1
            || !is_string($binding['platformCashAccount'] ?? null) || preg_match('/^[1-9][0-9]{0,9}$/D', $binding['platformCashAccount']) !== 1
            || !is_int($binding['grossAmount'] ?? null) || $binding['grossAmount'] < 1 || $binding['grossAmount'] > 100000000000
            || !is_int($binding['platformAmount'] ?? null) || $binding['platformAmount'] < 1 || $binding['platformAmount'] > 100000001250) throw new EzDokuReadException('routing_binding');
        // Do not clip negative seller allocations or substitute a processing-fee
        // estimate. Small-net provider behavior still needs live acceptance.
        return ['transactionType' => 'PAYMENT', 'rules' => [['type' => 'FLAT', 'value' => $binding['platformAmount'],
            'currency' => 'IDR', 'accountNumber' => (int) $binding['platformCashAccount']]]];
    }

    public function createSplitRule(array $binding): array
    {
        $payload = $this->splitPayload($binding);
        [$response, $evidence] = $this->splitRuleRequest($payload, $binding['externalId']);
        $rules = $response->rules ?? null; $rule = is_array($rules) && count($rules) === 1 ? $rules[0] : null;
        $amount = $rule instanceof stdClass ? ($rule->value ?? null) : null;
        $account = $rule instanceof stdClass ? ($rule->accountNumber ?? null) : null;
        if (strlen($evidence['responseBody']) > 16000 || ($response->transactionType ?? null) !== 'PAYMENT'
            || !is_string($response->splitRuleId ?? null) || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/D', $response->splitRuleId) !== 1
            || !$rule instanceof stdClass || count(get_object_vars($rule)) !== 4 || ($rule->type ?? null) !== 'FLAT' || ($rule->currency ?? null) !== 'IDR'
            || !$amount instanceof EzDokuJsonNumber || preg_match('/^(0|[1-9][0-9]*)(?:\.0{1,2})?$/D', $amount->value, $match) !== 1
            || $match[1] !== (string) $binding['platformAmount'] || !$account instanceof EzDokuJsonNumber || $account->value !== $binding['platformCashAccount']) throw new EzDokuReadException('routing_response');
        return ['routing' => ['profileId' => $binding['sellerProfileId'], 'splitRuleId' => $response->splitRuleId], 'evidence' => $evidence,
            'settlementVerified' => false];
    }
}
