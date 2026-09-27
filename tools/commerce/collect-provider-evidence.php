<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/commerce-provider-evidence.php';
try {
    $input = [];
    foreach (array_slice($argv, 1) as $argument) {
        if (preg_match('/^--(environment|seller|from|to|max-pages)=(.+)$/sD', $argument, $match) !== 1 || isset($input[$match[1]])) throw new InvalidArgumentException('Arguments must be named and unique.');
        $input[$match[1]] = $match[2];
    }
    foreach (['environment', 'seller', 'from', 'to'] as $field) if (!isset($input[$field])) throw new InvalidArgumentException('Required: --environment=sandbox|production --seller=ID --from=ISO8601 --to=ISO8601 [--max-pages=10].');
    $deployment = ez_config('deployment_environment');
    if (!(($deployment === 'test' && $input['environment'] === 'sandbox')
        || ($deployment === 'beta' && $input['environment'] === 'production'))) {
        throw new InvalidArgumentException('This workbench evidence command accepts TEST/sandbox or beta/production only.');
    }
    ez_central_commerce_environment($input['environment']);
    $pages = $input['max-pages'] ?? '10';
    if (preg_match('/^[1-9][0-9]?$/D', $pages) !== 1 || (int) $pages > 40) throw new InvalidArgumentException('Page budget must be between 1 and 40 per account.');
    $report = ez_collect_seller_provider_evidence($input['seller'], $input['from'], $input['to'], (int) $pages);
    echo json_encode(['ok' => true, ...$report], JSON_THROW_ON_ERROR) . "\n";
    exit($report['pagesExhausted'] ? 0 : 2);
} catch (Throwable $error) {
    if ($error instanceof EzProviderCollectionPending) {
        // Safe source IDs only: no credentials, account numbers or provider body.
        // Preserve stderr privately and finalize this exact manifest without a
        // second collection or provider request.
        fwrite(STDERR, json_encode(['ok' => false, 'error' => $error->getMessage(), 'pendingCollection' => $error->pendingCollection], JSON_THROW_ON_ERROR) . "\n");
        exit(1);
    }
    $reason = $error instanceof InvalidArgumentException ? $error->getMessage() : ($error instanceof EzDokuReadException ? $error->reason : 'Provider evidence collection did not finish. Saved observations remain available.');
    fwrite(STDERR, json_encode(['ok' => false, 'error' => $reason], JSON_THROW_ON_ERROR) . "\n");
    exit(1);
}
