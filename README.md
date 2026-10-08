# @iobroker/ai-core

The AI backend shared by `admin`, `javascript` and `vis-2`: talking to the LLM providers, the AI settings
of an adapter, the API keys of the credential store and the sendTo protocol between an editor and its
adapter. The matching React components are in [`@iobroker/ai-gui`](https://github.com/ioBroker/ai-gui).

Providers: OpenAI, Anthropic, Google Gemini, DeepSeek and any OpenAI-compatible endpoint (`custom`:
Ollama, LM Studio, OpenRouter, ...). Everything speaks the OpenAI chat-completion format; Anthropic is
translated on the way in and out.

## The rule behind it

Endpoint and key come from the configuration, never from a message. The browser names a provider, the
adapter adds the key. A key travels with the request as its authorization - a caller who could name the
address could have the adapter carry the key to a host of their own. The one exception is the Test button
of the settings dialog: an address typed into the form counts only together with a key typed into the
form, and only for `custom` (`resolveTestEndpoint`).

## Use in an adapter

```ts
import { AiBackend, readAiSettings, type AiNativeFields } from '@iobroker/ai-core';

/** What the AI fields are called in the `native` of this adapter */
const AI_FIELDS: AiNativeFields = {
    credentialType: 'aiCredentialType', // 'manual' | 'manager'
    keys: { openai: 'aiOpenAiKey', anthropic: 'aiAnthropicKey', custom: 'aiCustomKey' },
    credentialIds: { openai: 'aiCredentialOpenAi', anthropic: 'aiCredentialAnthropic' },
    customBaseUrl: 'aiCustomUrl',
    maxTokens: 'aiMaxTokens',
};

class MyAdapter extends Adapter {
    private ai = new AiBackend(this, {
        getSettings: () => readAiSettings(this.config, AI_FIELDS),
        // command names an older editor of this adapter still sends
        aliases: { aiChat: 'ai:chat', aiModels: 'ai:models', getAvailableAiProviders: 'ai:providers' },
    });

    constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'my-adapter',
            // pushed answers - a socket callback lives 30 s, a model often needs longer
            uiClientSubscribe: info => this.ai.onUiClientSubscribe(info) ?? { accepted: false },
            uiClientUnsubscribe: info => this.ai.onUiClientUnsubscribe(info),
        });
        this.on('ready', () => this.ai.start());
        this.on('unload', cb => void this.ai.stop().finally(cb));
        this.on('message', obj => {
            if (this.ai.handleMessage(obj)) {
                return;
            }
            // ... the other commands of the adapter
        });
    }
}
```

The keys have to be in `encryptedNative` and `protectedNative` of `io-package.json`, and the adapter
needs `common.messagebox: true`.

The system-wide settings of `system.ai` (admin's assistant settings) are read with
`readSystemAiSettings(adapter)` into the same `AiSettings` shape.

## Commands

| Command        | Request                                                                         | Answer                                                                    |
|----------------|---------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| `ai:providers` | -                                                                               | `{ providers: [{ provider, baseUrl? }] }`, never a key                    |
| `ai:models`    | `{ provider, apiKey?, baseUrl?, credentialId?, credentialType? }` (form values) | `{ success, models, count, result }` or `{ error }`                       |
| `ai:chat`      | `{ provider, model, messages, tools?, timeout?, uiSession?, requestId? }`       | `{ success, content, tool_calls?, finishReason?, usage? }` or `{ error }` |

An editor that subscribed with `subscribeOnInstance(instance, 'aiChatAnswer', { sessionToken })` and sends
`uiSession` + `requestId` gets `{ accepted: true, requestId }` at once and the answer as a pushed message
`{ type: 'aiChatAnswer', requestId, ... }`.

## Building blocks

- `chatCompletion(params)`, `listModels(connection)` - one request to a provider; throw `AiRequestError`
- `readAiSettings(native, fields)`, `systemAiSettings(native)`, `listAvailableProviders(settings)`,
  `resolveTestEndpoint(settings, provider, form)`
- `AiCredentialStore` - reads keys of type `ai` from `system.credentials.*` and follows their changes
- `runToolLoop(options)` - the agent loop: ask, run the tools, ask again
- `translateMessagesToAnthropic`, `translateToolsToAnthropic`, `translateAnthropicResponseToOpenAI`
- `resolveRequestTimeout`, `resolveMaxTokens`, `extractAiResponseInfo`, `describeEmptyAiResponse`,
  `isChatModel`, `stripThinkingArtifacts`, `isTruncatedAnswer`

Everything in `build/shared` imports no Node.js module and can be used in the browser:

```ts
import { runToolLoop, type OpenAIMessage } from '@iobroker/ai-core/build/shared';
```

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**
- (@GermanBluefox) Initial version: providers, settings, credentials and the sendTo protocol taken from admin, javascript and vis-2

## License
MIT License

Copyright (c) 2026 ioBroker Community Developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
