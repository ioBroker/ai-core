/**
 * `@iobroker/ai-core` - the AI backend shared by admin, javascript and vis-2.
 *
 * - `shared/*`: types, sendTo protocol, tool loop, helpers - also usable in the browser via
 *   `@iobroker/ai-core/build/shared`
 * - `node/*`: talking to the providers, the settings of an adapter, the credential store and the
 *   sendTo handler `AiBackend`
 */
export * from './shared';
export * from './node/http';
export * from './node/providers';
export * from './node/settings';
export * from './node/credentials';
export * from './node/AiBackend';
