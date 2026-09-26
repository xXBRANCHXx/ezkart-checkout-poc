<?php
declare(strict_types=1);
if (!function_exists('ez_admin_json')) { http_response_code(404); exit; }

function ez_admin_marketing_proxy(string $token, string $path, string $method): never
{
    $session = session_id(); $account = (string) ($_SESSION['admin_user']['id'] ?? ''); $csrf = (string) ($_SESSION['csrf_token'] ?? '');
    $store = (string) ($_SERVER['HTTP_X_EZKART_MARKETING_STORE'] ?? '');
    if ($account === '' || !hash_equals($account, (string) ($_SERVER['HTTP_X_EZKART_MARKETING_ACCOUNT'] ?? '')) || $csrf === ''
        || !hash_equals($csrf, (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? '')) || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/D', $store) !== 1) {
        ez_admin_json(['ok' => false, 'error' => 'Your sign-in or store changed. Reload this page.', 'code' => 'marketing_session_changed'], 401);
    }
    if (strlen($path) > 2600 || str_contains($path, '#') || preg_match('#^(/v1/commerce/marketing/(workspace|audience|campaigns)(?:/(cmp_[a-f0-9]{32})(/history)?)?)(?:\?(.*))?$#D', $path, $match) !== 1
        || ($match[2] !== 'campaigns' && !empty($match[3]))) ez_admin_json(['ok' => false, 'error' => 'Campaign path is invalid.'], 400);
    $route = $match[2]; $id = $match[3] ?? ''; $history = ($match[4] ?? '') !== '';
    if (!in_array($method, ['GET','POST'], true) || ($method === 'POST' && ($id !== '' || $route === 'workspace'))
        || ($method === 'GET' && $route === 'audience')) ez_admin_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $allowed = $method === 'GET' && $route === 'campaigns' ? ($id === '' ? ['state','q','month','cursor'] : ($history ? ['cursor'] : [])) : [];
    $query = [];
    if (array_key_exists(5, $match)) {
        foreach (explode('&', $match[5]) as $pair) {
            $parts = explode('=', $pair, 2); $name = urldecode($parts[0]); $value = urldecode($parts[1] ?? '');
            if (!in_array($name, $allowed, true) || array_key_exists($name, $query) || preg_match('/[\x00-\x1f\x7f]/', $value)
                || !mb_check_encoding($value, 'UTF-8') || ($name === 'q' && mb_strlen($value) > 120)
                || ($name === 'state' && !in_array($value, ['active','archived','all'], true))
                || ($name === 'month' && preg_match('/^20\d{2}-(?:0[1-9]|1[0-2])$/D', $value) !== 1)
                || ($name === 'cursor' && preg_match('/^[A-Za-z0-9_-]{1,1600}$/D', $value) !== 1)) ez_admin_json(['ok' => false, 'error' => 'Campaign filters are invalid.'], 400);
            $query[$name] = $value;
        }
    }
    $path = $match[1] . ($query === [] ? '' : '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986));
    if ($method === 'POST' && !ez_request_origin_allowed()) ez_admin_json(['ok' => false, 'error' => 'Reload this page before saving.'], 403);
    if ($method === 'POST' && preg_match('#^application/json(?:;|$)#i', (string) ($_SERVER['CONTENT_TYPE'] ?? '')) !== 1) ez_admin_json(['ok' => false, 'error' => 'Use a JSON request.'], 415);
    $limit = $route === 'audience' ? 5000 : 32000;
    $body = $method === 'POST' ? file_get_contents('php://input', false, null, 0, $limit + 1) : '';
    if (!is_string($body) || strlen($body) > $limit) ez_admin_json(['ok' => false, 'error' => 'Campaign request is too large.'], 413);
    $handle = curl_init(rtrim(ez_config('cloudflare_api_url'), '/') . $path);
    if ($handle === false) ez_admin_json(['ok' => false, 'error' => 'Campaigns are unavailable.'], 503);
    $raw = '';
    curl_setopt_array($handle, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json',
        'Authorization: Bearer ' . $token, 'X-Ezkart-Marketing-Store: ' . $store], CURLOPT_POSTFIELDS => $method === 'POST' ? $body : null,
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$raw): int { if (strlen($raw) + strlen($chunk) > 2000000) return 0; $raw .= $chunk; return strlen($chunk); },
        CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 25, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_FOLLOWLOCATION => false]);
    $received = curl_exec($handle); $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    session_id($session); $_SESSION = []; session_start();
    $same = ($_SESSION['authenticated'] ?? false) === true && ($_SESSION['authentication_method'] ?? '') === 'supabase'
        && ($_SESSION['admin_user']['id'] ?? '') === $account && ($_SESSION['csrf_token'] ?? '') === $csrf
        && (empty($_SESSION['mfa_enabled']) || ($_SESSION['mfa_aal'] ?? '') === 'aal2');
    session_write_close();
    if (!$same) { header_remove('Set-Cookie'); ez_admin_json(['ok' => false, 'error' => 'Your sign-in changed. Reload to check the saved campaign.', 'code' => 'marketing_session_changed'], 401); }
    $data = $received === true ? json_decode($raw, true) : null;
    if (!is_array($data)) ez_admin_json(['ok' => false, 'error' => 'The result was not confirmed. Retry the original save.'], 503);
    ez_admin_json($data, in_array($status, [200,400,401,403,404,409,413,415,422,429], true) ? $status : 503);
}
