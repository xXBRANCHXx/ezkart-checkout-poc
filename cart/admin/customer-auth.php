<?php
declare(strict_types=1);
// Customer callback shares the configured OAuth redirect allowlist, never the admin session.
$customerAuthCallback = true;
require dirname(__DIR__) . '/login.php';
