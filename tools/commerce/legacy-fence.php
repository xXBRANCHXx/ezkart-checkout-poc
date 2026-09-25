<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/legacy-fence-lib.php';
umask(0077);

try {
    $kind = $argv[1] ?? '';
    $options = [];
    foreach (array_slice($argv, 2) as $argument) {
        if (!preg_match('/^--(key|revision|epoch|wait-ms)=(.+)$/D', $argument, $match) || isset($options[$match[1]])) throw new InvalidArgumentException('Invalid or repeated migration argument.');
        $options[$match[1]] = $match[2];
    }
    if ($kind === 'status' && $options === []) $result = ['current' => ez_legacy_fence_status()];
    else {
        $allowed = $kind === 'freeze' ? ['key','revision','wait-ms'] : ($kind === 'resume' ? ['key','revision','epoch'] : []);
        if ($allowed === [] || array_diff(array_keys($options), $allowed) !== [] || !isset($options['key'],$options['revision'])
            || !preg_match('/^\d{1,9}$/D', $options['revision']) || ($kind === 'resume' && !isset($options['epoch']))
            || (isset($options['wait-ms']) && !preg_match('/^\d{1,5}$/D', $options['wait-ms']))) {
            throw new InvalidArgumentException('Usage: legacy-fence.php status | freeze --key=32hex --revision=N [--wait-ms=10000] | resume --key=32hex --revision=N --epoch=32hex');
        }
        $result = ez_legacy_fence_change($kind, $options['key'], (int) $options['revision'], $options['epoch'] ?? '', (int) ($options['wait-ms'] ?? 10000));
    }
    echo ez_json_encode(['ok' => true] + $result) . "\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'Legacy source fence: ' . $error->getMessage() . "\n");
    exit(1);
}
