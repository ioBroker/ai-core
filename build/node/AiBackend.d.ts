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
    /** Push subscriptions: the secret handed out to an editor → its socket and its user */
    private readonly uiClients;
    private readonly commands;
    constructor(adapter: ioBroker.Adapter, options: AiBackendOptions);
    /** Subscribe the credentials the settings name, so edits in the credential manager count at once */
    start(): Promise<void>;
    /** End the subscriptions and forget the keys and the editors */
    stop(): Promise<void>;
    /**
     * An editor subscribes for pushed answers, and gets the secret of its session back.
     *
     * The secret is made here, not by the editor: a token of the editor's own making could be named by
     * anybody else who subscribes, and the answers of that editor would go to them. Kept with it are the
     * socket to push to and the user the controller named for the subscription, so a request that names
     * the session has to come from that same user.
     *
     * @param info client id and the subscribe message, as the messaging controller hands it over
     * @param info.clientId the id to address this client with later
     * @param info.message the subscribe message, carrying the type and - from js-controller 7.2.5 on - the user
     * @returns the answer for the controller, or `null` when the subscription is not one of the AI -
     * the adapter then decides about it itself
     */
    onUiClientSubscribe(info: {
        clientId: string;
        message: ioBroker.Message;
    }): {
        accepted: boolean;
        error?: string;
        session?: string;
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
     * Whether the user of a request may do what it asks for. `null` means yes, a text says why not.
     *
     * The user is the one the controller wrote into the message (js-controller 7.2.5 on, with a socket
     * layer that names it - socket-classes 2.7.0 on). Nobody there means the message came from another
     * instance - a script, for instance - or through a platform too old to say; such a request is
     * served as before, because there is nobody to check.
     *
     * - A request that names a session must come from the user that session was handed out to.
     * - Testing what stands in the settings form - a key or an address not saved yet - can reach any
     *   address from this host, so it needs the right a command on the host needs: `other.execute`.
     *   Listing the models of the saved configuration needs nothing more than the request itself.
     *
     * @param obj the request
     * @param command what it asks for
     */
    authorize(obj: ioBroker.Message, command: AiCommand): Promise<string | null>;
    /**
     * Whether a user has `other.execute` - the right `cmdExec` is checked against
     *
     * @param user the user, `system.user.xy`
     */
    private mayExecute;
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
