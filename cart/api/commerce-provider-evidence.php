<?php
declare(strict_types=1);
require_once __DIR__ . '/commerce-checkout.php';
require_once __DIR__ . '/doku-financial-observation.php';

/** A finalization outage retains IDs so the exact collection can be retried. */
final class EzProviderCollectionPending extends RuntimeException
{
    public function __construct(public readonly array $pendingCollection, Throwable $previous)
    {
        parent::__construct('Provider observations are saved; collection finalization is pending.', 0, $previous);
    }
}

/** Retrying this body never issues a second provider request. */
function ez_record_provider_collection(array $payload): array
{
    try { $result = ez_commerce_request('POST', '/internal/commerce/finance/provider-collections', $payload); }
    catch (EzCommerceStorageException $error) {
        if ($error->httpStatus < 500) throw $error;
        try { $result = ez_commerce_request('POST', '/internal/commerce/finance/provider-collections', $payload); }
        catch (Throwable $retryError) { throw new EzProviderCollectionPending($payload, $retryError); }
    }
    $collection = $result['collection'] ?? null;
    if (!is_array($collection) || preg_match('/^fcol_[a-f0-9]{40}$/D', $collection['id'] ?? '') !== 1
        || ($collection['observationIds'] ?? null) !== ($payload['observationIds'] ?? null)
        || !is_bool($collection['pagesExhausted'] ?? null)) throw new RuntimeException('Provider collection acknowledgement is invalid.');
    return $collection;
}

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
    $observationIds = [];
    $report = ez_observe_doku_financial_window($reader, $account['profileId'], $from, $to, $maxPages,
        static function (string $kind, array $response) use ($seller, $environment, &$observationIds): void {
            $payload = ['seller' => $seller, 'environment' => $environment, 'evidence' => $response['evidence']];
            try { $saved = ez_commerce_request('POST', '/internal/commerce/finance/provider-evidence', $payload); }
            catch (EzCommerceStorageException $error) {
                if ($error->httpStatus < 500) throw $error;
                // An acknowledgement can be lost after commit. Replay only this
                // exact evidence; never reread the provider to replace it.
                $saved = ez_commerce_request('POST', '/internal/commerce/finance/provider-evidence', $payload);
            }
            if (preg_match('/^fobs_[a-f0-9]{40}$/D', $saved['id'] ?? '') !== 1) throw new RuntimeException('Provider observation acknowledgement is invalid.');
            $observationIds[] = $saved['id'];
        }, 20);
    $collection = ez_record_provider_collection(['seller' => $seller, 'environment' => $environment, 'observationIds' => $observationIds]);
    if ($collection['pagesExhausted'] !== $report['pagesExhausted']) throw new RuntimeException('Provider collection coverage differs from the original observations.');
    return ['environment' => $environment, 'collectionId' => $collection['id'], 'responses' => count($observationIds), 'pagesExhausted' => $collection['pagesExhausted'],
        'rows' => array_map(static fn(array $account): int => $account['rows'], $report['coverage']),
        'balancesChanged' => $report['balancesChanged'], 'atomicSnapshot' => false, 'settlementVerified' => false];
}
