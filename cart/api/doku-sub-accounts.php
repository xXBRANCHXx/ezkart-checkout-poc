<?php
declare(strict_types=1);
require_once __DIR__ . '/doku-snap.php';

/** Typed read-only Sub-Account operations. */
class EzDokuSubAccountReader extends EzDokuSnapClient
{
    private static function text(mixed $value, int $maximum, bool $empty = false): string
    {
        if (!is_string($value) || (!$empty && trim($value) === '') || strlen($value) > $maximum * 4 || preg_match('/[\x00-\x1f\x7f]/', $value)
            || preg_match('/^.{0,' . $maximum . '}$/usD', $value) !== 1) throw new EzDokuReadException('fields');
        return $value;
    }

    private static function account(mixed $value): string
    {
        if (!is_string($value) || preg_match('/^[0-9]{1,10}$/D', $value) !== 1) throw new EzDokuReadException('account');
        return $value;
    }

    /** Whole rupiah, with an exact decimal-string result even above 2^53. */
    private static function money(mixed $value, bool $negative = false): string
    {
        $value = $value instanceof EzDokuJsonNumber ? $value->value : $value;
        if (!is_string($value) || preg_match('/^(-?)(0|[1-9][0-9]{0,18})(?:\.0{1,2})?$/D', $value, $match) !== 1
            || (!$negative && $match[1] !== '') || (strlen($match[2]) === 19 && strcmp($match[2], '9223372036854775807') > 0)) throw new EzDokuReadException('amount');
        return $match[2] === '0' ? '0' : $match[1] . $match[2];
    }

