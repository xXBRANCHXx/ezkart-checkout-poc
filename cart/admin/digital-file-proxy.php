<?php
declare(strict_types=1);
if (!function_exists('ez_admin_json')) { http_response_code(404); exit; }

function ez_admin_digital_file_proxy(string $token, string $path, string $method): never
{
    $fileForm = $method === 'POST' && preg_match('#^/v1/digital-files/uploads/dupl_[a-f0-9]{40}/file$#D', $path) === 1
        && str_starts_with(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'application/x-www-form-urlencoded');
    $session = session_id(); $account = (string) ($_SESSION['admin_user']['id'] ?? ''); $csrf = (string) ($_SESSION['csrf_token'] ?? '');
    $sentAccount = $fileForm ? ($_POST['account'] ?? null) : ($_SERVER['HTTP_X_EZKART_FILE_ACCOUNT'] ?? null);
    $sentCsrf = $fileForm ? ($_POST['csrf'] ?? null) : ($_SERVER['HTTP_X_EZKART_CSRF'] ?? null);
    $store = $fileForm ? ($_POST['store'] ?? null) : ($_SERVER['HTTP_X_EZKART_FILE_STORE'] ?? null);
    if ($account === '' || !is_string($sentAccount) || !hash_equals($account, $sentAccount)
        || $csrf === '' || !is_string($sentCsrf) || !hash_equals($csrf, $sentCsrf)
        || !is_string($store) || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/D', $store) !== 1) {
        ez_admin_json(['ok' => false, 'error' => 'Your sign-in or store changed. Reload this page.', 'code' => 'digital_session_changed'], 401);
    }
    // A no-referrer page may send Origin:null for native form navigation. Fetch
    // metadata still identifies a same-origin navigation; the account, store
    // and unpredictable CSRF value above remain mandatory.
    $localDownload = $fileForm && ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'same-origin'
        && ($_SERVER['HTTP_SEC_FETCH_MODE'] ?? '') === 'navigate' && ($_SERVER['HTTP_SEC_FETCH_DEST'] ?? '') === 'iframe';
    if ($method !== 'GET' && $method !== 'HEAD' && !ez_request_origin_allowed() && !$localDownload) ez_admin_json(['ok' => false, 'error' => 'Reload this page before uploading.'], 403);
    $upload = preg_match('#^/v1/digital-files/uploads(?:/(dupl_[a-f0-9]{40})(?:/(complete|cancel|file)|/parts/([1-9][0-9]{0,2}))?)?$#D', $path, $match) === 1;
    $history = preg_match('#^/v1/digital-files/products/[A-Za-z0-9][A-Za-z0-9_-]{0,99}(?:\?before=[1-9][0-9]{0,15})?$#D', $path) === 1;
    if (!$upload && !$history) ez_admin_json(['ok' => false, 'error' => 'File path is invalid.'], 400);
    $id = $match[1] ?? ''; $action = $match[2] ?? ''; $part = $match[3] ?? '';
    $download = $upload && $action === 'file';
    $allowed = $history ? $method === 'GET' : ($id === '' ? $method === 'POST' : ($part !== '' ? $method === 'PUT'
        : ($download ? in_array($method, ['GET', 'HEAD'], true) || $fileForm : ($action !== '' ? $method === 'POST' : $method === 'GET'))));
    if (!$allowed) ez_admin_json(['ok' => false, 'error' => 'File method is not allowed.'], 405);
    if ($fileForm && array_diff(array_keys($_POST), ['account', 'csrf', 'store']) !== []) ez_admin_json(['ok' => false, 'error' => 'File download request is invalid.'], 400);
    $workerMethod = $fileForm ? 'GET' : $method;
    $maximum = $part !== '' ? 5242880 : 12000;
    $body = in_array($workerMethod, ['POST', 'PUT'], true) ? file_get_contents('php://input', false, null, 0, $maximum + 1) : '';
    if (!is_string($body) || strlen($body) > $maximum) ez_admin_json(['ok' => false, 'error' => 'This file part is too large.'], 413);
    $type = $part !== '' ? 'application/octet-stream' : 'application/json';
    if ($body !== '' && preg_match('#^' . preg_quote($type, '#') . '(?:;|$)#i', (string) ($_SERVER['CONTENT_TYPE'] ?? '')) !== 1) ez_admin_json(['ok' => false, 'error' => 'File request type is invalid.'], 415);
    $headers = ['Accept: application/json', 'Content-Type: ' . $type, 'Authorization: Bearer ' . $token, 'X-Ezkart-File-Store: ' . $store];
    if ($download && isset($_SERVER['HTTP_RANGE'])) {
        $range = (string) $_SERVER['HTTP_RANGE'];
        if (preg_match('/^bytes=(?:[0-9]{1,15}-[0-9]{0,15}|-[0-9]{1,15})$/D', $range) !== 1) ez_admin_json(['ok' => false, 'error' => 'Use one valid file range.'], 416);
        $headers[] = 'Range: ' . $range;
    }
    // Spool private responses so a session change during transfer is checked
    // before any bytes leave PHP. Large files never become a PHP/browser string.
    $spool = tmpfile();
    if ($spool === false) ez_admin_json(['ok' => false, 'error' => 'File transfer is unavailable. Try again.'], 503);
    $received = 0; $responseHeaders = []; $responseMaximum = $download ? 524288000 : 64000;
    $handle = curl_init(rtrim(ez_config('cloudflare_api_url'), '/') . $path);
    if ($handle === false) ez_admin_json(['ok' => false, 'error' => 'File storage is unavailable.'], 503);
    curl_setopt_array($handle, [CURLOPT_CUSTOMREQUEST => $workerMethod, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => in_array($workerMethod, ['POST', 'PUT'], true) ? $body : null,
        CURLOPT_RETURNTRANSFER => false, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => $download ? 120 : 60,
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$responseHeaders): int {
            if (str_starts_with($line, 'HTTP/')) $responseHeaders = [];
            $split = strpos($line, ':');
            if ($split !== false) $responseHeaders[strtolower(trim(substr($line, 0, $split)))] = trim(substr($line, $split + 1));
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => static function ($curl, string $bytes) use ($spool, &$received, $responseMaximum): int {
            $received += strlen($bytes);
            if ($received > $responseMaximum) return 0;
            $written = fwrite($spool, $bytes);
            return $written === false ? 0 : $written;
        }]);
    if ($workerMethod === 'HEAD') curl_setopt($handle, CURLOPT_NOBODY, true);
    $success = curl_exec($handle); $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    session_id($session); $_SESSION = []; session_start();
    $same = ($_SESSION['authenticated'] ?? false) === true && ($_SESSION['authentication_method'] ?? '') === 'supabase'
        && ($_SESSION['admin_user']['id'] ?? '') === $account && ($_SESSION['csrf_token'] ?? '') === $csrf
        && (empty($_SESSION['mfa_enabled']) || ($_SESSION['mfa_aal'] ?? '') === 'aal2');
    session_write_close();
    if (!$same) { fclose($spool); header_remove('Set-Cookie'); ez_admin_json(['ok' => false, 'error' => 'Your sign-in changed. Reload to check this file.', 'code' => 'digital_session_changed'], 401); }
    if ($success === false || $received > $responseMaximum) { fclose($spool); ez_admin_json(['ok' => false, 'error' => 'The result was not confirmed. Resume the same upload to check its progress.', 'code' => 'digital_transfer_unconfirmed'], 503); }
    rewind($spool);
    if ($download && in_array($status, [200, 206], true) && ($responseHeaders['content-type'] ?? '') === 'application/octet-stream') {
        $disposition = $responseHeaders['content-disposition'] ?? '';
        $length = $responseHeaders['content-length'] ?? '';
        $range = $responseHeaders['content-range'] ?? '';
        if (preg_match('/^attachment; filename="[A-Za-z0-9._ -]+"; filename\*=UTF-8\x27\x27[A-Za-z0-9._~%\x2d]+$/D', $disposition) !== 1
            || preg_match('/^[1-9][0-9]{0,8}$/D', $length) !== 1 || (int) $length > 524288000
            || ($workerMethod !== 'HEAD' && (int) $length !== $received)
            || ($status === 206 && preg_match('/^bytes [0-9]+-[0-9]+\/[1-9][0-9]*$/D', $range) !== 1)) {
            fclose($spool); ez_admin_json(['ok' => false, 'error' => 'The file response could not be verified.'], 503);
        }
        http_response_code($status); header('Content-Type: application/octet-stream'); header('Content-Disposition: ' . $disposition);
        header('Content-Length: ' . $length); header('Accept-Ranges: bytes'); if ($status === 206) header('Content-Range: ' . $range);
        header('Cache-Control: private, no-store'); header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer');
        header("Content-Security-Policy: default-src 'none'; sandbox allow-downloads");
        // Keep the Hostinger response-header bridge in sync with index.php.
        header("X-Ezkart-Content-Security-Policy: default-src 'none'; sandbox allow-downloads");
        if ($workerMethod !== 'HEAD') fpassthru($spool); fclose($spool); exit;
    }
    if ($workerMethod === 'HEAD' && $received === 0 && $status >= 400) {
        fclose($spool);
        ez_admin_json(['ok' => false, 'error' => 'File access could not be verified. Reload and try again.'], in_array($status, [400,401,403,404,409,410,416,422,429], true) ? $status : 503);
    }
    $raw = stream_get_contents($spool, 64001); fclose($spool);
    $data = is_string($raw) && strlen($raw) <= 64000 ? json_decode($raw, true) : null;
    if (!is_array($data)) ez_admin_json(['ok' => false, 'error' => 'The result was not confirmed. Resume the same upload.', 'code' => 'digital_transfer_unconfirmed'], 503);
    ez_admin_json($data, in_array($status, [200,400,401,403,404,405,409,410,413,415,416,422,429], true) ? $status : 503);
}
