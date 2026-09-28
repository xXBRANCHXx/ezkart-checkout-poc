<?php
declare(strict_types=1);
require_once __DIR__ . '/commerce-checkout.php';
require_once __DIR__ . '/doku-hosted-checkout.php';
require_once __DIR__ . '/commerce-hosted-recovery.php';
function ez_hosted_checkout_methods(string $environment): array
{
    $raw = ez_provider_config('doku', 'checkout_methods', $environment);
    $methods = $raw === '' ? [] : explode(',', $raw);
    if (count($methods) < 1 || count($methods) > 3 || array_diff($methods, ['QRIS','CREDIT_CARD','VIRTUAL_ACCOUNT_BCA'])
        || count(array_unique($methods)) !== count($methods)) throw new EzDokuReadException('checkout_methods_configuration');
    sort($methods); return $methods;
}
function ez_hosted_payment_path(string $orderId): string
{
    if (preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $orderId) !== 1) throw new InvalidArgumentException('Invalid Checkout order.');
    return '/internal/commerce/hosted-payments/' . $orderId;
}
function ez_hosted_store_receipt(string $orderId, array $evidence): array
{
    $path = ez_hosted_payment_path($orderId) . '/receipt';
    try { return ez_commerce_request('POST', $path, $evidence); }
    catch (EzCommerceStorageException $error) {
        if ($error->httpStatus < 500) throw $error;
        return ez_commerce_request('POST', $path, $evidence);
    }
}
function ez_central_hosted_payment_job(array $job, string $worker): array
{
    $outcome = 'uncertain'; $result = ['recorded' => false]; $message = ''; $mayHaveStarted = true;
    try {
        $path = ez_hosted_payment_path($job['orderId']);
        $payment = ez_commerce_request('GET', $path . '?environment=' . $job['environment'])['payment'];
        $order = $payment['order'];
        if ($job['kind'] !== 'payment.create' || $payment['jobId'] !== $job['id'] || $order['sellerId'] !== $job['sellerId']
            || $order['environment'] !== $job['environment'] || $order['paymentRequestId'] !== $job['data']['providerRequestId']) throw new RuntimeException('Checkout job identity changed.');
        $mayHaveStarted = $payment['binding'] !== null || ($payment['route'] !== null && $payment['route']['routing'] === null);
        if ($order['payment'] !== null || in_array($order['state'], ['paid', 'partially_refunded', 'refunded'], true)) {
            $outcome = 'succeeded'; $result = ['recorded' => true];
        } elseif (!$mayHaveStarted && ($order['state'] !== 'creating' || strtotime($order['expiresAt']) <= time())) {
            $outcome = 'dead'; $result = ['notStarted' => true];
        } else {
            $client = EzDokuHostedCheckoutClient::configured($order['environment']);
            $identity = $client->providerIdentity();
            $file = ez_hosted_receipt_directory() . '/' . $order['id'] . '-checkout.json';
            if ($payment['binding'] !== null) {
                if ($identity['credentialFingerprint'] !== $payment['binding']['credentialFingerprint'] || $identity['clientId'] !== $payment['clientId']) throw new RuntimeException('Original Checkout credentials changed.');
                $saved = ez_hosted_saved_receipt($file);
                if ($saved !== null) { ez_finalize_hosted_receipt($saved); $outcome = 'succeeded'; $result = ['recorded'=>true]; }
                else throw new RuntimeException('Reconcile the original Checkout request.');
            }
            if ($outcome === 'succeeded') { /* Only the original saved receipt was finalized. */ }
            elseif ($payment['route'] !== null && ($payment['route']['binding']['credentialFingerprint'] !== $identity['credentialFingerprint'] || $payment['route']['clientId'] !== $identity['clientId'])) throw new RuntimeException('Original routing credentials changed.');
            if ($outcome !== 'succeeded' && $payment['route'] !== null && $payment['route']['routing'] === null) throw new RuntimeException('Reconcile the original split-rule request.');
            if ($outcome === 'succeeded') { /* Recovery does not authenticate or create. */ }
            elseif ($job['mode'] !== 'execute') {
                // No fence means no provider write could have been dispatched.
                $outcome = 'retry'; $result = ['noEffectConfirmed' => true];
            } else {
                $methods = array_values(array_intersect(ez_hosted_checkout_methods($order['environment']), ['QRIS','CREDIT_CARD']));
                if (!$methods) throw new EzDokuReadException('checkout_methods_configuration');
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
                // Even a missing bind acknowledgement requires reconciliation.
                $mayHaveStarted = true;
                $bound = ez_commerce_request('POST', $path . '/bind', ['environment' => $order['environment'], 'workerId' => $worker,
                    'leaseToken' => $job['leaseToken'], 'credentialFingerprint' => $identity['credentialFingerprint'], 'clientId' => $identity['clientId'], 'methods' => $methods]);
                if (($bound['mayCreate'] ?? false) !== true) throw new RuntimeException('Checkout dispatch was not confirmed.');
                $created = $client->createSession($bound['binding']);
                ez_hosted_save_receipt($file, ['version'=>1,'orderId'=>$order['id'],'environment'=>$order['environment'],'binding'=>$bound['binding'],'evidence'=>$created['evidence']]);
                ez_hosted_store_receipt($order['id'], $created['evidence']);
                $outcome = 'succeeded'; $result = ['recorded' => true];
            }
        }
    } catch (Throwable $error) {
        if (!$mayHaveStarted && $outcome !== 'dead') { $outcome = 'retry'; $result = ['noEffectConfirmed' => true]; }
        $message = $mayHaveStarted ? 'Checkout payment is not confirmed. Reconcile the original request; do not create another account.'
            : 'Checkout payment has not started. Restore provider configuration or authentication before retrying.';
        error_log('Ezkart Checkout payment job ' . $job['id'] . ': ' . get_class($error) . ($error instanceof EzDokuReadException ? ':' . $error->reason : ''));
    }
    return ez_commerce_request('POST', '/internal/commerce/jobs/' . $job['id'] . '/finish', [
        'environment' => $job['environment'], 'workerId' => $worker, 'leaseToken' => $job['leaseToken'],
        'outcome' => $outcome, 'result' => $result, 'error' => $message,
    ])['job'];
}

function ez_apply_hosted_payment_notification(string $body, array $headers, string $target): array
{
    if (!ez_central_commerce_enabled()) throw new EzCommerceStorageException('Central storage is held.', 503);
    $environment = ez_central_commerce_environment();
    $client = EzDokuHostedCheckoutClient::configured($environment);
    $raw = $client->authenticateNotification($body, $headers, $target);
    $orderId = $raw->order->invoice_number ?? null;
    if (!is_string($orderId) || preg_match('/^EZK-' . ($environment === 'sandbox' ? 'S' : 'P') . '-[A-F0-9]{24}$/D', $orderId) !== 1) throw new EzDokuReadException('notification_order');
    $payment = ez_commerce_request('GET', ez_hosted_payment_path($orderId) . '?environment=' . $environment)['payment'];
    if ($payment['binding'] === null || $payment['clientId'] !== $client->providerIdentity()['clientId']
        || $payment['binding']['credentialFingerprint'] !== $client->credentialFingerprint) throw new EzCommerceStorageException('Original Checkout binding is unavailable.', 503);
    $saved = ez_hosted_store_receipt($orderId, $client->notificationEvidence($body, $headers));
    if (($saved['recorded'] ?? false) !== true) throw new EzCommerceStorageException('Checkout receipt was not saved.', 503);
    return ['ok' => true];
}
