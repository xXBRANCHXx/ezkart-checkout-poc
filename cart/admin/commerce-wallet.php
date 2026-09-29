<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }
require_once __DIR__ . '/../api/commerce-checkout.php';
require_once __DIR__ . '/../api/commerce-wallet-jobs.php';
require_once __DIR__ . '/../api/commerce-withdrawal-inquiries.php';
require_once __DIR__ . '/../api/commerce-withdrawal-status.php';

function ez_admin_wallet_request(string $action, bool $authenticated, string $authenticationMethod, string $csrfToken, bool $isHttps): never
{
    if (!$authenticated || $authenticationMethod !== 'supabase') ez_admin_json(['ok' => false, 'error' => 'Sign in again to open Wallet.', 'code' => 'wallet_locked'], 401);
    $allowedQuery = $action === 'history' ? ['wallet', 'before', 'cap'] : ['wallet'];
    $withdrawalActions = ['withdrawal_read', 'withdrawal_lookup', 'withdrawal_list', 'withdrawal_reserve', 'withdrawal_cancel', 'withdrawal_inquire', 'withdrawal_confirm', 'withdrawal_pay', 'withdrawal_status'];
    $onboardingActions = ['onboarding_read','onboarding_bank_read','onboarding_profile','onboarding_bank','onboarding_confirm_pins'];
    $isOnboarding = in_array($action, $onboardingActions, true);
    $isWithdrawal = in_array($action, $withdrawalActions, true);
    if (array_diff(array_keys($_GET), $allowedQuery) !== [] || !in_array($action, ['read', 'history', 'enroll', 'refresh', ...$withdrawalActions, ...$onboardingActions], true)) ez_admin_json(['ok' => false, 'error' => 'Wallet request is invalid.'], 400);
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
        $raw = (string) file_get_contents('php://input', false, null, 0, $isWithdrawal ? 4097 : 1025);
        // Provider and owner identities come only from the verified server session/configuration.
        if (strlen($raw) > ($isWithdrawal ? 4096 : 1024) || !str_starts_with(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')) ez_admin_json(['ok' => false, 'error' => 'Wallet request is invalid.'], 422);
        if ($isOnboarding) {
            try {
                EzDokuFinancialJson::decode($raw);
                $input = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
                $allowed = match ($action) {
                    'onboarding_read', 'onboarding_bank_read' => [], 'onboarding_profile' => ['revision','requestKey','legalName','birthDate','ageConfirmed','phone'],
                    'onboarding_bank' => ['revision','requestKey','bank'], 'onboarding_confirm_pins' => ['revision','requestKey','shippingRevision'],
                };
                if (!is_array($input) || array_diff(array_keys($input), $allowed) !== []) throw new InvalidArgumentException();
                if ($action === 'onboarding_bank') ez_withdrawal_check_bank_choice($input['bank'] ?? null);
            } catch (Throwable) { ez_admin_json(['ok'=>false,'error'=>'Onboarding request is invalid.'],422); }
        } elseif ($isWithdrawal) {
            try {
                EzDokuFinancialJson::decode($raw);
                $input = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
                $fields = match ($action) {
                    'withdrawal_list' => ['before', 'cap', 'limit'],
                    'withdrawal_lookup' => ['requestKey'],
                    'withdrawal_reserve' => ['requestKey', 'amount', 'bankRevision'],
                    'withdrawal_confirm' => ['id', 'requestKey', 'inquiryDigest'],
                    'withdrawal_pay' => ['id', 'confirmationId'],
                    'withdrawal_cancel' => ['id', 'requestKey'],
                    default => ['id'],
                };
                if (!is_array($input) || !str_starts_with(ltrim($raw), '{') || array_diff(array_keys($input), $fields) !== []) throw new InvalidArgumentException();
                if (!in_array($action, ['withdrawal_list', 'withdrawal_lookup', 'withdrawal_reserve'], true)
                    && (!is_string($input['id'] ?? null) || preg_match('/^wd_[a-f0-9]{40}$/D', $input['id']) !== 1)) throw new InvalidArgumentException();
            } catch (Throwable) { ez_admin_json(['ok' => false, 'error' => 'Withdrawal request is invalid.'], 422); }
        } else {
            if (!preg_match($action === 'enroll' ? '/^\s*\{\s*"requestKey"\s*:\s*"[a-f0-9]{32}"\s*\}\s*$/D' : '/^\s*\{\s*\}\s*$/D', $raw)) ez_admin_json(['ok' => false, 'error' => 'Wallet request is invalid.'], 422);
            $input = json_decode($raw, true, 4, JSON_THROW_ON_ERROR);
        }
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
        if ($access['email'] === '') ez_admin_json(['ok' => false, 'error' => 'Sign in again to continue seller setup.'], 401);
        $requiresWallet = !$isOnboarding || in_array($action, ['onboarding_bank', 'onboarding_bank_read'], true);
        if ($requiresWallet && !$access['unlocked']) ez_admin_json(['ok' => false, 'error' => 'Verify your identity to open Wallet again.', 'code' => 'wallet_locked'], 401);
        // Ordinary setup uses a short-lived assertion from the freshly checked
        // signed-in owner. It never creates or extends a Wallet unlock grant.
        $proofExpiry = $requiresWallet ? $access['expires_at'] : min(time() + 60, (int) $_SESSION['authenticated_until']);
        $sessionId = session_id(); $grant = $_SESSION['wallet_access'] ?? null; $signedInAt = $_SESSION['signed_in_at'];
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
                'proofExpiresAt' => gmdate('Y-m-d\TH:i:s', $proofExpiry) . '.000Z']];
            if ($isOnboarding) {
                $response = ez_commerce_request('POST', '/internal/commerce/onboarding', $payload + $input + ['action'=>$action === 'onboarding_bank_read' ? 'read' : substr($action, 11)]);
                // Profile/address requests use verified sign-in ownership only.
                // Never expose banking data through that less privileged path.
                $response['onboarding']['bankSaved'] = !empty($response['onboarding']['bank']);
                if (!$requiresWallet) {
                    $response['onboarding']['bank'] = null;
                    $response['onboarding']['bankRevision'] = 0;
                    $response['onboarding']['wallet'] = null;
                }
                $response['banks'] = $requiresWallet ? ez_withdrawal_bank_catalog() : [];
            } elseif ($isWithdrawal) {
                if (in_array($action, ['withdrawal_reserve', 'withdrawal_inquire', 'withdrawal_confirm'], true) && ez_config('commerce_withdrawals') !== 'enabled')
                    throw new EzCommerceStorageException('Bank withdrawals are not available yet.', 503);
                $path = '/internal/commerce/finance/withdrawals';

                $id = $input['id'] ?? null; unset($input['id']);
                if ($action === 'withdrawal_inquire') {
                    $result = ez_inquire_withdrawal_bank($id, $payload);
                    $response = ez_commerce_request('POST', $path . '/' . $id . '/read', $payload);
                    // A lost acknowledgement may already have committed the receipt.
                    if (($response['withdrawal']['bankVerified'] ?? null) === true) $result['state'] = 'verified';
                    $response['bankCheck'] = $result;
                } elseif ($action === 'withdrawal_pay') {
                    if (!is_string($input['confirmationId'] ?? null) || preg_match('/^wdconf_[a-f0-9]{40}$/D', $input['confirmationId']) !== 1)
                        throw new EzCommerceStorageException('Payment confirmation is invalid.', 422);
                    $result = ez_pay_withdrawal($id, $input['confirmationId'], $payload);
                    $response = ez_commerce_request('POST', $path . '/' . $id . '/read', $payload);
                    $response['paymentDispatch'] = $result;
                } elseif ($action === 'withdrawal_status') {
                    $result = ez_check_withdrawal_status($id, $payload);
                    $response = ez_commerce_request('POST', $path . '/' . $id . '/read', $payload);
                    $response['statusCheck'] = $result;
                } else {
                    $target = match ($action) {
                        'withdrawal_list' => $path . '/list',
                        'withdrawal_lookup' => $path . '/lookup',
                        'withdrawal_reserve' => $path,
                        'withdrawal_read' => $path . '/' . $id . '/read',
                        'withdrawal_cancel' => $path . '/' . $id . '/cancel',
                        'withdrawal_confirm' => $path . '/' . $id . '/confirm',
                    };
                    $response = ez_commerce_request('POST', $target, $payload + $input);
                }
            } else {
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
                if ($action !== 'history') {
                    $onboarding = ez_commerce_request('POST','/internal/commerce/onboarding',$payload + ['action'=>'read']);
                    $response['onboarding'] = $onboarding['onboarding'];
                    $response['sellingOnboardingRequired'] = $environment === 'production' && !($response['onboarding']['sellingReady'] ?? $response['onboarding']['ready']);
                    $response['onboardingRequired'] = $environment === 'production' && !$response['onboarding']['ready'];
                }
                if ($action !== 'history') $response['withdrawalCapabilities'] = [
                    'requests' => $ready && !($response['onboardingRequired'] ?? false) && ez_config('commerce_withdrawals') === 'enabled' && ($response['enrollment']['status'] ?? '') === 'connected',
                    'bankVerification' => $ready && ez_config('commerce_withdrawals') === 'enabled' && ez_config('commerce_withdrawal_inquiry') === 'enabled',
                    'transfers' => $ready && ez_config('commerce_withdrawals') === 'enabled' && ez_config('commerce_withdrawal_payment') === 'enabled',
                    'paymentStatus' => $ready && ez_config('commerce_withdrawal_status') === 'enabled',
                    'banks' => ez_withdrawal_bank_catalog(),
                ];
            }
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
            && (!$requiresWallet || (($_SESSION['wallet_access'] ?? null) === $grant && ($grant['expires_at'] ?? 0) > time()));
        if ($same && $requiresWallet) $same = ez_wallet_access('supabase', $sellerId, $csrfToken, $isHttps)['unlocked'];
        session_write_close();
        if (!$same) { header_remove('Set-Cookie'); ez_admin_json(['ok' => false, 'error' => 'Verify your identity again to check Wallet. Your saved request is preserved.', 'code' => 'wallet_locked'], 401); }
    }
    ez_admin_json($response, $status);
}
