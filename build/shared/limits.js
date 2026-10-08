"use strict";
/**
 * The budgets of a request: how long to wait for it and how much the model may write.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_AI_MAX_TOKENS = exports.MIN_AI_MAX_TOKENS = exports.DEFAULT_AI_MAX_TOKENS = exports.AI_MODELS_TIMEOUT_MS = exports.MIN_AI_REQUEST_TIMEOUT_MS = exports.MAX_AI_REQUEST_TIMEOUT_MS = void 0;
exports.resolveRequestTimeout = resolveRequestTimeout;
exports.resolveMaxTokens = resolveMaxTokens;
/** Ceiling for one AI request, and the budget when the caller names none */
exports.MAX_AI_REQUEST_TIMEOUT_MS = 600_000;
/** Below this not even a local model gets a chance to answer */
exports.MIN_AI_REQUEST_TIMEOUT_MS = 1_000;
/** How long a model list may take - it is also the test of a key, and somebody waits for it */
exports.AI_MODELS_TIMEOUT_MS = 30_000;
/** What Anthropic gets as `max_tokens` when the setting is empty or unusable */
exports.DEFAULT_AI_MAX_TOKENS = 8192;
/** Smallest `max_tokens` worth sending: below that not even a short answer with its reasoning fits */
exports.MIN_AI_MAX_TOKENS = 1024;
/** Highest `max_tokens` the setting may ask for - beyond this every current model answers 400 */
exports.MAX_AI_MAX_TOKENS = 200_000;
/**
 * How long to wait for an AI endpoint, from the `timeout` the caller put in the message.
 *
 * An inline completion asks for a short budget because it must not sit on the editor, a chat panel
 * for a long one because a reasoning model takes its time.
 *
 * @param requested the value from the sendTo message, in milliseconds
 */
function resolveRequestTimeout(requested) {
    const value = parseInt(requested, 10);
    // Nothing usable, or a zero - which is how Node itself spells "no timeout" - gets the ceiling
    if (isNaN(value) || value <= 0) {
        return exports.MAX_AI_REQUEST_TIMEOUT_MS;
    }
    return Math.min(Math.max(value, exports.MIN_AI_REQUEST_TIMEOUT_MS), exports.MAX_AI_REQUEST_TIMEOUT_MS);
}
/**
 * The output budget for an Anthropic request.
 *
 * Anthropic insists on `max_tokens`, so there is no "let the endpoint decide". Too small and a
 * generated answer is cut off mid-line; too large and the model rejects the request outright, so
 * the configured value is clamped into a range every model can live with.
 *
 * @param configured the value from the settings
 */
function resolveMaxTokens(configured) {
    const value = parseInt(configured, 10);
    if (isNaN(value) || value <= 0) {
        return exports.DEFAULT_AI_MAX_TOKENS;
    }
    return Math.min(Math.max(value, exports.MIN_AI_MAX_TOKENS), exports.MAX_AI_MAX_TOKENS);
}
//# sourceMappingURL=limits.js.map