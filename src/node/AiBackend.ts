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
import { randomBytes } from 'node:crypto';

import { AI_COMMANDS, AI_PUSH_MESSAGE_TYPE, type AiCommand } from '../shared/protocol';
import { resolveRequestTimeout } from '../shared/limits';
import { AI_PROVIDERS, isAiProvider, type AiProvider } from '../shared/types';
import { AiCredentialStore } from './credentials';
import { aiKeyRequired, AiRequestError, chatCompletion, listModels, type AiConnection } from './providers';
import {
    baseUrlOf,
    isProviderConfigured,
    listAvailableProviders,
    resolveTestEndpoint,
    type AiCredentialMode,
    type AiSettings,
} from './settings';

export interface AiBackendOptions {
    /** The current settings. Asked for every request, so a changed configuration counts at once */
    getSettings: () => AiSettings | Promise<AiSettings>;
    /**
     * The command names this adapter used before, mapped to the new ones - so an editor of an older
     * version keeps working, e.g. `{ chatCompletion: 'ai:chat', testApiConnection: 'ai:models' }`
     */
    aliases?: Record<string, AiCommand>;
}

/** One editor that subscribed for pushed answers */
interface AiUiSession {
    /** The messaging-controller client id the answer is pushed to */
    clientId: string;
    /** Who subscribed, as the controller named it - empty with a controller or socket that names nobody */
    user: string;
}

/** The fields with which the settings dialog tests what stands in its form instead of the configuration */
const FORM_FIELDS = ['apiKey', 'baseUrl', 'credentialId', 'credentialType'] as const;

