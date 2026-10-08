const assert = require('node:assert').strict;
const {
    readAiSettings,
    systemAiSettings,
    baseUrlOf,
    isProviderConfigured,
    listAvailableProviders,
    resolveTestEndpoint,
    DEFAULT_AI_MAX_TOKENS,
} = require('../build');

/** The fields of the javascript adapter */
const JAVASCRIPT_FIELDS = {
    credentialType: 'credentialType',
    keys: {
        openai: 'gptKey',
        anthropic: 'claudeKey',
        gemini: 'geminiKey',
        deepseek: 'deepseekKey',
        custom: 'gptBaseUrlKey',
    },
    credentialIds: {
        openai: 'credentialIdGptKey',
        anthropic: 'credentialIdClaudeKey',
        gemini: 'credentialIdGeminiKey',
        deepseek: 'credentialIdDeepseekKey',
        custom: 'credentialIdGptBaseUrlKey',
    },
    customBaseUrl: 'gptBaseUrl',
    allowSelfSignedCerts: 'allowSelfSignedCerts',
    maxTokens: 'aiMaxTokens',
    reasoningEffort: 'aiReasoningEffort',
};

/** The fields of vis-2 */
const VIS_FIELDS = {
    credentialType: 'aiCredentialType',
    keys: {
        openai: 'aiOpenAiKey',
        anthropic: 'aiAnthropicKey',
        gemini: 'aiGeminiKey',
        deepseek: 'aiDeepSeekKey',
        custom: 'aiCustomKey',
    },
    credentialIds: {
        openai: 'aiCredentialOpenAi',
        anthropic: 'aiCredentialAnthropic',
        gemini: 'aiCredentialGemini',
        deepseek: 'aiCredentialDeepSeek',
        custom: 'aiCredentialCustom',
    },
    customBaseUrl: 'aiCustomUrl',
    maxTokens: 'aiMaxTokens',
};

