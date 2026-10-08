"use strict";
/**
 * The message format every part of the ioBroker AI speaks: the OpenAI chat-completion format.
 *
 * Every provider but Anthropic understands it natively; Anthropic is translated on the way in and on
 * the way out (see `anthropic.ts`). The browser, the adapter and the tool loop therefore only ever
 * see this one shape.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_PROVIDERS = void 0;
exports.isAiProvider = isAiProvider;
/** All providers, in the order they are offered */
exports.AI_PROVIDERS = ['openai', 'anthropic', 'gemini', 'deepseek', 'custom'];
/** Whether a value names a known provider */
function isAiProvider(value) {
    return typeof value === 'string' && exports.AI_PROVIDERS.includes(value);
}
//# sourceMappingURL=types.js.map