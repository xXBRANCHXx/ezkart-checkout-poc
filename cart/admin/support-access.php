<?php
declare(strict_types=1);
if (!function_exists('ez_admin_json')) { http_response_code(404); exit; }

function ez_support_access(bool $reviewPage, string $csrf, bool $isHttps): array
{
    $state = ['authorized' => false, 'canRead' => false, 'canWrite' => false, 'error' => ''];
    $flash = $reviewPage ? (string) ($_SESSION['support_flash'] ?? '') : '';
    if ($reviewPage) unset($_SESSION['support_flash']);
    try {
        $token = (string) ($_SESSION['supabase_access_token'] ?? '');
        $read = static fn(string $access) => ez_admin_get_json(rtrim(ez_config('cloudflare_api_url'), '/') . '/v1/support/session', ['Accept: application/json', 'Authorization: Bearer ' . $access], 'Ezkart review access')['support'] ?? [];
        $state = array_merge($state, $read($token));
        $state['error'] = $flash;
        if (!$reviewPage || empty($state['authorized']) || ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || ($_POST['action'] ?? '') !== 'support_verify') return $state;
        // The admin's no-referrer policy gives native form posts an opaque
        // Origin. Accept that browser case only with same-origin fetch metadata
        // and the original session CSRF token; cross-site forms remain rejected.
        $nativeSameOrigin = ($_SERVER['HTTP_ORIGIN'] ?? '') === 'null' && ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'same-origin';
        if ((!ez_request_origin_allowed() && !$nativeSameOrigin) || !hash_equals($csrf, (string) ($_POST['csrf_token'] ?? ''))) {
            http_response_code(403); $state['canRead'] = false; $state['error'] = 'This verification request expired. Reload and try again.'; return $state;
        }
        $user = ez_admin_verify_supabase_user($token);
        if (!hash_equals((string) ($_SESSION['admin_user']['id'] ?? ''), (string) $user['id'])) throw new RuntimeException('Review identity changed.');
        $factors = ez_admin_totp_factors($user, 'verified');
        if ($factors === []) throw new InvalidArgumentException('Set up an authenticator in Security settings before opening Ezkart reviews.');
        ez_wallet_rate_limit((string) $user['id'], 'support_verify');
        $code = trim((string) ($_POST['code'] ?? ''));
        if (preg_match('/^[0-9]{6}$/D', $code) !== 1) throw new InvalidArgumentException('Enter the six-digit code from your authenticator app.');
        $factor = (string) $factors[0]['id'];
        $challenge = ez_admin_auth_request('POST', '/auth/v1/factors/' . $factor . '/challenge', $token);
        if (preg_match('/^[a-f0-9-]{36}$/i', (string) ($challenge['id'] ?? '')) !== 1) throw new RuntimeException('Review challenge unavailable.');
        $tokens = ez_admin_auth_request('POST', '/auth/v1/factors/' . $factor . '/verify', $token, ['challenge_id' => $challenge['id'], 'code' => $code]);
        $verified = ez_admin_verify_supabase_user((string) ($tokens['access_token'] ?? ''));
        if (!hash_equals((string) $user['id'], (string) $verified['id']) || !in_array($factor, array_column(ez_admin_totp_factors($verified, 'verified'), 'id'), true)) throw new RuntimeException('Review identity changed.');
        $next = $read((string) ($tokens['access_token'] ?? ''));
        if (empty($next['canRead']) || (($next['role'] ?? '') === 'reviewer' && empty($next['canWrite']))) throw new RuntimeException('Review verification was not confirmed.');
        ez_admin_store_supabase_session($tokens, $verified, false);
        session_regenerate_id(true); ez_admin_renew_session_cookie($isHttps);
        $_SESSION['csrf_token'] = bin2hex(random_bytes(24));
    } catch (Throwable $error) {
        if (!$reviewPage) return ['authorized' => false];
        $state['error'] = $error instanceof InvalidArgumentException ? $error->getMessage() : 'Review access could not be verified. Check your sign-in and try again.';
        if (($_POST['action'] ?? '') !== 'support_verify') return $state;
        $_SESSION['support_flash'] = $state['error'];
    }
    $refund = (string) ($_GET['refund'] ?? '');
    header('Location: ?page=support-refunds' . (preg_match('/^ref_[a-f0-9]{32}$/D', $refund) === 1 ? '&refund=' . $refund : ''), true, 303);
    exit;
}
