<?php
declare(strict_types=1);
require_once __DIR__ . '/doku-sub-accounts.php';

/**
 * Record every verified response before requesting the next page. The provider
 * offers offset pages, not an atomic snapshot: exhaustion never proves settlement.
 * The callback must durably save private evidence or throw before another read.
 */
function ez_observe_doku_financial_window(EzDokuSubAccountReader $reader, string $profile, string $from, string $to, int $maxPages, callable $record, int $pageSize = 100): array
{
    if ($maxPages < 1 || $maxPages > 40) throw new EzDokuReadException('page_budget');
    if ($pageSize < 1 || $pageSize > 100) throw new EzDokuReadException('page_size');
    EzDokuSubAccountReader::window($from, $to);
    $before = $reader->balances($profile); $record('balance_before', $before);
    $coverage = [];
    foreach ($before['data']['accounts'] as $type => $account) {
        $seen = []; $previousDate = null; $count = 0; $exhausted = false;
        for ($page = 0; $page < $maxPages; $page++) {
            $response = $reader->historyPage($account['accountNo'], $from, $to, $page, $pageSize);
            $record('history_page', $response);
            foreach ($response['data']['items'] as $item) {
                $hash = hash('sha256', json_encode($item, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
                // Same-page identical rows are preserved, not silently deduplicated.
                if (isset($seen[$hash]) && $seen[$hash] !== $page) throw new EzDokuReadException('history_overlap');
                if ($previousDate !== null && strcmp($item['dateTime'], $previousDate) > 0) throw new EzDokuReadException('history_order');
                $seen[$hash] = $page; $previousDate = $item['dateTime']; $count++;
            }
            if ($response['data']['exhausted']) { $exhausted = true; break; }
        }
        $coverage[$type] = ['accountNo' => $account['accountNo'], 'rows' => $count, 'exhausted' => $exhausted];
    }
    $after = $reader->balances($profile); $record('balance_after', $after);
    foreach ($before['data']['accounts'] as $type => $account) {
        if ($account['accountNo'] !== ($after['data']['accounts'][$type]['accountNo'] ?? null)) throw new EzDokuReadException('account_changed');
    }
    return ['profileId' => $profile, 'coverage' => $coverage,
        'pagesExhausted' => !in_array(false, array_column($coverage, 'exhausted'), true),
        'balancesChanged' => $before['data']['accounts'] !== $after['data']['accounts'],
        'atomicSnapshot' => false, 'settlementVerified' => false];
}
