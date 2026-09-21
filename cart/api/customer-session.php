<?php
declare(strict_types=1);
require_once __DIR__ . '/customer-auth.php';
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') ez_api_json(['ok' => false], 405);
    $customer = ez_customer_current();
    // A poll sent just before OAuth regenerates the session may arrive with the old
    // cookie. Its anonymous response must not replace the newly authenticated cookie.
    if (isset($_COOKIE['ezkart_customer']) && session_id() !== $_COOKIE['ezkart_customer']) header_remove('Set-Cookie');
    $error = (string) ($_SESSION['customer_flash'] ?? '');
    unset($_SESSION['customer_flash']);
    ez_api_json(['ok' => true, 'authenticated' => $customer !== null, 'version' => $customer !== null ? ($_SESSION['customer_auth']['version'] ?? '') : '', 'error' => $error]);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'Sign-in is temporarily unavailable. Please try again.'], 503);
}
