<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/commerce-treasury-observations.php';
try {
    $options = getopt('', ['intent:','environment:','run:','mode:','max-pages:','max-reads:']);
    if (count($options) < 4 || count($argv) !== count($options) + 1) throw new InvalidArgumentException('Provide intent, environment, run and mode with --key=value.');
    foreach (['max-pages','max-reads'] as $key) if (isset($options[$key]) && (!is_string($options[$key]) || preg_match('/^[1-9][0-9]?$/D', $options[$key]) !== 1)) throw new InvalidArgumentException('Budget is invalid.');
    $result = ez_sync_treasury_observations($options['intent'], $options['environment'], $options['run'], $options['mode'], (int) ($options['max-pages'] ?? 10), (int) ($options['max-reads'] ?? 20));
    echo json_encode(['ok'=>true,...$result], JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable) {
    fwrite(STDERR, "Treasury observation run needs review. Retain the original private run and use recover to replay saved evidence. No transfer was sent or retried.\n"); exit(1);
}
