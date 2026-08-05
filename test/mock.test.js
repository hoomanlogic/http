/**
 * Tests for the mock module: mock registration and matching, the recorder, and
 * the map dumps.
 *
 * The module is browser-shaped - it registers an `unhandledrejection` listener
 * on `window` at import time - so `window` gets a stub before the require.
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

var windowListeners = [];
globalThis.window = {
    addEventListener (type, listener) { windowListeners.push({ listener, type }); },
};

const http = require('../dist/index.js').default;
const installMocks = require('../dist/mock.js').default;
const { fetchSpy, withFetch } = require('./helpers.js');

installMocks(http);

/** A complete request map - the shape `http.mock(map)` expects. */
function emptyMap () {
    return { delete: {}, get: {}, patch: {}, post: {}, put: {} };
}

beforeEach(() => {
    http.clearMocks();
    http.recordQueryParams = false;
    http.onRecordResponse = null;
    http.onUnmockedRequest = null;
    http.record = null;
    http.requestCatcher = emptyMap();
    http.unmockedMap = emptyMap();
});

test('importing the module logs unhandled rejections it sees on the window', () => {
    var registered = windowListeners.filter(entry => entry.type === 'unhandledrejection');
    assert.strictEqual(registered.length, 1, 'expected one unhandledrejection listener');

    var logged = [];
    var original = console.error;
    console.error = (...args) => logged.push(args);
    try {
        registered[0].listener('the rejection event');
    }
    finally {
        console.error = original;
    }
    assert.deepStrictEqual(logged, [ [ 'the rejection event' ] ]);
});

test('installing the mocks exposes http globally and starts with none registered', () => {
    assert.strictEqual(global.http, http);
    assert.strictEqual(http.hasMocks, false);
    assert.deepStrictEqual(http.mockMap, emptyMap());
    assert.strictEqual(http.recordQueryParams, false);
});

test('a mocked request is served without touching fetch', () => {
    var spy = fetchSpy(() => new Response('from the network'));
    http.mock('get', '/api/pets', () => http.mockResponse(200, [ { name: 'Fido' } ]));
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets').requestJson(), [ { name: 'Fido' } ]);
        assert.strictEqual(spy.calls.length, 0, 'fetch should not have been called');
    });
});

test('a patch mock is matched and its handler is given the body', () => {
    var seen = null;
    http.mock('patch', '/api/pets/:id', args => {
        seen = args;
        return http.mockResponse(200, { id: args.params.id, patched: true });
    });
    return withFetch(fetchSpy().impl, async () => {
        var result = await http('/api/pets/823').patch().withJsonBody({ age: 6 }).requestJson();
        assert.deepStrictEqual(result, { id: 823, patched: true });
        assert.strictEqual(seen.requestBody, '{"age":6}');
    });
});

test('requests fall through to fetch while no mocks are registered', () => {
    var spy = fetchSpy(() => new Response('{"live":true}'));
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets').requestJson(), { live: true });
        assert.strictEqual(spy.calls.length, 1);
    });
});

test('clearMocks turns the mocks back off and empties the map', () => {
    var spy = fetchSpy(() => new Response('{"live":true}'));
    http.mock('get', '/api/pets', () => http.mockResponse(200, { mocked: true }));
    http.clearMocks();
    assert.strictEqual(http.hasMocks, false);
    assert.deepStrictEqual(http.mockMap, emptyMap());
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets').requestJson(), { live: true });
    });
});

test('mockResponse builds a Response with the status, body and headers', async () => {
    var json = http.mockResponse(201, { id: 7 }, { 'X-Trace': 'abc' });
    assert.strictEqual(json.status, 201);
    assert.strictEqual(json.headers.get('X-Trace'), 'abc');
    assert.deepStrictEqual(await json.json(), { id: 7 });

    // A string body is taken as already serialized.
    assert.strictEqual(await http.mockResponse(200, 'plain').text(), 'plain');
});

test('the handler is given the request body, the url and the query params', () => {
    var seen = null;
    http.mock('post', '/api/pets', args => {
        seen = args;
        return http.mockResponse(200, { ok: true });
    });
    return withFetch(fetchSpy().impl, async () => {
        await http('/api/pets?dry=true').post().withJsonBody({ name: 'Rex' }).requestJson();
        assert.strictEqual(seen.url, '/api/pets?dry=true');
        assert.strictEqual(seen.requestBody, '{"name":"Rex"}');
        assert.deepStrictEqual(seen.params, { dry: true });
    });
});

