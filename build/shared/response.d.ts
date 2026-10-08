/**
 * Reading how a chat endpoint finished: the stop reason and the token counts, and what to tell the
 * user when an answer arrived without any content.
 */
import type { AiResponseInfo } from './types';
/** The handful of fields of a chat-completion response that say how it ended. */
export interface AiRawResponse {
    stop_reason?: unknown;
    choices?: {
        finish_reason?: unknown;
    }[];
    usage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
    };
}
/**
 * Pull the "why did it stop" fields out of a chat-completion response.
 *
 * Anthropic and the OpenAI-compatible endpoints spell both the reason and the token counts
 * differently. The adapter normalizes them and passes them on to the editor, so an answer that
 * was cut off or filtered can say so instead of arriving as an empty chat bubble.
 */
export declare function extractAiResponseInfo(parsed: AiRawResponse | null | undefined): AiResponseInfo;
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
export declare function describeEmptyAiResponse(info: AiResponseInfo, rawBody?: string): string;
