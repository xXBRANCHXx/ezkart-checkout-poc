<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/doku-financial-observation.php';

/** Private sandbox evidence only. This command has no database or money writes. */
function ez_doku_observation_main(array $arguments, ?Closure $readerFactory = null): int
{
    $file = null; $count = 0;
    try {
        $allowed = ['environment', 'profile', 'from', 'to', 'max-pages', 'output']; $input = [];
        foreach ($arguments as $argument) {
            if (preg_match('/^--([a-z-]+)=(.+)$/sD', $argument, $match) !== 1 || !in_array($match[1], $allowed, true) || isset($input[$match[1]])) throw new InvalidArgumentException('Use each named argument once.');
            $input[$match[1]] = $match[2];
        }
        foreach (['environment', 'profile', 'from', 'to', 'output'] as $key) if (!isset($input[$key])) throw new InvalidArgumentException('Required: --environment=sandbox --profile=ID --from=ISO8601 --to=ISO8601 --output=/private/path.jsonl [--max-pages=10].');
        if ($input['environment'] !== 'sandbox') throw new InvalidArgumentException('This workbench evidence command accepts sandbox only.');
        $pages = $input['max-pages'] ?? '10';
        if (preg_match('/^[1-9][0-9]?$/D', $pages) !== 1 || (int) $pages > 40) throw new InvalidArgumentException('Page budget must be between 1 and 40 per account.');
        if (!str_starts_with($input['output'], '/') || !str_ends_with($input['output'], '.jsonl') || str_contains($input['output'], "\0")) throw new InvalidArgumentException('Output must be an absolute private .jsonl path.');
        $parent = realpath(dirname($input['output'])); $repository = realpath(dirname(__DIR__, 2));
        if ($parent === false || !is_dir($parent) || $parent === $repository || str_starts_with($parent . '/', $repository . '/')
            || preg_match('~/(?:public_html|htdocs|www|wwwroot|public)(?:/|$)~i', $parent)
            || (fileperms($parent) & 0077) !== 0) throw new InvalidArgumentException('Use an existing private directory outside the repository, with mode 0700.');
        $target = $parent . '/' . basename($input['output']);
        if (file_exists($target) || is_link($target)) throw new InvalidArgumentException('Output already exists. Choose a new evidence file.');
        // Argument failures must never get as far as token generation or a provider read.
        if (preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{1,21}$/D', $input['profile']) !== 1) throw new InvalidArgumentException('Profile ID is invalid.');
        EzDokuSubAccountReader::window($input['from'], $input['to']);
        $reader = $readerFactory === null ? EzDokuSubAccountReader::configured('sandbox') : $readerFactory();
        umask(0077); $file = @fopen($target, 'xb');
        if ($file === false) throw new RuntimeException('Cannot create private evidence output.');
        $write = static function (array $row) use ($file): void {
            $line = json_encode($row, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
            if (fwrite($file, $line) !== strlen($line) || !fflush($file) || !fsync($file)) throw new RuntimeException('Cannot persist provider evidence.');
        };
        $write(['kind' => 'started', 'version' => 1, 'environment' => 'sandbox', 'credentialFingerprint' => $reader->credentialFingerprint,
            'profileId' => $input['profile'], 'from' => $input['from'], 'to' => $input['to'], 'maxPagesPerAccount' => (int) $pages, 'startedAt' => gmdate('c')]);
        $report = ez_observe_doku_financial_window($reader, $input['profile'], $input['from'], $input['to'], (int) $pages,
            static function (string $kind, array $response) use ($write, &$count): void {
                $write(['kind' => $kind, 'sequence' => ++$count, ...$response]);
            });
        $write(['kind' => 'finished', 'observedAt' => gmdate('c'), 'responses' => $count, ...$report]);
        echo json_encode(['ok' => true, 'output' => $target, 'responses' => $count, ...$report], JSON_THROW_ON_ERROR) . "\n";
        return $report['pagesExhausted'] ? 0 : 2;
    } catch (Throwable $error) {
        $reason = $error instanceof EzDokuReadException ? $error->reason : ($error instanceof InvalidArgumentException ? $error->getMessage() : 'Observation did not finish.');
        if (is_resource($file)) {
            @fwrite($file, json_encode(['kind' => 'failed', 'reason' => $reason, 'responses' => $count], JSON_THROW_ON_ERROR) . "\n"); @fflush($file); @fsync($file);
        }
        fwrite(STDERR, json_encode(['ok' => false, 'error' => $reason], JSON_THROW_ON_ERROR) . "\n");
        return 1;
    } finally { if (is_resource($file)) fclose($file); }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) exit(ez_doku_observation_main(array_slice($argv, 1)));