test('a mock registered without query params still matches a url that has them', () => {
    http.mock('get', '/api/pets', () => http.mockResponse(200, { matched: true }));
    return withFetch(fetchSpy().impl, async () => {
        assert.deepStrictEqual(await http('/api/pets?type=dog').requestJson(), { matched: true });
    });
});

test('query param values are parsed as JSON when they can be', () => {
    http.mock('get', '/api/pets', ({ params }) => http.mockResponse(200, params));
    return withFetch(fetchSpy().impl, async () => {
        var params = await http('/api/pets?ids=[1,2]&limit=5&type=dog&exact=true').requestJson();
        assert.deepStrictEqual(params, { exact: true, ids: [ 1, 2 ], limit: 5, type: 'dog' });
    });
});

test('an empty pair in the query string is skipped', () => {
    http.mock('get', '/api/pets', ({ params }) => http.mockResponse(200, params));
    return withFetch(fetchSpy().impl, async () => {
        assert.deepStrictEqual(await http('/api/pets?&type=dog&').requestJson(), { type: 'dog' });
    });
});

test('a colon segment matches a pattern url and lands in params', () => {
    http.mock('get', '/api/pets/:id/toys/:toyId', ({ params }) => http.mockResponse(200, params));
    return withFetch(fetchSpy().impl, async () => {
        assert.deepStrictEqual(await http('/api/pets/823/toys/ball').requestJson(), { id: 823, toyId: 'ball' });
    });
});

test('a pattern url only matches when its query params match too', () => {
    var spy = fetchSpy(() => new Response('{"live":true}'));
    http.mock('get', '/api/pets/:id?type=dog', ({ params }) => http.mockResponse(200, { matched: params.id }));
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets/1?type=dog').requestJson(), { matched: 1 });
        assert.deepStrictEqual(await http('/api/pets/2?type=cat').requestJson(), { live: true });
        assert.strictEqual(spy.calls.length, 1, 'only the mismatched request should reach fetch');
    });
});

test('a pattern with a different number of segments is not a match', () => {
    var spy = fetchSpy(() => new Response('{"live":true}'));
    http.mock('get', '/api/pets/:id', () => http.mockResponse(200, { mocked: true }));
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets/1/toys').requestJson(), { live: true });
        assert.strictEqual(spy.calls.length, 1);
    });
});

test('a literal segment that differs is not a match', () => {
    var spy = fetchSpy(() => new Response('{"live":true}'));
    http.mock('get', '/api/pets/:id', () => http.mockResponse(200, { mocked: true }));
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/toys/1').requestJson(), { live: true });
    });
});

test('a mock registered for another method does not answer this one', () => {
    var spy = fetchSpy(() => new Response('{"live":true}'));
    http.mock('get', '/api/pets', () => http.mockResponse(200, { mocked: true }));
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets').post().withJsonBody({}).requestJson(), { live: true });
    });
});

test('a request with a method the mock map does not know falls through to fetch', () => {
    var spy = fetchSpy(() => new Response('{"live":true}'));
    http.mock('get', '/api/pets', () => http.mockResponse(200, { mocked: true }));
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets', { method: 'OPTIONS' }).requestJson(), { live: true });
        assert.strictEqual(spy.calls.length, 1);
    });
});

test('an unmocked method with no bucket still reaches onUnmockedRequest', () => {
    var spy = fetchSpy(() => new Response('{"live":true}'));
    var seen = [];
    http.mock('get', '/api/pets', () => http.mockResponse(200, { mocked: true }));
    http.onUnmockedRequest = (method, url, body) => {
        seen.push({ body, method, url });
        return undefined;
    };
    return withFetch(spy.impl, async () => {
        await http('/api/pets', { method: 'OPTIONS' }).withTextBody('probe').requestJson();
        assert.deepStrictEqual(seen, [ { body: 'probe', method: 'options', url: '/api/pets' } ]);
        assert.deepStrictEqual(http.unmockedMap.options, { '/api/pets': 'probe' });
    });
});

test('a handler that returns nothing leaves the request unhandled', () => {
    var spy = fetchSpy(() => new Response('{"live":true}'));
    http.mock('get', '/api/pets', () => undefined);
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets').requestJson(), { live: true });
        assert.strictEqual(spy.calls.length, 1);
    });
});

