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
export declare const DEFAULT_AI_TOOL_ROUNDS = 8;
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
export declare function parseToolArguments(call: OpenAIToolCall): Record<string, unknown>;
/**
 * Run one turn of the conversation.
 *
 * @param options the model, the tools and what to report on the way
 */
export declare function runToolLoop(options: AiToolLoopOptions): Promise<AiToolLoopResult>;
