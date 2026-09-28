<?php if (!isset($authenticated) || !$authenticated) { http_response_code(404); exit; } ?>
<header class="page-heading"><div><h1>Alerts</h1><p>Review the reason, make changes, and request a re-scan.</p></div></header>
<a href="?page=notifications">Back to notifications</a>
<section data-seller-alert-detail aria-live="polite"><p>Loading alerts…</p></section>
