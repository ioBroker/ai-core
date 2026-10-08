/**
 * Translation layer between OpenAI-style chat-completion messages/tools and
 * Anthropic's native Messages API.
 *
 * The editors and the tool loop always speak the OpenAI format:
 *   - tools[] = [{ type: 'function', function: { name, description, parameters } }]
 *   - assistant message with tool_calls[] = [{ id, type: 'function', function: { name, arguments } }]
 *   - tool-result message with { role: 'tool', tool_call_id, content }
 *   - response = { content, tool_calls? }
 *
 * Anthropic's API uses a different shape:
 *   - tools[] = [{ name, description, input_schema }]
 *   - assistant message content = [{ type: 'text', text }, { type: 'tool_use', id, name, input }]
 *   - tool-result = user message with content = [{ type: 'tool_result', tool_use_id, content }]
 *   - response body = { content: [text/tool_use blocks], stop_reason }
 *
 * These functions are pure so they can be unit-tested in isolation, and work in Node.js and in the
 * browser alike.
 */
import type { OpenAIMessage, OpenAIToolCall } from './types';
export interface AnthropicTool {
    name: string;
    description?: string;
    input_schema: unknown;
}
type AnthropicContentBlock = {
    type: 'text';
    text: string;
} | {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
} | {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
};
export interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | AnthropicContentBlock[];
}
export interface AnthropicResponse {
    content?: AnthropicContentBlock[];
    stop_reason?: string;
    [key: string]: unknown;
}
/** Translate OpenAI function-tool definitions to Anthropic tool definitions. */
export declare function translateToolsToAnthropic(tools: unknown[] | undefined | null): AnthropicTool[];
/**
 * Translate a flat OpenAI-style message array into Anthropic's content-block format.
 *  System messages are extracted and returned separately (Anthropic takes `system`
 *  as a top-level request field, not an inline message).
 */
export declare function translateMessagesToAnthropic(messages: OpenAIMessage[] | undefined | null): {
    system: string;
    messages: AnthropicMessage[];
};
/**
 * Translate an Anthropic Messages API response back into the OpenAI-style
 *  `{ content, tool_calls }` shape that the callers already understand.
 */
export declare function translateAnthropicResponseToOpenAI(response: AnthropicResponse | undefined | null): {
    content: string;
    tool_calls?: OpenAIToolCall[];
};
/**
 * Name the content blocks an answer consists of, for the log.
 *
 * When the translation above comes back empty although the endpoint reported a normal end and a
 * few hundred output tokens, the whole question is *what* it sent instead - a `thinking` block, a
 * block type that did not exist when this was written, an empty text. Without this the log can
 * only say "no content", which is the one thing already known.
 *
 * @param response the parsed answer of the Anthropic API
 */
export declare function describeAnthropicContent(response: AnthropicResponse | undefined | null): string;
export {};
