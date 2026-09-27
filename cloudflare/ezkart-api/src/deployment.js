const profiles = Object.freeze({
  test: Object.freeze({environment: 'test', commerceEnvironment: 'sandbox', origin: 'https://test.ezkart.id'}),
  beta: Object.freeze({environment: 'beta', commerceEnvironment: 'production', origin: 'https://test.ezkart.id'}),
  production: Object.freeze({environment: 'production', commerceEnvironment: 'production', origin: 'https://ezkart.id'}),
});

// A beta request has its own service signature and storage bindings, while its
// provider mode is production and its customer links stay on the workbench.
export function deploymentProfile(env) {
  const key = env?.APP_ENVIRONMENT;
  return typeof key === 'string' && Object.hasOwn(profiles, key) ? profiles[key] : null;
}
