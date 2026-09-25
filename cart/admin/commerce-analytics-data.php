<?php
declare(strict_types=1);

function ez_central_analytics(array $query, array $products): array
{
    $allowed = ['report','range','from','to','group','cohort','q','status','stage','method','sort','table_page'];
    $filters = array_intersect_key($query, array_flip($allowed));
    foreach ($filters as $value) if (!is_string($value)) throw new RuntimeException('Choose valid analytics filters.');
    // Date inputs remain visible for preset periods; only custom dates constrain them.
    if (($filters['range'] ?? '') !== 'custom') unset($filters['from'], $filters['to']);
    $token = (string) ($_SESSION['supabase_access_token'] ?? '');
    if ($token === '') throw new RuntimeException('Sign in to load central analytics.');
    $data = ez_admin_get_json(rtrim(ez_config('cloudflare_api_url'), '/') . '/v1/commerce/analytics?' . http_build_query($filters),
        ['Accept: application/json', 'Authorization: Bearer ' . $token], 'Analytics');
    if (($data['ok'] ?? false) !== true || !isset($data['period'], $data['current'], $data['table'])) throw new RuntimeException('Analytics could not be loaded.');
    $zone = new DateTimeZone('Asia/Jakarta');
    foreach (['start','end','previousStart'] as $key) $data['period'][$key] = $data['period'][$key] === null ? null : (new DateTimeImmutable($data['period'][$key]))->setTimezone($zone);
    foreach ($data['buckets'] as &$bucket) foreach (['start','end'] as $key) $bucket[$key] = (new DateTimeImmutable($bucket[$key]))->setTimezone($zone);
    unset($bucket);
    $decorate = static function (array $row) use ($products): array {
        if (isset($row['key'])) $row['image_url'] = $products[$row['key']]['image_url'] ?? '';
        if (isset($row['order_id'])) {
            $row['customer'] = ['name' => $row['customer_name'], 'email' => $row['customer_email']];
            $row['_central'] = true;
        }
        return $row;
    };
    $data['current']['products'] = array_map($decorate, $data['current']['products']);
    $data['table']['rows'] = array_map($decorate, $data['table']['rows']);
    $data['period']['error'] = '';
    $data['rows'] = [];
    $data['central'] = true;
    $data['preview'] = ez_config('commerce_storage') !== 'd1';
    return $data;
}

function ez_analytics_money(mixed $amount): string
{
    if (is_int($amount)) $amount = (string) $amount;
    if (!is_string($amount) || preg_match('/^-?\d+$/D', $amount) !== 1) return ez_admin_money($amount);
    // Keep decimal integer strings out of PHP's floating-point number_format.
    return 'Rp' . preg_replace('/\B(?=(\d{3})+(?!\d))/', '.', $amount);
}
