<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/executive-bridge.php';
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    if (ez_config('deployment_environment') !== 'test') ez_api_json(['ok' => false, 'error' => 'This control is only available on the workbench.'], 403);
    $body = (string) file_get_contents('php://input');
    if (strlen($body) > 4096) ez_api_json(['ok' => false, 'error' => 'Request too large.'], 413);
    ez_executive_authorize($body);
    $input = json_decode($body, true);
    if (!is_array($input)) throw new InvalidArgumentException('Invalid request.');
    $environment = (string) ($input['environment'] ?? '');
    if (!in_array($environment, ['sandbox', 'production'], true)) throw new InvalidArgumentException('Invalid environment.');
    $meta = ['ok' => true, 'deployment' => 'test', 'environment' => $environment];
    $action = (string) ($input['action'] ?? '');
    if ($action === 'tips' || $action === 'save-tips') {
        require_once __DIR__ . '/sidebar-tips.php';
        if ($environment !== 'sandbox') throw new InvalidArgumentException('Tips are managed on the test workbench.');
        $state = $action === 'save-tips' ? ez_tips_change($input) : ez_tips_read();
        ez_api_json($meta + ['schedule' => $state, 'icons' => ez_tips_icons()]);
    }
    if ($action === 'orders') ez_api_json($meta + ez_executive_orders($environment));
    if (!in_array($action, ['status', 'set-mode'], true)) throw new InvalidArgumentException('Unknown executive action.');
    if ($action === 'set-mode') {
        $target = (string) ($input['target'] ?? '');
        if (!in_array($target, ['sandbox', 'production'], true)) throw new InvalidArgumentException('Invalid target mode.');
        $path = ez_executive_directory() . '/mode.json';
        $lock = fopen(ez_executive_directory() . '/mode.lock', 'c');
        if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Workbench mode is busy.');
        try {
            $current = ez_commerce_environment();
            if (($input['expected_mode'] ?? '') !== $current) ez_api_json(['ok' => false, 'error' => 'Workbench mode changed. Refresh before switching.'], 409);
            if (!ez_executive_readiness($target)['ready']) ez_api_json(['ok' => false, 'error' => 'The target environment is not ready. Complete the provider settings first.'], 422);
            $temporary = tempnam(dirname($path), '.mode-');
            if ($temporary === false) throw new RuntimeException('Could not save workbench mode.');
            chmod($temporary, 0600);
            try { if (file_put_contents($temporary, json_encode(['mode' => $target, 'changed_at' => gmdate(DATE_ATOM)]), LOCK_EX) === false || !rename($temporary, $path)) throw new RuntimeException('Could not save workbench mode.'); }
            finally { if (is_file($temporary)) unlink($temporary); }
        } finally { flock($lock, LOCK_UN); fclose($lock); }
    }
    ez_api_json($meta + ['mode' => $action === 'set-mode' ? $target : ez_commerce_environment(), 'readiness' => ['sandbox' => ez_executive_readiness('sandbox'), 'production' => ez_executive_readiness('production')]]);
} catch (DomainException $error) { ez_api_json(['ok' => false, 'error' => $error->getMessage()], 409); }
catch (InvalidArgumentException $error) { ez_api_json(['ok' => false, 'error' => $error->getMessage()], 400); }
catch (Throwable $error) { error_log('Ezkart executive bridge: ' . $error->getMessage()); ez_api_json(['ok' => false, 'error' => 'The workbench connector is unavailable. Check its private configuration.'], 503); }
