const assert = require('node:assert').strict;
const http = require('node:http');
const { chatCompletion, listModels, AiRequestError, AiBackend, readAiSettings, describeConnectionError } = require('../build');

/**
 * A local OpenAI-compatible endpoint. `handler` decides the answer of every request and sees what
 * arrived
 */
function startServer(handler) {
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
            const request = {
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: body ? JSON.parse(body) : null,
            };
            requests.push(request);
            const { status = 200, json } = handler(request, requests.length);
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(typeof json === 'string' ? json : JSON.stringify(json));
        });
    });
    return new Promise(resolve =>
        server.listen(0, '127.0.0.1', () =>
            resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}/v1` }),
        ),
    );
}

function chatAnswer(message, extra = {}) {
    return {
        choices: [{ message, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
        ...extra,
    };
}

/** Just enough of an adapter for AiBackend */
function fakeAdapter() {
    const sent = [];
    const pushed = [];
    return {
        sent,
        pushed,
        log: { debug() {}, info() {}, warn() {}, error() {} },
        sendTo(from, command, payload, callback) {
            sent.push({ from, command, payload, callback });
        },
        sendToUI(options) {
            pushed.push(options);
            return Promise.resolve();
        },
    };
}

function waitFor(check) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
            if (check()) {
                clearInterval(timer);
                resolve();
            } else if (Date.now() - started > 3000) {
                clearInterval(timer);
                reject(new Error('timeout'));
            }
        }, 5);
    });
}

describe('Test providers and AiBackend', function () {
    let endpoint;
    let answer;

    before(async function () {
        endpoint = await startServer((request, n) => answer(request, n));
    });

    after(function () {
        endpoint.server.close();
    });

    beforeEach(function () {
        endpoint.requests.length = 0;
    });

    describe('chatCompletion', function () {
        it('sends the conversation and returns content, tool calls and usage', async function () {
            const toolCall = { id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } };
            answer = () => ({ json: chatAnswer({ content: 'hi', tool_calls: [toolCall] }) });
            const result = await chatCompletion({
                provider: 'custom',
                baseUrl: `${endpoint.url}/`,
                apiKey: 'local-key',
                model: 'llama',
                messages: [{ role: 'user', content: 'hello' }],
                tools: [{ type: 'function', function: { name: 't' } }],
                reasoningEffort: 'low',
            });
            assert.equal(result.content, 'hi');
            assert.deepEqual(result.tool_calls, [toolCall]);
            assert.equal(result.finishReason, 'stop');
            assert.deepEqual(result.usage, { input: 3, output: 4 });

            const request = endpoint.requests[0];
            assert.equal(request.url, '/v1/chat/completions');
            assert.equal(request.headers.authorization, 'Bearer local-key');
            assert.equal(request.body.model, 'llama');
            assert.equal(request.body.stream, false);
            assert.equal(request.body.reasoning_effort, 'low');
            assert.equal(request.body.tools.length, 1);
        });

        it('lets a custom endpoint go without a key', async function () {
            answer = () => ({ json: chatAnswer({ content: 'ok' }) });
            await chatCompletion({
                provider: 'custom',
                baseUrl: endpoint.url,
                apiKey: '',
                model: 'm',
                messages: [{ role: 'user', content: 'x' }],
            });
            assert.equal(endpoint.requests[0].headers.authorization, undefined);
        });

        it('refuses a provider with a fixed host without a key', async function () {
            await assert.rejects(
                chatCompletion({
                    provider: 'anthropic',
                    apiKey: '',
                    model: 'm',
                    messages: [{ role: 'user', content: 'x' }],
                }),
                /No API key/,
            );
        });

        it('does not fall back to OpenAI for a custom provider without an address', async function () {
            await assert.rejects(
                chatCompletion({
                    provider: 'custom',
                    apiKey: 'k',
                    model: 'm',
                    messages: [{ role: 'user', content: 'x' }],
                }),
                /No address configured/,
            );
        });

        it('reports the error of the endpoint with its status', async function () {
            answer = () => ({ status: 429, json: { error: { message: 'Rate limit reached' } } });
            await assert.rejects(
                chatCompletion({
                    provider: 'custom',
                    baseUrl: endpoint.url,
                    apiKey: 'k',
                    model: 'm',
                    messages: [{ role: 'user', content: 'x' }],
                }),
                e => e instanceof AiRequestError && e.status === 429 && /Rate limit reached \(429\)/.test(e.message),
            );
        });

        it('names the reason of an empty answer', async function () {
            answer = () => ({ json: { choices: [{ message: { content: '  ' }, finish_reason: 'length' }] } });
            await assert.rejects(
                chatCompletion({
                    provider: 'custom',
                    baseUrl: endpoint.url,
                    apiKey: 'k',
                    model: 'm',
                    messages: [{ role: 'user', content: 'x' }],
                }),
                e => /output budget/.test(e.message) && e.info.finishReason === 'length',
            );
        });

        it('switches the reasoning off for a model that demands it, and remembers that', async function () {
            answer = request =>
                request.body.reasoning_effort === 'none'
                    ? { json: chatAnswer({ content: 'ok' }) }
                    : {
                          status: 400,
                          json: {
                              error: {
                                  message:
                                      "Function tools with reasoning_effort are not supported, set reasoning_effort to 'none'",
                              },
                          },
                      };
            const params = {
                provider: 'custom',
                baseUrl: endpoint.url,
                apiKey: 'k',
                model: 'picky-model',
                messages: [{ role: 'user', content: 'x' }],
                tools: [{ type: 'function', function: { name: 't' } }],
            };
            assert.equal((await chatCompletion(params)).content, 'ok');
            assert.equal(endpoint.requests.length, 2);
            await chatCompletion(params);
            assert.equal(endpoint.requests.length, 3);
            assert.equal(endpoint.requests[2].body.reasoning_effort, 'none');
        });

        it('says that an endpoint did not answer in time', async function () {
            const silent = http.createServer(() => {});
            await new Promise(resolve => silent.listen(0, '127.0.0.1', resolve));
            try {
                await assert.rejects(
                    chatCompletion({
                        provider: 'custom',
                        baseUrl: `http://127.0.0.1:${silent.address().port}/v1`,
                        apiKey: 'k',
                        model: 'm',
                        messages: [{ role: 'user', content: 'x' }],
                        timeoutMs: 200,
                    }),
                    /Connection timeout/,
                );
            } finally {
                silent.closeAllConnections();
                silent.close();
            }
        });
    });

    describe('listModels', function () {
        it('lists the models sorted, without the `models/` of Gemini', async function () {
            answer = () => ({ json: { data: [{ id: 'models/b' }, { id: 'a' }] } });
            assert.deepEqual(await listModels({ provider: 'custom', baseUrl: endpoint.url, apiKey: 'k' }), ['a', 'b']);
            assert.equal(endpoint.requests[0].url, '/v1/models');
        });

        it('calls a 401 an invalid key', async function () {
            answer = () => ({ status: 401, json: {} });
            await assert.rejects(
                listModels({ provider: 'custom', baseUrl: endpoint.url, apiKey: 'k' }),
                /Invalid API key/,
            );
        });

        it('says why the connection failed, also when Node tried several addresses', async function () {
            // `localhost` is `::1` and `127.0.0.1`: Node tries both and throws an AggregateError without message
            await assert.rejects(
                listModels({ provider: 'custom', baseUrl: 'http://localhost:1/v1', apiKey: 'k' }),
                /Connection failed: \S/,
            );
            const aggregate = Object.assign(new AggregateError([new Error('connect ECONNREFUSED ::1:1')], ''), {
                code: 'ECONNREFUSED',
            });
            assert.equal(describeConnectionError(aggregate, new URL('http://localhost:1')), 'connect ECONNREFUSED ::1:1');
            const bare = Object.assign(new Error(''), { code: 'ECONNRESET' });
            assert.equal(describeConnectionError(bare, new URL('http://localhost:1')), 'ECONNRESET (localhost:1)');
        });
    });

    describe('AiBackend', function () {
        const FIELDS = { keys: { openai: 'openaiKey', custom: 'customKey' }, customBaseUrl: 'customUrl' };

        function backend(native, options = {}) {
            const adapter = fakeAdapter();
            const ai = new AiBackend(adapter, { getSettings: () => readAiSettings(native, FIELDS), ...options });
            return { adapter, ai };
        }

        it('lets other messages pass', function () {
            const { ai } = backend({});
            assert.equal(ai.handleMessage({ command: 'somethingElse' }), false);
        });

        it('lists the configured providers under the new name and an old one', async function () {
            const { adapter, ai } = backend(
                { openaiKey: 'sk', customUrl: endpoint.url },
                {
                    aliases: { getAvailableAiProviders: 'ai:providers' },
                },
            );
            assert.ok(ai.handleMessage({ command: 'ai:providers', from: 'x', callback: {} }));
            assert.ok(ai.handleMessage({ command: 'getAvailableAiProviders', from: 'x', callback: {} }));
            await waitFor(() => adapter.sent.length === 2);
            for (const { payload } of adapter.sent) {
                assert.deepEqual(payload.providers, [
                    { provider: 'openai' },
                    { provider: 'custom', baseUrl: endpoint.url },
                ]);
            }
            assert.equal(adapter.sent[1].command, 'getAvailableAiProviders');
        });

        it('answers a chat with the key of the configuration, never one of the message', async function () {
            answer = () => ({ json: chatAnswer({ content: 'hello back' }) });
            const { adapter, ai } = backend({ customKey: 'stored-key', customUrl: endpoint.url });
            ai.handleMessage({
                command: 'ai:chat',
                from: 'x',
                callback: {},
                message: {
                    provider: 'custom',
                    model: 'm',
                    messages: [{ role: 'user', content: 'hi' }],
                    apiKey: 'injected',
                    baseUrl: 'http://evil.invalid/v1',
                },
            });
            await waitFor(() => adapter.sent.length === 1);
            assert.equal(adapter.sent[0].payload.success, true);
            assert.equal(adapter.sent[0].payload.content, 'hello back');
            assert.equal(endpoint.requests[0].headers.authorization, 'Bearer stored-key');
        });

        it('refuses a provider that is not configured', async function () {
            const { adapter, ai } = backend({});
            ai.handleMessage({
                command: 'ai:chat',
                from: 'x',
                callback: {},
                message: { provider: 'openai', model: 'm', messages: [] },
            });
            await waitFor(() => adapter.sent.length === 1);
            assert.match(adapter.sent[0].payload.error, /not configured/);
        });

        it('pushes the answer to a subscribed editor and releases the callback at once', async function () {
            answer = () => ({ json: chatAnswer({ content: 'pushed' }) });
            const { adapter, ai } = backend({ customUrl: endpoint.url });
            assert.equal(ai.onUiClientSubscribe({ clientId: 'c1', message: { message: { type: 'other' } } }), null);
            assert.deepEqual(
                ai.onUiClientSubscribe({
                    clientId: 'c1',
                    message: { message: { type: 'aiChatAnswer', data: { sessionToken: 'tok' } } },
                }),
                { accepted: true },
            );
            ai.handleMessage({
                command: 'ai:chat',
                from: 'x',
                callback: {},
                message: {
                    provider: 'custom',
                    model: 'm',
                    messages: [{ role: 'user', content: 'hi' }],
                    uiSession: 'tok',
                    requestId: 'r1',
                },
            });
            await waitFor(() => adapter.pushed.length === 1);
            assert.deepEqual(adapter.sent[0].payload, { accepted: true, requestId: 'r1' });
            assert.equal(adapter.pushed[0].clientId, 'c1');
            assert.equal(adapter.pushed[0].data.type, 'aiChatAnswer');
            assert.equal(adapter.pushed[0].data.requestId, 'r1');
            assert.equal(adapter.pushed[0].data.content, 'pushed');

            ai.onUiClientUnsubscribe({ clientId: 'c1' });
            ai.handleMessage({
                command: 'ai:chat',
                from: 'x',
                callback: {},
                message: {
                    provider: 'custom',
                    model: 'm',
                    messages: [{ role: 'user', content: 'hi' }],
                    uiSession: 'tok',
                    requestId: 'r2',
                },
            });
            await waitFor(() => adapter.sent.length === 2);
            assert.equal(adapter.sent[1].payload.content, 'pushed');
            assert.equal(adapter.pushed.length, 1);
        });

        it('tests a key of the form against an address of the form, only together', async function () {
            answer = () => ({ json: { data: [{ id: 'x' }] } });
            const { adapter, ai } = backend({ customUrl: 'http://127.0.0.1:1/v1' });
            ai.handleMessage({
                command: 'ai:models',
                from: 'x',
                callback: {},
                message: { provider: 'custom', apiKey: 'form-key', baseUrl: endpoint.url },
            });
            await waitFor(() => adapter.sent.length === 1);
            assert.deepEqual(adapter.sent[0].payload, { success: true, models: ['x'], count: 1, result: '1 models' });
            assert.equal(endpoint.requests[0].headers.authorization, 'Bearer form-key');

            // without a key of its own the form may not choose the address
            ai.handleMessage({
                command: 'ai:models',
                from: 'x',
                callback: {},
                message: { provider: 'custom', baseUrl: endpoint.url },
            });
            await waitFor(() => adapter.sent.length === 2);
            assert.match(adapter.sent[1].payload.error, /Connection failed/);
            assert.equal(endpoint.requests.length, 1);
        });

        it('says which credential is missing in manager mode', async function () {
            const adapter = fakeAdapter();
            const ai = new AiBackend(adapter, {
                getSettings: () =>
                    readAiSettings(
                        { mode: 'manager' },
                        { ...FIELDS, credentialType: 'mode', credentialIds: { openai: 'openaiCred' } },
                    ),
            });
            ai.handleMessage({ command: 'ai:models', from: 'x', callback: {}, message: { provider: 'openai' } });
            await waitFor(() => adapter.sent.length === 1);
            assert.equal(adapter.sent[0].payload.error, 'No credential selected for "openai"');
        });
    });
});
