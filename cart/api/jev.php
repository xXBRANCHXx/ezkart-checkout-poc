<?php
http_response_code(410);
header('Content-Type: application/json');
header('Cache-Control: no-store');
echo json_encode(['ok'=>false,'error'=>'Page review operations have moved to Ezkart Executive.']);
