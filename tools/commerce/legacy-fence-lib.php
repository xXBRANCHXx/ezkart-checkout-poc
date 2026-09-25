<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/bootstrap.php';

function ez_legacy_fence_directory(): string
{
    if (ez_config('deployment_environment') !== 'test' || ez_commerce_environment() !== 'sandbox') {
        throw new RuntimeException('Legacy source fencing is available only for the TEST sandbox.');
    }
    // CLI has no web DOCUMENT_ROOT. Never export a guessed temporary directory.
    if (ez_config('order_storage') === '' && ez_config('midtrans_order_storage') === '') {
        throw new RuntimeException('Configure the explicit private order storage used by the TEST storefront before fencing.');
    }
    $directory = realpath(ez_order_directory('sandbox', false));
    if ($directory === false) throw new RuntimeException('Private order storage is unavailable.');
    $application = realpath(dirname(__DIR__, 2));
    if ($application !== false && ($directory === $application || str_starts_with($directory, $application . '/'))) {
        throw new RuntimeException('Private order storage must be outside the application web root.');
    }
    return $directory;
}

function ez_legacy_fence_status(): array
{
    $state = ez_legacy_storage_state('sandbox', ez_legacy_fence_directory());
    return ez_legacy_fence_public_state($state);
}

function ez_legacy_fence_public_state(array $state): array
{
    return ['mode' => $state['mode'], 'revision' => $state['revision'], 'epoch' => $state['epoch'],
        'commerceStorage' => ez_config('commerce_storage') === 'd1' ? 'd1' : 'legacy',
        'snapshot' => $state['operations'][$state['epoch']]['result']['snapshot'] ?? null];
}

function ez_legacy_fence_write(string $path, string $contents): void
{
    if (is_link($path)) throw new RuntimeException('Migration control cannot replace a symbolic link.');
    $temporary = tempnam(dirname($path), '.fence-');
    if ($temporary === false) throw new RuntimeException('Migration control could not be saved.');
    $handle = null;
    try {
        if (!chmod($temporary, 0600)) throw new RuntimeException('Migration control could not be secured.');
        $handle = fopen($temporary, 'wb');
        if ($handle === false) throw new RuntimeException('Migration control could not be saved.');
        $offset = 0;
        while ($offset < strlen($contents)) {
            $written = fwrite($handle, substr($contents, $offset));
            if ($written === false || $written === 0) throw new RuntimeException('Migration control write was incomplete.');
            $offset += $written;
        }
        if (!fflush($handle) || !fsync($handle)) throw new RuntimeException('Migration control could not be flushed.');
        fclose($handle); $handle = null;
        if (!rename($temporary, $path)) throw new RuntimeException('Migration control could not be committed.');
    } finally {
        if (is_resource($handle)) fclose($handle);
        if (is_file($temporary)) unlink($temporary);
    }
}

function ez_legacy_fence_save(string $directory, array $state): void
{
    $json = ez_json_encode($state);
    if (strlen($json) > 1000000) throw new RuntimeException('Migration control history is too large.');
    ez_legacy_fence_write($directory . '/.commerce-storage.state', $json);
}

function ez_legacy_fence_scan(string $directory, bool $includeSources = true): array
{
    $names = scandir($directory);
    if ($names === false) throw new RuntimeException('Private order storage could not be listed.');
    sort($names, SORT_STRING);
    $digest = hash_init('sha256'); hash_update($digest, "ezkart-legacy-files-v1\nsandbox\n");
    $entries = []; $count = 0; $bytes = 0;
    foreach ($names as $name) {
        if (!str_ends_with($name, '.json')) continue;
        $path = $directory . '/' . $name;
        clearstatcache(true, $path);
        if (!preg_match('/^[a-f0-9]{64}\.json$/D', $name) || is_link($path) || !is_file($path)) {
            throw new RuntimeException('An unrecognized JSON entry prevents a complete order export.');
        }
        if (++$count > 1000 || filesize($path) > 1000000) throw new RuntimeException('The source set exceeds this bounded export; no orders were omitted.');
        $source = file_get_contents($path);
        if ($source === false || strlen($source) > 1000000) throw new RuntimeException('An order source could not be read completely.');
        $bytes += strlen($source);
        if ($bytes > 16 * 1024 * 1024) throw new RuntimeException('The source set exceeds this bounded export; no orders were omitted.');
        try { $order = json_decode($source, true, 64, JSON_THROW_ON_ERROR); }
        catch (Throwable) { throw new RuntimeException('An order source contains invalid JSON or encoding.'); }
        if (!is_array($order) || !is_string($order['order_id'] ?? null) || !preg_match('/^EZK-[A-Z0-9-]{8,70}$/D', $order['order_id'])
            || str_starts_with($order['order_id'], 'EZK-P-') || ($order['commerce_environment'] ?? '') !== 'sandbox'
            || hash('sha256', $order['order_id']) . '.json' !== $name) throw new RuntimeException('An order reference or environment does not match its source file.');
        hash_update($digest, $name . ':' . hash('sha256', $source) . "\n");
        if ($includeSources) $entries[] = ['filename' => $name, 'source' => $source];
    }
    return ['sourceDigest' => hash_final($digest), 'orders' => $count, 'sourceBytes' => $bytes, 'entries' => $entries];
}

