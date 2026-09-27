<?php
declare(strict_types=1);
require_once __DIR__ . '/commerce-client.php';
require_once __DIR__ . '/doku-wallet-registration.php';

function ez_wallet_provider_configuration(string $environment): array
{
    $client = EzDokuWalletRegistrationClient::configured($environment);
    $parent = ez_provider_config('doku', 'parent_profile_id', $environment);
    if (preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{1,21}$/D', $parent) !== 1) throw new EzDokuReadException('parent_configuration');
    return [$client, $parent];
}

function ez_wallet_registration_job(array $job, string $worker, ?EzDokuWalletRegistrationClient $client = null, ?string $parent = null): array
{
    $outcome = 'uncertain'; $result = ['recorded' => false]; $message = ''; $mayHaveStarted = true;
    $stage = 'load_registration';
    try {
        if (($job['kind'] ?? '') !== 'wallet.register' || preg_match('/^wallet_[a-f0-9]{40}$/D', (string) ($job['data']['enrollmentId'] ?? '')) !== 1) throw new RuntimeException('Wallet job is invalid.');
        $path = '/internal/commerce/finance/wallet/registrations/' . $job['data']['enrollmentId'];
        $registration = ez_commerce_request('GET', $path . '?environment=' . rawurlencode($job['environment']))['registration'];
        if ($registration['jobId'] !== $job['id'] || $registration['seller'] !== $job['sellerId']
            || $registration['request']['partnerReferenceNo'] !== $job['data']['partnerReferenceNo']) throw new RuntimeException('Wallet job identity changed.');
        $mayHaveStarted = $registration['binding'] !== null;
        if ($registration['profile'] !== null) {
            $outcome = 'succeeded'; $result = ['recorded' => true];
        } else {
            $stage = 'provider_configuration';
            if ($client === null || $parent === null) [$client, $parent] = ez_wallet_provider_configuration($job['environment']);
            $identity = $client->providerIdentity();
            $stage = 'check_provider_binding';
            if ($identity['environment'] !== $job['environment']) throw new RuntimeException('Wallet provider environment changed.');
            if ($registration['binding'] !== null && ($registration['binding']['credentialFingerprint'] !== $identity['credentialFingerprint']
                || $registration['binding']['clientId'] !== $identity['clientId'] || $registration['binding']['parentProfileId'] !== $parent)) throw new RuntimeException('Wallet provider identity changed.');
            if ($registration['registrationBody'] === null) {
                $stage = 'registration_recovery';
                if ($job['mode'] !== 'execute' || $registration['binding'] !== null) throw new RuntimeException('The original provider result must be reconciled.');
                if (!$registration['ownerStillAuthorized']) {
                    $outcome = 'dead'; $result = ['notStarted' => true];
                    throw new RuntimeException('The original owner no longer authorizes wallet setup.');
                }
                $stage = 'prepare_registration';
                $client->registrationPayload($registration['request'], $parent);
                // Verify the configured parent and obtain a usable token before
                // committing the dispatch binding. A setup/authentication error
                // here is a known no-effect failure and can safely be retried.
                $stage = 'parent_preflight';
                $client->parentBalances($parent);
                // Treat an uncertain bind response as dispatch uncertainty too.
                // It must never cause a second call to the registration API.
                $mayHaveStarted = true;
                $stage = 'bind_registration';
                $bound = ez_commerce_request('POST', $path . '/bind', ['environment' => $job['environment'], 'workerId' => $worker,
                    'leaseToken' => $job['leaseToken'], 'credentialFingerprint' => $identity['credentialFingerprint'],
                    'clientId' => $identity['clientId'], 'parentProfileId' => $parent]);
                if (($bound['mayRegister'] ?? false) !== true) throw new RuntimeException('Registration may already have started.');
                $stage = 'register_account';
                $created = $client->registerAccount($registration['request'], $parent);
                $body = $created['evidence']['responseBody'];
                $payload = ['environment' => $job['environment'], 'credentialFingerprint' => $identity['credentialFingerprint'], 'registrationBody' => $body];
                $stage = 'save_registration_receipt';
                try { ez_commerce_request('POST', $path . '/receipt', $payload); }
                catch (EzCommerceStorageException $error) {
                    // Only the idempotent internal receipt is retried; no provider
                    // registration is repeated after a missing response.
                    if ($error->httpStatus < 500) throw $error;
                    ez_commerce_request('POST', $path . '/receipt', $payload);
                }
                $registration['registrationBody'] = $body;
            }
            $stage = 'confirm_accounts';
            $original = EzDokuFinancialJson::decode($registration['registrationBody']);
            $confirmed = $client->balances($original->profileId);
            $stage = 'record_profile';
            ez_commerce_request('POST', $path . '/record', ['environment' => $job['environment'], 'credentialFingerprint' => $identity['credentialFingerprint'],
                'confirmationBody' => $confirmed['evidence']['responseBody']]);
            $outcome = 'succeeded'; $result = ['recorded' => true, 'reconciled' => $job['mode'] === 'reconcile'];
        }
    } catch (Throwable $error) {
        if (!$mayHaveStarted && $outcome !== 'dead') { $outcome = 'retry'; $result = ['noEffectConfirmed' => true]; }
        // Keep bounded diagnostics in the private job/attempt history. These do
        // not prove no effect, permit another dispatch, or replace a receipt.
        // Never persist exception messages, response bodies, tokens or traces.
        $failure = ['stage' => $stage, 'category' => 'internal'];
        if ($error instanceof EzDokuReadException) {
            $reasons = ['configuration', 'parent_configuration', 'transport', 'http', 'response', 'provider',
                'signing', 'token', 'operation', 'external_id', 'registration_request', 'registration_response',
                'profile', 'scope', 'account', 'amount', 'fields'];
            $failure['category'] = 'provider';
            $failure['reason'] = in_array($error->reason, $reasons, true) ? $error->reason : 'unknown';
            $failure['httpStatus'] = $error->providerStatus >= 100 && $error->providerStatus <= 599 ? $error->providerStatus : null;
        } elseif ($error instanceof EzCommerceStorageException) {
            $failure['category'] = 'storage';
            $failure['httpStatus'] = $error->httpStatus >= 100 && $error->httpStatus <= 599 ? $error->httpStatus : null;
        }
        $result['failure'] = $failure;
        $message = $outcome === 'retry' ? 'Wallet setup has not started. Provider configuration or access must be restored.'
            : ($outcome === 'dead' ? 'The original owner no longer authorizes wallet setup.' : 'Wallet setup was not confirmed. Reconcile the original provider request before continuing.');
        error_log('Ezkart wallet registration: ' . get_class($error));
    }
    return ez_commerce_request('POST', '/internal/commerce/jobs/' . $job['id'] . '/finish', [
        'environment' => $job['environment'], 'workerId' => $worker, 'leaseToken' => $job['leaseToken'],
        'outcome' => $outcome, 'result' => $result, 'error' => $message,
    ])['job'];
}

function ez_wallet_process_enrollment(string $enrollmentId, string $environment): void
{
    // Configuration is checked before consuming a job attempt. Missing signing
    // credentials cannot repeatedly exhaust a merchant's setup request.
    [$client, $parent] = ez_wallet_provider_configuration($environment);
    $registration = ez_commerce_request('GET', '/internal/commerce/finance/wallet/registrations/' . $enrollmentId . '?environment=' . rawurlencode($environment))['registration'];
    if ($registration['profile'] !== null) return;
    $worker = 'wallet_' . bin2hex(random_bytes(12));
    $mode = $registration['jobState'] === 'uncertain' || $registration['binding'] !== null ? 'reconcile' : 'execute';
    $jobs = ez_commerce_request('POST', '/internal/commerce/jobs/claim', ['environment' => $environment, 'workerId' => $worker,
        'kinds' => ['wallet.register'], 'jobId' => $registration['jobId'], 'mode' => $mode, 'limit' => 1, 'leaseSeconds' => 120])['jobs'];
    foreach ($jobs as $job) ez_wallet_registration_job($job, $worker, $client, $parent);
}
