<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }
require_once __DIR__ . '/../api/commerce-checkout.php';
require_once __DIR__ . '/../api/commerce-wallet-jobs.php';

function ez_admin_wallet_request(string $action, bool $authenticated, string $authenticationMethod, string $csrfToken, bool $isHttps): never
{
    if (!$authenticated || $authenticationMethod !== 'supabase') ez_admin_json(['ok' => false, 'error' => 'Sign in again to open Wallet.', 'code' => 'wallet_locked'], 401);
    $allowedQuery = $action === 'history' ? ['wallet', 'before', 'cap'] : ['wallet'];
    if (array_diff(array_keys($_GET), $allowedQuery) !== [] || !in_array($action, ['read', 'history', 'enroll', 'refresh'], true)) ez_admin_json(['ok' => false, 'error' => 'Wallet request is invalid.'], 400);
    $seenQuery = [];
    foreach (explode('&', (string) ($_SERVER['QUERY_STRING'] ?? '')) as $pair) {
        $key = urldecode(explode('=', $pair, 2)[0]);
        if (isset($seenQuery[$key])) ez_admin_json(['ok' => false, 'error' => 'Wallet request is invalid.'], 400);
        $seenQuery[$key] = true;
    }
    $historyQuery = [];
    if ($action === 'history') foreach (['before', 'cap'] as $key) {
        if (!is_string($_GET[$key] ?? null) || preg_match('/^[1-9][0-9]{0,15}$/D', $_GET[$key]) !== 1) ez_admin_json(['ok' => false, 'error' => 'Earnings history boundary is invalid.'], 422);
        $historyQuery[$key] = $_GET[$key];
    }
    $method = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
    if ($method !== (in_array($action, ['read', 'history'], true) ? 'GET' : 'POST')) ez_admin_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $account = (string) ($_SESSION['admin_user']['id'] ?? '');
    if ($account === '' || !hash_equals($account, (string) ($_SERVER['HTTP_X_EZKART_WALLET_ACCOUNT'] ?? ''))
        || $csrfToken === '' || !hash_equals($csrfToken, (string) ($_SERVER['HTTP_X_EZKART_CSRF'] ?? ''))) ez_admin_json(['ok' => false, 'error' => 'Your sign-in changed. Reload Wallet.', 'code' => 'wallet_locked'], 401);
    $input = [];
    if ($method === 'POST') {
        $raw = (string) file_get_contents('php://input', false, null, 0, 1025);
        // This endpoint accepts one opaque request key, never provider or owner identities.
        if (strlen($raw) > 1024 || !str_starts_with(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')
            || !preg_match($action === 'enroll' ? '/^\s*\{\s*"requestKey"\s*:\s*"[a-f0-9]{32}"\s*\}\s*$/D' : '/^\s*\{\s*\}\s*$/D', $raw)) ez_admin_json(['ok' => false, 'error' => 'Wallet request is invalid.'], 422);
        $input = json_decode($raw, true, 4, JSON_THROW_ON_ERROR);
    }
    try {
        $identity = ez_admin_get_json(rtrim(ez_config('cloudflare_api_url'), '/') . '/v1/me', [
            'Accept: application/json', 'Authorization: Bearer ' . $_SESSION['supabase_access_token'],
        ], 'Ezkart account');
        $seller = $identity['user']['active_seller'] ?? [];
        if (($seller['role'] ?? '') !== 'owner') ez_admin_json(['ok' => false, 'error' => 'Only the current store owner can manage Wallet.'], 403);
        $sellerId = (string) ($seller['id'] ?? '');
        if ($sellerId === '' || !hash_equals($sellerId, (string) ($_SERVER['HTTP_X_EZKART_WALLET_STORE'] ?? ''))) ez_admin_json(['ok' => false, 'error' => 'Your store changed. Reload Wallet.', 'code' => 'wallet_locked'], 401);
        $access = ez_wallet_access($authenticationMethod, $sellerId, $csrfToken, $isHttps);
        if (!$access['unlocked']) ez_admin_json(['ok' => false, 'error' => 'Verify your identity to open Wallet again.', 'code' => 'wallet_locked'], 401);
        $sessionId = session_id(); $grant = $_SESSION['wallet_access']; $signedInAt = $_SESSION['signed_in_at'];
        session_write_close();
        $enabled = ez_central_commerce_enabled();
        $environment = ez_central_commerce_environment();
        $ready = false;
        if ($enabled) {
            try { ez_wallet_provider_configuration($environment); $ready = true; }
            catch (EzDokuReadException) { /* Provider setup is incomplete; existing requests remain readable. */ }
        }
        $response = ['ok' => true, 'enabled' => $ready, 'enrollment' => null, 'availableToWithdraw' => null, 'earnings' => null, 'earningsHistory' => null,
            'owner' => ['storeName' => (string) ($seller['name'] ?? ''), 'email' => $access['email']]];
        $status = 200;
        if ($enabled) {
            $payload = ['environment' => $environment, 'seller' => $sellerId, 'actor' => ['id' => $account, 'email' => $access['email'],
                'proofExpiresAt' => gmdate('Y-m-d\TH:i:s', $access['expires_at']) . '.000Z']];
            if (!in_array($action, ['read', 'history'], true) && !$ready) throw new EzCommerceStorageException('Wallet setup is temporarily unavailable. Your saved request is preserved.', 503);
            if ($action === 'enroll') ez_commerce_request('POST', '/internal/commerce/finance/wallet', $payload + ['action' => 'enroll', 'requestKey' => $input['requestKey']]);
            $response = array_replace($response, ez_commerce_request('POST', '/internal/commerce/finance/wallet', $payload + ['action' => 'read']));
            if ($action === 'refresh' && $response['enrollment'] !== null && $response['enrollment']['status'] !== 'connected') {
                ez_wallet_process_enrollment($response['enrollment']['id'], $environment);
                $response = array_replace($response, ez_commerce_request('POST', '/internal/commerce/finance/wallet', $payload + ['action' => 'read']));
            }
            $financialQuery = ['seller' => $sellerId, 'environment' => $environment];
            $response['earningsHistory'] = ez_commerce_request('GET', '/internal/commerce/finance/earnings/history?' . http_build_query($financialQuery + $historyQuery, '', '&', PHP_QUERY_RFC3986));
            if ($action !== 'history') $response['earnings'] = ez_commerce_request('GET', '/internal/commerce/finance/earnings/summary?' . http_build_query($financialQuery, '', '&', PHP_QUERY_RFC3986));
        } elseif ($action !== 'read') throw new EzCommerceStorageException('Wallet setup is not available yet.', 503);
    } catch (Throwable $error) {
        $status = $error instanceof EzCommerceStorageException ? $error->httpStatus : 503;
        $response = ['ok' => false, 'error' => $error instanceof EzCommerceStorageException ? $error->getMessage() : 'Wallet could not be checked. Refresh to try again.'];
        error_log('Ezkart Wallet request: ' . get_class($error));
    }
    if (isset($sessionId)) {
        session_id($sessionId); $_SESSION = []; session_start();
        $same = ($_SESSION['authenticated'] ?? false) === true && ($_SESSION['authentication_method'] ?? '') === 'supabase'
            && ($_SESSION['authenticated_until'] ?? 0) > time() && ($_SESSION['admin_user']['id'] ?? '') === $account
            && ($_SESSION['csrf_token'] ?? '') === $csrfToken && ($_SESSION['signed_in_at'] ?? null) === $signedInAt
            && ($_SESSION['wallet_access'] ?? null) === $grant && ($grant['expires_at'] ?? 0) > time();
        if ($same) $same = ez_wallet_access('supabase', $sellerId, $csrfToken, $isHttps)['unlocked'];
        session_write_close();
        if (!$same) { header_remove('Set-Cookie'); ez_admin_json(['ok' => false, 'error' => 'Verify your identity again to check Wallet. Your saved request is preserved.', 'code' => 'wallet_locked'], 401); }
    }
    ez_admin_json($response, $status);
}
