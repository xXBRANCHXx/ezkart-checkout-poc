<?php
declare(strict_types=1);

final class EzLegacyOrderStorageException extends RuntimeException {}

function ez_legacy_storage_assert_routing(string $environment): void
{
    if (ez_legacy_storage_state($environment)['mode'] !== 'legacy') {
        throw new EzLegacyOrderStorageException('Order processing is temporarily paused. Retry shortly.');
    }
}

function ez_legacy_provider_lease(string $environment): ?EzLegacyOrderLease
{
    if (ez_config('commerce_storage') !== 'd1') return EzLegacyOrderLease::acquire($environment);
    ez_legacy_storage_assert_routing($environment);
    return null;
}

function ez_legacy_storage_state(string $environment, ?string $directory = null): array
{
    $directory ??= ez_order_directory($environment, false);
    $path = $directory . '/.commerce-storage.state';
    clearstatcache(true, $path);
    if (!file_exists($path) && !is_link($path)) return [
        'format' => 'ezkart-legacy-storage-v1', 'environment' => $environment,
        'mode' => 'legacy', 'revision' => 0, 'epoch' => '', 'operations' => [],
    ];
    if (is_link($path) || !is_file($path) || filesize($path) > 1000000) throw new EzLegacyOrderStorageException('Order storage control is unavailable.');
    $state = json_decode((string) file_get_contents($path), true);
    if (!is_array($state) || ($state['format'] ?? '') !== 'ezkart-legacy-storage-v1'
        || ($state['environment'] ?? '') !== $environment || !in_array($state['mode'] ?? '', ['legacy', 'draining', 'frozen'], true)
        || !is_int($state['revision'] ?? null) || $state['revision'] < 0 || !is_array($state['operations'] ?? null)
        || !is_string($state['epoch'] ?? null) || ($state['epoch'] !== '' && !preg_match('/^[a-f0-9]{32}$/D', $state['epoch']))
        || ($state['mode'] !== 'legacy' && $state['epoch'] === '') || ($state['mode'] === 'legacy' && $state['epoch'] !== '')) {
        throw new EzLegacyOrderStorageException('Order storage control is invalid.');
    }
    return $state;
}

/** @return resource */
function ez_legacy_storage_lock_file(string $path)
{
    clearstatcache(true, $path);
    if (is_link($path) || (file_exists($path) && !is_file($path))) throw new EzLegacyOrderStorageException('Order storage lock is unavailable.');
    $mask = umask(0077);
    try { $handle = @fopen($path, 'c'); } finally { umask($mask); }
    if ($handle === false) throw new EzLegacyOrderStorageException('Order storage lock is unavailable.');
    if (!chmod($path, 0600)) { fclose($handle); throw new EzLegacyOrderStorageException('Order storage lock could not be secured.'); }
    return $handle;
}

/**
 * A lease spans the complete legacy operation, including provider calls made
 * outside an individual order lock. The controller stops new leases, then waits
 * for existing ones to finish before exporting. Nested saves share the lease.
 */
final class EzLegacyOrderLease
{
    private static array $active = [];
    private static array $orderLocks = [];
    private bool $released = false;

    private function __construct(private readonly string $directory) {}

    public static function acquire(string $environment): self
    {
        if (ez_config('commerce_storage') === 'd1') throw new EzLegacyOrderStorageException('Legacy order writes are disabled for central commerce.');
        $directory = realpath(ez_order_directory($environment));
        if ($directory === false) throw new EzLegacyOrderStorageException('Order storage is unavailable.');
        if (isset(self::$active[$directory])) {
            self::$active[$directory]['depth']++;
            return new self($directory);
        }
        $handle = ez_legacy_storage_lock_file($directory . '/.commerce-writers.lock');
        try {
            if (!flock($handle, LOCK_SH | LOCK_NB)) throw new EzLegacyOrderStorageException('Order processing is temporarily paused. Retry shortly.');
            $state = ez_legacy_storage_state($environment, $directory);
            if ($state['mode'] !== 'legacy') throw new EzLegacyOrderStorageException('Order processing is temporarily paused. Retry shortly.');
            self::$active[$directory] = ['handle' => $handle, 'depth' => 1];
        } catch (Throwable $error) {
            flock($handle, LOCK_UN); fclose($handle); throw $error;
        }
        return new self($directory);
    }

    /** @param resource $handle */
    public static function attachOrderLock($handle, self $lease): void
    {
        self::$orderLocks[(int) $handle] = $lease;
    }

    /** @param resource $handle */
    public static function releaseOrderLock($handle): void
    {
        $id = (int) $handle;
        $lease = self::$orderLocks[$id] ?? null;
        unset(self::$orderLocks[$id]);
        $lease?->release();
    }

    public function release(): void
    {
        if ($this->released) return;
        $this->released = true;
        if (--self::$active[$this->directory]['depth'] === 0) {
            $handle = self::$active[$this->directory]['handle'];
            unset(self::$active[$this->directory]);
            flock($handle, LOCK_UN); fclose($handle);
        }
    }

    public function __destruct() { $this->release(); }
}
