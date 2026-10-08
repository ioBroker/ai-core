/**
 * The message format every part of the ioBroker AI speaks: the OpenAI chat-completion format.
 *
 * Every provider but Anthropic understands it natively; Anthropic is translated on the way in and on
 * the way out (see `anthropic.ts`). The browser, the adapter and the tool loop therefore only ever
 * see this one shape.
 */

/** The providers an adapter can talk to */
export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'custom';

/** All providers, in the order they are offered */
export const AI_PROVIDERS: readonly AiProvider[] = ['openai', 'anthropic', 'gemini', 'deepseek', 'custom'];

/** Whether a value names a known provider */
export function isAiProvider(value: unknown): value is AiProvider {
    return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);
}

/**
 * `reasoning_effort` for the OpenAI-compatible providers. An empty value leaves the parameter out
 * and lets the endpoint decide - which is what a hosted reasoning model wants.
 */
export type AiReasoningEffort = '' | 'none' | 'minimal' | 'low' | 'medium' | 'high';

/** A function tool, as the model is offered it */
export interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: unknown;
    };
}

/** A call of a tool, as the model asks for it */
export interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        /** The arguments as a JSON string */
        arguments: string;
    };
}

/** One message of a conversation */
export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | null;
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string;
    name?: string;
}

/** What a chat endpoint reported about how it finished a completion */
export interface AiResponseInfo {
    /** Anthropic's `stop_reason` or the OpenAI-compatible `finish_reason`, when the endpoint sends one */
    finishReason?: string;
    /** Token counts, as far as the endpoint reports them */
    usage?: { input?: number; output?: number };
}

/** The answer of a model */
export interface AiChatResult extends AiResponseInfo {
    content: string;
    tool_calls?: OpenAIToolCall[];
}
