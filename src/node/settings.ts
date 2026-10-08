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
import { resolveMaxTokens } from '../shared/limits';
import { AI_PROVIDERS, type AiProvider, type AiReasoningEffort } from '../shared/types';

/** Where the API keys come from */
export type AiCredentialMode = 'manual' | 'manager';

/** The AI settings of an adapter, whatever its fields are called */
export interface AiSettings {
    /**
     * - `manual`: the keys stand in the adapter configuration (encryptedNative)
     * - `manager`: the configuration names an entry of the central credential store (`system.credentials.*`)
     */
    credentialType: AiCredentialMode;
    /** The keys, in `manual` mode */
    keys: Partial<Record<AiProvider, string>>;
    /** The ids of the credential store entries, in `manager` mode */
    credentialIds: Partial<Record<AiProvider, string>>;
    /** Address of the OpenAI-compatible endpoint (`custom`) */
    customBaseUrl: string;
    /** Accept a self-signed certificate of the custom endpoint */
    allowSelfSignedCerts: boolean;
    /** `max_tokens` for Anthropic, already clamped */
    maxTokens: number;
    /** `reasoning_effort` for the OpenAI-compatible providers */
    reasoningEffort: AiReasoningEffort;
    /** The provider to use when the request names none (`system.ai` has exactly one) */
    defaultProvider?: AiProvider;
    /** The model to use when the request names none */
    defaultModel?: string;
}

/** The names of the `native` fields of an adapter that hold its AI settings */
export interface AiNativeFields {
    /** Field with `'manual' | 'manager'`. Without it the mode is `manual` */
    credentialType?: string;
    /** Field with the key per provider, in `manual` mode */
    keys: Partial<Record<AiProvider, string>>;
    /** Field with the credential id per provider, in `manager` mode */
    credentialIds?: Partial<Record<AiProvider, string>>;
    /** Field with the address of the custom endpoint */
    customBaseUrl: string;
    allowSelfSignedCerts?: string;
    maxTokens?: string;
    reasoningEffort?: string;
}

const REASONING_EFFORTS: readonly AiReasoningEffort[] = ['', 'none', 'minimal', 'low', 'medium', 'high'];

function text(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function effortOf(value: unknown): AiReasoningEffort {
    const effort = text(value) as AiReasoningEffort;
    return REASONING_EFFORTS.includes(effort) ? effort : '';
}

/**
 * The AI settings out of the `native` of an adapter
 *
 * @param native the configuration of the instance (`this.config`)
 * @param fields what the fields are called in this adapter
 */
export function readAiSettings(native: object | null | undefined, fields: AiNativeFields): AiSettings {
    // an adapter config has no index signature - the fields are looked up by the names given in `fields`
    const cfg = (native || {}) as Record<string, unknown>;
    const keys: AiSettings['keys'] = {};
    const credentialIds: AiSettings['credentialIds'] = {};
    for (const provider of AI_PROVIDERS) {
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
        maxTokens: resolveMaxTokens(fields.maxTokens ? cfg[fields.maxTokens] : undefined),
        reasoningEffort: fields.reasoningEffort ? effortOf(cfg[fields.reasoningEffort]) : '',
    };
}

/** ID of the object with the system-wide assistant settings */
export const SYSTEM_AI_OBJECT_ID = 'system.ai';

/** The `native` of `system.ai`, as the settings dialog of admin stores it */
export interface SystemAiNative {
    provider?: AiProvider;
    model?: string;
    /** Id of a `system.credentials.*` entry of type `ai` */
    credentialId?: string;
    /** Endpoint of the custom provider, ignored for the others */
    baseUrl?: string;
    allowSelfSignedCerts?: boolean;
    reasoningEffort?: AiReasoningEffort;
    maxTokens?: number;
}

/**
 * The system-wide settings of `system.ai` in the normalized shape. They know one provider with one
 * credential - always from the credential store
 *
 * @param native the `native` of `system.ai`
 */
export function systemAiSettings(native: SystemAiNative | null | undefined): AiSettings {
    const cfg = native || {};
    const provider = AI_PROVIDERS.includes(cfg.provider as AiProvider) ? cfg.provider : undefined;
    return {
        credentialType: 'manager',
        keys: {},
        credentialIds: provider && text(cfg.credentialId) ? { [provider]: text(cfg.credentialId) } : {},
        customBaseUrl: provider === 'custom' ? text(cfg.baseUrl) : '',
        allowSelfSignedCerts: cfg.allowSelfSignedCerts === true,
        maxTokens: resolveMaxTokens(cfg.maxTokens),
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
export async function readSystemAiSettings(adapter: ioBroker.Adapter): Promise<AiSettings> {
    try {
        const obj = await adapter.getForeignObjectAsync(SYSTEM_AI_OBJECT_ID);
        return systemAiSettings(obj?.native as SystemAiNative | undefined);
    } catch {
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
export function baseUrlOf(settings: AiSettings, provider: AiProvider): string {
    return provider === 'custom' ? settings.customBaseUrl : '';
}

/**
 * Whether a provider is configured: a key (`manual`) or a credential (`manager`). The custom endpoint
 * is identified by its address - its key is optional, a local Ollama has none
 *
 * @param settings the settings
 * @param provider the provider
 */
export function isProviderConfigured(settings: AiSettings, provider: AiProvider): boolean {
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
export function listAvailableProviders(settings: AiSettings): { provider: AiProvider; baseUrl?: string }[] {
    return AI_PROVIDERS.filter(provider => isProviderConfigured(settings, provider)).map(provider =>
        provider === 'custom' ? { provider, baseUrl: settings.customBaseUrl } : { provider },
    );
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
export function resolveTestEndpoint(
    settings: AiSettings,
    provider: AiProvider,
    form: { apiKey?: string; baseUrl?: string },
): string {
    const stored = baseUrlOf(settings, provider);
    const formKey = text(form.apiKey);
    const formUrl = text(form.baseUrl);
    // a form value that is still a jsonConfig placeholder (`${data.x}`) was never filled in
    if (provider !== 'custom' || !formKey || !formUrl || formUrl.includes('${')) {
        return stored;
    }
    return formUrl;
}
