<?php
declare(strict_types=1);
require_once __DIR__ . '/commerce-checkout.php';
require_once __DIR__ . '/doku-financial-observation.php';

/** Read only at DOKU; each response must persist before the next provider read. */
function ez_collect_seller_provider_evidence(string $seller, string $from, string $to, int $maxPages = 10): array
{
    if (preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/D', $seller) !== 1 || $maxPages < 1 || $maxPages > 40) throw new InvalidArgumentException('Seller or page budget is invalid.');
    [, $end] = EzDokuSubAccountReader::window($from, $to);
    if ($end->getTimestamp() > time()) throw new InvalidArgumentException('Choose a completed time window.');
    $environment = ez_central_commerce_environment();
    $reader = EzDokuSubAccountReader::configured($environment);
    $account = ez_commerce_request('GET', '/internal/commerce/finance/provider-account?' . http_build_query(['seller' => $seller, 'environment' => $environment], '', '&', PHP_QUERY_RFC3986))['account'];
    if (($account['seller'] ?? '') !== $seller || ($account['environment'] ?? '') !== $environment
        || ($account['credentialFingerprint'] ?? '') !== $reader->credentialFingerprint) throw new RuntimeException('The provider credentials do not match this seller wallet.');
    $recorded = 0;
    $report = ez_observe_doku_financial_window($reader, $account['profileId'], $from, $to, $maxPages,
        static function (string $kind, array $response) use ($seller, $environment, &$recorded): void {
            $payload = ['seller' => $seller, 'environment' => $environment, 'evidence' => $response['evidence']];
            try { ez_commerce_request('POST', '/internal/commerce/finance/provider-evidence', $payload); }
            catch (EzCommerceStorageException $error) {
                if ($error->httpStatus < 500) throw $error;
                // An acknowledgement can be lost after commit. Replay only this
                // exact evidence; never reread the provider to replace it.
                ez_commerce_request('POST', '/internal/commerce/finance/provider-evidence', $payload);
            }
            $recorded++;
        }, 20);
    return ['environment' => $environment, 'responses' => $recorded, 'pagesExhausted' => $report['pagesExhausted'],
        'rows' => array_map(static fn(array $account): int => $account['rows'], $report['coverage']),
        'balancesChanged' => $report['balancesChanged'], 'atomicSnapshot' => false, 'settlementVerified' => false];
}
