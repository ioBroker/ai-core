"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYSTEM_AI_OBJECT_ID = void 0;
exports.readAiSettings = readAiSettings;
exports.systemAiSettings = systemAiSettings;
exports.readSystemAiSettings = readSystemAiSettings;
exports.baseUrlOf = baseUrlOf;
exports.isProviderConfigured = isProviderConfigured;
exports.listAvailableProviders = listAvailableProviders;
exports.resolveTestEndpoint = resolveTestEndpoint;
/**
 * Where an adapter keeps its AI settings, and what may be taken from where.
 *
 * Every adapter names its `native` fields differently (`gptKey` in javascript, `aiOpenAiKey` in
 * vis-2), so the adapter describes its fields once ({@link AiNativeFields}) and everything else works
 * on the normalized {@link AiSettings}. The system-wide settings of `system.ai` are read into the
 * same shape ({@link readSystemAiSettings}).
 *
 * The one rule behind all of it: endpoint and key come from the configuration, never from a message.
 * The key travels with the request as its authorization - a caller who could name the address could
 * have the adapter carry the key to a host of their own.
 */
const limits_1 = require("../shared/limits");
const types_1 = require("../shared/types");
const REASONING_EFFORTS = ['', 'none', 'minimal', 'low', 'medium', 'high'];
function text(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}
function effortOf(value) {
    const effort = text(value);
    return REASONING_EFFORTS.includes(effort) ? effort : '';
}
/**
 * The AI settings out of the `native` of an adapter
 *
 * @param native the configuration of the instance (`this.config`)
 * @param fields what the fields are called in this adapter
 */
function readAiSettings(native, fields) {
    const cfg = native || {};
    const keys = {};
    const credentialIds = {};
    for (const provider of types_1.AI_PROVIDERS) {
        const keyField = fields.keys[provider];
        if (keyField && text(cfg[keyField])) {
            keys[provider] = text(cfg[keyField]);
        }
        const idField = fields.credentialIds?.[provider];
        if (idField && text(cfg[idField])) {
            credentialIds[provider] = text(cfg[idField]);
        }
    }
    return {
        credentialType: fields.credentialType && text(cfg[fields.credentialType]) === 'manager' ? 'manager' : 'manual',
        keys,
        credentialIds,
        customBaseUrl: text(cfg[fields.customBaseUrl]),
        allowSelfSignedCerts: fields.allowSelfSignedCerts ? cfg[fields.allowSelfSignedCerts] === true : false,
        maxTokens: (0, limits_1.resolveMaxTokens)(fields.maxTokens ? cfg[fields.maxTokens] : undefined),
        reasoningEffort: fields.reasoningEffort ? effortOf(cfg[fields.reasoningEffort]) : '',
    };
}
/** ID of the object with the system-wide assistant settings */
exports.SYSTEM_AI_OBJECT_ID = 'system.ai';
/**
 * The system-wide settings of `system.ai` in the normalized shape. They know one provider with one
 * credential - always from the credential store
 *
 * @param native the `native` of `system.ai`
 */
function systemAiSettings(native) {
    const cfg = native || {};
    const provider = types_1.AI_PROVIDERS.includes(cfg.provider) ? cfg.provider : undefined;
    return {
        credentialType: 'manager',
        keys: {},
        credentialIds: provider && text(cfg.credentialId) ? { [provider]: text(cfg.credentialId) } : {},
        customBaseUrl: provider === 'custom' ? text(cfg.baseUrl) : '',
        allowSelfSignedCerts: cfg.allowSelfSignedCerts === true,
        maxTokens: (0, limits_1.resolveMaxTokens)(cfg.maxTokens),
        reasoningEffort: effortOf(cfg.reasoningEffort),
        ...(provider ? { defaultProvider: provider } : {}),
        ...(text(cfg.model) ? { defaultModel: text(cfg.model) } : {}),
    };
}
/**
 * Read `system.ai`. A missing object (or one the adapter may not read) gives empty settings
 *
 * @param adapter the adapter that reads it
 */
async function readSystemAiSettings(adapter) {
    try {
        const obj = await adapter.getForeignObjectAsync(exports.SYSTEM_AI_OBJECT_ID);
        return systemAiSettings(obj?.native);
    }
    catch {
        return systemAiSettings(undefined);
    }
}
/**
 * The address a provider is sent to - only `custom` has one. `openai` used to inherit the address of
 * the custom endpoint, which sent the OpenAI key to whatever host that pointed at (javascript #2369)
 *
 * @param settings the settings
 * @param provider the provider
 */
function baseUrlOf(settings, provider) {
    return provider === 'custom' ? settings.customBaseUrl : '';
}
/**
 * Whether a provider is configured: a key (`manual`) or a credential (`manager`). The custom endpoint
 * is identified by its address - its key is optional, a local Ollama has none
 *
 * @param settings the settings
 * @param provider the provider
 */
function isProviderConfigured(settings, provider) {
    if (provider === 'custom') {
        return !!settings.customBaseUrl;
    }
    return settings.credentialType === 'manager' ? !!settings.credentialIds[provider] : !!settings.keys[provider];
}
/**
 * The configured providers, for the editor to choose from. Never contains a key
 *
 * @param settings the settings
 */
function listAvailableProviders(settings) {
    return types_1.AI_PROVIDERS.filter(provider => isProviderConfigured(settings, provider)).map(provider => provider === 'custom' ? { provider, baseUrl: settings.customBaseUrl } : { provider });
}
/**
 * The address the Test button of the settings dialog may try.
 *
 * The dialog tests what stands in the form rather than what was saved, because the first thing
 * anybody does is type a key and press it. The one thing it must not do is make the adapter carry a
 * secret of its own to an address that came with the message, so an address out of the form counts
 * only together with a key out of the form: one's own key to one's own endpoint gives nothing away.
 * As soon as the key comes from this system - from the configuration or from the credential store -
 * the address comes from there too. And only the custom provider has an address to try.
 *
 * @param settings the settings
 * @param provider the provider that is being tested
 * @param form what the Test button sent
 * @param form.apiKey the key that stands in the form, if any
 * @param form.baseUrl the address that stands in the form, if any
 */
function resolveTestEndpoint(settings, provider, form) {
    const stored = baseUrlOf(settings, provider);
    const formKey = text(form.apiKey);
    const formUrl = text(form.baseUrl);
    // a form value that is still a jsonConfig placeholder (`${data.x}`) was never filled in
    if (provider !== 'custom' || !formKey || !formUrl || formUrl.includes('${')) {
        return stored;
    }
    return formUrl;
}
//# sourceMappingURL=settings.js.map