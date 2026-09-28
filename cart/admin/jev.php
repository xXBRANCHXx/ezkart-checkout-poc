<?php
declare(strict_types=1);
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { http_response_code(410); exit('Open the original request in Ezkart Executive before continuing.'); }
$target=['operations'=>'jev'];
if(preg_match('/^jev_[a-f0-9]{32}$/D',(string)($_GET['review']??'')))$target['review']=$_GET['review'];
header('Location: https://admin.ezkart.id/?'.http_build_query($target).'#operations',true,302);
exit;
