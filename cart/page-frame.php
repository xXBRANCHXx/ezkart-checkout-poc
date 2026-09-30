<?php
declare(strict_types=1);

function ez_landing_page_frame(string $html): string
{
    // Hostinger can replace CSP response headers. The iframe's sandbox must
    // therefore enforce isolation independently of headers on the outer page.
    $title = 'Landing page';
    if (preg_match('#<title\b[^>]*>(.*?)</title>#is', $html, $match) === 1) {
        $title = html_entity_decode(strip_tags($match[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    // Older saved exports used location.href for the checkout return link.
    // A srcdoc document inherits the durable outer URL through document.baseURI.
    $html = str_replace('return:location.href}', "return:(location.href==='about:srcdoc'?document.baseURI:location.href)}", $html);
    $escape = static fn(string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    $metadata = '';
    $language = preg_match('#<html\b[^>]*\blang="([a-z0-9-]+)"#i', $html, $match) === 1 ? $match[1] : 'en';
    if (preg_match('#<meta\s+name="description"\s+content="([^"]*)"#i', $html, $match) === 1) {
        $metadata .= '<meta name="description" content="' . $escape(html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, 'UTF-8')) . '">';
    }
    // Copy only the builder's validated PNG icons, never authored head scripts.
    if (preg_match('#<link\b[^>]*\bdata-ezkart-favicon\b[^>]*>#i', $html, $icon) === 1) {
        $light = preg_match('#\bdata-light="(data:image/png;base64,[a-z0-9+/=]+)"#i', $icon[0], $match) === 1 ? $match[1] : '';
        $dark = preg_match('#\bdata-dark="(data:image/png;base64,[a-z0-9+/=]+)"#i', $icon[0], $match) === 1 ? $match[1] : $light;
        $light = $light !== '' ? $light : $dark;
        foreach (['light' => $light, 'dark' => $dark] as $mode => $source) {
            if ($source !== '') $metadata .= '<link rel="icon" type="image/png" sizes="128x128" media="(prefers-color-scheme: ' . $mode . ')" href="' . $escape($source) . '">';
        }
    }
    // Embed only the trusted player source; opaque nested shells cannot load ESM.
    $player = str_replace('export function mountLandingMediaPlayer', 'function mountLandingMediaPlayer', (string) file_get_contents(__DIR__ . '/landing-media-player.js'));
    return '<!doctype html><html lang="' . $escape($language) . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
        . $escape($title)
        . '</title>' . $metadata . '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe[data-hosted-page]{display:block;width:100%;height:100%;border:0}</style></head><body><iframe data-hosted-page allowfullscreen title="'
        . $escape($title)
        . '" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" srcdoc="'
        . $escape($html) . '"></iframe><script>' . $player . '</script></body></html>';
}