describe('Test AI settings', function () {
    describe('readAiSettings', function () {
        it('reads the fields of javascript', function () {
            const settings = readAiSettings(
                {
                    gptKey: ' sk-openai ',
                    claudeKey: 'sk-ant',
                    gptBaseUrl: 'http://ollama:11434/v1',
                    aiMaxTokens: '32000',
                    aiReasoningEffort: 'low',
                    allowSelfSignedCerts: true,
                },
                JAVASCRIPT_FIELDS,
            );
            assert.equal(settings.credentialType, 'manual');
            assert.deepEqual(settings.keys, { openai: 'sk-openai', anthropic: 'sk-ant' });
            assert.equal(settings.customBaseUrl, 'http://ollama:11434/v1');
            assert.equal(settings.maxTokens, 32000);
            assert.equal(settings.reasoningEffort, 'low');
            assert.equal(settings.allowSelfSignedCerts, true);
        });

        it('reads the fields of vis-2 in manager mode', function () {
            const settings = readAiSettings(
                { aiCredentialType: 'manager', aiCredentialAnthropic: 'system.credentials.anthropic' },
                VIS_FIELDS,
            );
            assert.equal(settings.credentialType, 'manager');
            assert.deepEqual(settings.credentialIds, { anthropic: 'system.credentials.anthropic' });
            assert.equal(settings.maxTokens, DEFAULT_AI_MAX_TOKENS);
            assert.equal(settings.reasoningEffort, '');
        });

        it('takes an unknown reasoning effort as none set', function () {
            assert.equal(readAiSettings({ aiReasoningEffort: 'turbo' }, JAVASCRIPT_FIELDS).reasoningEffort, '');
        });

        it('copes with a missing configuration', function () {
            const settings = readAiSettings(undefined, JAVASCRIPT_FIELDS);
            assert.deepEqual(settings.keys, {});
            assert.equal(settings.customBaseUrl, '');
        });

        it('does not take an object for a key', function () {
            assert.deepEqual(readAiSettings({ gptKey: { a: 1 } }, JAVASCRIPT_FIELDS).keys, {});
        });
    });

    describe('systemAiSettings', function () {
        it('turns system.ai into a manager configuration with one provider', function () {
            const settings = systemAiSettings({
                provider: 'anthropic',
                model: 'claude-sonnet-4-5',
                credentialId: 'system.credentials.claude',
                baseUrl: 'http://ignored',
            });
            assert.equal(settings.credentialType, 'manager');
            assert.deepEqual(settings.credentialIds, { anthropic: 'system.credentials.claude' });
            assert.equal(settings.customBaseUrl, '');
            assert.equal(settings.defaultProvider, 'anthropic');
            assert.equal(settings.defaultModel, 'claude-sonnet-4-5');
        });

        it('keeps the address only for the custom provider', function () {
            assert.equal(
                systemAiSettings({ provider: 'custom', baseUrl: 'http://lm:1234/v1' }).customBaseUrl,
                'http://lm:1234/v1',
            );
        });

        it('ignores an unknown provider', function () {
            assert.equal(systemAiSettings({ provider: 'skynet' }).defaultProvider, undefined);
        });
    });

    describe('custom endpoint and openai stay separate (javascript #2369)', function () {
        const settings = readAiSettings({ gptKey: 'sk-real', gptBaseUrl: 'http://evil:1/v1' }, JAVASCRIPT_FIELDS);

        it('sends only custom to the stored address', function () {
            assert.equal(baseUrlOf(settings, 'custom'), 'http://evil:1/v1');
            for (const provider of ['openai', 'anthropic', 'gemini', 'deepseek']) {
                assert.equal(baseUrlOf(settings, provider), '', provider);
            }
        });
    });

    describe('listAvailableProviders', function () {
        it('lists providers with a key, custom by its address, and never a key', function () {
            const settings = readAiSettings(
                { gptKey: 'sk-1', deepseekKey: 'sk-2', gptBaseUrl: 'http://ollama/v1' },
                JAVASCRIPT_FIELDS,
            );
            const list = listAvailableProviders(settings);
            assert.deepEqual(list, [
                { provider: 'openai' },
                { provider: 'deepseek' },
                { provider: 'custom', baseUrl: 'http://ollama/v1' },
            ]);
            assert.ok(!JSON.stringify(list).includes('sk-'));
        });

        it('lists by credential id in manager mode, ignoring manual keys', function () {
            const settings = readAiSettings(
                { credentialType: 'manager', gptKey: 'sk-1', credentialIdClaudeKey: 'system.credentials.c' },
                JAVASCRIPT_FIELDS,
            );
            assert.deepEqual(listAvailableProviders(settings), [{ provider: 'anthropic' }]);
            assert.ok(!isProviderConfigured(settings, 'openai'));
        });
    });

    describe('resolveTestEndpoint', function () {
        const settings = readAiSettings({ gptBaseUrl: 'http://stored/v1' }, JAVASCRIPT_FIELDS);

        it('takes the address of the form together with a key of the form', function () {
            assert.equal(
                resolveTestEndpoint(settings, 'custom', { apiKey: 'mine', baseUrl: 'http://mine/v1' }),
                'http://mine/v1',
            );
        });

        it('ignores the address of the form without a key of the form', function () {
            assert.equal(resolveTestEndpoint(settings, 'custom', { baseUrl: 'http://evil/v1' }), 'http://stored/v1');
        });

        it('ignores an address for a provider that has none', function () {
            assert.equal(resolveTestEndpoint(settings, 'openai', { apiKey: 'k', baseUrl: 'http://evil/v1' }), '');
        });

        it('ignores a jsonConfig placeholder that was never filled in', function () {
            assert.equal(
                resolveTestEndpoint(settings, 'custom', { apiKey: 'k', baseUrl: '${data.gptBaseUrl}' }),
                'http://stored/v1',
            );
        });
    });
});
