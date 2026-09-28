<?php
declare(strict_types=1);
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { http_response_code(410); exit('Open the original request in Ezkart Executive before continuing.'); }
$target=['operations'=>'treasury'];
if(preg_match('/^try_[a-f0-9]{40}$/D',(string)($_GET['intent']??'')))$target['intent']=$_GET['intent'];
header('Location: https://admin.ezkart.id/?'.http_build_query($target).'#operations',true,302);
exit;
