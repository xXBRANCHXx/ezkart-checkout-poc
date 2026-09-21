<?php
declare(strict_types=1);
require_once __DIR__ . '/api/customer-auth.php';
header('Cache-Control: no-store');
header('Referrer-Policy: same-origin');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
$escape = static fn(string $text): string => htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$next = ez_customer_next((string) ($_POST['next'] ?? $_GET['next'] ?? '/cart/return.php'));
$error = '';
$popup = false;
$jsonStart = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && ($_POST['action'] ?? '') === 'google' && ($_POST['popup'] ?? '') === '1';
function ez_customer_login_return(string $next, bool $popup, bool $success = true): never
{
    $target = $popup ? '/cart/login.php?' . http_build_query(['complete' => $success ? '1' : 'error', 'next' => $next]) : $next;
    header('Location: ' . $target, true, 303);
    exit;
}
try {
    ez_customer_session();
    $settings = ez_customer_auth_settings();
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' " . $settings['url'] . " https://accounts.google.com");
    $flows = array_filter($_SESSION['customer_oauth_flows'] ?? [], static fn(array $flow): bool => (int) ($flow['expires_at'] ?? 0) > time());
    if (isset($_SESSION['customer_mfa']) && ($_SESSION['customer_mfa']['expires_at'] ?? 0) <= time()) unset($_SESSION['customer_mfa']);
    if (isset($customerAuthCallback) && $customerAuthCallback === true) {
        $flowId = (string) ($_GET['flow'] ?? '');
        $flow = $flows[$flowId] ?? null;
        unset($flows[$flowId]);
        $_SESSION['customer_oauth_flows'] = $flows;
        try {
            if (!$flow) throw new InvalidArgumentException('Google sign-in expired. Please try again.');
            $popup = !empty($flow['popup']);
            $next = ez_customer_next($flow['next']);
            if (!empty($_GET['error']) || !empty($_GET['error_description'])) throw new InvalidArgumentException('Google sign-in was cancelled. Please try again.');
            $code = (string) ($_GET['code'] ?? '');
            if ($code === '' || strlen($code) > 512) throw new InvalidArgumentException('Google sign-in could not be completed.');
            $tokens = ez_customer_auth_request('token?grant_type=pkce', ['auth_code' => $code, 'code_verifier' => $flow['verifier']]);
            $user = ez_customer_verified_user((string) ($tokens['access_token'] ?? ''));
            session_regenerate_id(true);
            unset($_SESSION['customer_oauth_flows'], $_SESSION['customer_auth']);
            $_SESSION['customer_csrf'] = bin2hex(random_bytes(24));
            if (ez_customer_needs_mfa($user, $tokens['access_token'])) {
                $factors = array_values(array_filter($user['factors'] ?? [], static fn(array $factor): bool => ($factor['status'] ?? '') === 'verified' && ($factor['factor_type'] ?? '') === 'totp'));
                if ($factors === []) throw new InvalidArgumentException('This account requires a verification method that is not supported here yet.');
                $_SESSION['customer_mfa'] = ['tokens' => $tokens, 'user_id' => $user['id'], 'factor_id' => $factors[0]['id'], 'next' => $next, 'popup' => $popup, 'expires_at' => time() + 600];
                header('Location: /cart/login.php?' . http_build_query(['mfa' => '1', 'next' => $next]), true, 303); exit;
            }
            ez_customer_store_session($tokens, $user, true);
            ez_customer_login_return($next, $popup);
        } catch (Throwable $failure) {
            $_SESSION['customer_flash'] = $failure instanceof InvalidArgumentException ? $failure->getMessage() : 'Google sign-in could not be completed. Please try again.';
            ez_customer_login_return($next, $popup, false);
        }
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        if (!ez_request_origin_allowed() || !hash_equals(ez_customer_csrf(), (string) ($_POST['csrf_token'] ?? ''))) {
            http_response_code(403); throw new InvalidArgumentException('This sign-in request expired. Reload the tracking page and try again.');
        }
        $action = (string) ($_POST['action'] ?? '');
        if ($action === 'logout') {
            $token = (string) ($_SESSION['customer_auth']['access_token'] ?? '');
            $_SESSION = ['customer_skip_existing_login' => true];
            session_regenerate_id(true);
            if ($token !== '') { try { ez_customer_auth_request('logout?scope=local', [], $token); } catch (Throwable) {} }
            ez_customer_login_return($next, false);
        }
        if ($action === 'google') {
            // Keep the anonymous session stable while Google is open; regenerate it on successful login.
            $flowId = bin2hex(random_bytes(16));
            $verifier = rtrim(strtr(base64_encode(random_bytes(64)), '+/', '-_'), '=');
            $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
            $_SESSION['customer_oauth_flows'] = [$flowId => ['verifier' => $verifier, 'next' => $next, 'popup' => $jsonStart, 'expires_at' => time() + 600]];
            $_SESSION['customer_skip_existing_login'] = true;
            unset($_SESSION['customer_mfa'], $_SESSION['customer_flash']);
            $callback = ez_checkout_public_url() . '/cart/admin/customer-auth.php?' . http_build_query(['flow' => $flowId]);
            $url = $settings['url'] . '/auth/v1/authorize?' . http_build_query(['provider' => 'google', 'redirect_to' => $callback, 'code_challenge' => $challenge, 'code_challenge_method' => 's256', 'prompt' => 'select_account']);
            if ($jsonStart) ez_api_json(['ok' => true, 'url' => $url]);
            header('Location: ' . $url, true, 303); exit;
        }
        if ($action === 'mfa') {
            $pending = $_SESSION['customer_mfa'] ?? null;
            $code = (string) ($_POST['code'] ?? '');
            if (!$pending || preg_match('/^\d{6}$/D', $code) !== 1) throw new InvalidArgumentException('Enter the six-digit code from your authenticator app.');
            $factor = rawurlencode((string) $pending['factor_id']);
            $token = $pending['tokens']['access_token'];
            $challenge = ez_customer_auth_request('factors/' . $factor . '/challenge', [], $token);
            try {
                $tokens = ez_customer_auth_request('factors/' . $factor . '/verify', ['challenge_id' => $challenge['id'], 'code' => $code], $token);
            } catch (EzProviderException $failure) {
                if (in_array($failure->providerStatus, [400, 401, 422], true)) throw new InvalidArgumentException('That code could not be verified. Please try again.');
                throw $failure;
            }
            $user = ez_customer_verified_user((string) ($tokens['access_token'] ?? ''));
            if ($user['id'] !== $pending['user_id']) throw new InvalidArgumentException('Please start sign-in again.');
            ez_customer_store_session($tokens, $user, true);
            unset($_SESSION['customer_mfa']);
            session_regenerate_id(true);
            $_SESSION['customer_csrf'] = bin2hex(random_bytes(24));
            ez_customer_login_return(ez_customer_next($pending['next']), !empty($pending['popup']));
        }
    }
} catch (Throwable $failure) {
    $error = $failure instanceof InvalidArgumentException ? $failure->getMessage() : 'Sign-in is temporarily unavailable. Please try again.';
    if ($jsonStart) ez_api_json(['ok' => false, 'error' => $error], http_response_code() === 403 ? 403 : 503);
}
$mfa = isset($_SESSION['customer_mfa']);
$complete = isset($_GET['complete']);
if (!$mfa && !$complete) {
    if ($error !== '') $_SESSION['customer_flash'] = $error;
    if (http_response_code() === 403) { header('Content-Type: text/plain; charset=utf-8'); exit($error); }
    $target = $next . (($_GET['switch'] ?? '') === '1' ? (str_contains($next, '?') ? '&' : '?') . 'signin=1' : '');
    ez_customer_login_return($target, false);
}
$checkoutReturn = in_array(parse_url($next, PHP_URL_PATH), ['/cart/', '/cart/index.html'], true);
$csrf = ez_customer_csrf();
session_write_close();
?>
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/cart/payment.css?v=2"><link rel="stylesheet" href="/cart/customer-auth.css?v=2"><?php if ($complete): ?><script src="/cart/customer-auth-complete.js?v=1" defer></script><?php endif; ?><title><?= $mfa ? 'Verify your sign-in' : 'Return to your order' ?> · Ezkart</title></head>
<body><main class="auth-popup"><img class="brand" src="/assets/ezkart-logo.svg" width="1020" height="420" alt="Ezkart">
<?php if ($mfa): ?><h1>Enter your verification code</h1><p>Use the code from your authenticator app.</p>
<?php if ($error !== ''): ?><p class="notice" role="alert"><?= $escape($error) ?></p><?php endif; ?>
<form method="post" action="/cart/login.php"><input type="hidden" name="csrf_token" value="<?= $escape($csrf) ?>"><input type="hidden" name="next" value="<?= $escape($next) ?>"><input type="hidden" name="action" value="mfa"><label for="customer-mfa">Authenticator code</label><input id="customer-mfa" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus><button class="primary-button" type="submit"><?= $checkoutReturn ? 'Verify and continue' : 'Verify and track order' ?></button></form>
<?php else: ?><h1><?= ($_GET['complete'] ?? '') === '1' ? 'Signed in' : 'Sign-in wasn’t completed' ?></h1><p><?= $checkoutReturn ? 'Return to checkout to continue.' : 'Return to the tracking page to continue.' ?></p><?php endif; ?>
<a class="auth-return" href="<?= $escape($next) ?>"><?= $checkoutReturn ? 'Return to checkout' : 'View order tracking' ?></a></main></body></html>
