<?php
declare(strict_types=1);

require_once __DIR__ . '/commerce-checkout.php';
require_once __DIR__ . '/commerce-doku.php';

function ez_central_payment_event(array $order, string $key, string $type, array $data): array
{
    return ez_commerce_request('POST', '/internal/commerce/orders/' . $order['id'] . '/events', [
        'environment' => $order['environment'], 'sellerId' => $order['sellerId'], 'eventKey' => $key, 'type' => $type, 'data' => $data,
    ])['order'];
}

function ez_central_payment_session(array $order, array $payment): array
{
    $expiry = $payment['payment_expires_at'];
    if (preg_match('/^\d{14}$/D', $expiry) === 1) {
        $date = DateTimeImmutable::createFromFormat('!YmdHis', $expiry, new DateTimeZone('Asia/Jakarta'));
        if (!$date || $date->format('YmdHis') !== $expiry) throw new RuntimeException('Invalid provider expiry.');
        $expiry = $date->format(DATE_ATOM);
    }
    return ['provider' => 'doku', 'providerRequestId' => $order['paymentRequestId'], 'amount' => $order['total'], 'currency' => 'IDR',
        'expiresAt' => $expiry, 'paymentUrl' => $payment['payment_url'],
        'method' => $payment['payment_details']['method'] ?? '', 'accountNumber' => $payment['payment_details']['account_number'] ?? ''];
}

/** A lease permits one provider operation; a missing response is never permission to repeat it. */
function ez_central_payment_job(array $job, string $worker): array
{
    $outcome = 'uncertain'; $result = ['recorded' => false]; $errorMessage = '';
    try {
        $order = ez_central_order($job['orderId'], $job['environment']);
        if ($order['snapshot']['checkout']['paymentFlow'] === 'routed_hosted') {
            require_once __DIR__ . '/commerce-hosted-payments.php';
            return ez_central_hosted_payment_job($job, $worker);
        }
        if ($order['snapshot']['checkout']['paymentFlow'] === 'snap_bca') {
            require_once __DIR__ . '/commerce-snap-payments.php';
            return ez_central_snap_payment_job($job, $worker);
        }
        if ($order['payment'] !== null || in_array($order['state'], ['paid', 'partially_refunded', 'refunded'], true)) {
            $outcome = 'succeeded'; $result = ['recorded' => true];
        } elseif ($job['mode'] === 'reconcile') {
            $notification = ez_doku_central_status($order);
            $order = ez_apply_central_doku_result($order, $notification);
            if (in_array($order['state'], ['paid', 'partially_refunded', 'refunded'], true)) {
                $outcome = 'succeeded'; $result = ['recorded' => true, 'reconciled' => true];
            } else {
                // A status response without recoverable instructions is not proof that create had no effect.
                $errorMessage = 'Provider status did not establish a captured payment or recoverable payment instructions. Review the original request.';
            }
        } elseif ($order['state'] !== 'creating' || strtotime($order['expiresAt']) <= time()) {
            $outcome = 'dead'; $result = ['notStarted' => true];
        } else {
            if ($job['data']['providerRequestId'] !== $order['paymentRequestId']) throw new RuntimeException('Provider job does not match this order.');
            $payment = ez_create_doku_payment(ez_central_order_projection($order));
            $order = ez_central_payment_event($order, 'payment_created:' . $job['id'], 'payment.created', ez_central_payment_session($order, $payment));
            $outcome = 'succeeded'; $result = ['recorded' => true];
        }
    } catch (Throwable $error) {
        // Provider 5xx, malformed success, network failure, and a lost storage response all remain uncertain.
        // Store a bounded operational explanation, never provider bodies or customer details.
        $errorMessage = 'Payment operation was not confirmed. Reconcile the original provider request before any retry.';
        error_log('Ezkart payment job ' . $job['id'] . ': ' . get_class($error));
    }
    return ez_commerce_request('POST', '/internal/commerce/jobs/' . $job['id'] . '/finish', [
        'environment' => $job['environment'], 'workerId' => $worker, 'leaseToken' => $job['leaseToken'],
        'outcome' => $outcome, 'result' => $result, 'error' => $errorMessage,
    ])['job'];
}

function ez_central_checkout_payment(array $order): array
{
    if ($order['payment'] !== null || !in_array($order['state'], ['creating', 'pending'], true)) return $order;
    $worker = 'checkout_' . bin2hex(random_bytes(12));
    $mode = $order['paymentJobState'] === 'uncertain' ? 'reconcile' : 'execute';
    $jobs = ez_commerce_request('POST', '/internal/commerce/jobs/claim', [
        'environment' => $order['environment'], 'workerId' => $worker, 'kinds' => ['payment.create'],
        'orderId' => $order['id'], 'mode' => $mode, 'limit' => 1, 'leaseSeconds' => 120,
    ])['jobs'];
    foreach ($jobs as $job) ez_central_payment_job($job, $worker);
    return ez_central_order($order['id'], $order['environment']);
}
