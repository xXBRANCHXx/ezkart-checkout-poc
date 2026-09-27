<?php
if (!isset($authenticated) || !$authenticated) { http_response_code(404); exit; }
$refundAudience='merchant'; $refundOrderId=''; $refundAccount=(string) ($adminUser['id'] ?? ''); $refundStore=$sellerId; $refundCsrf=$csrfToken; $refundVersion='';
?>
<div class="page-heading"><div><a href="?page=orders">← Orders</a><h1>Refunds</h1><p>Review buyer requests against their original purchases.</p></div></div>
<?php require dirname(__DIR__) . '/refunds-workspace.php'; ?>
