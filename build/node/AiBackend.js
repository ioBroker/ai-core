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
const protocol_1 = require("../shared/protocol");
const limits_1 = require("../shared/limits");
const types_1 = require("../shared/types");
const credentials_1 = require("./credentials");
const providers_1 = require("./providers");
const settings_1 = require("./settings");
/** What a jsonConfig form sends: a value that is still a placeholder (`${data.x}`) was never filled in */
function formValue(value) {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    return text.includes('${') ? '' : text;
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
    /** Push subscriptions: session token of an editor → client id of its socket */
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
     * An editor subscribes for pushed answers. It names a token of its own making; what is kept is which
     * socket that token came in on, so an answer goes back to that one editor and not to every open tab.
     *
     * @param info client id and the subscribe message, as the messaging controller hands it over
     * @param info.clientId the id to address this client with later
     * @param info.message the subscribe message, carrying the type and the session token
     * @returns the answer for the controller, or `null` when the subscription is not one of the AI -
     * the adapter then decides about it itself
     */
    onUiClientSubscribe(info) {
        const message = info.message?.message;
        if (message?.type !== protocol_1.AI_PUSH_MESSAGE_TYPE) {
            return null;
        }
        const token = (message.data?.sessionToken || '').trim();
        if (!token) {
            return { accepted: false, error: 'No session token provided' };
        }
        this.uiClients.set(token, info.clientId);
        this.adapter.log.debug(`An editor waits for pushed AI answers (${this.uiClients.size} open)`);
        return { accepted: true };
    }
    /**
     * An editor went away - every token that pointed at it is worthless now
     *
     * @param info the client that is going away
     * @param info.clientId its id
     */
    onUiClientUnsubscribe(info) {
        for (const [token, clientId] of this.uiClients) {
            if (clientId === info.clientId) {
                this.uiClients.delete(token);
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
        let job;
        if (command === protocol_1.AI_COMMANDS.providers) {
            job = this.handleProviders(obj);
        }
        else if (command === protocol_1.AI_COMMANDS.models) {
            job = this.handleModels(obj);
        }
        else {
            job = this.handleChat(obj);
        }
        job.catch(e => {
            this.adapter.log.warn(`${obj.command}: ${errorText(e)}`);
            if (obj.callback) {
                this.adapter.sendTo(obj.from, obj.command, { error: errorText(e) }, obj.callback);
            }
        });
        return true;
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
        const token = formValue(obj.message?.uiSession);
        const requestId = formValue(obj.message?.requestId);
        const clientId = token ? this.uiClients.get(token) : undefined;
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
                this.uiClients.delete(token);
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