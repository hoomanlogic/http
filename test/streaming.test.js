/**
 * Tests for the streaming request methods and the SSE decoder they're built on.
 * Runs against the compiled `dist`, so `npm run build` first: `npm test` does
 * both.
 */
const test = require('node:test');
const assert = require('node:assert');

const { createSseDecoder } = require('../dist/index.js');
const http = require('../dist/index.js').default;

/**
 * A Response whose body streams the given text in the given pieces, so a test
 * can control exactly where the chunk boundaries fall.
 */
function streamedResponse (chunks, init = {}) {
    var encoder = new TextEncoder();
    var body = new ReadableStream({
        start (controller) {
            chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
            controller.close();
        },
    });
    return new Response(body, { status: 200, ...init });
}

/** Drain an async iterable into an array. */
async function collect (iterable) {
    var out = [];
    for await (var value of iterable) {
        out.push(value);
    }
    return out;
}

function withFetch (impl, fn) {
    var original = globalThis.fetch;
    globalThis.fetch = impl;
    return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

test('createSseDecoder frames an event on the blank line', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('data: hello\n'), []);
    assert.deepStrictEqual(decoder.push('\n'), [
        { data: 'hello', event: 'message', id: '', retry: null },
    ]);
});

test('createSseDecoder carries a partial frame across chunk boundaries', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('event: ping\ndata: {"a":'), []);
    assert.deepStrictEqual(decoder.push('1}\n\n'), [
        { data: '{"a":1}', event: 'ping', id: '', retry: null },
    ]);
});

test('createSseDecoder joins multiple data lines with newlines', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('data: one\ndata: two\n\n'), [
        { data: 'one\ntwo', event: 'message', id: '', retry: null },
    ]);
});

test('createSseDecoder handles CRLF line endings split mid-sequence', () => {
    var decoder = createSseDecoder();
    // The CR arrives alone - it could still turn out to be a CRLF, so the
    // decoder has to wait before treating it as a line ending.
    assert.deepStrictEqual(decoder.push('data: hi\r'), []);
    assert.deepStrictEqual(decoder.push('\n\r\n'), [
        { data: 'hi', event: 'message', id: '', retry: null },
    ]);
});

test('createSseDecoder ignores comments and carries id and retry forward', () => {
    var decoder = createSseDecoder();
    var events = decoder.push(': keepalive\nid: 7\nretry: 2500\ndata: a\n\ndata: b\n\n');
    assert.deepStrictEqual(events, [
        { data: 'a', event: 'message', id: '7', retry: 2500 },
        { data: 'b', event: 'message', id: '7', retry: 2500 },
    ]);
});

test('createSseDecoder discards an unterminated trailing frame', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('data: complete\n\ndata: cut off'), [
        { data: 'complete', event: 'message', id: '', retry: null },
    ]);
});

test('requestSse yields each event as it arrives', () => {
    return withFetch(
        async () => streamedResponse([ 'event: a\ndata: {"n":1}\n\n', 'event: b\ndata: {"n":2}\n\n' ]),
        async () => {
            var events = await collect(http('/stream').post().withJsonBody({}).requestSse());
            assert.deepStrictEqual(events.map(e => e.event), [ 'a', 'b' ]);
            assert.deepStrictEqual(events.map(e => JSON.parse(e.data).n), [ 1, 2 ]);
        }
    );
});

test('requestSse sets the event-stream Accept header', () => {
    var seen = null;
    return withFetch(
        async (url, opts) => { seen = opts; return streamedResponse([ 'data: x\n\n' ]); },
        async () => {
            await collect(http('/stream').requestSse());
            assert.strictEqual(seen.headers.Accept, 'text/event-stream');
        }
    );
});

test('requestTextStream holds back a character split across chunks', () => {
    // The 4-byte emoji is cut in half by the chunk boundary; the decoder must
    // not emit a replacement character for the first half.
    var bytes = new TextEncoder().encode('a😀b');
    var body = new ReadableStream({
        start (controller) {
            controller.enqueue(bytes.slice(0, 3));
            controller.enqueue(bytes.slice(3));
            controller.close();
        },
    });
    return withFetch(
        async () => new Response(body, { status: 200 }),
        async () => {
            var chunks = await collect(http('/text').requestTextStream());
            assert.strictEqual(chunks.join(''), 'a😀b');
        }
    );
});

test('requestTextStream falls back to the whole body when there is no stream', () => {
    // Mocks and non-streaming polyfills hand back a response with no body.
    return withFetch(
        async () => ({ ok: true, status: 200, body: null, text: async () => 'all at once' }),
        async () => {
            assert.deepStrictEqual(await collect(http('/text').requestTextStream()), [ 'all at once' ]);
        }
    );
});

test('streaming requests reject on a non-ok response', () => {
    return withFetch(
        async () => new Response('nope', { status: 503, statusText: 'Service Unavailable' }),
        async () => {
            var err = await collect(http('/stream').requestSse()).then(() => null, e => e);
            assert.ok(err, 'expected a rejection');
            assert.strictEqual(err.status, 503);
            assert.match(err.message, /503/);
            assert.strictEqual(err.response.status, 503);
        }
    );
});

test('breaking out of the loop cancels the body', () => {
    var cancelled = false;
    // Deliberately left open: a consumer that stops early has to be what ends
    // this stream, which is the whole point of the assertion.
    var body = new ReadableStream({
        start (controller) {
            controller.enqueue(new TextEncoder().encode('data: 1\n\ndata: 2\n\n'));
        },
        cancel () { cancelled = true; },
    });
    return withFetch(
        async () => new Response(body, { status: 200 }),
        async () => {
            for await (var event of http('/stream').requestSse()) {
                assert.strictEqual(event.data, '1');
                break;
            }
            assert.strictEqual(cancelled, true);
        }
    );
});

test('withSignal passes the signal through to fetch', () => {
    var controller = new AbortController();
    var seen = null;
    return withFetch(
        async (url, opts) => { seen = opts; return streamedResponse([ 'data: 1\n\n' ]); },
        async () => {
            await collect(http('/stream').withSignal(controller.signal).requestSse());
            assert.strictEqual(seen.signal, controller.signal);
        }
    );
});
