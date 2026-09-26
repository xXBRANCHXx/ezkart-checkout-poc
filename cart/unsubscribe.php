<?php
declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';
require_once __DIR__ . '/api/database.php';

header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');
header("Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
header('Content-Type: text/html; charset=utf-8');

$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');
$token = preg_match('/^t=([a-f0-9]{64})$/D', (string) ($_SERVER['QUERY_STRING'] ?? ''), $match) === 1 ? $match[1] : '';
$status = 200; $view = null; $sent = false;

try {
    if (!in_array($method, ['GET','HEAD','POST'], true)) { header('Allow: GET, HEAD, POST'); throw new RuntimeException('method', 405); }
    if ($token === '') throw new RuntimeException('link', 404);
    $payload = '';
    if ($method === 'POST') {
        $type = (string) ($_SERVER['CONTENT_TYPE'] ?? ''); $length = (string) ($_SERVER['CONTENT_LENGTH'] ?? '');
        if ($length !== '' && (preg_match('/^\d+$/D', $length) !== 1 || (float) $length > 8192)) throw new RuntimeException('size', 413);
        if (preg_match('#^multipart/form-data\s*;#i', $type) === 1) {
            // PHP consumes multipart bodies before this handler. Require a
            // bounded message and exactly the known directive; never use any
            // account, cookie, address, grant or store field from the request.
            if ($length === '') throw new RuntimeException('length', 411);
            if ($_FILES !== [] || count($_POST) !== 1 || ($_POST['List-Unsubscribe'] ?? null) !== 'One-Click') throw new RuntimeException('form', 400);
            $payload = 'List-Unsubscribe=One-Click';
        } elseif (preg_match('#^application/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?\s*$#i', $type) === 1) {
            $raw = file_get_contents('php://input', false, null, 0, 8193);
            if (!is_string($raw) || strlen($raw) > 8192) throw new RuntimeException('size', 413);
            // The Worker validates the original URL-encoded fields, including
            // duplicates. PHP's normalized $_POST is not identity evidence.
            $payload = $raw;
        } else throw new RuntimeException('type', 415);
    }
    // Deployment pins the destination. The Executive environment selector and
    // commerce/sending holds cannot redirect or disable an existing opt-out.
    $database = ez_database_configuration(); $parts = parse_url($database['url']);
    if (isset($parts['user']) || isset($parts['pass']) || isset($parts['port']) || isset($parts['query']) || isset($parts['fragment'])
        || !in_array($parts['path'] ?? '', ['', '/'], true) || !function_exists('curl_init')) throw new RuntimeException('service', 503);
    $handle = curl_init($database['url'] . '/v1/public/campaign-unsubscribe?t=' . $token);
    if ($handle === false) throw new RuntimeException('service', 503);
    $raw = '';
    curl_setopt_array($handle, [CURLOPT_CUSTOMREQUEST => $method === 'POST' ? 'POST' : 'GET', CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 15, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$raw): int { if (strlen($raw) + strlen($chunk) > 16000) return 0; $raw .= $chunk; return strlen($chunk); }]);
    if ($method === 'POST') curl_setopt($handle, CURLOPT_POSTFIELDS, $payload);
    $received = curl_exec($handle); $upstream = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $result = $received === true ? json_decode($raw, true) : null;
    if (!is_array($result)) throw new RuntimeException('unconfirmed', 503);
    if ($upstream !== 200 || ($result['ok'] ?? false) !== true) throw new RuntimeException('service', in_array($upstream, [400,404,405,409,413,415,429], true) ? $upstream : 503);
    if (!is_string($result['storeName'] ?? null) || strlen($result['storeName']) > 1000 || !is_string($result['emailHint'] ?? null)
        || strlen($result['emailHint']) > 300 || !is_bool($result['unsubscribed'] ?? null) || ($method === 'POST' && $result['unsubscribed'] !== true)) throw new RuntimeException('unconfirmed', 503);
    $view = $result; $sent = $method === 'POST';
} catch (Throwable $error) {
    $status = in_array($error->getCode(), [400,404,405,409,411,413,415,429,503], true) ? $error->getCode() : 503;
}
http_response_code($status);
if ($method === 'HEAD') exit;
$escape = static fn(string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$action = '/cart/unsubscribe.php' . ($token !== '' ? '?t=' . $token : '');
$complete = is_array($view) && $view['unsubscribed'];
$title = $status === 200 ? ($complete ? 'You’re unsubscribed' : 'Your email, your choice') : ($status === 404 ? 'Link unavailable' : 'Please try again');
?>
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title><?= $escape($title) ?> · Ezkart</title><link rel="stylesheet" href="unsubscribe.css?v=<?= (int) filemtime(__DIR__ . '/unsubscribe.css') ?>"></head>
<body><header class="unsubscribe-header"><img src="../assets/ezkart-logo.svg" width="156" height="64" alt="Ezkart"><span>Email preferences</span></header>
<main class="unsubscribe-card"><div class="unsubscribe-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><?php if ($complete): ?><path d="m5 12 4 4L19 6"/><?php else: ?><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 6 8 7 8-7"/><?php endif; ?></svg></div>
<p class="unsubscribe-eyebrow">YOUR CHOICES</p><h1><?= $escape($title) ?></h1>
<?php if ($view !== null): ?>
  <?php if ($complete): ?><p>Promotional emails from <strong><?= $escape($view['storeName']) ?></strong> to <strong><?= $escape($view['emailHint']) ?></strong> are turned off.</p><p class="unsubscribe-note"><?= $sent ? 'Your unsubscribe request has been saved.' : 'No further action is needed.' ?> Your order and delivery updates are unaffected.</p><a class="unsubscribe-secondary" href="preferences.php">Manage email preferences</a>
  <?php else: ?><p>Stop promotional emails from <strong><?= $escape($view['storeName']) ?></strong> to <strong><?= $escape($view['emailHint']) ?></strong>.</p><p class="unsubscribe-note">Your order and delivery updates will continue. You can make this choice without signing in.</p><form method="post" action="<?= $escape($action) ?>"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Stop promotional emails</button></form><a class="unsubscribe-secondary" href="preferences.php">Manage all email preferences</a><?php endif; ?>
<?php elseif ($status === 404): ?><p>This unsubscribe link is unavailable. Open the original link from the email, or sign in to manage your email preferences.</p><a class="unsubscribe-secondary" href="preferences.php">Manage email preferences</a>
<?php else: ?><p><?= $method === 'POST' ? 'We could not confirm the unsubscribe request. Please try again using this same link.' : 'We could not load this email preference. Please try this link again.' ?></p>
  <?php if ($token !== '' && in_array($status, [409,429,503], true)): ?><?php if ($method === 'POST'): ?><form method="post" action="<?= $escape($action) ?>"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Try unsubscribe again</button></form><?php else: ?><a class="unsubscribe-secondary" href="<?= $escape($action) ?>">Reload this link</a><?php endif; ?><?php endif; ?>
  <p class="unsubscribe-note">You can also sign in to <a href="preferences.php">manage email preferences</a>.</p>
<?php endif; ?>
</main><footer class="unsubscribe-footer">Email choices are specific to each store and email address.</footer></body></html>
