/**
 * The sendTo protocol between an editor in the browser and the adapter that talks to the model.
 *
 * The browser never sees a key: it names a provider, the adapter adds the key from its own
 * configuration or from the credential store. A socket callback dies after thirty seconds, a model
 * often needs longer - so an editor that subscribed for pushed answers (`AI_PUSH_MESSAGE_TYPE`)
 * gets the callback answered at once with `{ accepted: true }`, and the answer itself later as an
 * instance message.
 */
import type { AiChatResult, AiProvider, OpenAIMessage, OpenAITool } from './types';
/** The commands an adapter with `AiBackend` answers */
export declare const AI_COMMANDS: {
    /** Which providers are configured, see {@link AiProvidersResponse} */
    readonly providers: "ai:providers";
    /** The models of one provider, also the test of a key, see {@link AiModelsRequest} */
    readonly models: "ai:models";
    /** One request to a model, see {@link AiChatRequest} */
    readonly chat: "ai:chat";
};
export type AiCommand = (typeof AI_COMMANDS)[keyof typeof AI_COMMANDS];
/** Type of the subscription (and of the pushed message) that carries answers to the browser */
export declare const AI_PUSH_MESSAGE_TYPE = "aiChatAnswer";
/** Answer of `ai:providers`. Never contains a key */
export interface AiProvidersResponse {
    providers: {
        provider: AiProvider;
        baseUrl?: string;
    }[];
}
/**
 * Request of `ai:models`.
 *
 * Without any field it lists the models of the stored configuration. The settings dialog sends what
 * stands in its form, so a key can be tested before it is saved - see `resolveTestEndpoint` for what
 * the form may decide.
 */
export interface AiModelsRequest {
    provider: AiProvider;
    /** A key typed into the form, not saved yet */
    apiKey?: string;
    /** An address typed into the form - only honoured together with `apiKey` and only for `custom` */
    baseUrl?: string;
    /** A credential chosen in the form, not saved yet */
    credentialId?: string;
    /** The credential mode chosen in the form */
    credentialType?: 'manual' | 'manager';
}
/** Answer of `ai:models`. `result` is what a jsonConfig `sendTo` button shows */
export type AiModelsResponse = {
    success: true;
    models: string[];
    count: number;
    result: string;
} | {
    success?: false;
    error: string;
};
/** Request of `ai:chat` */
export interface AiChatRequest {
    provider: AiProvider;
    model: string;
    messages: OpenAIMessage[];
    tools?: OpenAITool[];
    /** How long the caller is willing to wait, in milliseconds */
    timeout?: number;
    /** Token of the push subscription of this editor, see `AI_PUSH_MESSAGE_TYPE` */
    uiSession?: string;
    /** Id of this request, repeated in the pushed answer */
    requestId?: string;
}
/** Answer of `ai:chat` */
export type AiChatResponse = ({
    success: true;
} & AiChatResult) | {
    success?: false;
    error: string;
    finishReason?: string;
    usage?: AiChatResult['usage'];
};
/** What the callback of `ai:chat` gets when the answer is pushed later */
export interface AiAcceptedResponse {
    accepted: true;
    requestId: string;
}
/** The pushed answer, as it arrives at the subscription */
export type AiPushedAnswer = AiChatResponse & {
    type: typeof AI_PUSH_MESSAGE_TYPE;
    requestId: string;
};
