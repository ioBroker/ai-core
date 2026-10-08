/**
 * The budgets of a request: how long to wait for it and how much the model may write.
 */
/** Ceiling for one AI request, and the budget when the caller names none */
export declare const MAX_AI_REQUEST_TIMEOUT_MS = 600000;
/** Below this not even a local model gets a chance to answer */
export declare const MIN_AI_REQUEST_TIMEOUT_MS = 1000;
/** How long a model list may take - it is also the test of a key, and somebody waits for it */
export declare const AI_MODELS_TIMEOUT_MS = 30000;
/** What Anthropic gets as `max_tokens` when the setting is empty or unusable */
export declare const DEFAULT_AI_MAX_TOKENS = 8192;
/** Smallest `max_tokens` worth sending: below that not even a short answer with its reasoning fits */
export declare const MIN_AI_MAX_TOKENS = 1024;
/** Highest `max_tokens` the setting may ask for - beyond this every current model answers 400 */
export declare const MAX_AI_MAX_TOKENS = 200000;
/**
 * How long to wait for an AI endpoint, from the `timeout` the caller put in the message.
 *
 * An inline completion asks for a short budget because it must not sit on the editor, a chat panel
 * for a long one because a reasoning model takes its time.
 *
 * @param requested the value from the sendTo message, in milliseconds
 */
export declare function resolveRequestTimeout(requested?: unknown): number;
/**
 * The output budget for an Anthropic request.
 *
 * Anthropic insists on `max_tokens`, so there is no "let the endpoint decide". Too small and a
 * generated answer is cut off mid-line; too large and the model rejects the request outright, so
 * the configured value is clamped into a range every model can live with.
 *
 * @param configured the value from the settings
 */
export declare function resolveMaxTokens(configured?: unknown): number;
