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
    if (strlen($path) > 4000 || str_contains($path, '#') || preg_match('#^(/v1/commerce/marketing/(workspace|audience|campaigns|automations|reports|report-exports|performance|performance-exports)(?:/((?:cmp_|auto_|crex_|cpex_)[a-f0-9]{32})(?:/(history|activity|action|publication|publish|publication-action|recipients|publication-history))?)?)(?:\?(.*))?$#D', $path, $match) !== 1) ez_admin_json(['ok' => false, 'error' => 'Campaign path is invalid.'], 400);
    $route = $match[2]; $id = $match[3] ?? ''; $action = $match[4] ?? '';
    $prefixes = ['campaigns' => 'cmp_', 'automations' => 'auto_', 'report-exports' => 'crex_', 'performance-exports' => 'cpex_'];
    $actions = $route === 'campaigns' ? ['history','publication','publish','publication-action','recipients','publication-history'] : ($route === 'automations' ? ['history','activity','action'] : []);
    if (($id !== '' && (!isset($prefixes[$route]) || !str_starts_with($id, $prefixes[$route]))) || ($action !== '' && !in_array($action, $actions, true))) ez_admin_json(['ok' => false, 'error' => 'Campaign path is invalid.'], 400);
    if (!in_array($method, ['GET','POST'], true) || ($method === 'POST' && (($id !== '' && !in_array($action, ['publish','publication-action','action'], true)) || in_array($route, ['workspace','reports','performance'], true)))
        || ($method === 'GET' && ($route === 'audience' || (in_array($route, ['report-exports','performance-exports'], true) && $id === '') || in_array($action, ['publish','publication-action','action'], true)))) ez_admin_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $allowed = $method === 'GET' && $route === 'campaigns' ? ($id === '' ? ['state','q','month','cursor'] : (in_array($action, ['history','recipients','publication-history'], true) ? ['cursor'] : [])) : [];
    if ($method === 'GET' && $route === 'automations') $allowed = $id === '' ? ['state','q','cursor'] : ($action === 'activity' ? ['cursor','status'] : ($action === 'history' ? ['cursor'] : []));
    if ($method === 'GET' && in_array($route, ['reports','performance'], true)) $allowed = ['range','from','to','cohort','cursor'];
    if ($method === 'GET' && in_array($route, ['report-exports','performance-exports'], true)) $allowed = ['after','limit'];
    $query = [];
    if (array_key_exists(5, $match)) {
        foreach (explode('&', $match[5]) as $pair) {
            $parts = explode('=', $pair, 2); $name = urldecode($parts[0]); $value = urldecode($parts[1] ?? '');
            if (!in_array($name, $allowed, true) || array_key_exists($name, $query) || preg_match('/[\x00-\x1f\x7f]/', $value)
                || !mb_check_encoding($value, 'UTF-8') || ($name === 'q' && mb_strlen($value) > 120)
                || ($name === 'state' && !in_array($value, $route === 'automations' ? ['available','active','paused','archived','all'] : ['active','archived','all'], true))
                || ($name === 'status' && !in_array($value, ['all','waiting','published','skipped','needs_review'], true))
                || ($name === 'month' && preg_match('/^20\d{2}-(?:0[1-9]|1[0-2])$/D', $value) !== 1)
                || (in_array($name, ['cursor','cohort'], true) && preg_match('/^[A-Za-z0-9_-]{1,1600}$/D', $value) !== 1)
                || ($name === 'range' && !in_array($value, ['7','30','90','180','all','custom'], true))
                || (in_array($name, ['from','to'], true) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value) !== 1)
                || ($name === 'after' && preg_match('/^(0|[1-9][0-9]{0,12})$/D', $value) !== 1)
                || ($name === 'limit' && (preg_match('/^[1-9][0-9]{0,2}$/D', $value) !== 1 || (int) $value > 500))) ez_admin_json(['ok' => false, 'error' => 'Campaign filters are invalid.'], 400);
            $query[$name] = $value;
        }
    }
    $path = $match[1] . ($query === [] ? '' : '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986));
    if ($method === 'POST' && !ez_request_origin_allowed()) ez_admin_json(['ok' => false, 'error' => 'Reload this page before saving.'], 403);
    if ($method === 'POST' && preg_match('#^application/json(?:;|$)#i', (string) ($_SERVER['CONTENT_TYPE'] ?? '')) !== 1) ez_admin_json(['ok' => false, 'error' => 'Use a JSON request.'], 415);
    $limit = in_array($action, ['publish','publication-action','action'], true) || in_array($route, ['report-exports','performance-exports'], true) ? 3000 : ($route === 'audience' ? 5000 : 32000);
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
    if (!is_array($data)) ez_admin_json(['ok' => false, 'error' => $route === 'automations' ? 'The result was not confirmed. Retry the original automation request.' : (in_array($action, ['publish','publication-action'], true)
        ? 'The result was not confirmed. Retry the original delivery action.' : (in_array($route, ['report-exports','performance-exports'], true) ? 'The result was not confirmed. Retry the original export.' : 'The result was not confirmed. Retry the original save.'))], 503);
    ez_admin_json($data, in_array($status, [200,400,401,403,404,409,410,413,415,422,429], true) ? $status : 503);
}
