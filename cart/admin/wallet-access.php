<?php
declare(strict_types=1);

const EZ_WALLET_UNLOCK_SECONDS = 600;

function ez_wallet_rate_limit(string $userId, string $action): void
{
    // Shared across this account's browser sessions; no codes or email addresses are stored.
    $directory = session_save_path() . '/wallet-rate-limits';
    if (!is_dir($directory) && !@mkdir($directory, 0700) && !is_dir($directory)) throw new RuntimeException('Wallet verification storage unavailable.');
    $path = $directory . '/' . hash('sha256', ez_admin_supabase_settings()['url'] . '|' . $userId) . '.json';
    $file = @fopen($path, 'c+');
    if ($file === false) throw new RuntimeException('Wallet verification storage unavailable.');
    try {
        if (!flock($file, LOCK_EX)) throw new RuntimeException('Wallet verification storage unavailable.');
        @chmod($path, 0600);
        $raw = stream_get_contents($file);
        $state = $raw === '' ? [] : json_decode((string) $raw, true);
        if (!is_array($state)) throw new RuntimeException('Wallet verification storage unavailable.');
        $now = time();
        $window = $action === 'send' ? 900 : 300;
        $times = array_values(array_filter($state[$action] ?? [], static fn($time) => is_int($time) && $time > $now - $window));
        if ($action === 'send' && $times !== [] && max($times) + 60 > $now) throw new InvalidArgumentException('Wait one minute before requesting another email code.');
        if (count($times) >= 5) throw new InvalidArgumentException($action === 'send' ? 'Too many email requests. Try again in 15 minutes.' : 'Too many verification attempts. Try again in five minutes.');
        $state[$action] = [...$times, $now];
        $json = json_encode($state, JSON_THROW_ON_ERROR);
        rewind($file);
        if (!ftruncate($file, 0) || fwrite($file, $json) !== strlen($json) || !fflush($file)) throw new RuntimeException('Wallet verification storage unavailable.');
    } finally {
        flock($file, LOCK_UN);
        fclose($file);
    }
}

function ez_wallet_identity_key(array $user, string $sellerId): string
{
    $factors = array_column(ez_admin_totp_factors($user, 'verified'), 'id');
    sort($factors);
    return hash('sha256', json_encode([(string) $user['id'], strtolower((string) $user['email']), $sellerId, $factors, (int) ($_SESSION['signed_in_at'] ?? 0)], JSON_THROW_ON_ERROR));
}

