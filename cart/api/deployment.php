<?php
declare(strict_types=1);

/** Hosting identity and provider mode are separate for the live workbench beta. */
function ez_deployment_profile(?string $deployment = null): array
{
    $deployment ??= strtolower(ez_config('deployment_environment'));
    return match ($deployment) {
        'test' => ['environment' => 'test', 'commerce_environment' => 'sandbox', 'origin' => 'https://test.ezkart.id'],
        'beta' => ['environment' => 'beta', 'commerce_environment' => 'production', 'origin' => 'https://test.ezkart.id'],
        'production' => ['environment' => 'production', 'commerce_environment' => 'production', 'origin' => 'https://ezkart.id'],
        default => throw new RuntimeException('deployment_environment must be test, beta or production.'),
    };
}
