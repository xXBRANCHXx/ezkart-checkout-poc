<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }
require_once __DIR__ . '/commerce-hosted-payments.php';

function ez_hosted_receipt_directory(): string
{
    $configured = ez_config('commerce_payment_recovery_directory'); $directory = realpath($configured);
    if ($configured === '' || !str_starts_with($configured, '/') || $directory === false || !is_dir($directory)
        || is_link($configured) || (fileperms($directory) & 0077) !== 0 || !is_writable($directory)) throw new RuntimeException('Private payment recovery storage is required.');
    foreach ([realpath(dirname(__DIR__, 2)), realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''))] as $public) {
        if (is_string($public) && ($directory === $public || str_starts_with($directory, rtrim($public, '/') . '/'))) throw new RuntimeException('Payment receipts must remain outside the public root.');
    }
    return $directory;
}
function ez_hosted_receipt_document(array $d): void
{
    if (array_keys($d) !== ['version','orderId','environment','binding','evidence'] || $d['version'] !== 1
        || !in_array($d['environment'], ['sandbox','production'], true) || !is_array($d['binding']) || !is_array($d['evidence'])
        || ($d['evidence']['operation'] ?? null) !== 'checkout-create') throw new RuntimeException('Original Checkout receipt is invalid.');
    ez_hosted_payment_path($d['orderId']);
}
function ez_hosted_saved_receipt(string $file): ?array
{
    if (!file_exists($file) && !is_link($file)) return null;
    if (!is_file($file) || is_link($file) || (fileperms($file) & 0077) !== 0 || filesize($file) < 2 || filesize($file) > 600000) throw new RuntimeException('Original Checkout receipt is unsafe.');
    $raw = file_get_contents($file); if (!is_string($raw)) throw new RuntimeException('Original Checkout receipt is unreadable.');
    EzDokuFinancialJson::decode($raw); $d = json_decode($raw, true, 64, JSON_THROW_ON_ERROR); ez_hosted_receipt_document($d); return $d;
}
function ez_hosted_save_receipt(string $file, array $document): void
{
    ez_hosted_receipt_document($document); $raw = json_encode($document, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    if (strlen($raw) > 600000) throw new RuntimeException('Checkout receipt is too large.');
    $mask = umask(0077); try { $stream = @fopen($file, 'xb'); } finally { umask($mask); }
    if ($stream === false) { if (ez_hosted_saved_receipt($file) === $document) return; throw new RuntimeException('Original Checkout receipt cannot change.'); }
    try {
        for ($offset = 0; $offset < strlen($raw); $offset += $written) {
            $written = fwrite($stream, substr($raw, $offset)); if (!is_int($written) || $written < 1) throw new RuntimeException('Checkout receipt was not saved.');
        }
        if (!fflush($stream) || (function_exists('fsync') && !fsync($stream))) throw new RuntimeException('Checkout receipt was not flushed.');
    } finally { fclose($stream); }
}
/** Internal storage only: uses the frozen original binding and never calls DOKU. */
function ez_finalize_hosted_receipt(array $d): array
{
    ez_hosted_receipt_document($d); ez_central_commerce_environment($d['environment']);
    $p = ez_commerce_request('GET', ez_hosted_payment_path($d['orderId']) . '?environment=' . $d['environment'])['payment'];
    if ($p['binding'] !== $d['binding']) throw new RuntimeException('Checkout receipt differs from its original dispatch.');
    $saved = ez_hosted_store_receipt($d['orderId'], $d['evidence']);
    if (($saved['recorded'] ?? null) !== true) throw new RuntimeException('Checkout receipt acknowledgement is missing.');
    return ['recorded'=>true,'providerCalls'=>0,'orderId'=>$d['orderId']];
}
