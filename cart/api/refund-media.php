<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }

/** Buffer bounded private evidence until the caller has rechecked its session. */
function ez_refund_fetch(mixed $handle): array
{
    $raw = ''; $headers = [];
    curl_setopt($handle, CURLOPT_HEADERFUNCTION, static function ($curl, string $line) use (&$headers): int {
            if (preg_match('/^(content-disposition|x-ezkart-file-sha256):\s*(.*?)\s*$/iD', trim($line), $match)) $headers[strtolower($match[1])] = $match[2];
            return strlen($line);
        });
    curl_setopt($handle, CURLOPT_WRITEFUNCTION, static function ($curl, string $bytes) use (&$raw): int {
            if (strlen($raw) + strlen($bytes) > 5242880) return 0;
            $raw .= $bytes; return strlen($bytes);
        });
    $ok = curl_exec($handle);
    return ['raw' => $ok === false ? null : $raw, 'status' => (int) curl_getinfo($handle, CURLINFO_HTTP_CODE),
        'type' => (string) curl_getinfo($handle, CURLINFO_CONTENT_TYPE), 'headers' => $headers];
}

/** Called only after both the provider-side access and PHP session checks. */
function ez_refund_send_file(array $response): void
{
    $raw = $response['raw']; $type = $response['type']; $headers = $response['headers'];
    $hash = $headers['x-ezkart-file-sha256'] ?? ''; $disposition = $headers['content-disposition'] ?? '';
    if ($response['status'] !== 200 || !is_string($raw) || !in_array($type, ['image/jpeg','image/png','image/webp','application/pdf'], true)
        || preg_match('/^[a-f0-9]{64}$/D', $hash) !== 1 || !hash_equals($hash, hash('sha256', $raw))
        || strlen($disposition) > 2400 || !str_starts_with($disposition, 'attachment; ') || preg_match('/[\x00-\x1f\x7f]/', $disposition)) return;
    header('Content-Type: ' . $type); header('Content-Length: ' . strlen($raw)); header('Content-Disposition: ' . $disposition);
    header('X-Ezkart-File-SHA256: ' . $hash); header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; sandbox");
    header("X-Ezkart-Content-Security-Policy: default-src 'none'; sandbox");
    echo $raw; exit;
}