    private static function date(mixed $value, bool $fraction = true): DateTimeImmutable
    {
        $pattern = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' . ($fraction ? '(?:\.\d{1,6})?' : '') . '(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/D';
        if (!is_string($value) || preg_match($pattern, $value) !== 1) throw new EzDokuReadException('date');
        try { $date = new DateTimeImmutable($value); }
        catch (Throwable) { throw new EzDokuReadException('date'); }
        if ($date->format('Y-m-d\TH:i:s') !== substr($value, 0, 19)) throw new EzDokuReadException('date');
        return $date->setTimezone(new DateTimeZone('UTC'));
    }

    public function balances(string $profileId): array
    {
        if (preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{1,21}$/D', $profileId) !== 1) throw new EzDokuReadException('profile');
        [$response, $evidence] = $this->request('balance-inquiries', ['profileId' => $profileId]);
        if (($response->profileId ?? null) !== $profileId || !is_array($response->accounts ?? null) || count($response->accounts) > 10) throw new EzDokuReadException('scope');
        $accounts = []; $seen = [];
        foreach ($response->accounts as $item) {
            if (!$item instanceof stdClass) throw new EzDokuReadException('account');
            $number = self::account($item->accountNo ?? null);
            if (isset($seen[$number])) throw new EzDokuReadException('account');
            $seen[$number] = true;
            if (in_array($item->type ?? null, ['DOKU_MERCHANT_POINT', 'DOKU_SYSTEM_POINT'], true) && ($item->currency ?? null) === 'POINT') continue;
            if (!in_array($item->type ?? null, ['DOKU_MERCHANT_IDR', 'DOKU_MERCHANT_PENDING_IDR'], true)
                || ($item->currency ?? null) !== 'IDR' || isset($accounts[$item->type]) || !($item->balance ?? null) instanceof stdClass) throw new EzDokuReadException('account');
            $accounts[$item->type] = ['accountNo' => $number, 'currency' => 'IDR',
                'available' => self::money($item->balance->available ?? null, true), 'reserved' => self::money($item->balance->reserved ?? null, true)];
        }
        if (count($accounts) !== 2) throw new EzDokuReadException('account');
        return ['data' => ['profileId' => $profileId, 'name' => self::text($response->name ?? null, 128), 'accounts' => $accounts], 'evidence' => $evidence];
    }

    public function historyPage(string $accountNo, string $from, string $to, int $page = 0, int $size = 100): array
    {
        self::account($accountNo); [$start, $end] = self::window($from, $to);
        if ($page < 0 || $page > 999 || $size < 1 || $size > 100) throw new EzDokuReadException('window');
        [$response, $evidence] = $this->request('transaction-history-list', ['accountNo' => $accountNo,
            'fromDateTime' => $start->format('Y-m-d\TH:i:s\Z'), 'toDateTime' => $end->format('Y-m-d\TH:i:s\Z'), 'pageSize' => (string) $size, 'pageNumber' => (string) $page]);
        if (!is_array($response->detailData ?? null) || count($response->detailData) > $size) throw new EzDokuReadException('history');
        $items = []; $previous = null;
        foreach ($response->detailData as $item) {
            if (!$item instanceof stdClass || ($item->currency ?? null) !== 'IDR' || !in_array($item->mutationType ?? null, ['CREDIT', 'DEBIT'], true)
                || !in_array($item->status ?? null, ['SUCCESS', 'PENDING', 'FAILED', 'VOID'], true)) throw new EzDokuReadException('history');
            $date = self::date($item->dateTime ?? null);
            if ($date < $start || $date > $end || ($previous !== null && $date > $previous)) throw new EzDokuReadException('history_order');
            $previous = $date;
            $type = self::text($item->transactionType ?? null, 32);
            if (preg_match('/^[A-Z][A-Z0-9_]*$/D', $type) !== 1) throw new EzDokuReadException('history');
            $items[] = ['accountNo' => $accountNo, 'referenceNo' => self::text($item->referenceNo ?? null, 64),
                // Provider fee/split rows can lack a merchant reference. Preserve
                // that absence; referenceNo still identifies the provider group.
                'partnerReferenceNo' => isset($item->partnerReferenceNo) ? self::text($item->partnerReferenceNo, 64, true) : null, 'transactionType' => $type,
                'mutationType' => $item->mutationType, 'amount' => self::money($item->amount ?? null), 'currency' => 'IDR', 'status' => $item->status,
                'dateTime' => $date->format('Y-m-d\TH:i:s.u\Z'), 'channel' => self::text($item->channel ?? '', 64, true), 'remark' => self::text($item->remark ?? '', 256, true)];
        }
        // A short page is only this read's exhaustion signal, not a provider snapshot or settled balance.
        return ['data' => ['accountNo' => $accountNo, 'page' => $page, 'items' => $items, 'exhausted' => count($items) < $size], 'evidence' => $evidence];
    }

    public static function window(string $from, string $to): array
    {
        $start = self::date($from, false); $end = self::date($to, false);
        if ($end <= $start || $end->getTimestamp() - $start->getTimestamp() > 31 * 86400) throw new EzDokuReadException('window');
        return [$start, $end];
    }

    public function transactionStatus(string $partnerReference): array
    {
        self::text($partnerReference, 64);
        [$response, $evidence] = $this->request('transactions-status', ['partnerReferenceNo' => $partnerReference]);
        if (($response->partnerReferenceNo ?? null) !== $partnerReference || !in_array($response->latestTransactionStatus ?? null, ['00', '03', '04', '05', '06'], true)
            || !($response->amount ?? null) instanceof stdClass || ($response->amount->currency ?? null) !== 'IDR') throw new EzDokuReadException('status');
        $refundHistoryPresent = property_exists($response, 'refundHistory');
        $refunds = $refundHistoryPresent ? $response->refundHistory : [];
        if (!is_array($refunds) || count($refunds) > 1000) throw new EzDokuReadException('status');
        $history = []; $seen = [];
        foreach ($refunds as $refund) {
            if (!$refund instanceof stdClass || !($refund->refundAmount ?? null) instanceof stdClass || ($refund->refundAmount->currency ?? null) !== 'IDR') throw new EzDokuReadException('status');
            $number = self::text($refund->refundNo ?? null, 64);
            if (isset($seen[$number])) throw new EzDokuReadException('status');
            $seen[$number] = true;
            $history[] = ['refundNo' => $number, 'refundStatus' => self::text($refund->refundStatus ?? null, 4),
                'amount' => self::money($refund->refundAmount->value ?? null), 'currency' => 'IDR',
                'transactionDate' => self::date($refund->transactionDate ?? null)->format('Y-m-d\TH:i:s.u\Z'), 'reason' => self::text($refund->reason ?? '', 128, true)];
        }
        $description = self::text($response->latestTransactionDesc ?? '', 32, true);
        if ($response->latestTransactionStatus === '00' && in_array(strtolower($description), ['void', 'voided'], true)) throw new EzDokuReadException('status');
        return ['data' => ['partnerReferenceNo' => $partnerReference, 'transactionType' => self::text($response->transactionType ?? null, 32),
            'latestTransactionStatus' => $response->latestTransactionStatus, 'latestTransactionDesc' => $description,
            'amount' => self::money($response->amount->value ?? null), 'currency' => 'IDR',
            'transactionDate' => self::date($response->transactionDate ?? null)->format('Y-m-d\TH:i:s.u\Z'),
            'refundHistoryPresent' => $refundHistoryPresent, 'refundHistory' => $history], 'evidence' => $evidence];
    }
}
