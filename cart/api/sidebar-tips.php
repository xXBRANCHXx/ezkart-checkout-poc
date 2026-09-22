<?php
declare(strict_types=1);
require_once __DIR__ . '/executive-bridge.php';

// Dates are merchant-local calendar dates, with an exclusive end at midnight.
function ez_tips_default(): array
{
    return ['icon' => 'globe', 'title' => 'Launch on your own domain',
        'description' => 'Hosted pages, checkout, payments & shipping.',
        'label' => 'Manage Landing Pages', 'href' => '?page=sites'];
}
function ez_tips_icons(): array { return ['globe', 'sparkles', 'rocket', 'box', 'store', 'chart', 'link', 'help', 'star', 'truck']; }
function ez_tips_date(mixed $value): string
{
    if (!is_string($value)) throw new InvalidArgumentException('Choose a calendar date.');
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('UTC'));
    if (!$date || $date->format('Y-m-d') !== $value) throw new InvalidArgumentException('Choose a valid calendar date.');
    return $value;
}
function ez_tips_add_days(string $date, int $days): string
{
    return (new DateTimeImmutable($date, new DateTimeZone('UTC')))->modify('+' . $days . ' days')->format('Y-m-d');
}
function ez_tips_card(array $input): array
{
    $card = [];
    foreach (['title' => 70, 'description' => 160, 'label' => 32, 'href' => 500, 'icon' => 20] as $key => $limit) {
        $value = $input[$key] ?? '';
        if (!is_string($value) || !preg_match('//u', $value)) throw new InvalidArgumentException('Use valid text for ' . $key . '.');
        $value = trim($value);
        $length = preg_match_all('/./us', $value);
        if ($value === '' || $length > $limit || preg_match('/[\x00-\x1f\x7f]/u', $value)) throw new InvalidArgumentException(ucfirst($key) . ' is required and must be at most ' . $limit . ' characters, on one line.');
        $card[$key] = $value;
    }
    if (!in_array($card['icon'], ez_tips_icons(), true)) throw new InvalidArgumentException('Choose one of the available icons.');
    // Only merchant navigation or HTTPS links. No script, protocol-relative, or logout URLs.
    $href = $card['href'];
    $internal = preg_match('/^\?page=(dashboard|orders|products|customers|payments|wallet|settings|sites|shop|reviews)$/D', $href);
    $url = parse_url($href);
    $external = filter_var($href, FILTER_VALIDATE_URL) && is_array($url) && ($url['scheme'] ?? '') === 'https' && !isset($url['user']) && !isset($url['pass']) && !str_contains($href, '\\');
    if (!$internal && !$external) throw new InvalidArgumentException('Use a merchant page such as ?page=products, or a full https:// link.');
    return $card;
}
function ez_tips_read(): array
{
    $path = ez_executive_directory() . '/sidebar-tips.json';
    if (!is_file($path)) return ['revision' => 0, 'cadence_days' => 1, 'fallback' => ez_tips_default(), 'tips' => []];
    if (filesize($path) > 2000000) throw new RuntimeException('Tip schedule is too large.');
    $state = json_decode((string) file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($state) || !is_int($state['revision'] ?? null) || !in_array($state['cadence_days'] ?? null, [1, 3, 7], true) || !is_array($state['fallback'] ?? null) || !is_array($state['tips'] ?? null) || count($state['tips']) > 500) throw new RuntimeException('Invalid tip schedule.');
    $state['fallback'] = ez_tips_card($state['fallback']);
    $previousEnd = ''; $ids = [];
    foreach ($state['tips'] as &$tip) {
        if (!is_array($tip) || !preg_match('/^[a-f0-9]{24}$/D', (string) ($tip['id'] ?? '')) || isset($ids[$tip['id']])) throw new RuntimeException('Invalid scheduled tip.');
        $ids[$tip['id']] = true;
        $start = ez_tips_date($tip['start_date'] ?? null); $end = ez_tips_date($tip['end_date'] ?? null);
        if ($end <= $start || $start < $previousEnd) throw new RuntimeException('Invalid tip dates.');
        $previousEnd = $end;
        $tip = ['id' => $tip['id'], 'start_date' => $start, 'end_date' => $end] + ez_tips_card($tip);
    }
    unset($tip);
    return $state;
}
function ez_tips_current(array $state, string $date): array
{
    foreach ($state['tips'] as $tip) if ($tip['start_date'] <= $date && $date < $tip['end_date']) return ['source' => 'scheduled', 'card' => ez_tips_card($tip)];
    return ['source' => 'fallback', 'card' => $state['fallback']];
}
function ez_tips_local_date(string $timezone, ?DateTimeImmutable $now = null): string
{
    if (strlen($timezone) > 80 || !in_array($timezone, DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC), true)) $timezone = 'UTC';
    return ($now ?? new DateTimeImmutable('now'))->setTimezone(new DateTimeZone($timezone))->format('Y-m-d');
}
function ez_tips_change(array $input): array
{
    $directory = ez_executive_directory();
    $old = umask(0077); $lock = fopen($directory . '/sidebar-tips.lock', 'c'); umask($old);
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Tip schedule is busy.');
    try {
        $state = ez_tips_read();
        if (($input['revision'] ?? null) !== $state['revision']) throw new DomainException('Tips changed in another tab. Refresh the schedule before saving again.');
        $operation = $input['operation'] ?? '';
        if ($operation === 'cadence') {
            if (!in_array($input['cadence_days'] ?? null, [1, 3, 7], true)) throw new InvalidArgumentException('Choose daily, every 3 days, or weekly.');
            $state['cadence_days'] = $input['cadence_days'];
        } elseif ($operation === 'fallback') {
            if (!is_array($input['card'] ?? null)) throw new InvalidArgumentException('Enter a fallback tip.');
            $state['fallback'] = ez_tips_card($input['card']);
        } elseif ($operation === 'save' || $operation === 'remove') {
            $id = $input['id'] ?? ''; $existing = null;
            if (!is_string($id)) throw new InvalidArgumentException('Invalid tip ID.');
            foreach ($state['tips'] as $tip) if ($tip['id'] === $id) $existing = $tip;
            if ($id !== '' && !$existing) throw new InvalidArgumentException('This tip no longer exists. Refresh the schedule.');
            if ($operation === 'remove' && !$existing) throw new InvalidArgumentException('Choose a tip to remove.');
            $state['tips'] = array_values(array_filter($state['tips'], static fn($tip) => $tip['id'] !== $id));
            if ($operation === 'save') {
                if (count($state['tips']) >= 500) throw new InvalidArgumentException('The schedule is full. Remove older tips first.');
                if (!is_array($input['card'] ?? null)) throw new InvalidArgumentException('Enter a tip.');
                $start = ez_tips_date($input['start_date'] ?? null);
                // The earliest date currently in use anywhere, including UTC-12.
                $earliest = (new DateTimeImmutable('now', new DateTimeZone('Etc/GMT+12')))->format('Y-m-d');
                if ($start < $earliest && (!$existing || $existing['start_date'] !== $start)) throw new InvalidArgumentException('Choose today or a future date.');
                $end = $existing && $existing['start_date'] === $start ? $existing['end_date'] : ez_tips_add_days($start, $state['cadence_days']);
                foreach ($state['tips'] as $tip) if ($start < $tip['end_date'] && $end > $tip['start_date']) throw new InvalidArgumentException('Those dates already have a tip. Choose an empty slot.');
                $state['tips'][] = ['id' => $id ?: bin2hex(random_bytes(12)), 'start_date' => $start, 'end_date' => $end] + ez_tips_card($input['card']);
                usort($state['tips'], static fn($a, $b) => strcmp($a['start_date'], $b['start_date']));
            }
        } else { throw new InvalidArgumentException('Unknown tip action.'); }
        $state['revision']++;
        $temporary = tempnam($directory, '.tips-');
        if ($temporary === false) throw new RuntimeException('Could not save tips.');
        chmod($temporary, 0600);
        try {
            $json = json_encode($state, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if (file_put_contents($temporary, $json, LOCK_EX) === false || !rename($temporary, $directory . '/sidebar-tips.json')) throw new RuntimeException('Could not save tips.');
        } finally { if (is_file($temporary)) unlink($temporary); }
        return $state;
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}