test('a pattern handler that returns nothing leaves the request unhandled', () => {
    var spy = fetchSpy(() => new Response('{"live":true}'));
    http.mock('get', '/api/pets/:id', () => undefined);
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets/1').requestJson(), { live: true });
    });
});

test('onUnmockedRequest sees what no mock handled, and may answer it', () => {
    var seen = [];
    http.mock('get', '/api/other', () => undefined);
    http.onUnmockedRequest = (method, url, body) => {
        seen.push({ body, method, url });
        return http.mockResponse(200, { fallback: true });
    };
    return withFetch(fetchSpy().impl, async () => {
        assert.deepStrictEqual(await http('/api/pets').post().withJsonBody({ a: 1 }).requestJson(), { fallback: true });
        assert.deepStrictEqual(seen, [ { body: '{"a":1}', method: 'post', url: '/api/pets' } ]);
    });
});

test('unmocked requests are collected, keyed by body for post and put', () => {
    var spy = fetchSpy(() => new Response('{}'));
    http.mock('get', '/api/other', () => undefined);
    http.onUnmockedRequest = () => undefined;
    return withFetch(spy.impl, async () => {
        await http('/api/pets?type=dog').requestJson();
        await http('/api/pets').post().withJsonBody({ a: 1 }).requestJson();
        await http('/api/pets/1').put().withJsonBody({ a: 2 }).requestJson();
        await http('/api/pets/1').del().requestJson();
        assert.deepStrictEqual(http.unmockedMap.get, { '/api/pets?type=dog': '' });
        assert.deepStrictEqual(http.unmockedMap.post, { '/api/pets': { '{"a":1}': '' } });
        assert.deepStrictEqual(http.unmockedMap.put, { '/api/pets/1': { '{"a":2}': '' } });
        assert.deepStrictEqual(http.unmockedMap.delete, { '/api/pets/1': '' });
        assert.strictEqual(spy.calls.length, 4, 'all four should still reach fetch');
    });
});

test('dumpUnmockedRequestMap sorts the urls and the bodies under them', () => {
    http.unmockedMap = {
        delete: { '/api/z': '', '/api/a': '' },
        get: { '/api/z': '', '/api/a': '' },
        patch: { '/api/z': {}, '/api/a': { '{"n":2}': '', '{"n":1}': '' } },
        post: { '/api/z': {}, '/api/a': { '{"n":2}': '', '{"n":1}': '' } },
        put: { '/api/z': {}, '/api/a': { '{"n":2}': '', '{"n":1}': '' } },
    };
    var dumped = JSON.parse(http.dumpUnmockedRequestMap());
    assert.deepStrictEqual(Object.keys(dumped), [ 'delete', 'get', 'patch', 'post', 'put' ]);
    [ 'delete', 'get', 'patch', 'post', 'put' ].forEach(method => {
        assert.deepStrictEqual(Object.keys(dumped[method]), [ '/api/a', '/api/z' ], method + ' urls');
    });
    // Every body-carrying method gets its bodies sorted too.
    [ 'patch', 'post', 'put' ].forEach(method => {
        assert.deepStrictEqual(Object.keys(dumped[method]['/api/a']), [ '{"n":1}', '{"n":2}' ], method + ' bodies');
    });
});

test('http.mock with a request map registers a mock for every method', () => {
    http.mock({
        delete: { '/api/pets/1': { deleted: true } },
        get: { '/api/pets': [ { name: 'Fido' } ] },
        patch: { '/api/pets/1': { '{"age":6}': { patched: true } } },
        post: { '/api/pets': { '{"name":"Rex"}': { id: 2 } } },
        put: { '/api/pets/1': { '{"name":"Fido II"}': { id: 1 } } },
    });
    return withFetch(fetchSpy().impl, async () => {
        assert.deepStrictEqual(await http('/api/pets').requestJson(), [ { name: 'Fido' } ]);
        assert.deepStrictEqual(await http('/api/pets').post().withJsonBody({ name: 'Rex' }).requestJson(), { id: 2 });
        assert.deepStrictEqual(await http('/api/pets/1').put().withJsonBody({ name: 'Fido II' }).requestJson(), { id: 1 });
        assert.deepStrictEqual(await http('/api/pets/1').patch().withJsonBody({ age: 6 }).requestJson(), { patched: true });
        assert.deepStrictEqual(await http('/api/pets/1').del().requestJson(), { deleted: true });
    });
});