function ez_wallet_access(string $authenticationMethod, string $sellerId, string $csrfToken, bool $isHttps): array
{
    $state = ['unlocked' => false, 'method' => '', 'email' => '', 'email_sent' => false, 'error' => '', 'notice' => '', 'expires_at' => 0];
    $flash = $_SESSION['wallet_flash'] ?? [];
    unset($_SESSION['wallet_flash']);
    $state['error'] = (string) ($flash['error'] ?? '');
    $state['notice'] = (string) ($flash['notice'] ?? '');
    if ($authenticationMethod !== 'supabase') {
        unset($_SESSION['wallet_access'], $_SESSION['wallet_email_challenge']);
        $state['error'] = 'Sign in with your Google account to verify your identity and open Wallet.';
        return $state;
    }
    if ($sellerId === '') {
        unset($_SESSION['wallet_access'], $_SESSION['wallet_email_challenge']);
        $state['error'] = 'Your store could not be loaded. Reload to try again.';
        return $state;
    }
    try {
        $accessToken = (string) ($_SESSION['supabase_access_token'] ?? '');
        // Read current verified factors from the provider, not a browser flag or cached AAL.
        $user = ez_admin_verify_supabase_user($accessToken);
        if (!hash_equals((string) ($_SESSION['admin_user']['id'] ?? ''), (string) $user['id'])) throw new RuntimeException('Wallet identity mismatch.');
        $factors = ez_admin_totp_factors($user, 'verified');
        $state['method'] = $factors !== [] ? 'totp' : 'email';
        $state['email'] = strtolower((string) $user['email']);
        $identityKey = ez_wallet_identity_key($user, $sellerId);
        $grant = $_SESSION['wallet_access'] ?? [];
        $state['unlocked'] = hash_equals($identityKey, (string) ($grant['identity_key'] ?? '')) && (int) ($grant['expires_at'] ?? 0) > time();
        $state['expires_at'] = $state['unlocked'] ? (int) $grant['expires_at'] : 0;
        if (!$state['unlocked']) unset($_SESSION['wallet_access']);
        $emailChallenge = $_SESSION['wallet_email_challenge'] ?? [];
        $state['email_sent'] = $state['method'] === 'email' && hash_equals($identityKey, (string) ($emailChallenge['identity_key'] ?? '')) && (int) ($emailChallenge['expires_at'] ?? 0) > time();
        if (!$state['email_sent']) unset($_SESSION['wallet_email_challenge']);
    } catch (Throwable $error) {
        unset($_SESSION['wallet_access'], $_SESSION['wallet_email_challenge']);
        ez_admin_log_auth_error('Wallet identity check failed', $error);
        $state['error'] = 'Verification is temporarily unavailable. Reload to try again.';
        return $state;
    }

    $action = (string) ($_POST['action'] ?? '');
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !in_array($action, ['wallet_email_send', 'wallet_verify', 'wallet_lock'], true)) return $state;
    if (!hash_equals($csrfToken, (string) ($_POST['csrf_token'] ?? ''))) {
        http_response_code(403);
        $state['error'] = 'This verification request expired. Reload and try again.';
        $state['unlocked'] = false;
        return $state;
    }
    try {
        if ($action === 'wallet_lock') {
            unset($_SESSION['wallet_access'], $_SESSION['wallet_email_challenge']);
        } elseif ($action === 'wallet_email_send') {
            if ($state['method'] !== 'email') throw new InvalidArgumentException('Use your authenticator code to open Wallet.');
            ez_wallet_rate_limit((string) $user['id'], 'send');
            unset($_SESSION['wallet_email_challenge']);
            $settings = ez_admin_supabase_settings();
            ez_admin_post_json($settings['url'] . '/auth/v1/otp', ['Accept: application/json', 'apikey: ' . $settings['key']], [
                'email' => $state['email'], 'create_user' => false,
            ], 'Supabase Auth');
            $_SESSION['wallet_email_challenge'] = ['identity_key' => $identityKey, 'expires_at' => time() + 600];
            $_SESSION['wallet_flash'] = ['notice' => 'Email code sent. Enter it below within 10 minutes.'];
        } else {
            ez_wallet_rate_limit((string) $user['id'], 'verify');
            $code = trim((string) ($_POST['code'] ?? ''));
            if (preg_match($state['method'] === 'totp' ? '/^[0-9]{6}$/D' : '/^[0-9]{6,10}$/D', $code) !== 1) throw new InvalidArgumentException($state['method'] === 'totp' ? 'Enter the six-digit code from your authenticator app.' : 'Enter the numeric code from your email.');
            if ($state['method'] === 'totp') {
                $factorId = (string) $factors[0]['id'];
                $challenge = ez_admin_auth_request('POST', '/auth/v1/factors/' . $factorId . '/challenge', $accessToken);
                $challengeId = (string) ($challenge['id'] ?? '');
                if (preg_match('/^[a-f0-9-]{36}$/i', $challengeId) !== 1) throw new RuntimeException('Invalid wallet challenge.');
                $tokens = ez_admin_auth_request('POST', '/auth/v1/factors/' . $factorId . '/verify', $accessToken, ['challenge_id' => $challengeId, 'code' => $code]);
                if (ez_admin_token_aal((string) ($tokens['access_token'] ?? '')) !== 'aal2') throw new RuntimeException('Wallet MFA verification incomplete.');
            } else {
                if (!$state['email_sent']) throw new InvalidArgumentException('Request a new email code before continuing.');
                $settings = ez_admin_supabase_settings();
                $tokens = ez_admin_post_json($settings['url'] . '/auth/v1/verify', ['Accept: application/json', 'apikey: ' . $settings['key']], [
                    'type' => 'email', 'email' => $state['email'], 'token' => $code,
                ], 'Supabase Auth');
            }
            $verifiedUser = ez_admin_verify_supabase_user((string) ($tokens['access_token'] ?? ''));
            if (!hash_equals($identityKey, ez_wallet_identity_key($verifiedUser, $sellerId))) throw new RuntimeException('Wallet verification identity or factors changed.');
            ez_admin_store_supabase_session($tokens, $verifiedUser, false);
            session_regenerate_id(true);
            ez_admin_renew_session_cookie($isHttps);
            $_SESSION['csrf_token'] = bin2hex(random_bytes(24));
            $_SESSION['wallet_access'] = ['identity_key' => $identityKey, 'expires_at' => time() + EZ_WALLET_UNLOCK_SECONDS];
            unset($_SESSION['wallet_email_challenge']);
        }
    } catch (Throwable $error) {
        ez_admin_log_auth_error('Wallet verification failed', $error);
        $_SESSION['wallet_flash'] = ['error' => $error instanceof InvalidArgumentException ? $error->getMessage() : ($action === 'wallet_email_send' ? 'The email code could not be sent. Please try again shortly.' : 'That code was not accepted. Check your code and try again.')];
    }
    header('Location: ?page=wallet', true, 303);
    exit;
}
