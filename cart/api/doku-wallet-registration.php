<?php
declare(strict_types=1);
require_once __DIR__ . '/doku-sub-accounts.php';

/** Called only after a durable owner request and a committed dispatch binding. */
final class EzDokuWalletRegistrationClient extends EzDokuSubAccountReader
{
    public function registrationPayload(array $request, string $parentProfileId): array
    {
        $allowed = ['partnerReferenceNo', 'type', 'name', 'email', 'countryCode'];
        $prefix = $this->credentials['environment'] === 'sandbox' ? 'S' : 'P';
        if (array_diff(array_keys($request), $allowed) !== [] || count($request) !== count($allowed)
            || !is_string($request['partnerReferenceNo'] ?? null) || preg_match('/^EZK-W-' . $prefix . '-[a-f0-9]{40}$/D', $request['partnerReferenceNo']) !== 1
            || ($request['type'] ?? null) !== 'DEFAULT' || ($request['countryCode'] ?? null) !== 'ID'
            || !is_string($request['name'] ?? null) || trim($request['name']) === '' || preg_match('/^[^\x00-\x1f\x7f]{1,128}$/uD', $request['name']) !== 1
            || !is_string($request['email'] ?? null) || strlen($request['email']) > 25 || filter_var($request['email'], FILTER_VALIDATE_EMAIL) === false
            || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{1,21}$/D', $parentProfileId) !== 1) throw new EzDokuReadException('registration_request');
        return [...$request, 'parentProfileId' => $parentProfileId];
    }

    public function registerAccount(array $request, string $parentProfileId): array
    {
        [$response, $evidence] = $this->request('register', $this->registrationPayload($request, $parentProfileId));
        if (!is_string($response->profileId ?? null) || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{1,21}$/D', $response->profileId) !== 1
            || $response->profileId === $parentProfileId || ($response->parentProfileId ?? null) !== $parentProfileId
            || !is_array($response->accounts ?? null) || count($response->accounts) > 3) throw new EzDokuReadException('registration_response');
        $seen = []; $accounts = [];
        foreach ($response->accounts as $account) {
            if (!$account instanceof stdClass) throw new EzDokuReadException('registration_response');
            $number = self::account($account->accountNo ?? null);
            if (isset($seen[$number])) throw new EzDokuReadException('registration_response');
            $seen[$number] = true;
            if (($account->type ?? null) === 'DOKU_MERCHANT_POINT' && ($account->currency ?? null) === 'POINT') continue;
            if (!in_array($account->type ?? null, ['DOKU_MERCHANT_IDR', 'DOKU_MERCHANT_PENDING_IDR'], true)
                || ($account->currency ?? null) !== 'IDR' || isset($accounts[$account->type])) throw new EzDokuReadException('registration_response');
            $accounts[$account->type] = $number;
        }
        if (count($accounts) !== 2) throw new EzDokuReadException('registration_response');
        return ['data' => ['profileId' => $response->profileId, 'parentProfileId' => $parentProfileId,
            'cashAccount' => $accounts['DOKU_MERCHANT_IDR'], 'pendingAccount' => $accounts['DOKU_MERCHANT_PENDING_IDR']], 'evidence' => $evidence];
    }
}