test('a request map that leaves a method out simply mocks nothing for it', () => {
    var spy = fetchSpy(() => new Response('{"live":true}'));
    http.mock({ get: { '/api/pets': { mocked: true } } });
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets').requestJson(), { mocked: true });
        assert.deepStrictEqual(await http('/api/pets/1').patch().withJsonBody({}).requestJson(), { live: true });
    });
});

test('a mapped post body with no recorded response is left unhandled', () => {
    var spy = fetchSpy(() => new Response('{"live":true}'));
    var map = emptyMap();
    map.post['/api/pets'] = { '{"name":"Rex"}': { id: 2 } };
    map.put['/api/pets/1'] = { '{"name":"Rex"}': { id: 2 } };
    http.mock(map);
    return withFetch(spy.impl, async () => {
        assert.deepStrictEqual(await http('/api/pets').post().withJsonBody({ name: 'Unknown' }).requestJson(), { live: true });
        assert.deepStrictEqual(await http('/api/pets/1').put().withJsonBody({ name: 'Unknown' }).requestJson(), { live: true });
        assert.strictEqual(spy.calls.length, 2);
    });
});

test('tryRecord captures responses, dropping the query string by default', () => {
    http.record = http.tryRecord;
    return withFetch(
        async () => new Response(null, { status: 204 }),
        async () => {
            await http('/api/pets?type=dog').requestJson();
            await http('/api/pets/1').del().requestJson();
            assert.deepStrictEqual(http.requestCatcher.get, { '/api/pets': 'OK' });
            assert.deepStrictEqual(http.requestCatcher.delete, { '/api/pets/1': 'OK' });
        }
    );
});

test('recordQueryParams keeps the query string on the recorded url', () => {
    http.record = http.tryRecord;
    http.recordQueryParams = true;
    return withFetch(
        async () => new Response(null, { status: 204 }),
        async () => {
            await http('/api/pets?type=dog').requestJson();
            assert.deepStrictEqual(http.requestCatcher.get, { '/api/pets?type=dog': 'OK' });
        }
    );
});

test('post, put and patch recordings are keyed by the request body', () => {
    http.record = http.tryRecord;
    return withFetch(
        async () => new Response(null, { status: 204 }),
        async () => {
            await http('/api/pets').post().withJsonBody({ name: 'Rex' }).requestJson();
            await http('/api/pets').post().withJsonBody({ name: 'Fido' }).requestJson();
            await http('/api/pets/1').put().withJsonBody({ name: 'Fido II' }).requestJson();
            await http('/api/pets/1').patch().withJsonBody({ age: 6 }).requestJson();
            assert.deepStrictEqual(http.requestCatcher.post, {
                '/api/pets': { '{"name":"Fido"}': 'OK', '{"name":"Rex"}': 'OK' },
            });
            assert.deepStrictEqual(http.requestCatcher.put, {
                '/api/pets/1': { '{"name":"Fido II"}': 'OK' },
            });
            assert.deepStrictEqual(http.requestCatcher.patch, {
                '/api/pets/1': { '{"age":6}': 'OK' },
            });
        }
    );
});

test('tryRecord records a method it has no bucket for', () => {
    http.record = http.tryRecord;
    return withFetch(
        async () => new Response(null, { status: 204 }),
        async () => {
            await http('/api/pets', { method: 'HEAD' }).requestJson();
            assert.deepStrictEqual(http.requestCatcher.head, { '/api/pets': 'OK' });
        }
    );
});

test('onRecordResponse can take the recording over', () => {
    var seen = null;
    http.record = http.tryRecord;
    http.onRecordResponse = (request, response) => {
        seen = { status: response.status, url: request.url };
        return true;
    };
    return withFetch(
        async () => new Response(null, { status: 204 }),
        async () => {
            await http('/api/pets').requestJson();
            assert.deepStrictEqual(seen, { status: 204, url: '/api/pets' });
            assert.deepStrictEqual(http.requestCatcher.get, {}, 'the default recorder should not have run');
        }
    );
});

test('onRecordResponse returning false leaves the default recording in place', () => {
    http.record = http.tryRecord;
    http.onRecordResponse = () => false;
    return withFetch(
        async () => new Response(null, { status: 204 }),
        async () => {
            await http('/api/pets').requestJson();
            assert.deepStrictEqual(http.requestCatcher.get, { '/api/pets': 'OK' });
        }
    );
});

