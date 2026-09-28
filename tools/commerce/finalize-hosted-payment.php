<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/bootstrap.php';
require_once dirname(__DIR__, 2) . '/cart/api/commerce-hosted-recovery.php';
try {
    if ($argc !== 2 || preg_match('~^--receipt-file=(/[^\x00-\x1f]+)$~D', $argv[1], $match) !== 1) throw new InvalidArgumentException('Use --receipt-file=/private/original.json');
    $document = ez_hosted_saved_receipt($match[1]); if ($document === null) throw new RuntimeException('Original receipt is missing.');
    echo json_encode(ez_finalize_hosted_receipt($document), JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable) {
    fwrite(STDERR, "Original Checkout receipt was not confirmed. Retain it for review; no provider request was sent.\n"); exit(1);
}
