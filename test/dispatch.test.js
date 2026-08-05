/**
 * Tests for the dispatchers that send the request and read the whole body:
 * `request` and the `request*` family, plus the two hooks `request` consults on
 * the way through - `http.tryMocked` and `http.record`.
 */
const { test, afterEach } = require('node:test');
const assert = require('node:assert');

const http = require('../dist/index.js').default;
const { fetchSpy, resetHttpState, withFetch } = require('./helpers.js');

afterEach(resetHttpState);

test('request hands the url and the built options to fetch', () => {
    var spy = fetchSpy(() => new Response('{}'));
    return withFetch(spy.impl, async () => {
        await http('/api/pets', { cache: 'no-store' }).post().withJsonBody({ name: 'Fido' }).request();
        assert.strictEqual(spy.calls.length, 1);
        assert.strictEqual(spy.last.url, '/api/pets');
        assert.strictEqual(spy.last.opts.cache, 'no-store');
        assert.strictEqual(spy.last.opts.method, 'POST');
        assert.strictEqual(spy.last.opts.body, '{"name":"Fido"}');
        assert.deepStrictEqual(spy.last.opts.headers, { 'Content-Type': 'application/json' });
    });
});

test('request resolves with the Response untouched', () => {
    var response = new Response('{}', { status: 201 });
    return withFetch(
        async () => response,
        async () => {
            assert.strictEqual(await http('/api/pets').request(), response);
        }
    );
});

test('requestJson parses the body', () => {
    return withFetch(
        async () => new Response('[{"name":"Fido"}]'),
        async () => {
            assert.deepStrictEqual(await http('/api/pets').requestJson(), [ { name: 'Fido' } ]);
        }
    );
});

test('requestText resolves with the body as a string', () => {
    return withFetch(
        async () => new Response('plain text'),
        async () => {
            assert.strictEqual(await http('/api/pets').requestText(), 'plain text');
        }
    );
});

test('requestArrayBuffer resolves with the raw bytes', () => {
    return withFetch(
        async () => new Response('hi'),
        async () => {
            var buffer = await http('/api/pets').requestArrayBuffer();
            assert.ok(buffer instanceof ArrayBuffer);
            assert.deepStrictEqual([ ...new Uint8Array(buffer) ], [ 104, 105 ]);
        }
    );
});

test('requestBlob resolves with a Blob', () => {
    return withFetch(
        async () => new Response('hi'),
        async () => {
            var blob = await http('/api/pets').requestBlob();
            assert.ok(blob instanceof Blob);
            assert.strictEqual(await blob.text(), 'hi');
        }
    );
});

test('requestFormData resolves with the parsed form', () => {
    var form = new FormData();
    form.append('name', 'Fido');
    return withFetch(
        async () => new Response(form),
        async () => {
            var parsed = await http('/api/pets').requestFormData();
            assert.strictEqual(parsed.get('name'), 'Fido');
        }
    );
});

test('every dispatcher resolves to null on a 204', () => {
    var dispatchers = [ 'requestArrayBuffer', 'requestBlob', 'requestFormData', 'requestJson', 'requestText' ];
    return withFetch(
        async () => new Response(null, { status: 204 }),
        async () => {
            for (var name of dispatchers) {
                assert.strictEqual(await http('/api/pets')[name](), null, name + ' on a 204');
            }
        }
    );
});

test('each dispatcher sets its own Accept header', () => {
    var expected = {
        requestArrayBuffer: 'application/octet-stream',
        requestBlob: 'application/octet-stream',
        requestFormData: 'multipart/form-data',
        requestJson: 'application/json',
        requestText: 'text/plain',
    };
    var spy = fetchSpy(() => new Response(null, { status: 204 }));
    return withFetch(spy.impl, async () => {
        for (var name of Object.keys(expected)) {
            await http('/api/pets')[name]();
            assert.strictEqual(spy.last.opts.headers.Accept, expected[name], name + ' Accept header');
        }
    });
});

test('a non-ok response resolves rather than rejecting', () => {
    // The streaming dispatchers reject on a bad status; these deliberately
    // don't, so the caller can read the error body off the response.
    return withFetch(
        async () => new Response('{"error":"nope"}', { status: 500 }),
        async () => {
            assert.deepStrictEqual(await http('/api/pets').requestJson(), { error: 'nope' });
            var res = await http('/api/pets').request();
            assert.strictEqual(res.status, 500);
        }
    );
});

test('tryMocked answers the request instead of fetch when it returns a promise', () => {
    var spy = fetchSpy(() => new Response('from the network'));
    var seen = null;
    http.tryMocked = function (url, opts) {
        seen = { opts, url };
        return Promise.resolve(new Response('{"mocked":true}'));
    };
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets').requestJson(), { mocked: true });
        assert.strictEqual(spy.calls.length, 0, 'fetch should not have been called');
        assert.strictEqual(seen.url, '/api/pets');
        assert.strictEqual(seen.opts.headers.Accept, 'application/json');
    });
});

test('tryMocked returning nothing falls through to fetch', () => {
    var spy = fetchSpy(() => new Response('{"mocked":false}'));
    http.tryMocked = () => undefined;
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets').requestJson(), { mocked: false });
        assert.strictEqual(spy.calls.length, 1);
    });
});

test('record is called with the response, bound to the request', () => {
    var seen = null;
    http.record = function (response) {
        seen = { status: response.status, url: this.url };
        return response;
    };
    return withFetch(
        async () => new Response('{}', { status: 201 }),
        async () => {
            await http('/api/pets').requestJson();
            assert.deepStrictEqual(seen, { status: 201, url: '/api/pets' });
        }
    );
});

test('record runs after the response pipeline', () => {
    var order = [];
    http.record = function (value) {
        order.push('record:' + value);
        return value;
    };
    var pipeline = [ { job: () => { order.push('pipeline'); return 'piped'; } } ];
    return withFetch(
        async () => new Response('{}'),
        async () => {
            var result = await http('/api/pets', { responsePipeline: pipeline }).request();
            assert.strictEqual(result, 'piped');
            assert.deepStrictEqual(order, [ 'pipeline', 'record:piped' ]);
        }
    );
});
