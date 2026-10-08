/**
 * Talking to the providers: one chat completion, and the list of models.
 *
 * Every provider is addressed in the OpenAI chat-completion format; Anthropic is translated to and
 * from its Messages API. The key is handed in by the caller and goes nowhere but to the provider it
 * belongs to: the official hosts are fixed here, and only `custom` has an address of its own.
 */
import {
    describeAnthropicContent,
    translateAnthropicResponseToOpenAI,
    translateMessagesToAnthropic,
    translateToolsToAnthropic,
} from '../shared/anthropic';
import { AI_MODELS_TIMEOUT_MS, DEFAULT_AI_MAX_TOKENS, MAX_AI_REQUEST_TIMEOUT_MS } from '../shared/limits';
import { describeEmptyAiResponse, extractAiResponseInfo } from '../shared/response';
import type {
    AiChatResult,
    AiProvider,
    AiReasoningEffort,
    AiResponseInfo,
    OpenAIMessage,
    OpenAITool,
    OpenAIToolCall,
} from '../shared/types';
import { aiHttpRequest, type AiHttpResponse } from './http';

const OPENAI_BASE = 'https://api.openai.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

/** Where each provider with a fixed address listens */
const ENDPOINTS: Record<Exclude<AiProvider, 'custom'>, { chat: string; models: string }> = {
    openai: { chat: `${OPENAI_BASE}/chat/completions`, models: `${OPENAI_BASE}/models` },
    anthropic: { chat: 'https://api.anthropic.com/v1/messages', models: 'https://api.anthropic.com/v1/models' },
    gemini: {
        chat: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        models: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
    },
    deepseek: { chat: 'https://api.deepseek.com/chat/completions', models: 'https://api.deepseek.com/models' },
};

/** The connection to one provider */
export interface AiConnection {
    provider: AiProvider;
    apiKey: string;
    /** Address of the OpenAI-compatible endpoint. Only `custom` has one, every other provider ignores it */
    baseUrl?: string;
    /** Accept a self-signed certificate. Only honoured for `custom` */
    allowSelfSignedCerts?: boolean;
}

export interface AiChatParams extends AiConnection {
    model: string;
    messages: OpenAIMessage[];
    tools?: OpenAITool[];
    /** Default {@link MAX_AI_REQUEST_TIMEOUT_MS} */
    timeoutMs?: number;
    /** `max_tokens` for Anthropic, default {@link DEFAULT_AI_MAX_TOKENS} */
    maxTokens?: number;
    /** `reasoning_effort` for the OpenAI-compatible providers; empty sends nothing */
    reasoningEffort?: AiReasoningEffort;
}

/** A request that failed, with a message a user can read */
export class AiRequestError extends Error {
    constructor(
        message: string,
        /** Stop reason and token counts, when the endpoint answered */
        public readonly info: AiResponseInfo = {},
        /** HTTP status, when the endpoint answered */
        public readonly status?: number,
    ) {
        super(message);
        this.name = 'AiRequestError';
    }
}

/**
 * Whether a provider can be asked without a key. Only an endpoint of one's own can - a local Ollama
 * has no key at all
 *
 * @param connection the provider and its address
 */
export function aiKeyRequired(connection: Pick<AiConnection, 'provider' | 'baseUrl'>): boolean {
    return connection.provider !== 'custom' || !connection.baseUrl;
}

function trimSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

/** The address of the chat or model endpoint of a connection */
function endpointOf(connection: AiConnection, kind: 'chat' | 'models'): string {
    if (connection.provider === 'custom') {
        // A custom endpoint without an address is not configured - and must not fall back to OpenAI
        // with whatever key it carries
        if (!connection.baseUrl) {
            throw new AiRequestError('No address configured for the custom endpoint');
        }
        return `${trimSlash(connection.baseUrl)}/${kind === 'chat' ? 'chat/completions' : 'models'}`;
    }
    const known = ENDPOINTS[connection.provider];
    if (!known) {
        throw new AiRequestError(`Unknown AI provider "${String(connection.provider)}"`);
    }
    return known[kind];
}

