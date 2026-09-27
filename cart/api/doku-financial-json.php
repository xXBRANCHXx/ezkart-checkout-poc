<?php
declare(strict_types=1);

/** Keep the exact JSON number spelling until the financial field validates it. */
final class EzDokuJsonNumber
{
    public function __construct(public readonly string $value) {}
}

/** Bounded JSON reader: no floating-point conversion or duplicate object keys. */
final class EzDokuFinancialJson
{
    private int $position = 0;
    private function __construct(private readonly string $source) {}

    public static function decode(string $source): stdClass
    {
        if (strlen($source) > 2000000) throw new UnexpectedValueException('Provider JSON exceeds the response limit.');
        $reader = new self($source);
        $value = $reader->value(0);
        $reader->space();
        if (!$value instanceof stdClass || $reader->position !== strlen($source)) self::invalid();
        return $value;
    }

    /** Remove JSON whitespace only, preserving signed string/number spelling. */
    public static function minify(string $source): string
    {
        self::decode($source);
        $result = ''; $quoted = false; $escaped = false;
        for ($i = 0, $length = strlen($source); $i < $length; $i++) {
            $character = $source[$i];
            if ($quoted) {
                $result .= $character;
                if ($escaped) $escaped = false;
                elseif ($character === '\\') $escaped = true;
                elseif ($character === '"') $quoted = false;
            } elseif (!str_contains(" \t\r\n", $character)) {
                $result .= $character;
                if ($character === '"') $quoted = true;
            }
        }
        return $result;
    }

    private static function invalid(): never { throw new UnexpectedValueException('Provider JSON is invalid or ambiguous.'); }
    private function space(): void
    {
        while (isset($this->source[$this->position]) && str_contains(" \t\r\n", $this->source[$this->position])) $this->position++;
    }
    private function string(): string
    {
        $start = $this->position++;
        $escaped = false;
        while (isset($this->source[$this->position])) {
            $character = $this->source[$this->position++];
            if ($escaped) { $escaped = false; continue; }
            if ($character === '\\') { $escaped = true; continue; }
            if ($character !== '"') continue;
            try { return json_decode(substr($this->source, $start, $this->position - $start), true, 2, JSON_THROW_ON_ERROR); }
            catch (JsonException) { self::invalid(); }
        }
        self::invalid();
    }
    private function value(int $depth): mixed
    {
        if ($depth > 32) self::invalid();
        $this->space();
        $character = $this->source[$this->position] ?? '';
        if ($character === '"') return $this->string();
        if ($character === '{' || $character === '[') {
            $object = $character === '{';
            $end = $object ? '}' : ']';
            $result = $object ? new stdClass() : [];
            $this->position++; $this->space();
            if (($this->source[$this->position] ?? '') === $end) { $this->position++; return $result; }
            while (true) {
                $this->space();
                if ($object) {
                    if (($this->source[$this->position] ?? '') !== '"') self::invalid();
                    $key = $this->string(); $this->space();
                    if (str_contains($key, "\0") || property_exists($result, $key) || ($this->source[$this->position++] ?? '') !== ':') self::invalid();
                    $result->{$key} = $this->value($depth + 1);
                } else $result[] = $this->value($depth + 1);
                $this->space(); $next = $this->source[$this->position++] ?? '';
                if ($next === $end) return $result;
                if ($next !== ',') self::invalid();
            }
        }
        foreach (['true' => true, 'false' => false, 'null' => null] as $token => $value) {
            if (substr($this->source, $this->position, strlen($token)) === $token) { $this->position += strlen($token); return $value; }
        }
        if (preg_match('/\G-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/', $this->source, $matches, 0, $this->position) === 1) {
            $this->position += strlen($matches[0]);
            return new EzDokuJsonNumber($matches[0]);
        }
        self::invalid();
    }
}
