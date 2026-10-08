/**
 * The agent loop: ask the model, run the tools it asks for, give it the results, ask again - until it
 * answers without a tool call.
 *
 * It knows neither where the model is nor what the tools do, so the same loop runs in the browser
 * (javascript, vis-2: the tools act with the rights of the logged-in user) and in an adapter (admin:
 * the tools run behind its own gate).
 */
import type { AiChatResult, OpenAIMessage, OpenAITool, OpenAIToolCall } from './types';

/** How many rounds of tool calls a turn may take when the caller names no limit */
export const DEFAULT_AI_TOOL_ROUNDS = 8;

export interface AiToolLoopOptions {
    /** The conversation so far, system prompt included */
    messages: OpenAIMessage[];
    /** The tools the model is offered. Without them the loop is a single request */
    tools?: OpenAITool[];
    /** One request to the model. Throws on an error */
    ask: (messages: OpenAIMessage[], tools: OpenAITool[] | undefined) => Promise<AiChatResult>;
    /**
     * Runs one tool call and returns what the model gets to read. A thrown error is handed to the model
     * as the result, so it can react to it
     */
    runTool: (call: OpenAIToolCall, args: Record<string, unknown>) => Promise<string>;
    /** Most rounds of tool calls in one turn, default {@link DEFAULT_AI_TOOL_ROUNDS} */
    maxRounds?: number;
    /**
     * When the rounds are used up, ask once more without tools so the turn still ends with an answer.
     * Otherwise the turn ends with whatever the last round said
     */
    finalAnswerWithoutTools?: boolean;
    /** Asked before every request - `true` ends the turn, e.g. after the user pressed Stop */
    shouldStop?: () => boolean;
    /** Every answer of the model, as soon as it arrives */
    onAnswer?: (answer: AiChatResult, round: number) => void;
    /** Every tool result, as soon as it is there */
    onToolResult?: (call: OpenAIToolCall, result: string) => void;
}

export interface AiToolLoopResult {
    /** The text of the last answer */
    content: string;
    /** The last answer as it came */
    answer: AiChatResult | null;
    /** Everything this turn added to the conversation: answers and tool results */
    newMessages: OpenAIMessage[];
    /** Rounds with tool calls */
    rounds: number;
    /** The turn ended because `shouldStop` said so */
    stopped: boolean;
    /** The turn ended because the rounds were used up */
    exhausted: boolean;
}

/**
 * The arguments of a tool call as an object. A model that writes broken JSON gets an empty object -
 * the tool then says which argument is missing, which the model understands better than a parse error
 *
 * @param call the call as the model wrote it
 */
export function parseToolArguments(call: OpenAIToolCall): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(call.function?.arguments || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

/**
 * Run one turn of the conversation.
 *
 * @param options the model, the tools and what to report on the way
 */
export async function runToolLoop(options: AiToolLoopOptions): Promise<AiToolLoopResult> {
    const maxRounds = options.maxRounds ?? DEFAULT_AI_TOOL_ROUNDS;
    const tools = options.tools?.length ? options.tools : undefined;
    const conversation = [...options.messages];
    const newMessages: OpenAIMessage[] = [];
    let answer: AiChatResult | null = null;
    let rounds = 0;

    const add = (message: OpenAIMessage): void => {
        conversation.push(message);
        newMessages.push(message);
    };

    for (;;) {
        if (options.shouldStop?.()) {
            return { content: answer?.content || '', answer, newMessages, rounds, stopped: true, exhausted: false };
        }
        const exhausted = rounds >= maxRounds;
        if (exhausted && !options.finalAnswerWithoutTools) {
            return { content: answer?.content || '', answer, newMessages, rounds, stopped: false, exhausted: true };
        }

        answer = await options.ask(conversation, exhausted ? undefined : tools);
        options.onAnswer?.(answer, rounds);

        const calls = exhausted ? [] : answer.tool_calls || [];
        add({
            role: 'assistant',
            content: answer.content || '',
            ...(calls.length ? { tool_calls: calls } : {}),
        });

        if (!calls.length) {
            return { content: answer.content || '', answer, newMessages, rounds, stopped: false, exhausted };
        }

        rounds++;
        for (const call of calls) {
            let result: string;
            try {
                result = await options.runTool(call, parseToolArguments(call));
            } catch (e) {
                result = `Error: ${e instanceof Error ? e.message : String(e)}`;
            }
            options.onToolResult?.(call, result);
            add({ role: 'tool', tool_call_id: call.id, content: result });
        }
    }
}