test('dumpRequestMap sorts the urls and the bodies under them', () => {
    http.requestCatcher = {
        delete: { '/api/z': 'OK', '/api/a': 'OK' },
        get: { '/api/z': 'OK', '/api/a': 'OK' },
        patch: { '/api/z': {}, '/api/a': { '{"n":2}': 'OK', '{"n":1}': 'OK' } },
        post: { '/api/z': {}, '/api/a': { '{"n":2}': 'OK', '{"n":1}': 'OK' } },
        put: { '/api/z': {}, '/api/a': { '{"n":2}': 'OK', '{"n":1}': 'OK' } },
    };
    var dumped = JSON.parse(http.dumpRequestMap());
    assert.deepStrictEqual(Object.keys(dumped), [ 'delete', 'get', 'patch', 'post', 'put' ]);
    [ 'delete', 'get', 'patch', 'post', 'put' ].forEach(method => {
        assert.deepStrictEqual(Object.keys(dumped[method]), [ '/api/a', '/api/z' ], method + ' urls');
    });
    [ 'patch', 'post', 'put' ].forEach(method => {
        assert.deepStrictEqual(Object.keys(dumped[method]['/api/a']), [ '{"n":1}', '{"n":2}' ], method + ' bodies');
    });
    assert.strictEqual(dumped.get['/api/a'], 'OK');
});

test('a dump keeps a bucket for every method, even the empty ones', () => {
    assert.deepStrictEqual(JSON.parse(http.dumpRequestMap()), emptyMap());
    assert.deepStrictEqual(JSON.parse(http.dumpUnmockedRequestMap()), emptyMap());
});

test('a recorded map round-trips back through http.mock', () => {
    http.record = http.tryRecord;
    return withFetch(
        async () => new Response(null, { status: 204 }),
        async () => {
            await http('/api/pets').requestJson();
            await http('/api/pets').post().withJsonBody({ name: 'Rex' }).requestJson();
            await http('/api/pets/1').patch().withJsonBody({ age: 6 }).requestJson();
            var recorded = JSON.parse(http.dumpRequestMap());
            http.record = null;
            http.mock(recorded);
            assert.strictEqual(await http('/api/pets').requestText(), 'OK');
            assert.strictEqual(await http('/api/pets').post().withJsonBody({ name: 'Rex' }).requestText(), 'OK');
            assert.strictEqual(await http('/api/pets/1').patch().withJsonBody({ age: 6 }).requestText(), 'OK');
        }
    );
});

test('refreshMap dispatches the recorded GET requests', () => {
    http.mock('get', '/api/pets', () => http.mockResponse(200, { pets: true }));
    http.mock('get', '/api/toys', () => http.mockResponse(200, { toys: true }));
    return withFetch(fetchSpy().impl, async () => {
        var results = await http.refreshMap({ get: [ '/api/pets', '/api/toys' ] });
        assert.deepStrictEqual(results, [ { pets: true }, { toys: true } ]);
    });
});

test('refreshMap swallows a request that failed', () => {
    return withFetch(
        async () => { throw new Error('network down'); },
        async () => {
            assert.deepStrictEqual(await http.refreshMap({ get: [ '/api/pets' ] }), [ undefined ]);
        }
    );
});

test('refreshMap with nothing to refresh resolves immediately', async () => {
    assert.deepStrictEqual(await http.refreshMap({}), []);
});

test('refreshMap dispatches the recorded POST requests', () => {
    // Each POST is staggered by half a second, so keep the list to one entry.
    var seen = [];
    http.mock('post', '/api/pets', ({ requestBody }) => {
        seen.push(requestBody);
        return http.mockResponse(200, { created: true });
    });
    return withFetch(fetchSpy().impl, async () => {
        var results = await http.refreshMap({ post: [ [ '/api/pets', '{"name":"Rex"}' ] ] });
        assert.deepStrictEqual(seen, [ '{"name":"Rex"}' ]);
        assert.deepStrictEqual(results, [ { created: true } ]);
    });
});

test('refreshMap resolves a POST that failed rather than hanging', () => {
    return withFetch(
        async () => { throw new Error('network down'); },
        async () => {
            var results = await http.refreshMap({ post: [ [ '/api/pets', '{"name":"Rex"}' ] ] });
            assert.strictEqual(results.length, 1);
            assert.match(results[0].message, /network down/);
        }
    );
});
