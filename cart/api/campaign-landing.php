<?php
declare(strict_types=1);
require_once __DIR__ . '/commerce-client.php';
function ez_campaign_landing_visit(string $path): void
{
    $source = $_GET['ez_source'] ?? null;
    if (!is_string($source) || preg_match('/^[a-f0-9]{64}$/D', $source) !== 1) return;
    $visitor = $_COOKIE['ez_campaign_visitor'] ?? '';
    if (!is_string($visitor) || preg_match('/^[a-f0-9]{64}$/D', $visitor) !== 1) $visitor = bin2hex(random_bytes(32));
    setcookie('ez_campaign_visitor', $visitor, ['expires'=>time()+31536000,'path'=>'/','secure'=>true,'httponly'=>true,'samesite'=>'Lax']);
    $visit = null;
    try {
        $agent = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
        $referrer = parse_url((string) ($_SERVER['HTTP_REFERER'] ?? ''), PHP_URL_HOST);
        $data = ez_commerce_request('POST', '/internal/commerce/tracking/visit', ['source'=>$source,'visitor'=>$visitor,'path'=>$path,
            'dimensions'=>['device'=>preg_match('/Mobile|Android|iPhone/i', $agent) ? 'mobile' : 'desktop',
                'browser'=>preg_match('/Firefox/i', $agent) ? 'Firefox' : (preg_match('/Chrome/i', $agent) ? 'Chrome' : (preg_match('/Safari/i', $agent) ? 'Safari' : 'other')),
                'language'=>substr((string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? ''),0,120),'referrerHost'=>is_string($referrer)?$referrer:'',
                'utmSource'=>is_string($_GET['utm_source']??null)?substr($_GET['utm_source'],0,120):'',
                'utmMedium'=>is_string($_GET['utm_medium']??null)?substr($_GET['utm_medium'],0,120):'',
                'utmCampaign'=>is_string($_GET['utm_campaign']??null)?substr($_GET['utm_campaign'],0,120):'']]);
        if (is_string($data['visit'] ?? null) && preg_match('/^[a-f0-9]{64}$/D', $data['visit']) === 1) $visit=$data['visit'];
    } catch (Throwable) { error_log('Campaign measurement unavailable; serving landing page.'); }
    header('Location: ' . $path . ($visit ? '?tracking_visit=' . $visit : ''), true, 302);
    exit;
}
