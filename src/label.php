<?php
declare(strict_types=1);

require_once __DIR__ . '/commerce.php';

/**
 * Code 128-B patterns. Each digit is the width of an alternating bar/space.
 * The final stop pattern contains seven modules.
 */
function ez_code128_patterns(): array
{
    return [
        '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
        '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
        '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
        '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
        '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
        '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
        '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
        '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
        '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
        '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
        '114131','311141','411131','211412','211214','211232','2331112',
    ];
}

function ez_code128_svg(string $value, int $height = 78): string
{
    $value = preg_replace('/[^\x20-\x7E]/', '', $value) ?? '';
    if ($value === '') {
        $value = 'EZKART';
    }
    $value = substr($value, 0, 48);
    $codes = [104];
    foreach (str_split($value) as $character) {
        $codes[] = ord($character) - 32;
    }
    $checksum = 104;
    foreach (array_slice($codes, 1) as $position => $code) {
        $checksum += $code * ($position + 1);
    }
    $codes[] = $checksum % 103;
    $codes[] = 106;
    $patterns = ez_code128_patterns();
    $module = 2;
    $quiet = 10 * $module;
    $x = $quiet;
    $rectangles = '';
    foreach ($codes as $code) {
        $bar = true;
        foreach (str_split($patterns[$code]) as $width) {
            $pixelWidth = (int) $width * $module;
            if ($bar) {
                $rectangles .= '<rect x="' . $x . '" y="0" width="' . $pixelWidth . '" height="' . $height . '"/>';
            }
            $x += $pixelWidth;
            $bar = !$bar;
        }
    }
    $totalWidth = $x + $quiet;
    return '<svg class="barcode" role="img" aria-label="Barcode ' . ez_html($value) . '" '
        . 'viewBox="0 0 ' . $totalWidth . ' ' . $height . '" xmlns="http://www.w3.org/2000/svg">'
        . $rectangles . '</svg>';
}

function ez_label_data(PDO $pdo, string $sessionId): array
{
    $session = ez_session($pdo, $sessionId);
    $statement = $pdo->prepare('SELECT * FROM ezkart_shipments WHERE session_id = :session_id LIMIT 1');
    $statement->execute([':session_id' => $sessionId]);
    $shipment = $statement->fetch();
    if (!is_array($shipment) || (string) $shipment['provider_order_id'] === '') {
        throw new RuntimeException('The Biteship shipment has not been created yet.');
    }
    return [
        'session' => $session,
        'shipment' => $shipment,
        'items' => ez_session_items($pdo, $sessionId),
    ];
}

function ez_render_a5_label(PDO $pdo, string $sessionId): never
{
    $data = ez_label_data($pdo, $sessionId);
    $session = $data['session'];
    $shipment = $data['shipment'];
    $tracking = trim((string) ($shipment['waybill_id'] ?: $shipment['tracking_id']));
    $courier = trim((string) $session['courier_name'] . ' ' . (string) $session['courier_service_name']);
    $originArea = ez_config('biteship_origin_area_name', 'Origin configured in Biteship');
    $weightKg = number_format(((int) $session['total_weight_grams']) / 1000, 2);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>Shipping label ' . ez_html($tracking) . '</title>'
        . '<link rel="stylesheet" href="/styles.css"></head><body class="label-page">'
        . '<main class="shipping-label">'
        . '<header class="label-header"><img src="/assets/ezkart-logo.svg" alt="Ezkart">'
        . '<div><strong>' . ez_html(strtoupper($courier)) . '</strong><span>'
        . ez_html((string) $shipment['routing_code']) . '</span></div></header>'
        . '<section class="label-barcode">' . ez_code128_svg($tracking)
        . '<strong>' . ez_html($tracking) . '</strong></section>'
        . '<section class="label-grid"><article><span>FROM</span><strong>'
        . ez_html(ez_config('biteship_origin_contact_name', 'ZERO Fulfillment')) . '</strong><p>'
        . ez_html(ez_config('biteship_origin_address')) . '<br>' . ez_html($originArea) . '<br>'
        . ez_html(ez_config('biteship_origin_contact_phone')) . '</p></article>'
        . '<article class="recipient"><span>TO</span><strong>' . ez_html((string) $session['customer_name'])
        . '</strong><p>' . ez_html((string) $session['destination_address']) . '<br>'
        . ez_html((string) $session['destination_area_name']) . '<br>'
        . ez_html((string) $session['customer_phone']) . '</p></article></section>'
        . '<section class="label-meta"><div><span>Weight</span><strong>' . $weightKg . ' kg</strong></div>'
        . '<div><span>Pieces</span><strong>' . count($data['items']) . '</strong></div>'
        . '<div><span>Order</span><strong>' . ez_html((string) $session['merchant_order_reference']) . '</strong></div>'
        . '<div><span>Shipment</span><strong>' . ez_html((string) $shipment['provider_order_id']) . '</strong></div></section>'
        . '<section class="label-note"><strong>Delivery note</strong><p>'
        . ez_html((string) ($session['destination_note'] ?: 'No special instructions')) . '</p></section>'
        . '<footer>Generated by Ezkart • Biteship order data • Print at 100% on A5 portrait</footer>'
        . '</main><button id="print-label" class="print-button" type="button">Print A5 label</button>'
        . '<script src="/script.js" defer></script></body></html>';
    exit;
}
