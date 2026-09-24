<?php
// PHP's development server has no mod_rewrite. Match the narrow production
// .htaccess route here; hosted checks separately verify the real rewrite rule.
$path = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#^/[a-z0-9]+(?:-[a-z0-9]+)*/shop/[a-z0-9]+(?:-[a-z0-9]+)*(?:/preview)?/?$#D', $path) === 1) {
    require dirname(__DIR__, 2) . '/cart/page-route.php';
    return true;
}
return false;
