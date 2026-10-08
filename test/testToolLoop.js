const assert = require('node:assert').strict;
const { runToolLoop, parseToolArguments } = require('../build/shared');

function call(id, name, args) {
    return {
        id,
        type: 'function',
        function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
    };
}

describe('Test tool loop', function () {
    it('runs the tools until the model answers without one', async function () {
        const answers = [
            { content: '', tool_calls: [call('1', 'get_state', { id: 'a.0.x' })] },
            { content: 'It is 21 °C' },
        ];
        const seen = [];
        const result = await runToolLoop({
            messages: [{ role: 'user', content: 'How warm?' }],
            tools: [{ type: 'function', function: { name: 'get_state' } }],
            ask: async messages => {
                seen.push(messages.length);
                return answers.shift();
            },
            runTool: async (c, args) => `${c.function.name}(${args.id}) = 21`,
        });
        assert.equal(result.content, 'It is 21 °C');
        assert.equal(result.rounds, 1);
        assert.deepEqual(seen, [1, 3]);
        assert.deepEqual(
            result.newMessages.map(m => m.role),
            ['assistant', 'tool', 'assistant'],
        );
        assert.equal(result.newMessages[1].content, 'get_state(a.0.x) = 21');
        assert.equal(result.newMessages[1].tool_call_id, '1');
    });

    it('hands a failing tool to the model as its result', async function () {
        const answers = [{ content: '', tool_calls: [call('1', 'boom', {})] }, { content: 'Sorry' }];
        const result = await runToolLoop({
            messages: [{ role: 'user', content: 'x' }],
            tools: [{ type: 'function', function: { name: 'boom' } }],
            ask: async () => answers.shift(),
            runTool: async () => {
                throw new Error('no permission');
            },
        });
        assert.equal(result.newMessages[1].content, 'Error: no permission');
    });

    it('stops after the rounds and asks once more without tools if wanted', async function () {
        let asked = 0;
        const toolsSeen = [];
        const result = await runToolLoop({
            messages: [{ role: 'user', content: 'x' }],
            tools: [{ type: 'function', function: { name: 't' } }],
            maxRounds: 2,
            finalAnswerWithoutTools: true,
            ask: async (_m, tools) => {
                asked++;
                toolsSeen.push(!!tools);
                return tools ? { content: '', tool_calls: [call(String(asked), 't', {})] } : { content: 'final' };
            },
            runTool: async () => 'ok',
        });
        assert.equal(result.content, 'final');
        assert.equal(result.exhausted, true);
        assert.deepEqual(toolsSeen, [true, true, false]);
    });

    it('ends with the last answer when the rounds are used up', async function () {
        const result = await runToolLoop({
            messages: [{ role: 'user', content: 'x' }],
            tools: [{ type: 'function', function: { name: 't' } }],
            maxRounds: 1,
            ask: async () => ({ content: 'still busy', tool_calls: [call('1', 't', {})] }),
            runTool: async () => 'ok',
        });
        assert.equal(result.exhausted, true);
        assert.equal(result.content, 'still busy');
    });

    it('ends the turn when asked to stop', async function () {
        let stop = false;
        const result = await runToolLoop({
            messages: [{ role: 'user', content: 'x' }],
            tools: [{ type: 'function', function: { name: 't' } }],
            shouldStop: () => stop,
            ask: async () => ({ content: '', tool_calls: [call('1', 't', {})] }),
            runTool: async () => {
                stop = true;
                return 'ok';
            },
        });
        assert.equal(result.stopped, true);
        assert.equal(result.rounds, 1);
    });

    it('reads broken arguments as an empty object', function () {
        assert.deepEqual(parseToolArguments(call('1', 't', '{oops')), {});
        assert.deepEqual(parseToolArguments(call('1', 't', '[1]')), {});
        assert.deepEqual(parseToolArguments(call('1', 't', { a: 1 })), { a: 1 });
    });
});
