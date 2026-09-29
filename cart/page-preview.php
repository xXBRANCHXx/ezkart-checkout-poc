<?php
declare(strict_types=1);
// Only the validated pretty route may include this controller.
if (!isset($store, $page, $canonical)) { http_response_code(404); exit('Page not found.'); }
require_once __DIR__ . '/api/bootstrap.php';
require_once __DIR__ . '/page-frame.php';
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; img-src 'self' data: https:; media-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; connect-src 'self' https:; form-action 'self'; frame-src 'self' about: https:; frame-ancestors 'self'; base-uri 'none'");
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'POST'], true)) { header('Allow: GET, POST'); http_response_code(405); exit('Method not allowed.'); }
$cookieName = 'ezkart_preview_' . substr(hash('sha256', $store . '/' . $page), 0, 20);
$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
$cookieOptions = ['path' => $canonical, 'secure' => $secure, 'httponly' => true, 'samesite' => 'Strict'];
$error = '';
$token = is_string($_COOKIE[$cookieName] ?? null) ? $_COOKIE[$cookieName] : '';
try {
    $api = rtrim(ez_config('cloudflare_api_url'), '/');
    if (!filter_var($api, FILTER_VALIDATE_URL) || !function_exists('curl_init')) throw new RuntimeException('Preview service unavailable');
    $endpoint = $api . '/v1/public/landing-pages/' . rawurlencode($store) . '/' . rawurlencode($page) . '/preview';
    $request = static function (string $url, ?string $key, string $session = ''): array {
        $handle = curl_init($url);
        if ($handle === false) throw new RuntimeException('Preview request unavailable');
        $headers = ['Accept: ' . ($key === null ? 'text/html' : 'application/json')];
        if ($session !== '' && preg_match('/^\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}$/D', $session) === 1) $headers[] = 'X-Ezkart-Preview-Token: ' . $session;
        $options = [CURLOPT_RETURNTRANSFER => true, CURLOPT_ENCODING => '', CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 40, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_FOLLOWLOCATION => false];
        if ($key !== null) { $headers[] = 'Content-Type: application/json'; $options[CURLOPT_POST] = true; $options[CURLOPT_POSTFIELDS] = json_encode(['key' => $key]); }
        $options[CURLOPT_HTTPHEADER] = $headers;
        curl_setopt_array($handle, $options);
        $body = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $type = (string) curl_getinfo($handle, CURLINFO_CONTENT_TYPE);
        if (!is_string($body)) throw new RuntimeException('Preview request failed');
        return [$status, $type, $body];
    };
    if ($method === 'POST') {
        // Keys belong in POST bodies, never query strings, redirects or browser storage.
        $key = is_string($_POST['preview_key'] ?? null) ? trim($_POST['preview_key']) : '';
        if (strlen($key) > 100 || $key === '') { $error = 'Enter the preview key shared by the page owner.'; http_response_code(403); }
        else {
            [$status, $type, $body] = $request($endpoint . '/unlock', $key);
            $result = json_decode($body, true);
            if ($status === 200 && is_array($result) && preg_match('/^\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}$/D', (string) ($result['token'] ?? '')) === 1) {
                setcookie($cookieName, $result['token'], ['expires' => time() + min(3600, (int) ($result['expiresIn'] ?? 3600))] + $cookieOptions);
                header('Location: ' . $canonical, true, 303);
                exit;
            }
            if ($status === 403) { $error = 'That preview key is not valid. Ask the owner for the current key.'; http_response_code(403); }
            elseif ($status === 404) { $error = 'This preview is unavailable. Ask the owner to save and share it again.'; http_response_code(404); }
            else throw new RuntimeException('Preview unlock unavailable');
        }
    } elseif ($token !== '') {
        [$status, $type, $html] = $request($endpoint, null, $token);
        if ($status === 200 && str_starts_with(strtolower($type), 'text/html')) { echo ez_landing_page_frame($html); exit; }
        if ($status === 401 || $status === 403) {
            setcookie($cookieName, '', ['expires' => time() - 3600] + $cookieOptions);
            $error = 'Your preview access has expired or the key has changed. Enter the current key.';
        } elseif ($status === 404) { $error = 'This preview is unavailable. Ask the owner to save and share it again.'; http_response_code(404); }
        else throw new RuntimeException('Preview content unavailable');
    }
} catch (Throwable $exception) {
    error_log('Ezkart preview: ' . $exception->getMessage());
    http_response_code(503);
    $error = 'The preview service is unavailable. Please try again.';
}
$escape = static fn(string $value): string => htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
?>
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private preview · Ezkart</title>
<link rel="stylesheet" href="/cart/admin/admin-ui.css">
<style>*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;font:15px/1.5 system-ui;color:#222;background:#f7f7f8}.preview-gate{width:100%;max-width:420px;padding:32px;background:white;border:1px solid #e5e5e8;border-radius:16px}h1{font-size:24px;line-height:1.25;margin:0 0 12px}p{color:#62626c;margin:0 0 24px}label{display:block;font-weight:600;margin-bottom:8px}input{width:100%;min-height:46px;padding:12px;border:1px solid #bcbcc4;border-radius:8px;font:inherit}input:focus-visible{outline:3px solid #f5b2a8;outline-offset:2px}.preview-gate button{width:100%;margin-top:16px;min-height:46px}.preview-gate svg{width:18px;height:18px}#preview-error:empty{display:none}#preview-error{margin:16px 0 0;color:#9d2727;font-size:14px}@media(max-width:420px){.preview-gate{padding:24px}}</style>
</head><body class="dashboard-page"><main class="preview-gate"><h1>This preview is private</h1><p>Enter the preview key shared by the page owner to view this page.</p>
<form method="post" action="<?= $escape($canonical) ?>">
<label for="preview-key">Preview key</label><input id="preview-key" name="preview_key" type="password" required maxlength="100" autocomplete="off" spellcheck="false" autocapitalize="none" aria-describedby="preview-error">
<p id="preview-error" role="alert"><?= $escape($error) ?></p>
<button class="ui-button primary" type="submit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Open preview</button>
</form></main></body></html>
