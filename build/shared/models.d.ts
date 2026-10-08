/**
 * What to make of the models a provider lists, and of what a model answered.
 */
import type { AiResponseInfo } from './types';
export declare function isChatModel(name: string): boolean;
/** Strip LLM thinking artifacts from response content */
export declare function stripThinkingArtifacts(content: string): string;
/**
 * Whether the endpoint stopped because it ran out of output budget rather than because it was done.
 *
 * Anthropic says `max_tokens`, the OpenAI-compatible ones say `length`. In both cases the answer
 * ends mid-word and is worthless as code, so it must not look like a finished reply.
 *
 * @param result the response as the adapter passed it on
 */
export declare function isTruncatedAnswer(result: AiResponseInfo): boolean;
