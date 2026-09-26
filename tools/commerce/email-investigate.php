<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/bootstrap.php';
require_once dirname(__DIR__, 2) . '/cart/api/commerce-client.php';

function ez_email_investigation_arguments(array $arguments): array
{
    $input = [];
    foreach ($arguments as $argument) {
        if (preg_match('/^--(action|request|provider|operator|intent|lookup|updated-at|cursor|state)=(.+)$/sD', $argument, $match) !== 1 || isset($input[$match[1]])) {
            throw new InvalidArgumentException('Use each named argument once.');
        }
        $input[$match[1]] = $match[2];
    }
    $action = $input['action'] ?? '';
    $fields = match ($action) {
        'list' => ['action', 'cursor', 'state'], 'view' => ['action', 'request', 'cursor'],
        'lookup' => ['action', 'request', 'provider', 'operator', 'intent'],
        'resolve' => ['action', 'request', 'lookup', 'updated-at', 'operator', 'intent'],
        'retry' => ['action', 'intent'],
        default => throw new InvalidArgumentException('Choose --action=list, view, lookup, resolve or retry.'),
    };
    if (array_diff(array_keys($input), $fields)) throw new InvalidArgumentException('These arguments do not belong to the chosen action.');
    foreach (array_diff($fields, ['cursor', 'state']) as $field) if (!isset($input[$field])) throw new InvalidArgumentException('Missing --' . $field . '.');
    foreach (['request' => '/^email_[a-f0-9]{32}$/D', 'provider' => '/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/D',
        'operator' => '/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/D', 'lookup' => '/^[a-f0-9]{32}$/D',
        'updated-at' => '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/D'] as $name => $pattern) {
        if (isset($input[$name]) && preg_match($pattern, $input[$name]) !== 1) throw new InvalidArgumentException('Invalid --' . $name . '.');
    }
    if (isset($input['state']) && !in_array($input['state'], ['attention', 'all'], true)) throw new InvalidArgumentException('Choose --state=attention or all.');
    if (isset($input['cursor']) && (strlen($input['cursor']) > 2048 || preg_match('/^[A-Za-z0-9_-]+$/D', $input['cursor']) !== 1)) throw new InvalidArgumentException('Use the exact cursor returned by the previous page.');
    return $input;
}

function ez_email_investigation_path(string $path): string
{
    if (!str_starts_with($path, '/') || !str_ends_with($path, '.json') || str_contains($path, "\0")) throw new InvalidArgumentException('Intent must be an absolute private .json path.');
    $parent = realpath(dirname($path)); $repository = realpath(dirname(__DIR__, 2));
    if ($parent === false || !is_dir($parent) || ($parent === $repository || str_starts_with($parent . '/', $repository . '/'))
        || preg_match('~/(?:public_html|htdocs|www|wwwroot|public)(?:/|$)~i', $parent) || (fileperms($parent) & 0077) !== 0) {
        throw new InvalidArgumentException('Use an existing private directory outside the repository, with mode 0700.');
    }
    $target = $parent . '/' . basename($path);
    if (is_link($target)) throw new InvalidArgumentException('Intent cannot be a symbolic link.');
    return $target;
}

function ez_email_investigation_main(array $arguments, ?Closure $transport = null): int
{
    $intentPath = null;
    try {
        $input = ez_email_investigation_arguments($arguments);
        if (ez_config('deployment_environment') !== 'test') throw new InvalidArgumentException('This workbench command accepts TEST only.');
        $connection = ez_database_configuration();
        $connectionHash = hash('sha256', 'test' . "\n" . $connection['url'] . "\n" . ez_config('commerce_service_secret'));
        $action = $input['action']; $payload = null; $method = 'GET';
        if (in_array($action, ['list', 'view'], true)) {
            $target = '/internal/commerce/email/investigations' . ($action === 'view' ? '/' . $input['request'] : '') . '?environment=sandbox';
            foreach (['state', 'cursor'] as $field) if (isset($input[$field])) $target .= '&' . $field . '=' . rawurlencode($input[$field]);
        } else {
            $intentPath = ez_email_investigation_path($input['intent']);
            if ($action === 'retry') {
                if (!is_file($intentPath) || (fileperms($intentPath) & 0077) !== 0 || filesize($intentPath) > 6000) throw new InvalidArgumentException('Use the preserved private intent file.');
                $saved = json_decode((string) file_get_contents($intentPath), true, 12, JSON_THROW_ON_ERROR);
                if (!is_array($saved) || array_keys($saved) !== ['version', 'connectionHash', 'arguments', 'key'] || $saved['version'] !== 1 || !hash_equals($connectionHash, (string) $saved['connectionHash'])
                    || !is_array($saved['arguments']) || preg_match('/^[a-f0-9]{32}$/D', (string) $saved['key']) !== 1) throw new InvalidArgumentException('This intent does not match the configured TEST connection.');
                $input = ez_email_investigation_arguments($saved['arguments']);
                if (!in_array($input['action'], ['lookup', 'resolve'], true) || ez_email_investigation_path($input['intent']) !== $intentPath) throw new InvalidArgumentException('The preserved intent is invalid.');
                $action = $input['action']; $requestKey = $saved['key'];
            } else {
                $requestKey = bin2hex(random_bytes(16));
                $saved = ['version' => 1, 'connectionHash' => $connectionHash, 'arguments' => $arguments, 'key' => $requestKey];
                $encoded = json_encode($saved, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
                umask(0077); $file = @fopen($intentPath, 'xb');
                if ($file === false) throw new InvalidArgumentException('Intent already exists or cannot be created. Use --action=retry with the original file.');
                try { if (fwrite($file, $encoded) !== strlen($encoded) || !fflush($file) || !fsync($file)) throw new RuntimeException('Intent could not be preserved.'); }
                finally { fclose($file); }
            }
            $payload = ['environment' => 'sandbox', 'requestId' => $input['request'], 'operator' => $input['operator']];
            if ($action === 'lookup') $payload += ['providerId' => $input['provider'], 'lookupKey' => $requestKey];
            else $payload += ['lookupKey' => $input['lookup'], 'expectedUpdatedAt' => $input['updated-at'], 'resolutionKey' => $requestKey];
            $method = 'POST'; $target = '/internal/commerce/email/' . $action;
        }
        $result = $transport === null ? ez_commerce_request($method, $target, $payload) : $transport($method, $target, $payload);
        if (($result['ok'] ?? false) !== true) throw new RuntimeException('The investigation was not confirmed.');
        echo json_encode(['intent' => $intentPath, ...$result], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
        return isset($result['receipt']['outcome']) && $result['receipt']['outcome'] !== 'matched' ? 2 : 0;
    } catch (Throwable $error) {
        $message = $error instanceof InvalidArgumentException || $error instanceof EzCommerceStorageException ? $error->getMessage() : 'Investigation did not finish. Retry with the preserved intent file.';
        fwrite(STDERR, json_encode(['ok' => false, 'error' => $message, 'intent' => $intentPath], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
        return 1;
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) exit(ez_email_investigation_main(array_slice($argv, 1)));
