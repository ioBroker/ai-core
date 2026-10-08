"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_AI_TOOL_ROUNDS = void 0;
exports.parseToolArguments = parseToolArguments;
exports.runToolLoop = runToolLoop;
/** How many rounds of tool calls a turn may take when the caller names no limit */
exports.DEFAULT_AI_TOOL_ROUNDS = 8;
/**
 * The arguments of a tool call as an object. A model that writes broken JSON gets an empty object -
 * the tool then says which argument is missing, which the model understands better than a parse error
 *
 * @param call the call as the model wrote it
 */
function parseToolArguments(call) {
    try {
        const parsed = JSON.parse(call.function?.arguments || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
/**
 * Run one turn of the conversation.
 *
 * @param options the model, the tools and what to report on the way
 */
async function runToolLoop(options) {
    const maxRounds = options.maxRounds ?? exports.DEFAULT_AI_TOOL_ROUNDS;
    const tools = options.tools?.length ? options.tools : undefined;
    const conversation = [...options.messages];
    const newMessages = [];
    let answer = null;
    let rounds = 0;
    const add = (message) => {
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
            let result;
            try {
                result = await options.runTool(call, parseToolArguments(call));
            }
            catch (e) {
                result = `Error: ${e instanceof Error ? e.message : String(e)}`;
            }
            options.onToolResult?.(call, result);
            add({ role: 'tool', tool_call_id: call.id, content: result });
        }
    }
}
//# sourceMappingURL=toolLoop.js.map