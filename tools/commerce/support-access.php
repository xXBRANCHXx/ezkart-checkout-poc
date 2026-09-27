<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$_SERVER['DOCUMENT_ROOT'] = dirname(__DIR__, 2);
require_once dirname(__DIR__, 2) . '/cart/api/bootstrap.php';
require_once dirname(__DIR__, 2) . '/cart/api/commerce-client.php';
try {
    if (count($argv) !== 2 || !in_array($argv[1], ['--deployment=test','--deployment=beta'], true)) throw new InvalidArgumentException('Usage: php support-access.php --deployment=test|beta < private-request.json');
    $deployment = substr($argv[1], strlen('--deployment='));
    if (ez_config('deployment_environment') !== $deployment) throw new InvalidArgumentException('The configured deployment does not match.');
    $raw = stream_get_contents(STDIN, 3001);
    if (!is_string($raw) || strlen($raw) > 3000) throw new InvalidArgumentException('The access request is too large.');
    $input = json_decode($raw, true, 12, JSON_THROW_ON_ERROR);
    if (!is_array($input) || ($input['environment'] ?? '') !== ($deployment === 'test' ? 'sandbox' : 'production')) throw new InvalidArgumentException('The access request environment does not match.');
    $result = ez_commerce_request('POST', '/internal/commerce/support/access', $input);
    if (!is_array($result['permission'] ?? null)) throw new RuntimeException('Access receipt unavailable.');
    echo json_encode(['ok'=>true,'deployment'=>$deployment,'permission'=>$result['permission']], JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $error) {
    fwrite(STDERR,json_encode(['ok'=>false,'error'=>$error instanceof InvalidArgumentException?$error->getMessage():'Access was not confirmed. Retry the exact original request to check its receipt.'],JSON_THROW_ON_ERROR)."\n");
    exit(1);
}
