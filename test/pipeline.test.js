/**
 * Tests for the response pipeline - `buildResponsePipeline`, how the jobs it
 * collects are applied to a dispatched request, and `setHttpDefaults`.
 */
const { test, afterEach } = require('node:test');
const assert = require('node:assert');

const { buildResponsePipeline, setHttpDefaults } = require('../dist/index.js');
const http = require('../dist/index.js').default;
const { resetHttpState, withFetch } = require('./helpers.js');

afterEach(resetHttpState);

test('buildResponsePipeline records the jobs in the order they were chained', () => {
    var first = res => res;
    var second = res => res;
    var recover = err => err;
    var pipeline = buildResponsePipeline(first).then(second).catch(recover).build();
    assert.deepStrictEqual(pipeline, [
        { job: first },
        { job: second },
        { catch: true, job: recover },
    ]);
});

test('then and catch return the builder so they can be chained', () => {
    var builder = buildResponsePipeline(res => res);
    assert.strictEqual(builder.then(res => res), builder);
    assert.strictEqual(builder.catch(err => err), builder);
});

test('setDefault swaps the builder for the configured default pipeline', () => {
    var fallback = [ { job: res => res } ];
    setHttpDefaults({ responsePipeline: fallback });
    var builder = buildResponsePipeline(res => res);
    builder.setDefault();
    assert.strictEqual(builder.build(), fallback);
});

test('setDefault leaves an empty pipeline when no default is configured', () => {
    var builder = buildResponsePipeline(res => res);
    builder.setDefault();
    assert.deepStrictEqual(builder.build(), []);
});

test('the pipeline transforms the response before the promise resolves', () => {
    var pipeline = buildResponsePipeline(res => res.status)
        .then(status => 'status:' + status)
        .build();
    return withFetch(
        async () => new Response('{}', { status: 201 }),
        async () => {
            var result = await http('/api/pets', { responsePipeline: pipeline }).request();
            assert.strictEqual(result, 'status:201');
        }
    );
});

test('a catch job recovers from a job that threw', () => {
    var pipeline = buildResponsePipeline(() => { throw new Error('boom'); })
        .catch(err => 'recovered:' + err.message)
        .build();
    return withFetch(
        async () => new Response('{}'),
        async () => {
            assert.strictEqual(await http('/api/pets', { responsePipeline: pipeline }).request(), 'recovered:boom');
        }
    );
});

test('a catch job recovers from a fetch that rejected', () => {
    // The rejection passes straight through the leading `then` job and lands on
    // the `catch` behind it.
    var pipeline = buildResponsePipeline(res => res)
        .catch(err => 'offline:' + err.message)
        .build();
    return withFetch(
        async () => { throw new Error('network down'); },
        async () => {
            var result = await http('/api/pets', { responsePipeline: pipeline }).request();
            assert.strictEqual(result, 'offline:network down');
        }
    );
});

test('catch jobs are skipped when nothing rejects', () => {
    var caught = false;
    var pipeline = buildResponsePipeline(res => res.status)
        .catch(() => { caught = true; })
        .then(status => status + 1)
        .build();
    return withFetch(
        async () => new Response('{}', { status: 200 }),
        async () => {
            assert.strictEqual(await http('/api/pets', { responsePipeline: pipeline }).request(), 201);
            assert.strictEqual(caught, false);
        }
    );
});

test('a rethrowing catch job leaves the request rejected', () => {
    var pipeline = buildResponsePipeline(() => { throw new Error('boom'); })
        .catch(err => { throw err; })
        .build();
    return withFetch(
        async () => new Response('{}'),
        async () => {
            await assert.rejects(http('/api/pets', { responsePipeline: pipeline }).request(), /boom/);
        }
    );
});

test('the default pipeline applies to requests that do not bring their own', () => {
    setHttpDefaults({
        responsePipeline: buildResponsePipeline(res => {
            if (res.ok) {
                return res;
            }
            var error = new Error(res.statusText);
            error.response = res;
            throw error;
        }).build(),
    });
    return withFetch(
        async () => new Response('{}', { status: 401, statusText: 'Unauthorized' }),
        async () => {
            var err = await http('/api/pets').requestJson().then(() => null, e => e);
            assert.ok(err, 'expected the default pipeline to reject');
            assert.strictEqual(err.message, 'Unauthorized');
            assert.strictEqual(err.response.status, 401);
        }
    );
});

test('a pipeline passed in the options replaces the default entirely', () => {
    var defaultRan = false;
    setHttpDefaults({ responsePipeline: [ { job: res => { defaultRan = true; return res; } } ] });
    var own = buildResponsePipeline(() => 'mine').build();
    return withFetch(
        async () => new Response('{}'),
        async () => {
            assert.strictEqual(await http('/api/pets', { responsePipeline: own }).request(), 'mine');
            assert.strictEqual(defaultRan, false);
        }
    );
});

test('the pipeline runs before the body is read, so it can hand one back', () => {
    // A pipeline that swaps in a different Response still works with the
    // body-reading dispatchers stacked on top of it.
    var pipeline = buildResponsePipeline(() => new Response('{"swapped":true}')).build();
    return withFetch(
        async () => new Response('{"original":true}'),
        async () => {
            assert.deepStrictEqual(await http('/api/pets', { responsePipeline: pipeline }).requestJson(), { swapped: true });
        }
    );
});
