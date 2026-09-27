<?php
declare(strict_types=1);
require_once __DIR__ . '/commerce-checkout.php';
require_once __DIR__ . '/doku-bca-snap.php';

function ez_snap_bca_parameters(string $environment): array
{
    // Store unpadded digits in configuration: ez_config deliberately trims it.
    $service = ez_provider_config('doku', 'snap_bca_partner_service_id', $environment);
    $prefix = ez_provider_config('doku', 'snap_bca_customer_prefix', $environment);
    if (preg_match('/^[0-9]{1,8}$/D', $service) !== 1 || preg_match('/^[0-9]{1,10}$/D', $prefix) !== 1
        || strlen($service . $prefix) >= 16) throw new EzDokuReadException('bca_configuration');
    return ['partnerServiceId' => str_pad($service, 8, ' ', STR_PAD_LEFT), 'customerPrefix' => $prefix];
}

function ez_snap_payment_path(string $orderId): string
{
    if (preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $orderId) !== 1) throw new InvalidArgumentException('Invalid SNAP order.');
    return '/internal/commerce/snap-payments/' . $orderId;
}

function ez_snap_store_receipt(string $orderId, array $evidence): array
{
    $notification = $evidence['operation'] === 'bca-notification';
    $payload = ['environment' => $evidence['environment'], 'credentialFingerprint' => $evidence['credentialFingerprint'],
        'operation' => $evidence['operation'], 'externalId' => $evidence['externalId'],
        'sentAt' => $notification ? $evidence['sentAt'] : $evidence['requestedAt'], 'observedAt' => $evidence['observedAt'],
        'body' => $notification ? $evidence['body'] : $evidence['responseBody'], 'requestBody' => $notification ? null : $evidence['requestBody']];
    $path = ez_snap_payment_path($orderId) . '/receipt';
    try { return ez_commerce_request('POST', $path, $payload); }
    catch (EzCommerceStorageException $error) {
        // Only repeat the same internal, idempotent receipt. Never repeat a
        // provider write after a lost response or a failed durable commit.
        if ($error->httpStatus < 500) throw $error;
        return ez_commerce_request('POST', $path, $payload);
    }
}

function ez_central_snap_payment_job(array $job, string $worker): array
{
    $outcome = 'uncertain'; $result = ['recorded' => false]; $message = ''; $mayHaveStarted = true;
    try {
        $path = ez_snap_payment_path($job['orderId']);
        $payment = ez_commerce_request('GET', $path . '?environment=' . $job['environment'])['payment'];
        $order = $payment['order'];
        if ($job['kind'] !== 'payment.create' || $payment['jobId'] !== $job['id'] || $order['sellerId'] !== $job['sellerId']
            || $order['environment'] !== $job['environment'] || $order['paymentRequestId'] !== $job['data']['providerRequestId']) throw new RuntimeException('SNAP job identity changed.');
        $mayHaveStarted = $payment['binding'] !== null || ($payment['route'] !== null && $payment['route']['routing'] === null);
        if ($order['payment'] !== null || in_array($order['state'], ['paid', 'partially_refunded', 'refunded'], true)) {
            $outcome = 'succeeded'; $result = ['recorded' => true];
        } elseif (!$mayHaveStarted && ($order['state'] !== 'creating' || strtotime($order['expiresAt']) <= time())) {
            $outcome = 'dead'; $result = ['notStarted' => true];
        } else {
            $client = EzDokuBcaSnapClient::configured($order['environment']);
            $identity = $client->providerIdentity();
            if ($payment['binding'] !== null) {
                if ($identity['credentialFingerprint'] !== $payment['binding']['credentialFingerprint'] || $identity['clientId'] !== $payment['clientId']) throw new RuntimeException('Original SNAP credentials changed.');
                // A lost DGPC creation reply has no documented no-effect proof.
                // A known account permits a read only observation after 60s.
                if ($payment['accountNumber'] !== null && strtotime($payment['boundAt']) <= time() - 60) {
                    $observed = $client->observeStatus($payment['binding'], $payment['accountNumber']);
                    ez_snap_store_receipt($order['id'], $observed['evidence']);
                }
                throw new RuntimeException('Reconcile the original SNAP request.');
            }
            if ($payment['route'] !== null && ($payment['route']['binding']['credentialFingerprint'] !== $identity['credentialFingerprint'] || $payment['route']['clientId'] !== $identity['clientId'])) throw new RuntimeException('Original routing credentials changed.');
            if ($payment['route'] !== null && $payment['route']['routing'] === null) throw new RuntimeException('Reconcile the original split-rule request.');
            if ($job['mode'] !== 'execute') {
                // No fence means no provider write could have been dispatched.
                $outcome = 'retry'; $result = ['noEffectConfirmed' => true];
            } else {
                $parameters = ez_snap_bca_parameters($order['environment']);
                $binding = ['environment' => $order['environment'], 'credentialFingerprint' => $identity['credentialFingerprint'],
                    'externalId' => $order['paymentRequestId'], 'orderId' => $order['id'], ...$parameters, 'amount' => $order['total'],
                    'name' => $order['customer']['name'], 'email' => $order['customer']['email'], 'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', strtotime($order['expiresAt']))];
                $client->paymentPayload($binding);
                $client->verifyAuthentication();
                $route = $payment['route'];
                if ($route === null) {
                    $mayHaveStarted = true;
                    $route = ez_commerce_request('POST', $path . '/route/bind', ['environment' => $order['environment'], 'workerId' => $worker,
                        'leaseToken' => $job['leaseToken'], 'credentialFingerprint' => $identity['credentialFingerprint'], 'clientId' => $identity['clientId']]);
                    if (($route['mayCreateRule'] ?? false) !== true) throw new RuntimeException('Routing dispatch was not confirmed.');
                    $createdRule = $client->createSplitRule($route['binding']);
                    $routePayload = ['environment' => $order['environment'], 'evidence' => $createdRule['evidence']];
                    try { $savedRule = ez_commerce_request('POST', $path . '/route/receipt', $routePayload); }
                    catch (EzCommerceStorageException $error) {
                        if ($error->httpStatus < 500) throw $error;
                        $savedRule = ez_commerce_request('POST', $path . '/route/receipt', $routePayload);
                    }
                    if (($savedRule['recorded'] ?? false) !== true || ($savedRule['routing'] ?? null) !== $createdRule['routing']) throw new RuntimeException('Original split rule was not recorded.');
                    $route['routing'] = $savedRule['routing'];
                }
                $binding['routing'] = $route['routing'];
                $client->paymentPayload($binding);
                // Even a missing bind acknowledgement requires reconciliation.
                $mayHaveStarted = true;
                $bound = ez_commerce_request('POST', $path . '/bind', ['environment' => $order['environment'], 'workerId' => $worker,
                    'leaseToken' => $job['leaseToken'], 'credentialFingerprint' => $identity['credentialFingerprint'], 'clientId' => $identity['clientId'], ...$parameters]);
                if (($bound['mayCreate'] ?? false) !== true || $bound['binding'] !== $binding) throw new RuntimeException('SNAP dispatch was not confirmed.');
                $created = $client->createAccount($binding);
                ez_snap_store_receipt($order['id'], $created['evidence']);
                $outcome = 'succeeded'; $result = ['recorded' => true];
            }
        }
    } catch (Throwable $error) {
        if (!$mayHaveStarted && $outcome !== 'dead') { $outcome = 'retry'; $result = ['noEffectConfirmed' => true]; }
        $message = $mayHaveStarted ? 'SNAP payment is not confirmed. Reconcile the original request; do not create another account.'
            : 'SNAP payment has not started. Restore provider configuration or authentication before retrying.';
        error_log('Ezkart SNAP payment job ' . $job['id'] . ': ' . get_class($error));
    }
    return ez_commerce_request('POST', '/internal/commerce/jobs/' . $job['id'] . '/finish', [
        'environment' => $job['environment'], 'workerId' => $worker, 'leaseToken' => $job['leaseToken'],
        'outcome' => $outcome, 'result' => $result, 'error' => $message,
    ])['job'];
}

