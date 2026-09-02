<?php
declare(strict_types=1);

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; img-src 'self' data: https:; media-src data: https:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' https:; font-src 'self' data: https:; connect-src 'self' https:; form-action 'self' https:; frame-ancestors 'self'; base-uri 'none'; sandbox allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation");
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Landing page preview</title>
  <style>html,body{height:100%}body{margin:0;display:grid;place-items:center;background:#fff;font:14px system-ui;color:#59616c}</style>
</head>
<body>
  <p>Preparing production preview…</p>
  <script>
    const maximumPreviewCharacters = 16_000_000;
    addEventListener('message', function (event) {
      if (event.source !== parent || !event.data || event.data.type !== 'ezkart-render-page' || typeof event.data.html !== 'string') return;
      if (event.data.html.length > maximumPreviewCharacters) {
        document.body.innerHTML = '<p>This landing page is too large to preview. Reduce embedded media and try again.</p>';
        return;
      }
      document.open();
      document.write(event.data.html);
      document.close();
    });
    parent.postMessage({ type: 'ezkart-page-preview-ready' }, '*');
  </script>
</body>
</html>