function authHeaders(connection: AiConnection): Record<string, string> {
    if (connection.provider === 'anthropic') {
        return { 'x-api-key': connection.apiKey, 'anthropic-version': ANTHROPIC_VERSION };
    }
    return connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {};
}

/** Self-signed certificates only for an endpoint of one's own - never weaken TLS towards a provider */
function selfSigned(connection: AiConnection): boolean {
    return connection.provider === 'custom' && !!connection.allowSelfSignedCerts;
}

/**
 * A short readable reason out of a failed answer. Providers disagree about where they put it, and a
 * local model may put it nowhere at all; the status is the one thing that is always there
 *
 * @param response the answer of the endpoint
 */
export function describeHttpError(response: AiHttpResponse): string {
    let detail = '';
    try {
        const parsed = JSON.parse(response.body);
        const message = parsed?.error?.message || parsed?.message || parsed?.error;
        if (typeof message === 'string') {
            detail = message;
        }
    } catch {
        // not JSON, the text itself is what there is
    }
    if (!detail) {
        detail = response.body.substring(0, 200);
    }
    if (response.status === 401 && !detail) {
        detail = 'Invalid API key';
    } else if (response.status === 403 && !detail) {
        detail = 'Access denied';
    }
    return `${detail || 'Request failed'} (${response.status})`;
}

/**
 * Models that refuse function tools unless the reasoning is switched off explicitly.
 *
 * OpenAI answers such a request with "Function tools with reasoning_effort are not supported for
 * <model> ... set reasoning_effort to 'none'". Which models behave that way changes with every
 * release, so they are learned from the error: the first request runs into it and is repeated, every
 * later one carries the parameter right away.
 */
const needReasoningEffortNone = new Set<string>();

function buildChatBody(params: AiChatParams): Record<string, unknown> {
    const { model, messages, tools } = params;
    if (params.provider === 'anthropic') {
        const { system, messages: anthropicMessages } = translateMessagesToAnthropic(messages);
        const anthropicTools = tools?.length ? translateToolsToAnthropic(tools) : [];
        return {
            model,
            // Anthropic requires it; see `resolveMaxTokens` for the range
            max_tokens: params.maxTokens || DEFAULT_AI_MAX_TOKENS,
            stream: false,
            ...(system ? { system } : {}),
            messages: anthropicMessages,
            ...(anthropicTools.length ? { tools: anthropicTools } : {}),
        };
    }
    const effort =
        params.provider === 'openai' || params.provider === 'custom'
            ? needReasoningEffortNone.has(`${params.provider}:${model}`)
                ? 'none'
                : params.reasoningEffort
            : '';
    return {
        model,
        messages,
        stream: false,
        ...(tools?.length ? { tools } : {}),
        ...(effort ? { reasoning_effort: effort } : {}),
    };
}

/**
 * Ask a model once.
 *
 * @param params the connection, the model and the conversation
 * @returns the answer in the OpenAI shape, with stop reason and token counts
 * @throws {AiRequestError} when the request failed or the model answered with nothing
 */
