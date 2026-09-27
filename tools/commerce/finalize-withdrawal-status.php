<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/commerce-withdrawal-status.php';
try {
    if (count($argv) !== 2 || preg_match('/^--receipt-file=(\/[^\x00]+)$/D', $argv[1], $match) !== 1)
        throw new InvalidArgumentException('Required: --receipt-file=/absolute/private/withdrawal-status.json.');
    $document = ez_withdrawal_saved_payment($match[1]);
    if ($document === null) throw new InvalidArgumentException('The original private status receipt was not found.');
    echo json_encode(['ok' => true, ...ez_finalize_withdrawal_status($document)], JSON_THROW_ON_ERROR) . "\n";
    exit(0);
} catch (Throwable) {
    fwrite(STDERR, json_encode(['ok' => false, 'error' => 'Status receipt finalization was not confirmed. Retain the original private receipt. No provider read or bank transfer was retried.'], JSON_THROW_ON_ERROR) . "\n");
    exit(1);
}
