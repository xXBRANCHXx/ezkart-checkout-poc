<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/sidebar-tips.php';
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
// Public read returns only the current card; queued content remains private.
$date = ez_tips_local_date(is_string($_GET['timezone'] ?? null) ? $_GET['timezone'] : 'UTC');
try { $state = ez_tips_read(); $current = ez_tips_current($state, $date); $fallback = $state['fallback']; }
catch (Throwable $error) { error_log('Sidebar tips: ' . $error->getMessage()); $fallback = ez_tips_default(); $current = ['source' => 'fallback', 'card' => $fallback]; }
ez_api_json(['ok' => true, 'date' => $date, 'fallback' => $fallback] + $current);