function ez_apply_snap_payment_notification(string $body, array $headers, string $target): array
{
    if (!ez_central_commerce_enabled()) throw new EzCommerceStorageException('Central commerce storage is held.', 503);
    $environment = ez_central_commerce_environment();
    $client = EzDokuBcaSnapClient::configured($environment);
    $notice = $client->authenticateNotification($body, $headers, $target);
    $orderId = $notice->trxId ?? null;
    if (!is_string($orderId) || preg_match('/^EZK-' . ($environment === 'sandbox' ? 'S' : 'P') . '-[A-F0-9]{24}$/D', $orderId) !== 1) throw new EzDokuReadException('notification_order');
    $payment = ez_commerce_request('GET', ez_snap_payment_path($orderId) . '?environment=' . $environment)['payment'];
    if ($payment['binding'] === null || $payment['clientId'] !== $client->providerIdentity()['clientId']) throw new EzCommerceStorageException('Original payment dispatch is not available.', 503);
    $verified = $client->paymentNotification($body, $headers, $target, $payment['binding'], $payment['accountNumber']);
    $saved = ez_snap_store_receipt($orderId, $verified['evidence']);
    if (($saved['recorded'] ?? false) !== true || ($saved['paymentConfirmed'] ?? false) !== true) throw new EzCommerceStorageException('Payment capture was not confirmed.', 503);
    return $verified['acknowledgement'];
}

/** Read the saved account only. A status reply is never a replacement create,
 * capture, settlement or permission to retry an uncertain provider write.
 */
function ez_observe_central_snap_payment(string $orderId): array
{
    $environment = ez_central_commerce_environment();
    $payment = ez_commerce_request('GET', ez_snap_payment_path($orderId) . '?environment=' . $environment)['payment'];
    if ($payment['binding'] === null || $payment['accountNumber'] === null) throw new RuntimeException('The original account is not recorded. Reconcile the invoice with DOKU; do not create another account.');
    if (strtotime($payment['boundAt']) > time() - 60) throw new RuntimeException('Wait sixty seconds after dispatch before observing payment status.');
    $client = EzDokuBcaSnapClient::configured($environment);
    if ($client->providerIdentity()['clientId'] !== $payment['clientId'] || $client->credentialFingerprint !== $payment['binding']['credentialFingerprint']) throw new RuntimeException('The original provider credentials changed.');
    $observed = $client->observeStatus($payment['binding'], $payment['accountNumber']);
    $saved = ez_snap_store_receipt($orderId, $observed['evidence']);
    return ['orderId' => $orderId, 'environment' => $environment, 'recorded' => $saved['recorded'], 'receiptId' => $saved['receiptId'],
        'records' => $observed['data']['records'], 'paymentConfirmed' => false, 'settlementVerified' => false, 'createRetryAllowed' => false];
}
