<?php
declare(strict_types=1);

putenv('EZKART_APP_SIGNING_SECRET=test-signing-secret-with-more-than-32-characters');
putenv('EZKART_ZERO_MERCHANT_SECRET=test-merchant-secret-with-more-than-32-characters');
putenv('EZKART_ALLOWED_RETURN_HOSTS=zerofoods.id,www.zerofoods.id');

require_once dirname(__DIR__) . '/src/core.php';
require_once dirname(__DIR__) . '/src/commerce.php';
require_once dirname(__DIR__) . '/src/label.php';

$tests = [];

function test(string $name, callable $callback): void
{
    global $tests;
    try {
        $callback();
        $tests[] = ['name' => $name, 'passed' => true, 'message' => ''];
    } catch (Throwable $error) {
        $tests[] = ['name' => $name, 'passed' => false, 'message' => $error->getMessage()];
    }
}

function expect(bool $condition, string $message = 'Expectation failed.'): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function expectThrows(callable $callback): void
{
    try {
        $callback();
    } catch (Throwable) {
        return;
    }
    throw new RuntimeException('Expected an exception.');
}

test('normalizes item totals and weights', static function (): void {
    $items = ez_normalize_items(['items' => [[
        'sku' => 'ZERO-1',
        'name' => 'ZERO Product',
        'quantity' => 2,
        'unit_price' => 89000,
        'unit_weight_grams' => 650,
    ]]]);
    expect(ez_item_totals($items) === ['merchandise' => 178000, 'weight_grams' => 1300]);
});

test('rejects malformed item data', static function (): void {
    expectThrows(static fn () => ez_normalize_items(['items' => [[
        'sku' => 'ZERO-1',
        'name' => 'ZERO Product',
        'quantity' => 0,
        'unit_price' => 89000,
        'unit_weight_grams' => 650,
    ]]]));
});

test('signs, verifies, and expires quote tokens', static function (): void {
    $token = ez_signed_token(['session_id' => 'cs_test', 'expires_at' => 2000]);
    expect(ez_verify_token($token, 1999)['session_id'] === 'cs_test');
    expectThrows(static fn () => ez_verify_token($token . 'tampered', 1999));
    expectThrows(static fn () => ez_verify_token($token, 2001));
});

test('validates merchant HMAC over exact raw JSON', static function (): void {
    $raw = '{"merchant_order_reference":"ZERO-1"}';
    $timestamp = '1785483334000';
    $_SERVER['HTTP_X_EZKART_MERCHANT'] = 'zerofoods';
    $_SERVER['HTTP_X_EZKART_TIMESTAMP'] = $timestamp;
    $_SERVER['HTTP_X_EZKART_SIGNATURE'] = hash_hmac(
        'sha256',
        $timestamp . '.' . $raw,
        'test-merchant-secret-with-more-than-32-characters'
    );
    expect(ez_authenticate_merchant($raw, 1785483334000) === 'zerofoods');
    expectThrows(static fn () => ez_authenticate_merchant($raw . ' ', 1785483334000));
});

test('accepts only approved HTTPS return hosts', static function (): void {
    expect(ez_allowed_return_url('https://zerofoods.id/order/success') === 'https://zerofoods.id/order/success');
    expectThrows(static fn () => ez_allowed_return_url('https://attacker.example/order/success'));
    expectThrows(static fn () => ez_allowed_return_url('http://zerofoods.id/order/success'));
});

test('accepts Biteship installation probes', static function (): void {
    expect(ez_biteship_installation_probe(''));
    expect(ez_biteship_installation_probe('{}'));
    expect(!ez_biteship_installation_probe('{"event":"order.status"}'));
});

test('renders a Code 128 SVG without executable markup', static function (): void {
    $svg = ez_code128_svg('WYB-12345<script>');
    expect(str_contains($svg, '<svg'));
    expect(!str_contains($svg, '<script>'));
    expect(str_contains($svg, '<rect'));
});

$failures = array_filter($tests, static fn (array $result): bool => !$result['passed']);
foreach ($tests as $result) {
    echo ($result['passed'] ? 'PASS' : 'FAIL') . '  ' . $result['name'];
    if (!$result['passed']) {
        echo ': ' . $result['message'];
    }
    echo PHP_EOL;
}
echo PHP_EOL . count($tests) . ' tests, ' . count($failures) . ' failures' . PHP_EOL;
exit($failures === [] ? 0 : 1);
