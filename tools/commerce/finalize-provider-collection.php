<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/commerce-provider-evidence.php';
try {
    if (count($argv) !== 2 || preg_match('/^--receipt-file=(\/[^\x00]+)$/D', $argv[1], $match) !== 1) throw new InvalidArgumentException('Required: --receipt-file=/absolute/private/pending.json.');
    $file = $match[1];
    if (!is_file($file) || is_link($file) || filesize($file) > 10000 || (fileperms($file) & 0077) !== 0) throw new InvalidArgumentException('The pending receipt must be a private regular file, at most 10,000 bytes.');
    $document = json_decode(file_get_contents($file), true, 16, JSON_THROW_ON_ERROR);
    $payload = $document['pendingCollection'] ?? null;
    if (!is_array($payload) || count($payload) !== 3 || !isset($payload['seller'], $payload['environment'], $payload['observationIds'])
        || !is_string($payload['seller']) || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/D', $payload['seller']) !== 1
        || !is_array($payload['observationIds']) || !array_is_list($payload['observationIds'])
        || count($payload['observationIds']) < 4 || count($payload['observationIds']) > 82) throw new InvalidArgumentException('The pending collection receipt is invalid.');
    foreach ($payload['observationIds'] as $id) if (!is_string($id) || preg_match('/^fobs_[a-f0-9]{40}$/D', $id) !== 1) throw new InvalidArgumentException('The pending observation ID is invalid.');
    $deployment = ez_config('deployment_environment');
    if (!(($deployment === 'test' && $payload['environment'] === 'sandbox') || ($deployment === 'beta' && $payload['environment'] === 'production'))) throw new InvalidArgumentException('Collection finalization accepts TEST/sandbox or beta/production only.');
    ez_central_commerce_environment($payload['environment']);
    $collection = ez_record_provider_collection($payload);
    echo json_encode(['ok' => true, 'collectionId' => $collection['id'], 'pagesExhausted' => $collection['pagesExhausted'],
        'atomicSnapshot' => false, 'settlementVerified' => false], JSON_THROW_ON_ERROR) . "\n";
    exit($collection['pagesExhausted'] ? 0 : 2);
} catch (Throwable $error) {
    $reason = $error instanceof InvalidArgumentException ? $error->getMessage() : 'Collection finalization did not finish; retain the same receipt for recovery.';
    fwrite(STDERR, json_encode(['ok' => false, 'error' => $reason], JSON_THROW_ON_ERROR) . "\n");
    exit(1);
}
