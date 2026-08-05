/**
 * Tests for the streaming request methods and the SSE decoder they're built on.
 * Runs against the compiled `dist`, so `npm run build` first: `npm test` does
 * both.
 */
const test = require('node:test');
const assert = require('node:assert');

const { createSseDecoder } = require('../dist/index.js');
const http = require('../dist/index.js').default;
const { collect, streamedResponse, withFetch } = require('./helpers.js');

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

test('createSseDecoder treats a line with no colon as a field with an empty value', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('data\n\n'), [
        { data: '', event: 'message', id: '', retry: null },
    ]);
});

test('createSseDecoder ignores fields it does not know', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('foo: bar\ndata: x\n\n'), [
        { data: 'x', event: 'message', id: '', retry: null },
    ]);
});

test('createSseDecoder ignores a retry that is not a number', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('retry: soon\nretry: 12ms\ndata: x\n\n'), [
        { data: 'x', event: 'message', id: '', retry: null },
    ]);
});

test('createSseDecoder strips exactly one space after the colon', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('data:tight\n\ndata:  padded\n\n'), [
        { data: 'tight', event: 'message', id: '', retry: null },
        { data: ' padded', event: 'message', id: '', retry: null },
    ]);
});

test('createSseDecoder resets the event type between frames', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('event: named\ndata: a\n\ndata: b\n\n'), [
        { data: 'a', event: 'named', id: '', retry: null },
        { data: 'b', event: 'message', id: '', retry: null },
    ]);
});

test('createSseDecoder resets the event type on a frame that carried no data', () => {
    var decoder = createSseDecoder();
    // An `event:` with nothing to go with it isn't dispatched, and mustn't leak
    // its name onto the next frame.
    assert.deepStrictEqual(decoder.push('event: named\n\n'), []);
    assert.deepStrictEqual(decoder.push('data: x\n\n'), [
        { data: 'x', event: 'message', id: '', retry: null },
    ]);
});

test('createSseDecoder lets an empty id clear the one carried forward', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('id: 7\ndata: a\n\nid\ndata: b\n\n'), [
        { data: 'a', event: 'message', id: '7', retry: null },
        { data: 'b', event: 'message', id: '', retry: null },
    ]);
});

test('createSseDecoder yields nothing for blank lines on their own', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('\n\n\n'), []);
});

test('createSseDecoder accepts CRLF and LF endings in the same stream', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('data: a\r\n\r\ndata: b\n\n'), [
        { data: 'a', event: 'message', id: '', retry: null },
        { data: 'b', event: 'message', id: '', retry: null },
    ]);
});

