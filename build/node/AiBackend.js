"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiBackend = void 0;
exports.credentialIdsOf = credentialIdsOf;
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
const node_crypto_1 = require("node:crypto");
const protocol_1 = require("../shared/protocol");
const limits_1 = require("../shared/limits");
const types_1 = require("../shared/types");
const credentials_1 = require("./credentials");
const providers_1 = require("./providers");
const settings_1 = require("./settings");
/** The fields with which the settings dialog tests what stands in its form instead of the configuration */
const FORM_FIELDS = ['apiKey', 'baseUrl', 'credentialId', 'credentialType'];
/** What a jsonConfig form sends: a placeholder (`${data.x}`) or an `undefined` was never filled in */
function formValue(value) {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    // depending on the admin version an empty field arrives as the placeholder or as its stringified nothing
    return text.includes('${') || text === 'undefined' || text === 'null' ? '' : text;
}
function errorText(e) {
    return e instanceof Error ? e.message : String(e);
}
/**
 * The credential ids the settings name, for `AiCredentialStore.subscribe`
 *
 * @param settings the settings
 */
function credentialIdsOf(settings) {
    return types_1.AI_PROVIDERS.map(provider => settings.credentialIds[provider] || '').filter(id => !!id);
}
class AiBackend {
    adapter;
    options;
    /** The keys of the credential store */
    credentials;
    /** Push subscriptions: the secret handed out to an editor → its socket and its user */
    uiClients = new Map();
    commands;
    constructor(adapter, options) {
        this.adapter = adapter;
        this.options = options;
        this.credentials = new credentials_1.AiCredentialStore(adapter);
        this.commands = new Map(Object.values(protocol_1.AI_COMMANDS).map(command => [command, command]));
        for (const [alias, command] of Object.entries(options.aliases || {})) {
            this.commands.set(alias, command);
        }
    }
    /** Subscribe the credentials the settings name, so edits in the credential manager count at once */
    async start() {
        const settings = await this.options.getSettings();
        if (settings.credentialType === 'manager') {
            await this.credentials.subscribe(credentialIdsOf(settings));
        }
        else {
            await this.credentials.unsubscribe();
        }
    }
    /** End the subscriptions and forget the keys and the editors */
    async stop() {
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
    onUiClientSubscribe(info) {
        const message = info.message?.message;
        if (message?.type !== protocol_1.AI_PUSH_MESSAGE_TYPE) {
            return null;
        }
        const session = (0, node_crypto_1.randomBytes)(24).toString('hex');
        const user = info.message.user || '';
        this.uiClients.set(session, { clientId: info.clientId, user });
        this.adapter.log.debug(`An editor of "${user || 'unknown'}" waits for pushed AI answers (${this.uiClients.size} open)`);
        return { accepted: true, session };
    }
    /**
     * An editor went away - every token that pointed at it is worthless now
     *
     * @param info the client that is going away
     * @param info.clientId its id
     */
    onUiClientUnsubscribe(info) {
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
    handleMessage(obj) {
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
            if (command === protocol_1.AI_COMMANDS.providers) {
                return this.handleProviders(obj);
            }
            if (command === protocol_1.AI_COMMANDS.models) {
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
    async authorize(obj, command) {
        const message = (obj.message || {});
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
        if (command === protocol_1.AI_COMMANDS.models && FORM_FIELDS.some(field => formValue(message[field]))) {
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
    async mayExecute(user) {
        try {
            const permissions = await this.adapter.calculatePermissionsAsync(user, {
                cmdExec: { type: 'other', operation: 'execute' },
            });
            return !!permissions?.other?.execute;
        }
        catch (e) {
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
    async resolveConnection(provider, settings) {
        settings ||= await this.options.getSettings();
        const apiKey = settings.credentialType === 'manager'
            ? await this.credentials.getKey(settings.credentialIds[provider] || '')
            : settings.keys[provider] || '';
        return {
            provider,
            apiKey,
            baseUrl: (0, settings_1.baseUrlOf)(settings, provider),
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
    async resolveTestConnection(provider, form) {
        const settings = await this.options.getSettings();
        const formMode = formValue(form.credentialType);
        const mode = formMode === 'manager' || formMode === 'manual' ? formMode : settings.credentialType;
        const connection = {
            provider,
            apiKey: '',
            baseUrl: (0, settings_1.baseUrlOf)(settings, provider),
            allowSelfSignedCerts: settings.allowSelfSignedCerts,
        };
        if (mode === 'manager') {
            // a key out of the store is a secret of this system, so the address is the stored one
            const id = formValue(form.credentialId) || settings.credentialIds[provider] || '';
            if (!id) {
                return { ...connection, problem: `No credential selected for "${provider}"` };
            }
            connection.apiKey = await this.credentials.getKey(id);
            return connection.apiKey || !(0, providers_1.aiKeyRequired)(connection)
                ? connection
                : { ...connection, problem: `Credential "${id}" contains no API key` };
        }
        const formKey = formValue(form.apiKey);
        connection.apiKey = formKey || settings.keys[provider] || '';
        connection.baseUrl = (0, settings_1.resolveTestEndpoint)(settings, provider, {
            apiKey: formKey,
            baseUrl: formValue(form.baseUrl),
        });
        return connection;
    }
    respond(obj, payload) {
        if (obj.callback) {
            this.adapter.sendTo(obj.from, obj.command, payload, obj.callback);
        }
    }
    async handleProviders(obj) {
        const settings = await this.options.getSettings();
        this.respond(obj, { providers: (0, settings_1.listAvailableProviders)(settings) });
    }
    async handleModels(obj) {
        const message = (obj.message || {});
        const provider = formValue(message.provider) || 'openai';
        if (!(0, types_1.isAiProvider)(provider)) {
            this.respond(obj, { error: `Unknown AI provider "${provider}"` });
            return;
        }
        const connection = await this.resolveTestConnection(provider, message);
        if (connection.problem) {
            this.respond(obj, { error: connection.problem });
            return;
        }
        try {
            const models = await (0, providers_1.listModels)(connection);
            this.respond(obj, { success: true, models, count: models.length, result: `${models.length} models` });
        }
        catch (e) {
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
    buildResponder(obj) {
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
                .sendToUI({ clientId, data: { type: protocol_1.AI_PUSH_MESSAGE_TYPE, requestId, ...payload } })
                .catch(e => {
                // the tab was closed, or the socket died while the model was thinking
                this.uiClients.delete(session);
                this.adapter.log.warn(`Cannot deliver the AI answer to the editor: ${errorText(e)}`);
            });
        };
    }
    async handleChat(obj) {
        if (!obj.callback) {
            this.adapter.log.warn(`${obj.command} from ${obj.from} came without a callback - nobody gets the answer`);
            return;
        }
        const message = (obj.message || {});
        const respond = this.buildResponder(obj);
        const settings = await this.options.getSettings();
        const provider = formValue(message.provider) || settings.defaultProvider || 'openai';
        const model = formValue(message.model) || settings.defaultModel || '';
        if (!(0, types_1.isAiProvider)(provider)) {
            respond({ error: `Unknown AI provider "${provider}"` });
            return;
        }
        if (!(0, settings_1.isProviderConfigured)(settings, provider)) {
            respond({ error: `The AI provider "${provider}" is not configured` });
            return;
        }
        this.adapter.log.debug(`${obj.command} from ${obj.from}: ${provider}/${model}, ${Array.isArray(message.messages) ? message.messages.length : 0} messages, ${Array.isArray(message.tools) ? message.tools.length : 0} tools`);
        // Endpoint and key come from the configuration; a request can name neither
        const connection = await this.resolveConnection(provider, settings);
        try {
            const answer = await (0, providers_1.chatCompletion)({
                ...connection,
                model,
                messages: message.messages,
                tools: Array.isArray(message.tools) ? message.tools : undefined,
                timeoutMs: (0, limits_1.resolveRequestTimeout)(message.timeout),
                maxTokens: settings.maxTokens,
                reasoningEffort: settings.reasoningEffort,
            });
            respond({ success: true, ...answer });
        }
        catch (e) {
            const info = e instanceof providers_1.AiRequestError ? e.info : {};
            this.adapter.log.warn(`${obj.command} (${provider}/${model}): ${errorText(e)}`);
            respond({ error: errorText(e), ...info });
        }
    }
}
exports.AiBackend = AiBackend;
//# sourceMappingURL=AiBackend.js.map