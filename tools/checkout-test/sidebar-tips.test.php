<?php
declare(strict_types=1);
require_once dirname(__DIR__, 2) . '/cart/api/sidebar-tips.php';
function check(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
$fallback = ez_tips_default();
$tip = $fallback; $tip['title'] = 'A tip for Tuesday';
$state = ['fallback' => $fallback, 'tips' => [$tip + ['start_date' => '2026-09-22', 'end_date' => '2026-09-23']]];
check(ez_tips_current($state, '2026-09-21')['source'] === 'fallback', 'Fallback before scheduled day');
check(ez_tips_current($state, '2026-09-22')['card']['title'] === $tip['title'], 'Tip on scheduled day');
check(ez_tips_current($state, '2026-09-23')['source'] === 'fallback', 'Tip expires at next midnight');
$instant = new DateTimeImmutable('2026-09-21T17:00:00Z');
check(ez_tips_local_date('Asia/Jakarta', $instant) === '2026-09-22', 'Jakarta reaches Tuesday at midnight');
check(ez_tips_local_date('America/Los_Angeles', $instant) === '2026-09-21', 'Los Angeles still sees Monday at same instant');
check(ez_tips_local_date('Pacific/Kiritimati', new DateTimeImmutable('2026-09-21T10:00:00Z')) === '2026-09-22', 'UTC+14 midnight');
check(ez_tips_local_date('Etc/GMT+12', new DateTimeImmutable('2026-09-22T11:59:59Z')) === '2026-09-21', 'UTC-12 before midnight');
check(ez_tips_local_date('America/New_York', new DateTimeImmutable('2026-03-08T04:59:59Z')) === '2026-03-07', 'DST date before local midnight');
check(ez_tips_local_date('America/New_York', new DateTimeImmutable('2026-03-09T04:00:00Z')) === '2026-03-09', 'DST short day ends at local midnight');
check(ez_tips_add_days('2028-02-28', 1) === '2028-02-29', 'Leap date');
check(ez_tips_add_days('2026-12-30', 7) === '2027-01-06', 'Weekly year boundary');
check(ez_tips_local_date('../../invalid', $instant) === '2026-09-21', 'Invalid timezone uses UTC');
foreach (['javascript:alert(1)', '//example.com', 'data:text/html,test', '?logout=1', 'https://user:pass@example.com', '/\\evil.com'] as $href) {
    try { ez_tips_card(array_replace($fallback, ['href' => $href])); throw new RuntimeException('Unsafe link accepted'); }
    catch (InvalidArgumentException $expected) {}
}
foreach (['2026-02-30', '2026-9-2', 'next Tuesday', ''] as $date) {
    try { ez_tips_date($date); throw new RuntimeException('Invalid date accepted'); }
    catch (InvalidArgumentException $expected) {}
}
check(ez_tips_card(array_replace($fallback, ['title' => 'Tips untuk toko Anda 🌟']))['title'] === 'Tips untuk toko Anda 🌟', 'Unicode content');
echo "Sidebar tip date, timezone, expiry, link, and text checks passed.\n";