function ez_legacy_fence_verify_export(string $directory, array $result): void
{
    $epoch = $result['epoch'] ?? '';
    if (!is_string($epoch) || !preg_match('/^[a-f0-9]{32}$/D', $epoch)
        || !is_string($result['snapshot']['exportHash'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $result['snapshot']['exportHash'])) {
        throw new RuntimeException('The frozen export receipt is invalid.');
    }
    foreach ([$directory . '/.commerce-freezes', $directory . '/.commerce-freezes/' . $epoch] as $parent) {
        clearstatcache(true, $parent);
        if (is_link($parent) || !is_dir($parent) || (fileperms($parent) & 0077) !== 0) throw new RuntimeException('The original frozen export is not in private storage.');
    }
    $path = $directory . '/.commerce-freezes/' . $epoch . '/source.json';
    clearstatcache(true, $path);
    if (is_link($path) || !is_file($path) || (fileperms($path) & 0077) !== 0
        || !hash_equals($result['snapshot']['exportHash'], (string) hash_file('sha256', $path))) {
        throw new RuntimeException('The original frozen export is unavailable or changed; its receipt cannot be confirmed.');
    }
}

/** Freeze/resume is a source rehearsal only. Operational promotion is separate. */
function ez_legacy_fence_change(string $kind, string $requestKey, int $revision, string $epoch = '', int $waitMilliseconds = 10000): array
{
    $directory = ez_legacy_fence_directory();
    if (ez_config('commerce_storage') === 'd1') throw new RuntimeException('Do not change the legacy gate while central commerce is configured.');
    if (!in_array($kind, ['freeze', 'resume'], true) || !preg_match('/^[a-f0-9]{32}$/D', $requestKey) || $revision < 0
        || ($kind === 'resume' ? !preg_match('/^[a-f0-9]{32}$/D', $epoch) : $epoch !== '')
        || $waitMilliseconds < 1 || $waitMilliseconds > 30000) throw new InvalidArgumentException('Invalid migration operation.');
    $hash = hash('sha256', ez_json_encode(['kind' => $kind, 'revision' => $revision, 'epoch' => $epoch, 'environment' => 'sandbox']));
    $controller = ez_legacy_storage_lock_file($directory . '/.commerce-controller.lock');
    if (!flock($controller, LOCK_EX | LOCK_NB)) { fclose($controller); throw new RuntimeException('Another migration operation is running. Retry this request key.'); }
    $writer = null;
    try {
        $state = ez_legacy_storage_state('sandbox', $directory);
        $prior = $state['operations'][$requestKey] ?? null;
        if ($prior !== null) {
            if (($prior['hash'] ?? '') !== $hash) throw new RuntimeException('This migration request key belongs to different arguments.');
            if (($prior['status'] ?? '') === 'aborted') throw new RuntimeException('This freeze was resumed before completion; its request key cannot freeze again.');
            if (($prior['status'] ?? '') === 'complete') {
                if ($kind === 'freeze') ez_legacy_fence_verify_export($directory, $prior['result']);
                return ['receipt' => $prior['result'], 'current' => ez_legacy_fence_public_state($state), 'replayed' => true];
            }
            if ($kind !== 'freeze' || $state['mode'] !== 'draining' || $state['epoch'] !== $requestKey) throw new RuntimeException('Migration control does not match this pending request.');
        } else {
            if ($state['revision'] !== $revision) throw new RuntimeException('Migration control changed. Read its current revision before proceeding.');
            if ($kind === 'freeze') {
                if ($state['mode'] !== 'legacy') throw new RuntimeException('An existing freeze must be completed or resumed first.');
                $state['operations'][$requestKey] = ['kind' => $kind, 'hash' => $hash, 'status' => 'pending', 'requestedAt' => gmdate(DATE_ATOM)];
                $state['mode'] = 'draining'; $state['epoch'] = $requestKey; $state['revision']++;
                // New writers now fail quickly. Previously admitted operations
                // retain their shared lease until their final provider result.
                ez_legacy_fence_save($directory, $state);
            } else {
                if (!in_array($state['mode'], ['draining','frozen'], true) || $state['epoch'] !== $epoch) throw new RuntimeException('This request does not identify the active freeze.');
                if (($state['operations'][$epoch]['status'] ?? '') === 'pending') $state['operations'][$epoch]['status'] = 'aborted';
                $state['mode'] = 'legacy'; $state['epoch'] = ''; $state['revision']++;
                $result = ['kind' => 'resume', 'requestKey' => $requestKey, 'epoch' => $epoch, 'revision' => $state['revision'], 'completedAt' => gmdate(DATE_ATOM)];
                $state['operations'][$requestKey] = ['kind' => $kind, 'hash' => $hash, 'status' => 'complete', 'result' => $result];
                ez_legacy_fence_save($directory, $state);
                return ['receipt' => $result, 'current' => ez_legacy_fence_public_state($state), 'replayed' => false];
            }
        }
        $writer = ez_legacy_storage_lock_file($directory . '/.commerce-writers.lock');
        $deadline = hrtime(true) + $waitMilliseconds * 1000000;
        while (!flock($writer, LOCK_EX | LOCK_NB)) {
            if (hrtime(true) >= $deadline) throw new RuntimeException('Legacy writers are still finishing. The gate remains draining; retry freeze with the same key or resume that freeze.');
            usleep(25000);
        }
        $scan = ez_legacy_fence_scan($directory);
        $second = ez_legacy_fence_scan($directory, false);
        if (!hash_equals($scan['sourceDigest'], $second['sourceDigest']) || $scan['orders'] !== $second['orders']) throw new RuntimeException('Sources changed outside the writer gate; complete the deployment before retrying.');
        $sourceName = basename($directory);
        if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/D', $sourceName)) throw new RuntimeException('The private source directory needs a portable name.');
        $fence = ['version' => 1, 'epoch' => $requestKey, 'revision' => $state['revision'] + 1, 'sourceDigest' => $scan['sourceDigest']];
        $export = ez_json_encode(['format' => 'ezkart-private-legacy-source-v1', 'deployment' => 'test', 'environment' => 'sandbox',
            'sourceDirectory' => $sourceName, 'fence' => $fence, 'entries' => $scan['entries']]);
        $archive = $directory . '/.commerce-freezes';
        foreach ([$archive, $archive . '/' . $requestKey] as $path) {
            if (is_link($path) || (file_exists($path) && !is_dir($path))) throw new RuntimeException('Private export storage is unavailable.');
            if (!is_dir($path) && !mkdir($path, 0700)) throw new RuntimeException('Private export storage could not be created.');
            if ((fileperms($path) & 0077) !== 0) throw new RuntimeException('Export storage must be private to its owner.');
        }
        $exportPath = $archive . '/' . $requestKey . '/source.json';
        if (file_exists($exportPath) || is_link($exportPath)) {
            if (is_link($exportPath) || !is_file($exportPath) || !hash_equals(hash('sha256', $export), (string) hash_file('sha256', $exportPath))) throw new RuntimeException('The existing export differs from this freeze; it was not overwritten.');
        } else ez_legacy_fence_write($exportPath, $export);
        $state['mode'] = 'frozen'; $state['revision']++;
        $result = ['kind' => 'freeze', 'requestKey' => $requestKey, 'epoch' => $requestKey, 'revision' => $state['revision'], 'completedAt' => gmdate(DATE_ATOM),
            'snapshot' => $fence + ['relativePath' => '.commerce-freezes/' . $requestKey . '/source.json', 'exportHash' => hash('sha256', $export),
                'orders' => $scan['orders'], 'sourceBytes' => $scan['sourceBytes'], 'exportBytes' => strlen($export)]];
        $state['operations'][$requestKey]['status'] = 'complete'; $state['operations'][$requestKey]['result'] = $result;
        ez_legacy_fence_save($directory, $state);
        return ['receipt' => $result, 'current' => ez_legacy_fence_public_state($state), 'replayed' => $prior !== null];
    } finally {
        if (is_resource($writer)) { flock($writer, LOCK_UN); fclose($writer); }
        flock($controller, LOCK_UN); fclose($controller);
    }
}