export async function chatCompletion(params: AiChatParams): Promise<AiChatResult> {
    if (!params.model) {
        throw new AiRequestError('No model selected');
    }
    if (!Array.isArray(params.messages) || !params.messages.length) {
        throw new AiRequestError('No messages to send');
    }
    if (!params.apiKey && aiKeyRequired(params)) {
        throw new AiRequestError('No API key provided');
    }

    const url = endpointOf(params, 'chat');
    const send = (body: Record<string, unknown>): Promise<AiHttpResponse> =>
        aiHttpRequest({
            url,
            method: 'POST',
            headers: authHeaders(params),
            body,
            timeoutMs: params.timeoutMs || MAX_AI_REQUEST_TIMEOUT_MS,
            allowSelfSignedCerts: selfSigned(params),
        }).catch(e => {
            throw new AiRequestError(e instanceof Error ? e.message : String(e));
        });

    const body = buildChatBody(params);
    let response = await send(body);

    // The model rejects function tools while it is reasoning. It says so itself, so repeat the
    // request with the reasoning switched off and remember the model for the next time
    if (
        response.status === 400 &&
        body.reasoning_effort === undefined &&
        params.provider !== 'anthropic' &&
        /reasoning_effort/.test(response.body)
    ) {
        needReasoningEffortNone.add(`${params.provider}:${params.model}`);
        response = await send({ ...body, reasoning_effort: 'none' });
    }

    if (response.status < 200 || response.status >= 300) {
        throw new AiRequestError(describeHttpError(response), {}, response.status);
    }

    let parsed: any;
    try {
        parsed = JSON.parse(response.body);
    } catch {
        throw new AiRequestError(`Invalid JSON response from API: ${response.body.substring(0, 200)}`);
    }

    let content: string;
    let toolCalls: OpenAIToolCall[] | undefined;
    if (params.provider === 'anthropic') {
        const translated = translateAnthropicResponseToOpenAI(parsed);
        content = translated.content;
        toolCalls = translated.tool_calls;
    } else {
        const message = parsed?.choices?.[0]?.message;
        content = typeof message?.content === 'string' ? message.content : '';
        toolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length ? message.tool_calls : undefined;
    }

    const info = extractAiResponseInfo(parsed);
    // A whitespace-only answer is just as empty to the user - the stop reason is what helps here
    if (!content.trim() && !toolCalls?.length) {
        const shape =
            params.provider === 'anthropic'
                ? describeAnthropicContent(parsed)
                : `choices: ${parsed?.choices?.length ?? 0}, content: ${typeof parsed?.choices?.[0]?.message?.content}`;
        throw new AiRequestError(`${describeEmptyAiResponse(info, response.body)}. Answer contained: ${shape}`, info);
    }

    return { content, ...(toolCalls ? { tool_calls: toolCalls } : {}), ...info };
}

/**
 * The models a provider offers. It is also the test of a key: a provider that answers with a list
 * has accepted it, one that does not says why.
 *
 * @param connection the provider, its key and its address
 * @param timeoutMs default {@link AI_MODELS_TIMEOUT_MS}
 * @returns the sorted model ids, as they go into a request
 * @throws {AiRequestError} on an invalid key or a connection error
 */
export async function listModels(connection: AiConnection, timeoutMs = AI_MODELS_TIMEOUT_MS): Promise<string[]> {
    if (!connection.apiKey && aiKeyRequired(connection)) {
        throw new AiRequestError('No API key provided');
    }
    let response: AiHttpResponse;
    try {
        response = await aiHttpRequest({
            url: endpointOf(connection, 'models'),
            method: 'GET',
            headers: authHeaders(connection),
            timeoutMs,
            allowSelfSignedCerts: selfSigned(connection),
        });
    } catch (e) {
        throw e instanceof AiRequestError ? e : new AiRequestError(e instanceof Error ? e.message : String(e));
    }
    if (response.status === 401) {
        throw new AiRequestError('Invalid API key (401)', {}, 401);
    }
    if (response.status < 200 || response.status >= 300) {
        throw new AiRequestError(describeHttpError(response), {}, response.status);
    }
    let parsed: any;
    try {
        parsed = JSON.parse(response.body);
    } catch {
        throw new AiRequestError('Invalid JSON response from API');
    }
    // OpenAI and everything that copies it answer with `data`, Anthropic likewise; a `models/` in
    // front of the id is Gemini's own habit
    const list: { id?: string; name?: string }[] = parsed?.data || parsed?.models || [];
    return list
        .map(one => (one?.id || one?.name || '').replace(/^models\//, ''))
        .filter(name => !!name)
        .sort();
}
