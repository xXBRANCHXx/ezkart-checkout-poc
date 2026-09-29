<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/commerce-client.php';
header('Cache-Control: no-store');
// Authored landing pages have an opaque sandbox origin. No cookies or credentials are accepted.
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); exit('{"ok":false}'); }
$raw = file_get_contents('php://input', false, null, 0, 5001);
$input = is_string($raw) && strlen($raw) <= 5000 ? json_decode($raw, true) : null;
if (!is_array($input)) { http_response_code(422); exit('{"ok":false}'); }
try { $data = ez_commerce_request('POST', '/internal/commerce/tracking/event', $input); echo json_encode(['ok'=>true,'recorded'=>$data['recorded'] ?? false]); }
catch (Throwable) { http_response_code(503); echo '{"ok":false}'; }
