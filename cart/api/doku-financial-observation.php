<?php
declare(strict_types=1);
require_once __DIR__ . '/doku-sub-accounts.php';

/**
 * Record every verified response before requesting the next page. The provider
 * offers offset pages, not an atomic snapshot: exhaustion never proves settlement.
 * The callback must durably save private evidence or throw before another read.
 */
function ez_observe_doku_financial_window(EzDokuFinancialReader $reader, string $profile, string $from, string $to, int $maxPages, callable $record, int $pageSize = 100): array
{
    return ez_observe_doku_financial_windows($reader, $profile, [['from'=>$from,'to'=>$to]], $maxPages, $record, $pageSize);
}

/** The page budget is shared across all windows of each original pocket. */
function ez_observe_doku_financial_windows(EzDokuFinancialReader $reader, string $profile, array $windows, int $maxPages, callable $record, int $pageSize = 100): array
{
    if (!$windows || count($windows) > 12 || count($windows) > $maxPages) throw new EzDokuReadException('window_budget');
    $previous = null;
    foreach ($windows as $window) {
        EzDokuSubAccountReader::window($window['from'], $window['to']);
        if ($previous !== null && $previous !== $window['from']) throw new EzDokuReadException('window_gap');
        $previous = $window['to'];
    }
    if ($maxPages < 1 || $maxPages > 40) throw new EzDokuReadException('page_budget');
    if ($pageSize < 1 || $pageSize > 100) throw new EzDokuReadException('page_size');
    $before = $reader->balances($profile); $record('balance_before', $before);
    $coverage = [];
    foreach ($before['data']['accounts'] as $type => $account) {
        $count = 0; $used = 0; $complete = true;
        foreach ($windows as $index => $window) {
            $from = $window['from']; $to = $window['to'];
            $seen = []; $previousDate = null; $exhausted = false;
            // Reserve at least one page for every remaining window. Partial windows
            // remain explicitly incomplete even when a later one is exhausted.
            $budget = $maxPages - $used - (count($windows) - $index - 1);
            for ($page = 0; $page < $budget; $page++) {
                $used++;
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
            $complete = $complete && $exhausted;
        }
        $coverage[$type] = ['accountNo' => $account['accountNo'], 'rows' => $count, 'exhausted' => $complete];
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
