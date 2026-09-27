<?php
declare(strict_types=1);
if (!function_exists('ez_admin_json')) { http_response_code(404); exit; }

function ez_admin_refund_proxy(string $token, string $path, string $method): never
{
    $session = session_id(); $account = (string) ($_SESSION['admin_user']['id'] ?? ''); $csrf = (string) ($_SESSION['csrf_token'] ?? '');
    $store = (string) ($_SERVER['HTTP_X_EZKART_REFUND_STORE'] ?? '');
    if ($account === '' || !hash_equals($account, (string) ($_SERVER['HTTP_X_EZKART_REFUND_ACCOUNT'] ?? '')) || $csrf === ''
        || !hash_equals($csrf, (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? '')) || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/D', $store) !== 1) {
        ez_admin_json(['ok' => false, 'error' => 'Your sign-in or store changed. Reload this page.', 'code' => 'refund_session_changed'], 401);
    }
    $parts = parse_url($path);
    $route = is_array($parts) ? ($parts['path'] ?? '') : '';
    if (strlen($path) > 2400 || str_contains($path, '#') || preg_match('#^/v1/commerce/refunds(?:/(ref_[a-f0-9]{32})|/orders/(EZK-[SP]-[A-F0-9]{24}))?$#D', $route, $match) !== 1) ez_admin_json(['ok' => false, 'error' => 'Refund reference is invalid.'], 400);
    $query = [];
    foreach (explode('&', (string) ($parts['query'] ?? '')) as $pair) {
        if ($pair === '') continue;
        [$key, $value] = array_pad(explode('=', $pair, 2), 2, ''); $key = rawurldecode($key); $value = rawurldecode($value);
        if (isset($query[$key]) || !in_array($key, ['state','cursor'], true) || $method !== 'GET' || !empty($match[1])
            || ($key === 'state' && !in_array($value, ['all','open','requested','approved','declined','withdrawn'], true))
            || ($key === 'cursor' && preg_match('/^[A-Za-z0-9_-]{1,1800}$/D', $value) !== 1)) ez_admin_json(['ok' => false, 'error' => 'Refund filters are invalid.'], 400);
        $query[$key] = $value;
    }
    if ($method === 'POST' && empty($match[1]) && empty($match[2])) ez_admin_json(['ok' => false], 405);
    if ($method === 'POST' && ez_config('commerce_storage') !== 'd1') ez_admin_json(['ok' => false, 'error' => 'Refund requests are not available yet.'], 503);
    $path = $route . ($query !== [] ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : '');
    if (!in_array($method, ['GET','POST'], true)) ez_admin_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    if ($method === 'POST' && !ez_request_origin_allowed()) ez_admin_json(['ok' => false, 'error' => 'Reload this page before saving.'], 403);
    if ($method === 'POST' && preg_match('#^application/json(?:;|$)#i', (string) ($_SERVER['CONTENT_TYPE'] ?? '')) !== 1) ez_admin_json(['ok' => false, 'error' => 'Use a JSON request.'], 415);
    $body = $method === 'POST' ? file_get_contents('php://input', false, null, 0, 16001) : '';
    if (!is_string($body) || strlen($body) > 16000) ez_admin_json(['ok' => false, 'error' => 'Refund request is too large.'], 413);
    $handle = curl_init(rtrim(ez_config('cloudflare_api_url'), '/') . $path);
    if ($handle === false) ez_admin_json(['ok' => false, 'error' => 'Refund are unavailable.'], 503);
    curl_setopt_array($handle, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json',
        'Authorization: Bearer ' . $token, 'X-Ezkart-Refund-Store: ' . $store], CURLOPT_POSTFIELDS => $method === 'POST' ? $body : null,
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 25, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_FOLLOWLOCATION => false]);
    $raw = curl_exec($handle); $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    session_id($session); $_SESSION = []; session_start();
    $same = ($_SESSION['authenticated'] ?? false) === true && ($_SESSION['authentication_method'] ?? '') === 'supabase'
        && ($_SESSION['admin_user']['id'] ?? '') === $account && ($_SESSION['csrf_token'] ?? '') === $csrf
        && (empty($_SESSION['mfa_enabled']) || ($_SESSION['mfa_aal'] ?? '') === 'aal2');
    session_write_close();
    if (!$same) { header_remove('Set-Cookie'); ez_admin_json(['ok' => false, 'error' => 'Your sign-in changed. Reload to check the saved refund.', 'code' => 'refund_session_changed'], 401); }
    $data = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($data)) ez_admin_json(['ok' => false, 'error' => 'The result was not confirmed. Retry the same save.'], 503);
    ez_admin_json($data, in_array($status, [200,400,401,403,404,409,413,415,422,429], true) ? $status : 503);
}
