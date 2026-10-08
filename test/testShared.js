const assert = require('node:assert').strict;
const {
    resolveRequestTimeout,
    MAX_AI_REQUEST_TIMEOUT_MS,
    extractAiResponseInfo,
    describeEmptyAiResponse,
    resolveMaxTokens,
    DEFAULT_AI_MAX_TOKENS,
    MAX_AI_MAX_TOKENS,
    isChatModel,
    stripThinkingArtifacts,
    isTruncatedAnswer,
} = require('../build/shared');

describe('Test limits and answers', function () {
    describe('resolveRequestTimeout', function () {
        it('takes the budget the caller asked for', function () {
            assert.equal(resolveRequestTimeout(15000), 15000);
        });

        it('accepts it as a string, the way it arrives in a sendTo message', function () {
            assert.equal(resolveRequestTimeout('15000'), 15000);
        });

        it('falls back to the maximum when the caller names none', function () {
            assert.equal(resolveRequestTimeout(undefined), MAX_AI_REQUEST_TIMEOUT_MS);
            assert.equal(resolveRequestTimeout(null), MAX_AI_REQUEST_TIMEOUT_MS);
            assert.equal(resolveRequestTimeout(''), MAX_AI_REQUEST_TIMEOUT_MS);
            assert.equal(resolveRequestTimeout('soon'), MAX_AI_REQUEST_TIMEOUT_MS);
        });

        it('does not let a caller wait longer than the ceiling', function () {
            assert.equal(resolveRequestTimeout(3600000), MAX_AI_REQUEST_TIMEOUT_MS);
        });

        it('keeps a second as the floor', function () {
            assert.equal(resolveRequestTimeout(1), 1000);
            assert.equal(resolveRequestTimeout(999), 1000);
        });

        it('reads a zero the way Node does - as no timeout - and caps it at the ceiling', function () {
            assert.equal(resolveRequestTimeout(0), MAX_AI_REQUEST_TIMEOUT_MS);
            assert.equal(resolveRequestTimeout(-5000), MAX_AI_REQUEST_TIMEOUT_MS);
        });
    });
    describe('extractAiResponseInfo', function () {
        it("reads Anthropic's stop_reason and token counts", function () {
            const info = extractAiResponseInfo({
                stop_reason: 'max_tokens',
                usage: { input_tokens: 1200, output_tokens: 64000 },
            });
            assert.equal(info.finishReason, 'max_tokens');
            assert.deepEqual(info.usage, { input: 1200, output: 64000 });
        });

        it('reads the OpenAI-compatible finish_reason and token counts', function () {
            const info = extractAiResponseInfo({
                choices: [{ finish_reason: 'length' }],
                usage: { prompt_tokens: 10, completion_tokens: 20 },
            });
            assert.equal(info.finishReason, 'length');
            assert.deepEqual(info.usage, { input: 10, output: 20 });
        });

        it('stays empty when the endpoint reports nothing', function () {
            assert.deepEqual(extractAiResponseInfo({}), {});
            assert.deepEqual(extractAiResponseInfo(null), {});
            assert.deepEqual(extractAiResponseInfo(undefined), {});
        });
    });

    describe('describeEmptyAiResponse', function () {
        it('names the output budget as the reason, not a broken key', function () {
            const msg = describeEmptyAiResponse({ finishReason: 'max_tokens', usage: { input: 5, output: 8000 } });
            assert.ok(msg.includes('output budget'), msg);
            assert.ok(msg.includes('stop reason: max_tokens'), msg);
            assert.ok(msg.includes('tokens in/out: 5/8000'), msg);
        });

        it('says when the endpoint filtered the answer', function () {
            assert.ok(describeEmptyAiResponse({ finishReason: 'content_filter' }).includes('filtered'));
        });

        it('says when a tool call could not be read', function () {
            assert.ok(describeEmptyAiResponse({ finishReason: 'tool_use' }).includes('tool'));
        });

        it('repeats an unknown stop reason verbatim', function () {
            assert.ok(describeEmptyAiResponse({ finishReason: 'whatever' }).includes('whatever'));
        });

        it('falls back to the raw body when the endpoint said nothing at all', function () {
            const msg = describeEmptyAiResponse({}, '{"choices":[]}');
            assert.ok(msg.includes('{"choices":[]}'), msg);
        });

        it('does not dump the raw body when there is a stop reason to show', function () {
            assert.ok(!describeEmptyAiResponse({ finishReason: 'max_tokens' }, '{"a":1}').includes('{"a":1}'));
        });
    });
    describe('resolveMaxTokens', function () {
        it('falls back to the default Anthropic accepts everywhere', function () {
            assert.equal(resolveMaxTokens(undefined), DEFAULT_AI_MAX_TOKENS);
            assert.equal(resolveMaxTokens(''), DEFAULT_AI_MAX_TOKENS);
            assert.equal(resolveMaxTokens(0), DEFAULT_AI_MAX_TOKENS);
            assert.equal(resolveMaxTokens(-1), DEFAULT_AI_MAX_TOKENS);
        });

        it('takes the configured budget', function () {
            assert.equal(resolveMaxTokens(32000), 32000);
            assert.equal(resolveMaxTokens('32000'), 32000);
        });

        it('keeps the value in a range every model can live with', function () {
            assert.equal(resolveMaxTokens(10), 1024);
            assert.equal(resolveMaxTokens(999999), MAX_AI_MAX_TOKENS);
        });
    });

    describe('isChatModel', function () {
        it('keeps chat models', function () {
            for (const name of ['gpt-5', 'claude-sonnet-4-5', 'gemini-2.5-pro', 'deepseek-chat', 'llama3.1:8b']) {
                assert.ok(isChatModel(name), name);
            }
        });

        it('drops embedding, image and deprecated models', function () {
            for (const name of ['text-embedding-3-small', 'dall-e-3', 'nomic-embed-text', 'claude-instant-1.2']) {
                assert.ok(!isChatModel(name), name);
            }
        });
    });

    describe('stripThinkingArtifacts / isTruncatedAnswer', function () {
        it('removes the reasoning of a local model', function () {
            assert.equal(stripThinkingArtifacts('<think>hm</think>Answer'), 'Answer');
        });

        it('knows both spellings of "out of budget"', function () {
            assert.ok(isTruncatedAnswer({ finishReason: 'max_tokens' }));
            assert.ok(isTruncatedAnswer({ finishReason: 'length' }));
            assert.ok(!isTruncatedAnswer({ finishReason: 'stop' }));
        });
    });
});
