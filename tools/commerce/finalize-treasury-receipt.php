<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/commerce-treasury-bank.php';
try {
    if (count($argv) !== 2 || preg_match('/^--receipt-file=(\/[^\x00]+)$/D', $argv[1], $m) !== 1) throw new InvalidArgumentException('Use --receipt-file=/absolute/private/original.json.');
    $d = ez_treasury_saved_receipt($m[1]); if ($d === null) throw new RuntimeException('Original receipt is missing.');
    echo json_encode(['ok' => true, ...ez_finalize_treasury_receipt($d)], JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable) {
    fwrite(STDERR, "Original treasury receipt was not confirmed. Retain the private file and review its saved status; no provider call was made.\n"); exit(1);
}
