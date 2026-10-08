import type { AiChatResult, AiProvider, AiReasoningEffort, AiResponseInfo, OpenAIMessage, OpenAITool } from '../shared/types';
import { type AiHttpResponse } from './http';
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
export declare class AiRequestError extends Error {
    /** Stop reason and token counts, when the endpoint answered */
    readonly info: AiResponseInfo;
    /** HTTP status, when the endpoint answered */
    readonly status?: number | undefined;
    constructor(message: string, 
    /** Stop reason and token counts, when the endpoint answered */
    info?: AiResponseInfo, 
    /** HTTP status, when the endpoint answered */
    status?: number | undefined);
}
/**
 * Whether a provider can be asked without a key. Only an endpoint of one's own can - a local Ollama
 * has no key at all
 *
 * @param connection the provider and its address
 */
export declare function aiKeyRequired(connection: Pick<AiConnection, 'provider' | 'baseUrl'>): boolean;
/**
 * A short readable reason out of a failed answer. Providers disagree about where they put it, and a
 * local model may put it nowhere at all; the status is the one thing that is always there
 *
 * @param response the answer of the endpoint
 */
export declare function describeHttpError(response: AiHttpResponse): string;
/**
 * Ask a model once.
 *
 * @param params the connection, the model and the conversation
 * @returns the answer in the OpenAI shape, with stop reason and token counts
 * @throws {AiRequestError} when the request failed or the model answered with nothing
 */
export declare function chatCompletion(params: AiChatParams): Promise<AiChatResult>;
/**
 * The models a provider offers. It is also the test of a key: a provider that answers with a list
 * has accepted it, one that does not says why.
 *
 * @param connection the provider, its key and its address
 * @param timeoutMs default {@link AI_MODELS_TIMEOUT_MS}
 * @returns the sorted model ids, as they go into a request
 * @throws {AiRequestError} on an invalid key or a connection error
 */
export declare function listModels(connection: AiConnection, timeoutMs?: number): Promise<string[]>;