test('createSseDecoder accepts a bare CR as a line ending', () => {
    var decoder = createSseDecoder();
    assert.deepStrictEqual(decoder.push('data: a\r\rdata: b'), [
        { data: 'a', event: 'message', id: '', retry: null },
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

test('a cancel that fails on the way out is swallowed', () => {
    // The cleanup is best-effort: a body that refuses to cancel must not turn
    // into a rejection the consumer never asked for.
    var body = new ReadableStream({
        start (controller) { controller.enqueue(new TextEncoder().encode('data: 1\n\n')); },
        cancel () { throw new Error('cancel failed'); },
    });
    return withFetch(
        async () => new Response(body, { status: 200 }),
        async () => {
            for await (var event of http('/stream').requestSse()) {
                assert.strictEqual(event.data, '1');
                break;
            }
        }
    );
});

test('requestSse yields nothing when the stream carries only keepalives', () => {
    return withFetch(
        async () => streamedResponse([ ': ping\n\n', ': ping\n\n' ]),
        async () => {
            assert.deepStrictEqual(await collect(http('/stream').requestSse()), []);
        }
    );
});

test('requestStream hands back the body stream for the caller to drive', () => {
    return withFetch(
        async () => streamedResponse([ 'one', 'two' ]),
        async () => {
            var stream = await http('/download').requestStream();
            assert.strictEqual(typeof stream.getReader, 'function');
            var reader = stream.getReader();
            var decoder = new TextDecoder();
            var out = '';
            for (;;) {
                let result = await reader.read();
                if (result.done) {
                    break;
                }
                out += decoder.decode(result.value, { stream: true });
            }
            assert.strictEqual(out, 'onetwo');
        }
    );
});

test('requestStream rejects when the response has no body', () => {
    return withFetch(
        async () => ({ body: null, ok: true, status: 200 }),
        async () => {
            await assert.rejects(http('/download').requestStream(), /no readable body stream/);
        }
    );
});

test('requestStream rejects when the body is not a stream', () => {
    // A polyfill can hand back a body that isn't readable incrementally.
    return withFetch(
        async () => ({ body: {}, ok: true, status: 200 }),
        async () => {
            await assert.rejects(http('/download').requestStream(), /no readable body stream/);
        }
    );
});

test('requestStream rejects on a non-ok response', () => {
    return withFetch(
        async () => new Response('nope', { status: 404, statusText: 'Not Found' }),
        async () => {
            var err = await http('/download').requestStream().then(() => null, e => e);
            assert.ok(err, 'expected a rejection');
            assert.strictEqual(err.status, 404);
            assert.strictEqual(err.message, 'HTTP 404 Not Found');
            assert.strictEqual(err.response.status, 404);
        }
    );
});

test('a non-ok response with no status text still gets a usable message', () => {
    return withFetch(
        async () => ({ body: null, ok: false, status: 500, statusText: '' }),
        async () => {
            var err = await http('/download').requestStream().then(() => null, e => e);
            assert.strictEqual(err.message, 'HTTP 500');
        }
    );
});

test('requestTextStream rejects on a non-ok response', () => {
    return withFetch(
        async () => new Response('nope', { status: 403, statusText: 'Forbidden' }),
        async () => {
            var err = await collect(http('/text').requestTextStream()).then(() => null, e => e);
            assert.ok(err, 'expected a rejection');
            assert.strictEqual(err.status, 403);
        }
    );
});

test('requestTextStream yields nothing when the non-stream body is empty', () => {
    return withFetch(
        async () => ({ body: null, ok: true, status: 200, text: async () => '' }),
        async () => {
            assert.deepStrictEqual(await collect(http('/text').requestTextStream()), []);
        }
    );
});

test('requestTextStream falls back when the body is not a readable stream', () => {
    return withFetch(
        async () => ({ body: {}, ok: true, status: 200, text: async () => 'all at once' }),
        async () => {
            assert.deepStrictEqual(await collect(http('/text').requestTextStream()), [ 'all at once' ]);
        }
    );
});

test('requestTextStream skips a chunk that decodes to nothing', () => {
    // The first chunk is only the leading half of a 4-byte character, so it
    // decodes to the empty string - nothing worth yielding.
    var bytes = new TextEncoder().encode('😀');
    var body = new ReadableStream({
        start (controller) {
            controller.enqueue(bytes.slice(0, 2));
            controller.enqueue(bytes.slice(2));
            controller.close();
        },
    });
    return withFetch(
        async () => new Response(body, { status: 200 }),
        async () => {
            assert.deepStrictEqual(await collect(http('/text').requestTextStream()), [ '😀' ]);
        }
    );
});

test('requestTextStream flushes what the decoder held for a character that never finished', () => {
    // The stream ends mid-character; the decoder's flush turns the orphaned
    // bytes into a replacement character rather than dropping them silently.
    var bytes = new TextEncoder().encode('ok😀');
    var body = new ReadableStream({
        start (controller) {
            controller.enqueue(bytes.slice(0, 4));
            controller.close();
        },
    });
    return withFetch(
        async () => new Response(body, { status: 200 }),
        async () => {
            assert.deepStrictEqual(await collect(http('/text').requestTextStream()), [ 'ok', '�' ]);
        }
    );
});

test('an aborted signal rejects the stream', () => {
    var controller = new AbortController();
    controller.abort();
    return withFetch(
        async (url, opts) => {
            opts.signal.throwIfAborted();
            return streamedResponse([ 'data: 1\n\n' ]);
        },
        async () => {
            await assert.rejects(collect(http('/stream').withSignal(controller.signal).requestSse()));
        }
    );
});
