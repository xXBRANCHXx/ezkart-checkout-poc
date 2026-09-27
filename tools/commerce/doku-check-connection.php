<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/doku-bca-snap.php';

/** Obtain a B2B token only. Does not create an account, charge, refund or payout. */
function ez_doku_connection_main(array $arguments, ?Closure $clientFactory = null): int
{
    try {
        if (count($arguments) !== 1 || !in_array($arguments[0], ['--environment=sandbox', '--environment=production'], true)) {
            throw new InvalidArgumentException('Usage: php tools/commerce/doku-check-connection.php --environment=sandbox|production');
        }
        $environment = substr($arguments[0], strlen('--environment='));
        $client = $clientFactory === null ? EzDokuBcaSnapClient::configured($environment) : $clientFactory($environment);
        if ($client->providerIdentity()['environment'] !== $environment) throw new InvalidArgumentException('The configured provider environment does not match.');
        $proof = $client->verifyAuthentication();
        echo json_encode(['ok' => true, 'authentication' => $proof, 'servicesVerified' => false, 'paymentCreated' => false,
            'checkedAt' => gmdate('Y-m-d\TH:i:s\Z')], JSON_THROW_ON_ERROR) . "\n";
        return 0;
    } catch (Throwable $error) {
        $reason = $error instanceof EzDokuReadException ? $error->reason
            : ($error instanceof InvalidArgumentException ? $error->getMessage() : 'Connection verification did not finish.');
        fwrite(STDERR, json_encode(['ok' => false, 'error' => $reason,
            'providerStatus' => $error instanceof EzDokuReadException ? $error->providerStatus : 0], JSON_THROW_ON_ERROR) . "\n");
        return 1;
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) exit(ez_doku_connection_main(array_slice($argv, 1)));
