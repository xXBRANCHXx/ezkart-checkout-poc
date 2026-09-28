<?php
declare(strict_types=1);
if (!function_exists('ez_admin_json')) { http_response_code(404); exit; }
require_once dirname(__DIR__) . '/api/commerce-treasury-bank.php';
function ez_admin_treasury_access(string $csrf): array
{
    $state = ['summary' => null, 'detail' => null, 'error' => '', 'notice' => (string) ($_SESSION['treasury_notice'] ?? '')]; unset($_SESSION['treasury_notice']);
    $id = (string) ($_GET['intent'] ?? '');
    $owner = static function (string $path, ?array $input): array {
        $url = rtrim(ez_config('cloudflare_api_url'), '/') . '/v1/treasury' . $path;
        $headers = ['Accept: application/json', 'Authorization: Bearer ' . (string) ($_SESSION['supabase_access_token'] ?? '')];
        return $input === null ? ez_admin_get_json($url, $headers, 'Ezkart treasury') : ez_admin_post_json($url, $headers, $input, 'Ezkart treasury');
    };
    try {
        $state['summary'] = $owner('/commissions', null); // JWT + allowlist + fresh TOTP on every request.
        if ($id !== '' && preg_match('/^try_[a-f0-9]{40}$/D', $id) !== 1) throw new InvalidArgumentException('Treasury reference is invalid.');
        $action = (string) ($_POST['action'] ?? '');
        if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && str_starts_with($action, 'treasury_')) {
            $native = ($_SERVER['HTTP_ORIGIN'] ?? '') === 'null' && ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'same-origin';
            if ((!ez_request_origin_allowed() && !$native) || !hash_equals($csrf, (string) ($_POST['csrf_token'] ?? ''))) throw new InvalidArgumentException('This treasury form expired. Reload before continuing.');
            if ($action === 'treasury_reserve') {
                $r = $owner('/intents', ['requestKey' => (string) ($_POST['request_key'] ?? ''), 'amount' => (string) ($_POST['amount'] ?? '')]); $id = $r['intent']['id'];
                $_SESSION['treasury_notice'] = 'Commission reserved. No bank transfer has been made.';
            } elseif ($id !== '' && $action === 'treasury_cancel') {
                $owner('/intents/' . $id . '/cancel', ['requestKey' => (string) ($_POST['request_key'] ?? '')]); $_SESSION['treasury_notice'] = 'The original commission reservation was cancelled.';
            } elseif ($id !== '' && $action === 'treasury_confirm') {
                $owner('/intents/' . $id . '/confirm', ['requestKey' => (string) ($_POST['request_key'] ?? ''), 'inquiryDigest' => (string) ($_POST['digest'] ?? '')]); $_SESSION['treasury_notice'] = 'Original company bank details confirmed. Transfer release remains subject to the displayed holds.';
            } elseif ($id !== '' && in_array($action, ['treasury_inquiry','treasury_payment'], true)) {
                $stage = $action === 'treasury_inquiry' ? 'inquiry' : 'payment';
                $r = ez_dispatch_treasury_bank($id, $state['summary']['environment'], $stage, $owner, $stage === 'payment' ? (string) ($_POST['confirmation_id'] ?? '') : null);
                $_SESSION['treasury_notice'] = $r['state'] === 'recorded' ? 'Original provider response recorded. Bank payment is not yet reconciled.' : 'Original dispatch outcome needs review. This request will not be sent again.';
            } else { throw new InvalidArgumentException('Treasury action is invalid.'); }
            header('Location: ?page=treasury' . ($id !== '' ? '&intent=' . $id : ''), true, 303); exit;
        }
        if ($id !== '') $state['detail'] = $owner('/intents/' . $id, null);
    } catch (Throwable $e) {
        $state['error'] = $e instanceof InvalidArgumentException || $e instanceof EzCommerceStorageException || $e instanceof EzAdminAuthProviderException ? $e->getMessage() : 'Treasury is unavailable. Your original reservation and send status are preserved.';
    }
    return $state;
}
