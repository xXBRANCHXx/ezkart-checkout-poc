<?php
declare(strict_types=1);

function ez_profile_image_url(mixed $value): string
{
    $url = is_string($value) ? trim($value) : '';
    if (strlen($url) > 2048 || filter_var($url, FILTER_VALIDATE_URL) === false
        || strtolower((string) parse_url($url, PHP_URL_SCHEME)) !== 'https'
        || parse_url($url, PHP_URL_USER) !== null || parse_url($url, PHP_URL_PASS) !== null) return '';
    return $url;
}

// Call only with the user returned by the verified Supabase /user request.
function ez_customer_identity(array $user): array
{
    $metadata = is_array($user['user_metadata'] ?? null) ? $user['user_metadata'] : [];
    return [
        'id' => (string) $user['id'],
        'email' => strtolower(trim((string) $user['email'])),
        'name' => mb_substr(trim((string) ($metadata['full_name'] ?? $metadata['name'] ?? '')), 0, 160),
        'avatar_url' => ez_profile_image_url($metadata['avatar_url'] ?? $metadata['picture'] ?? ''),
    ];
}

function ez_customer_save_profile(array $identity): void
{
    // Photos are optional. A storage failure must never break sign-in or payment.
    try {
        $directory = ez_order_directory() . '/customer-profiles';
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) return;
        $path = $directory . '/' . hash('sha256', $identity['email']) . '.json';
        $temporary = tempnam($directory, '.profile-');
        if ($temporary === false) return;
        try {
            chmod($temporary, 0600);
            if (file_put_contents($temporary, ez_json_encode($identity), LOCK_EX) !== false) rename($temporary, $path);
        } finally { if (is_file($temporary)) unlink($temporary); }
    } catch (Throwable) { error_log('Customer profile photo could not be saved.'); }
}

function ez_customer_order_profile(array $order): array
{
    $email = strtolower(trim((string) ($order['customer']['email'] ?? '')));
    if ($email === '') return [];
    $path = ez_order_directory() . '/customer-profiles/' . hash('sha256', $email) . '.json';
    $raw = is_file($path) ? file_get_contents($path) : false;
    $profile = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($profile) || ($profile['email'] ?? '') !== $email) return [];
    $owner = (string) ($order['customer_auth_user_id'] ?? '');
    if ($owner !== '' && $owner !== ($profile['id'] ?? '')) return [];
    $profile['avatar_url'] = ez_profile_image_url($profile['avatar_url'] ?? '');
    return $profile;
}
