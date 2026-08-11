<?php
declare(strict_types=1);

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; img-src data: https:; media-src data: https:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' https:; font-src data: https:; connect-src https:; form-action https:; frame-ancestors 'self'; base-uri 'none'; sandbox allow-scripts allow-forms");
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Custom code preview</title>
  <style>html,body{height:100%}body{margin:0;font-family:Poppins,Arial,sans-serif;color:#24262b}*{box-sizing:border-box}</style>
</head>
<body>
  <script>
    addEventListener('message', function (event) {
      if (!event.data || event.data.type !== 'ezkart-render-code' || typeof event.data.html !== 'string') return;
      document.open();
      document.write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{min-height:100%}body{margin:0;font-family:Poppins,Arial,sans-serif;color:#24262b}*{box-sizing:border-box}</style></head><body>' + event.data.html + '</body></html>');
      document.close();
    });
    parent.postMessage({ type: 'ezkart-code-preview-ready' }, '*');
  </script>
</body>
</html>
