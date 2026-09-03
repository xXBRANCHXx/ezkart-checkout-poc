<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    $ids = array_values(array_unique(array_filter(array_map(
        'trim',
        explode(',', (string) ($_GET['products'] ?? '')),
    ))));
    if ($ids === [] || count($ids) > 100) {
        throw new InvalidArgumentException('The product request is too large.');
    }
    $catalog = array_values(array_filter(ez_catalog($ids), 'is_array'));
    if (count($catalog) !== count($ids)) {
        throw new InvalidArgumentException('One or more selected products are unavailable.');
    }
    ez_api_json(['ok' => true, 'products' => $catalog]);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable $error) {
    error_log('Ezkart storefront catalog error: ' . $error->getMessage());
    ez_api_json(['ok' => false, 'error' => 'The selected products could not be loaded.'], 503);
}
