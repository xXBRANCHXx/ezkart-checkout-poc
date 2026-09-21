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
$configured = true;
try {
    ez_customer_session();
    $settings = ez_customer_auth_settings();
    // Browsers apply form-action to the full POST redirect chain through Supabase and Google.
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' " . $settings['url'] . " https://accounts.google.com");
    if (!empty($_SESSION['customer_flash'])) { $error = $_SESSION['customer_flash']; unset($_SESSION['customer_flash']); }
    $flows = array_filter($_SESSION['customer_oauth_flows'] ?? [], static fn(array $flow): bool => (int) ($flow['expires_at'] ?? 0) > time());
    if (isset($_SESSION['customer_mfa']) && ($_SESSION['customer_mfa']['expires_at'] ?? 0) <= time()) unset($_SESSION['customer_mfa']);
    if (isset($customerAuthCallback) && $customerAuthCallback === true) {
        $flowId = (string) ($_GET['flow'] ?? '');
        $flow = $flows[$flowId] ?? null;
        unset($flows[$flowId]);
        $_SESSION['customer_oauth_flows'] = $flows;
        try {
            if (!$flow || !empty($_GET['error']) || !empty($_GET['error_description'])) throw new InvalidArgumentException('Google sign-in was cancelled or expired. Please try again.');
            $next = ez_customer_next($flow['next']);
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
                $_SESSION['customer_mfa'] = ['tokens' => $tokens, 'user_id' => $user['id'], 'factor_id' => $factors[0]['id'], 'next' => $next, 'expires_at' => time() + 600];
                header('Location: /cart/login.php?' . http_build_query(['next' => $next]), true, 303); exit;
            }
            ez_customer_store_session($tokens, $user, true);
            header('Location: ' . $next, true, 303); exit;
        } catch (Throwable $failure) {
            $_SESSION['customer_flash'] = $failure instanceof InvalidArgumentException ? $failure->getMessage() : 'Google sign-in could not be completed. Please try again.';
            header('Location: /cart/login.php?' . http_build_query(['next' => $next]), true, 303); exit;
        }
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        if (!ez_request_origin_allowed() || !hash_equals(ez_customer_csrf(), (string) ($_POST['csrf_token'] ?? ''))) {
            http_response_code(403); throw new InvalidArgumentException('This sign-in form expired. Reload the page and try again.');
        }
        $action = (string) ($_POST['action'] ?? '');
        if ($action === 'logout') {
            $token = (string) ($_SESSION['customer_auth']['access_token'] ?? '');
            $_SESSION = [];
            session_regenerate_id(true);
            if ($token !== '') { try { ez_customer_auth_request('logout?scope=local', [], $token); } catch (Throwable) {} }
            header('Location: /cart/login.php?' . http_build_query(['next' => $next]), true, 303); exit;
        }
        if ($action === 'google') {
            session_regenerate_id(true);
            $flowId = bin2hex(random_bytes(16));
            $verifier = rtrim(strtr(base64_encode(random_bytes(64)), '+/', '-_'), '=');
            $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
            $_SESSION['customer_oauth_flows'] = [$flowId => ['verifier' => $verifier, 'next' => $next, 'expires_at' => time() + 600]];
            unset($_SESSION['customer_mfa']);
            // Reuse the existing Supabase /cart/admin/** callback allowlist, with an isolated customer session.
            $callback = ez_checkout_public_url() . '/cart/admin/customer-auth.php?' . http_build_query(['flow' => $flowId]);
            $url = $settings['url'] . '/auth/v1/authorize?' . http_build_query(['provider' => 'google', 'redirect_to' => $callback, 'code_challenge' => $challenge, 'code_challenge_method' => 's256', 'prompt' => 'select_account']);
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
            header('Location: ' . ez_customer_next($pending['next']), true, 303); exit;
        }
    }
    $customer = ez_customer_current();
    if ($customer !== null && ($_GET['switch'] ?? '') !== '1' && $error === '') { header('Location: ' . $next, true, 303); exit; }
} catch (Throwable $failure) {
    $error = $failure instanceof InvalidArgumentException ? $failure->getMessage() : 'Sign-in is temporarily unavailable. Please try again.';
    try { ez_customer_auth_settings(); } catch (Throwable) { $configured = false; }
}
$csrf = session_status() === PHP_SESSION_ACTIVE ? ez_customer_csrf() : '';
$mfa = isset($_SESSION['customer_mfa']);
if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
?>
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/cart/payment.css?v=2"><link rel="stylesheet" href="/cart/customer-auth.css?v=1"><title>Sign in to track your order · Ezkart</title></head>
<body><header class="payment-header"><div class="header-content"><img class="brand" src="/assets/ezkart-logo.svg" width="1020" height="420" alt="Ezkart"><span class="secure-label">Your orders, securely</span></div></header>
<main class="customer-login"><div class="login-symbol" aria-hidden="true">↗</div><span class="login-eyebrow">YOUR ORDER JOURNEY</span><h1><?= $mfa ? 'One more step' : 'Your order.<br>Your updates.' ?></h1><p><?= $mfa ? 'Enter the code from your authenticator app to finish signing in.' : 'Sign in with Google to follow your order from the seller to your door.' ?></p>
<?php if ($error !== ''): ?><p class="notice" role="alert"><?= $escape($error) ?></p><?php endif; ?>
<?php if ($configured && $csrf !== ''): ?><form method="post" action="/cart/login.php"><input type="hidden" name="csrf_token" value="<?= $escape($csrf) ?>"><input type="hidden" name="next" value="<?= $escape($next) ?>"><input type="hidden" name="action" value="<?= $mfa ? 'mfa' : 'google' ?>">
<?php if ($mfa): ?><label for="customer-mfa">Authenticator code</label><input id="customer-mfa" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button class="primary-button" type="submit">Verify and continue</button>
<?php else: ?><button class="google-button" type="submit"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.01v2.5h3.23c1.89-1.74 2.99-4.31 2.99-7.34Z"/><path fill="#34a853" d="M12 22c2.7 0 4.96-.9 6.61-2.43l-3.23-2.5c-.9.6-2.05.97-3.38.97-2.61 0-4.83-1.76-5.62-4.13H3.04v2.58A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.38 13.91a6 6 0 0 1 0-3.82V7.51H3.04a10 10 0 0 0 0 8.98l3.34-2.58Z"/><path fill="#ea4335" d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.86-2.86A9.61 9.61 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.34 2.58A6 6 0 0 1 12 5.96Z"/></svg>Continue with Google</button><?php endif; ?></form><?php endif; ?>
<p class="login-hint">For a guest checkout, use the Google account with the same email you entered when ordering.</p><a class="login-back" href="/cart/">← Back to checkout</a></main></body></html>
