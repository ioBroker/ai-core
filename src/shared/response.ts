/**
 * Reading how a chat endpoint finished: the stop reason and the token counts, and what to tell the
 * user when an answer arrived without any content.
 */
import type { AiResponseInfo } from './types';

/** The handful of fields of a chat-completion response that say how it ended. */
export interface AiRawResponse {
    stop_reason?: unknown;
    choices?: { finish_reason?: unknown }[];
    usage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
    };
}

function toCount(value: unknown): number | undefined {
    return typeof value === 'number' && isFinite(value) ? value : undefined;
}

/**
 * Pull the "why did it stop" fields out of a chat-completion response.
 *
 * Anthropic and the OpenAI-compatible endpoints spell both the reason and the token counts
 * differently. The adapter normalizes them and passes them on to the editor, so an answer that
 * was cut off or filtered can say so instead of arriving as an empty chat bubble.
 */
export function extractAiResponseInfo(parsed: AiRawResponse | null | undefined): AiResponseInfo {
    const info: AiResponseInfo = {};
    const reason = parsed?.stop_reason ?? parsed?.choices?.[0]?.finish_reason;
    if (typeof reason === 'string' && reason) {
        info.finishReason = reason;
    }
    const input = toCount(parsed?.usage?.input_tokens ?? parsed?.usage?.prompt_tokens);
    const output = toCount(parsed?.usage?.output_tokens ?? parsed?.usage?.completion_tokens);
    if (input !== undefined || output !== undefined) {
        info.usage = {
            ...(input !== undefined ? { input } : {}),
            ...(output !== undefined ? { output } : {}),
        };
    }
    return info;
}

/**
 * Why a 200 OK answer carried neither text nor a tool call.
 *
 * "Empty response from API" is true but useless - it sends the user looking for a broken key
 * when the usual cause is a model that spent its whole output budget on reasoning tokens. The
 * endpoint nearly always says why it stopped, so repeat that, and append a slice of the raw
 * body for the cases where it does not.
 *
 * @param info the normalized stop reason and token counts
 * @param rawBody the response body as it came off the wire
 */
export function describeEmptyAiResponse(info: AiResponseInfo, rawBody?: string): string {
    let why: string;
    switch (info.finishReason) {
        case 'max_tokens':
        case 'length':
            why = 'the model used up its output budget before writing an answer';
            break;
        case 'content_filter':
        case 'refusal':
            why = 'the endpoint filtered the answer away';
            break;
        case 'tool_use':
        case 'tool_calls':
            why = 'the model wanted to call a tool, but the answer carried no readable tool call';
            break;
        default:
            why = info.finishReason ? `the endpoint stopped with "${info.finishReason}"` : '';
            break;
    }
    const details: string[] = [];
    if (info.finishReason) {
        details.push(`stop reason: ${info.finishReason}`);
    }
    if (info.usage?.input !== undefined || info.usage?.output !== undefined) {
        details.push(`tokens in/out: ${info.usage?.input ?? '?'}/${info.usage?.output ?? '?'}`);
    }
    let message = 'The API answered without any content';
    if (why) {
        message += ` - ${why}`;
    }
    if (details.length) {
        message += ` (${details.join(', ')})`;
    }
    // Only worth showing when the endpoint told us nothing usable at all
    if (!info.finishReason && rawBody) {
        message += `. Response: ${rawBody.substring(0, 200)}`;
    }
    return message;
}
