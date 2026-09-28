<?php
// Internal reviewer workspace, deliberately outside the seller navigation/shell.
declare(strict_types=1);
define('EZ_CUSTOMER_SESSION_BRIDGE', true);
require __DIR__ . '/index.php';
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
if (!$authenticated || $authenticationMethod !== 'supabase' || $pendingMfa !== null) { http_response_code(401); exit('Sign in to Ezkart with your reviewer account first.'); }
require_once __DIR__ . '/support-access.php';
$adminUser = is_array($_SESSION['admin_user'] ?? null) ? $_SESSION['admin_user'] : [];
$supportAccess = ez_support_access(true, $csrfToken, $isHttps);
?>
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Internal page reviews · Ezkart</title><link rel="stylesheet" href="admin.css"><link rel="stylesheet" href="jev.css"><style>body{padding:24px;margin:auto;max-width:1400px}*{box-sizing:border-box}</style></head><body>
<?php require __DIR__ . '/jev.php'; ?>
<script src="../select.js"></script><script src="jev.js?v=<?= (int) filemtime(__DIR__ . '/jev.js') ?>"></script></body></html>
