"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_PUSH_MESSAGE_TYPE = exports.AI_COMMANDS = void 0;
/** The commands an adapter with `AiBackend` answers */
exports.AI_COMMANDS = {
    /** Which providers are configured, see {@link AiProvidersResponse} */
    providers: 'ai:providers',
    /** The models of one provider, also the test of a key, see {@link AiModelsRequest} */
    models: 'ai:models',
    /** One request to a model, see {@link AiChatRequest} */
    chat: 'ai:chat',
};
/** Type of the subscription (and of the pushed message) that carries answers to the browser */
exports.AI_PUSH_MESSAGE_TYPE = 'aiChatAnswer';
//# sourceMappingURL=protocol.js.map