<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/sidebar-tips.php';
// The browser supplies its timezone for subsequent server renders. On the first
// visit, show the evergreen card until the local-date request completes.
try {
    $schedule = ez_tips_read();
    $zone = $_COOKIE['ezkart_tip_timezone'] ?? '';
    return is_string($zone) && $zone !== ''
        ? ez_tips_current($schedule, ez_tips_local_date($zone))['card']
        : $schedule['fallback'];
} catch (Throwable $error) {
    error_log('Sidebar tips: ' . $error->getMessage());
    return ez_tips_default();
}
