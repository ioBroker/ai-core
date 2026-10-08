import { type AiProvider, type AiReasoningEffort } from '../shared/types';
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
/**
 * The AI settings out of the `native` of an adapter
 *
 * @param native the configuration of the instance (`this.config`)
 * @param fields what the fields are called in this adapter
 */
export declare function readAiSettings(native: Record<string, unknown> | null | undefined, fields: AiNativeFields): AiSettings;
/** ID of the object with the system-wide assistant settings */
export declare const SYSTEM_AI_OBJECT_ID = "system.ai";
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
export declare function systemAiSettings(native: SystemAiNative | null | undefined): AiSettings;
/**
 * Read `system.ai`. A missing object (or one the adapter may not read) gives empty settings
 *
 * @param adapter the adapter that reads it
 */
export declare function readSystemAiSettings(adapter: ioBroker.Adapter): Promise<AiSettings>;
/**
 * The address a provider is sent to - only `custom` has one. `openai` used to inherit the address of
 * the custom endpoint, which sent the OpenAI key to whatever host that pointed at (javascript #2369)
 *
 * @param settings the settings
 * @param provider the provider
 */
export declare function baseUrlOf(settings: AiSettings, provider: AiProvider): string;
/**
 * Whether a provider is configured: a key (`manual`) or a credential (`manager`). The custom endpoint
 * is identified by its address - its key is optional, a local Ollama has none
 *
 * @param settings the settings
 * @param provider the provider
 */
export declare function isProviderConfigured(settings: AiSettings, provider: AiProvider): boolean;
/**
 * The configured providers, for the editor to choose from. Never contains a key
 *
 * @param settings the settings
 */
export declare function listAvailableProviders(settings: AiSettings): {
    provider: AiProvider;
    baseUrl?: string;
}[];
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
export declare function resolveTestEndpoint(settings: AiSettings, provider: AiProvider, form: {
    apiKey?: string;
    baseUrl?: string;
}): string;
