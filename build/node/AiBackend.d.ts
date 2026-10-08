/**
 * The sendTo side of the AI in an adapter: it answers `ai:providers`, `ai:models` and `ai:chat`,
 * resolves the keys and pushes long answers to the editor that asked.
 *
 * Wiring in an adapter:
 *
 * ```ts
 * this.ai = new AiBackend(this, { getSettings: () => readAiSettings(this.config, MY_AI_FIELDS) });
 * // adapter options
 * uiClientSubscribe: info => this.ai.onUiClientSubscribe(info) ?? { accepted: false },
 * uiClientUnsubscribe: info => this.ai.onUiClientUnsubscribe(info),
 * // onReady / onUnload
 * await this.ai.start();
 * await this.ai.stop();
 * // onMessage
 * if (this.ai.handleMessage(obj)) return;
 * ```
 */
import { type AiCommand } from '../shared/protocol';
import { type AiProvider } from '../shared/types';
import { AiCredentialStore } from './credentials';
import { type AiConnection } from './providers';
import { type AiSettings } from './settings';
export interface AiBackendOptions {
    /** The current settings. Asked for every request, so a changed configuration counts at once */
    getSettings: () => AiSettings | Promise<AiSettings>;
    /**
     * The command names this adapter used before, mapped to the new ones - so an editor of an older
     * version keeps working, e.g. `{ chatCompletion: 'ai:chat', testApiConnection: 'ai:models' }`
     */
    aliases?: Record<string, AiCommand>;
}
/**
 * The credential ids the settings name, for `AiCredentialStore.subscribe`
 *
 * @param settings the settings
 */
export declare function credentialIdsOf(settings: AiSettings): string[];
export declare class AiBackend {
    private readonly adapter;
    private readonly options;
    /** The keys of the credential store */
    readonly credentials: AiCredentialStore;
    /** Push subscriptions: session token of an editor → client id of its socket */
    private readonly uiClients;
    private readonly commands;
    constructor(adapter: ioBroker.Adapter, options: AiBackendOptions);
    /** Subscribe the credentials the settings name, so edits in the credential manager count at once */
    start(): Promise<void>;
    /** End the subscriptions and forget the keys and the editors */
    stop(): Promise<void>;
    /**
     * An editor subscribes for pushed answers. It names a token of its own making; what is kept is which
     * socket that token came in on, so an answer goes back to that one editor and not to every open tab.
     *
     * @param info client id and the subscribe message, as the messaging controller hands it over
     * @param info.clientId the id to address this client with later
     * @param info.message the subscribe message, carrying the type and the session token
     * @returns the answer for the controller, or `null` when the subscription is not one of the AI -
     * the adapter then decides about it itself
     */
    onUiClientSubscribe(info: {
        clientId: string;
        message: ioBroker.Message;
    }): {
        accepted: boolean;
        error?: string;
    } | null;
    /**
     * An editor went away - every token that pointed at it is worthless now
     *
     * @param info the client that is going away
     * @param info.clientId its id
     */
    onUiClientUnsubscribe(info: {
        clientId: string;
    }): void;
    /**
     * Answer the message if it is one of the AI commands
     *
     * @param obj the message as `onMessage` got it
     * @returns `true` when the message was an AI command - it is answered asynchronously
     */
    handleMessage(obj: ioBroker.Message): boolean;
    /**
     * Provider, key and address of a configured provider - all from the configuration
     *
     * @param provider the provider
     * @param settings the settings, if already read
     */
    resolveConnection(provider: AiProvider, settings?: AiSettings): Promise<AiConnection>;
    /**
     * What the Test button of the settings dialog may try: the values of the form, as far as they give
     * nothing of this system away - see `resolveTestEndpoint`
     *
     * @param provider the provider that is being tested
     * @param form what the button sent
     * @param form.apiKey key in the form
     * @param form.baseUrl address in the form
     * @param form.credentialId credential chosen in the form
     * @param form.credentialType credential mode chosen in the form
     */
    resolveTestConnection(provider: AiProvider, form: {
        apiKey?: unknown;
        baseUrl?: unknown;
        credentialId?: unknown;
        credentialType?: unknown;
    }): Promise<AiConnection & {
        problem?: string;
    }>;
    private respond;
    private handleProviders;
    private handleModels;
    /**
     * How the answer of one chat request gets back. A socket callback lives thirty seconds, a model
     * that is handed a page of context and a dozen tools regularly takes longer. An editor that
     * subscribed gets the callback answered at once with `accepted`, and the answer as an instance
     * message whenever it is ready; anything else is answered the plain way
     *
     * @param obj the request
     */
    private buildResponder;
    private handleChat;
}
