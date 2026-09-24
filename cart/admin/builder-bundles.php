<?php
declare(strict_types=1);

// The manifest contains only public, checked-in assets. No request supplies paths.
function ez_builder_bundle_files(string $bundle): array
{
    static $manifest;
    $manifest ??= json_decode((string) file_get_contents(__DIR__ . '/builder-bundles.json'), true, 512, JSON_THROW_ON_ERROR);
    return $manifest[$bundle] ?? [];
}

function ez_builder_bundle_version(string $bundle): string
{
    $files = array_merge(['builder-bundles.json', 'builder-bundles.php', 'builder-bundle.php'], ez_builder_bundle_files($bundle));
    return substr(hash('sha256', implode('|', array_map(static fn($file) => $file . ':' . filemtime(__DIR__ . '/' . $file) . ':' . filesize(__DIR__ . '/' . $file), $files))), 0, 20);
}

function ez_builder_bundle_url(string $bundle): string
{
    $version = ez_builder_bundle_version($bundle);
    [$name, $extension] = explode('.', $bundle, 2);
    $file = 'builder-cache-' . $name . '-' . $version . '.' . $extension;
    $path = __DIR__ . '/' . $file;
    // Serve a fingerprinted static asset so the host can cache and precompress
    // it normally. Generate atomically; a read-only checkout uses the endpoint.
    if (!is_file($path) && is_writable(__DIR__)) {
        $temporary = tempnam(__DIR__, '.builder-cache-');
        if ($temporary !== false) {
            $contents = ez_builder_bundle_contents($bundle);
            if (file_put_contents($temporary, $contents, LOCK_EX) === strlen($contents)) {
                chmod($temporary, 0644);
                if (!@rename($temporary, $path)) @unlink($temporary);
            } else @unlink($temporary);
        }
    }
    return is_file($path) ? $file : 'builder-bundle.php?bundle=' . rawurlencode($bundle) . '&v=' . $version;
}

function ez_builder_bundle_contents(string $bundle): string
{
    $javascript = str_ends_with($bundle, '.js');
    $parts = [];
    foreach (ez_builder_bundle_files($bundle) as $file) {
        $source = file_get_contents(__DIR__ . '/' . $file);
        if ($source === false) throw new RuntimeException('Builder asset unavailable');
        // Font faces are included directly in the CSS manifest, avoiding an
        // extra request and an invalid @import after concatenated CSS rules.
        if ($file === 'builder-fonts.css') $source = preg_replace('/^@import[^;]+;\s*/', '', $source);
        // An always-active group lets isolated asset cards reuse only the native
        // primitives from the combined sheet, without importing admin styling.
        if ($file === 'builder-native.css') $source = "@media all {\n" . $source . "\n}";
        $parts[] = '/* ' . $file . " */\n" . $source;
    }
    return implode($javascript ? "\n;\n" : "\n", $parts);
}
