<?php
declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';

// This walkthrough renders fixtures only. It cannot create orders or call providers.
if (ez_config('deployment_environment') !== 'test' || ez_commerce_environment() !== 'sandbox') {
    http_response_code(404);
    exit('Not found.');
}

$time = static fn(int $minutes): string => gmdate(DATE_ATOM, time() - 3600 + $minutes * 60);
$sample = [
    'order_id' => 'EZK-S-000000000000000000000001', 'status' => 'PAID',
    'commerce_environment' => 'sandbox', 'shipping_skipped' => false,
    'shipping' => ['courier' => 'JNE', 'service' => 'Regular', 'courier_type' => 'reg'],
    'total' => 76000, 'paid_at' => $time(0), 'updated_at' => $time(0),
    'fulfillment_status' => 'AWAITING_ACCEPTANCE',
];
$scenarios = [];
$add = static function (string $key, string $label, array $order) use (&$scenarios): void {
    $scenarios[$key] = [
        'label' => $label,
        'data' => [
            'ok' => true, 'order_id' => $order['order_id'], 'status' => $order['status'],
            'environment' => 'sandbox', 'total' => $order['total'], 'shop' => '',
            'payment_reference' => $order['status'] === 'PAID' ? 'SANDBOX-WALKTHROUGH' : '',
            'payment_details' => null, 'tracking' => ez_public_order_tracking($order),
        ],
    ];
};
$add('pending', 'Awaiting payment', array_replace($sample, ['status' => 'PENDING', 'paid_at' => '', 'fulfillment_status' => 'AWAITING_PAYMENT']));
$add('paid', 'Payment received', $sample);
$sample['accepted_at'] = $sample['updated_at'] = $time(5);
$sample['fulfillment_status'] = 'AWAITING_PICKUP_ARRANGEMENT';
$add('processing', 'Seller processing', $sample);
$sample['biteship_order_id'] = 'sandbox-walkthrough';
$sample['biteship_waybill_id'] = 'DEMO-TRACKING-001';
$sample['biteship_status'] = 'confirmed';
$sample['fulfilled_at'] = $sample['updated_at'] = $sample['biteship_status_at'] = $time(10);
$sample['biteship_locations'] = [
    'origin' => ['latitude' => -6.2253114, 'longitude' => 106.7993735],
    'destination' => ['latitude' => -6.28927, 'longitude' => 106.7749200],
];
$add('pickup', 'Awaiting pickup', $sample);
$sample['biteship_status'] = 'picked';
$sample['biteship_status_at'] = $time(20);
$sample['biteship_history'] = [['status' => 'picked', 'updated_at' => $time(20), 'note' => 'The courier collected the package from the seller.']];
$add('picked', 'Picked up', $sample);
$sample['biteship_status'] = 'in_transit';
$sample['biteship_status_at'] = $time(25);
$sample['biteship_history'][] = ['status' => 'in_transit', 'updated_at' => $time(25), 'note' => 'Package received at the Jakarta sorting facility.'];
$add('transit', 'In transit', $sample);
$inTransit = $sample;
$sample['biteship_status'] = 'dropping_off';
$sample['biteship_status_at'] = $time(30);
$sample['biteship_history'][] = ['status' => 'dropping_off', 'updated_at' => $time(30), 'note' => 'The courier is on the way to the delivery address.'];
$add('delivery', 'Out for delivery', $sample);
$sample['biteship_status'] = 'delivered';
$sample['biteship_status_at'] = $time(40);
$sample['biteship_history'][] = ['status' => 'delivered', 'updated_at' => $time(40), 'note' => 'The package was received at the delivery address.'];
$add('delivered', 'Delivered', $sample);
foreach ([
    ['delay', 'Delivery on hold', 'on_hold', 'Delivery is on hold. The courier will provide another update.'],
    ['cancelled', 'Delivery cancelled', 'cancelled', 'This simulated shipment has been cancelled.'],
    ['returning', 'Returning to seller', 'return_in_transit', 'The package is on its way back to the seller.'],
    ['returned', 'Returned to seller', 'returned', 'The package has been returned to the seller.'],
] as [$key, $label, $status, $note]) {
    $order = $inTransit;
    $order['biteship_status'] = $status;
    $order['biteship_status_at'] = $time(35);
    $order['biteship_history'][] = ['status' => $status, 'updated_at' => $time(35), 'note' => $note];
    $add($key, $label, $order);
}
$unavailable = $inTransit;
$unavailable['tracking_unavailable'] = true;
$add('unavailable', 'Courier updates unavailable', $unavailable);
$noMap = $inTransit;
unset($noMap['biteship_locations']);
$add('no-map', 'In transit without coordinates', $noMap);
$trackingSandboxData = $scenarios;
require __DIR__ . '/return.php';