/** What a jsonConfig form sends: a placeholder (`${data.x}`) or an `undefined` was never filled in */
function formValue(value: unknown): string {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    // depending on the admin version an empty field arrives as the placeholder or as its stringified nothing
    return text.includes('${') || text === 'undefined' || text === 'null' ? '' : text;
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * The credential ids the settings name, for `AiCredentialStore.subscribe`
 *
 * @param settings the settings
 */
export function credentialIdsOf(settings: AiSettings): string[] {
    return AI_PROVIDERS.map(provider => settings.credentialIds[provider] || '').filter(id => !!id);
}

export class AiBackend {
    /** The keys of the credential store */
    readonly credentials: AiCredentialStore;
    /** Push subscriptions: the secret handed out to an editor → its socket and its user */
    private readonly uiClients = new Map<string, AiUiSession>();
    private readonly commands: Map<string, AiCommand>;

    constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly options: AiBackendOptions,
    ) {
        this.credentials = new AiCredentialStore(adapter);
        this.commands = new Map<string, AiCommand>(Object.values(AI_COMMANDS).map(command => [command, command]));
        for (const [alias, command] of Object.entries(options.aliases || {})) {
            this.commands.set(alias, command);
        }
    }

    /** Subscribe the credentials the settings name, so edits in the credential manager count at once */
    async start(): Promise<void> {
        const settings = await this.options.getSettings();
        if (settings.credentialType === 'manager') {
            await this.credentials.subscribe(credentialIdsOf(settings));
        } else {
            await this.credentials.unsubscribe();
        }
    }

    /** End the subscriptions and forget the keys and the editors */
    async stop(): Promise<void> {
        this.uiClients.clear();
        await this.credentials.unsubscribe();
    }

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
    onUiClientSubscribe(info: { clientId: string; message: ioBroker.Message }): {
        accepted: boolean;
        error?: string;
        session?: string;
    } | null {
        const message = info.message?.message as { type?: string } | undefined;
        if (message?.type !== AI_PUSH_MESSAGE_TYPE) {
            return null;
        }
        const session = randomBytes(24).toString('hex');
        const user = info.message.user || '';
        this.uiClients.set(session, { clientId: info.clientId, user });
        this.adapter.log.debug(
            `An editor of "${user || 'unknown'}" waits for pushed AI answers (${this.uiClients.size} open)`,
        );
        return { accepted: true, session };
    }

    /**
     * An editor went away - every token that pointed at it is worthless now
     *
     * @param info the client that is going away
     * @param info.clientId its id
     */
    onUiClientUnsubscribe(info: { clientId: string }): void {
        for (const [session, entry] of this.uiClients) {
            if (entry.clientId === info.clientId) {
                this.uiClients.delete(session);
            }
        }
    }

    /**
     * Answer the message if it is one of the AI commands
     *
     * @param obj the message as `onMessage` got it
     * @returns `true` when the message was an AI command - it is answered asynchronously
     */
    handleMessage(obj: ioBroker.Message): boolean {
        const command = obj?.command ? this.commands.get(obj.command) : undefined;
        if (!command) {
            return false;
        }
        const job = this.authorize(obj, command).then(refusal => {
            if (refusal) {
                this.adapter.log.warn(`${obj.command} from ${obj.from}: ${refusal}`);
                // a refused chat releases its callback like any other answer; nothing is pushed
                this.respond(obj, { error: refusal });
                return;
            }
            if (command === AI_COMMANDS.providers) {
                return this.handleProviders(obj);
            }
            if (command === AI_COMMANDS.models) {
                return this.handleModels(obj);
            }
            return this.handleChat(obj);
        });
        job.catch(e => {
            this.adapter.log.warn(`${obj.command}: ${errorText(e)}`);
            if (obj.callback) {
                this.adapter.sendTo(obj.from, obj.command, { error: errorText(e) }, obj.callback);
            }
        });
        return true;
    }

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
    async authorize(obj: ioBroker.Message, command: AiCommand): Promise<string | null> {
        const message = (obj.message || {}) as Record<string, unknown>;
        const sessionId = formValue(message.uiSession);
        const session = sessionId ? this.uiClients.get(sessionId) : undefined;
        const user = obj.user || '';

        if (session?.user && user && session.user !== user) {
            return 'This AI session belongs to another user';
        }
        const asking = user || session?.user || '';
        if (!asking) {
            return null;
        }

        if (command === AI_COMMANDS.models && FORM_FIELDS.some(field => formValue(message[field]))) {
            return (await this.mayExecute(asking))
                ? null
                : 'No permission: testing an AI connection requires the "execute" right';
        }
        return null;
    }

    /**
     * Whether a user has `other.execute` - the right `cmdExec` is checked against
     *
     * @param user the user, `system.user.xy`
     */
    private async mayExecute(user: string): Promise<boolean> {
        try {
            const permissions = await this.adapter.calculatePermissionsAsync(user, {
                cmdExec: { type: 'other', operation: 'execute' },
            });
            return !!permissions?.other?.execute;
        } catch (e) {
            this.adapter.log.warn(`Cannot check the rights of "${user}": ${errorText(e)}`);
            return false;
        }
    }

    /**
     * Provider, key and address of a configured provider - all from the configuration
     *
     * @param provider the provider
     * @param settings the settings, if already read
     */
    async resolveConnection(provider: AiProvider, settings?: AiSettings): Promise<AiConnection> {
        settings ||= await this.options.getSettings();
        const apiKey =
            settings.credentialType === 'manager'
                ? await this.credentials.getKey(settings.credentialIds[provider] || '')
                : settings.keys[provider] || '';
        return {
            provider,
            apiKey,
            baseUrl: baseUrlOf(settings, provider),
            allowSelfSignedCerts: settings.allowSelfSignedCerts,
        };
    }

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
    async resolveTestConnection(
        provider: AiProvider,
        form: { apiKey?: unknown; baseUrl?: unknown; credentialId?: unknown; credentialType?: unknown },
    ): Promise<AiConnection & { problem?: string }> {
        const settings = await this.options.getSettings();
        const formMode = formValue(form.credentialType);
        const mode: AiCredentialMode =
            formMode === 'manager' || formMode === 'manual' ? formMode : settings.credentialType;
        const connection: AiConnection = {
            provider,
            apiKey: '',
            baseUrl: baseUrlOf(settings, provider),
            allowSelfSignedCerts: settings.allowSelfSignedCerts,
        };

        if (mode === 'manager') {
            // a key out of the store is a secret of this system, so the address is the stored one
            const id = formValue(form.credentialId) || settings.credentialIds[provider] || '';
            if (!id) {
                return { ...connection, problem: `No credential selected for "${provider}"` };
            }
            connection.apiKey = await this.credentials.getKey(id);
            return connection.apiKey || !aiKeyRequired(connection)
                ? connection
                : { ...connection, problem: `Credential "${id}" contains no API key` };
        }

        const formKey = formValue(form.apiKey);
        connection.apiKey = formKey || settings.keys[provider] || '';
        connection.baseUrl = resolveTestEndpoint(settings, provider, {
            apiKey: formKey,
            baseUrl: formValue(form.baseUrl),
        });
        return connection;
    }

    private respond(obj: ioBroker.Message, payload: Record<string, unknown>): void {
        if (obj.callback) {
            this.adapter.sendTo(obj.from, obj.command, payload, obj.callback);
        }
    }

    private async handleProviders(obj: ioBroker.Message): Promise<void> {
        const settings = await this.options.getSettings();
        this.respond(obj, { providers: listAvailableProviders(settings) });
    }

    private async handleModels(obj: ioBroker.Message): Promise<void> {
        const message = (obj.message || {}) as Record<string, unknown>;
        const provider = formValue(message.provider) || 'openai';
        if (!isAiProvider(provider)) {
            this.respond(obj, { error: `Unknown AI provider "${provider}"` });
            return;
        }
        const connection = await this.resolveTestConnection(provider, message);
        if (connection.problem) {
            this.respond(obj, { error: connection.problem });
            return;
        }
        try {
            const models = await listModels(connection);
            this.respond(obj, { success: true, models, count: models.length, result: `${models.length} models` });
        } catch (e) {
            this.respond(obj, { error: errorText(e) });
        }
    }

    /**
     * How the answer of one chat request gets back. A socket callback lives thirty seconds, a model
     * that is handed a page of context and a dozen tools regularly takes longer. An editor that
     * subscribed gets the callback answered at once with `accepted`, and the answer as an instance
     * message whenever it is ready; anything else is answered the plain way
     *
     * @param obj the request
     */
    private buildResponder(obj: ioBroker.Message): (payload: Record<string, unknown>) => void {
        const session = formValue(obj.message?.uiSession);
        const requestId = formValue(obj.message?.requestId);
        const clientId = session ? this.uiClients.get(session)?.clientId : undefined;

        if (!clientId || !requestId) {
            return payload => this.respond(obj, payload);
        }

        this.respond(obj, { accepted: true, requestId });
        let sent = false;
        return payload => {
            if (sent) {
                return;
            }
            sent = true;
            this.adapter
                .sendToUI({ clientId, data: { type: AI_PUSH_MESSAGE_TYPE, requestId, ...payload } })
                .catch(e => {
                    // the tab was closed, or the socket died while the model was thinking
                    this.uiClients.delete(session);
                    this.adapter.log.warn(`Cannot deliver the AI answer to the editor: ${errorText(e)}`);
                });
        };
    }

    private async handleChat(obj: ioBroker.Message): Promise<void> {
        if (!obj.callback) {
            this.adapter.log.warn(`${obj.command} from ${obj.from} came without a callback - nobody gets the answer`);
            return;
        }
        const message = (obj.message || {}) as Record<string, any>;
        const respond = this.buildResponder(obj);
        const settings = await this.options.getSettings();

        const provider = formValue(message.provider) || settings.defaultProvider || 'openai';
        const model = formValue(message.model) || settings.defaultModel || '';
        if (!isAiProvider(provider)) {
            respond({ error: `Unknown AI provider "${provider}"` });
            return;
        }
        if (!isProviderConfigured(settings, provider)) {
            respond({ error: `The AI provider "${provider}" is not configured` });
            return;
        }
        this.adapter.log.debug(
            `${obj.command} from ${obj.from}: ${provider}/${model}, ${
                Array.isArray(message.messages) ? message.messages.length : 0
            } messages, ${Array.isArray(message.tools) ? message.tools.length : 0} tools`,
        );

        // Endpoint and key come from the configuration; a request can name neither
        const connection = await this.resolveConnection(provider, settings);
        try {
            const answer = await chatCompletion({
                ...connection,
                model,
                messages: message.messages,
                tools: Array.isArray(message.tools) ? message.tools : undefined,
                timeoutMs: resolveRequestTimeout(message.timeout),
                maxTokens: settings.maxTokens,
                reasoningEffort: settings.reasoningEffort,
            });
            respond({ success: true, ...answer });
        } catch (e) {
            const info = e instanceof AiRequestError ? e.info : {};
            this.adapter.log.warn(`${obj.command} (${provider}/${model}): ${errorText(e)}`);
            respond({ error: errorText(e), ...info });
        }
    }
}
