/**
 * Tests for building a request: the constructor's option handling and the
 * chainable builder methods. Nothing here dispatches - see dispatch.test.js.
 */
const { test, afterEach } = require('node:test');
const assert = require('node:assert');

const { HttpRequest, setHttpDefaults } = require('../dist/index.js');
const http = require('../dist/index.js').default;
const { resetHttpState } = require('./helpers.js');

afterEach(resetHttpState);

test('http() builds an HttpRequest with the url and no method', () => {
    var req = http('/api/pets');
    assert.ok(req instanceof HttpRequest);
    assert.strictEqual(req.url, '/api/pets');
    assert.strictEqual(req.opts.method, undefined);
    assert.deepStrictEqual(req.opts.headers, {});
});

test('the constructor keeps the fetch options and strips the two that are ours', () => {
    var req = http('/api/pets', {
        cache: 'no-store',
        mode: 'cors',
        noHeaderDefaults: true,
        responsePipeline: [],
    });
    assert.strictEqual(req.opts.cache, 'no-store');
    assert.strictEqual(req.opts.mode, 'cors');
    assert.ok(!('noHeaderDefaults' in req.opts), 'noHeaderDefaults should not reach fetch');
    assert.ok(!('responsePipeline' in req.opts), 'responsePipeline should not reach fetch');
});

test('default headers are merged in, and headers passed in win', () => {
    setHttpDefaults({ headers: { app_version: '1.2.3', 'X-Shared': 'default' } });
    var req = http('/api/pets', { headers: { 'X-Shared': 'override' } });
    assert.deepStrictEqual(req.opts.headers, {
        app_version: '1.2.3',
        'X-Shared': 'override',
    });
});

test('noHeaderDefaults drops the defaults but keeps the headers passed in', () => {
    setHttpDefaults({ headers: { app_version: '1.2.3' } });
    var req = http('/api/pets', { headers: { 'X-Mine': 'kept' }, noHeaderDefaults: true });
    assert.deepStrictEqual(req.opts.headers, { 'X-Mine': 'kept' });
});

test('the default response pipeline is used unless the request brings its own', () => {
    var fallback = [ { job: res => res } ];
    var own = [ { job: res => res } ];
    setHttpDefaults({ responsePipeline: fallback });
    assert.strictEqual(http('/api/pets').responsePipeline, fallback);
    assert.strictEqual(http('/api/pets', { responsePipeline: own }).responsePipeline, own);
});

test('withCreds defaults to same-origin and takes an override', () => {
    assert.strictEqual(http('/api/pets').withCreds().opts.credentials, 'same-origin');
    assert.strictEqual(http('/api/pets').withCreds('include').opts.credentials, 'include');
    assert.strictEqual(http('/api/pets').withCreds('omit').opts.credentials, 'omit');
});

test('withBody without a content type leaves the headers alone', () => {
    setHttpDefaults({ headers: { app_version: '1.2.3' } });
    var req = http('/api/pets').post().withBody('raw');
    assert.strictEqual(req.opts.body, 'raw');
    assert.deepStrictEqual(req.opts.headers, { app_version: '1.2.3' });
});

test('withBody with a content type merges it over the existing headers', () => {
    setHttpDefaults({ headers: { app_version: '1.2.3' } });
    var req = http('/api/pets').post().withBody('raw', 'text/csv');
    assert.deepStrictEqual(req.opts.headers, {
        app_version: '1.2.3',
        'Content-Type': 'text/csv',
    });
});

test('the typed body helpers set the body and its content type', () => {
    var cases = [
        { body: new Blob([ 'x' ]), method: 'withBlobBody', type: 'application/octet-stream' },
        { body: new ArrayBuffer(4), method: 'withArrayBufferBody', type: 'application/octet-stream' },
        { body: new ReadableStream(), method: 'withReadableStreamBody', type: 'application/octet-stream' },
        { body: 'plain', method: 'withTextBody', type: 'text/plain' },
        { body: new URLSearchParams('a=1'), method: 'withUrlSearchParamsBody', type: 'application/x-www-form-urlencoded' },
    ];
    cases.forEach(({ body, method, type }) => {
        var req = http('/api/pets').post()[method](body);
        assert.strictEqual(req.opts.body, body, method + ' should set the body');
        assert.strictEqual(req.opts.headers['Content-Type'], type, method + ' content type');
    });
});

test('withFormDataBody sets the multipart content type with the boundary', () => {
    var body = new FormData();
    body.append('name', 'Fido');
    var req = http('/api/pets').post().withFormDataBody(body, 'abc123');
    assert.strictEqual(req.opts.body, body);
    assert.strictEqual(req.opts.headers['Content-Type'], 'multipart/form-data; boundary=abc123');
});

test('withJsonBody serializes the value and sets the json content type', () => {
    var req = http('/api/pets').post().withJsonBody({ age: 5, name: 'Fido' });
    assert.strictEqual(req.opts.body, '{"age":5,"name":"Fido"}');
    assert.strictEqual(req.opts.headers['Content-Type'], 'application/json');
});

test('withJsonBody with skipStringify passes an already-serialized body through', () => {
    var req = http('/api/pets').post().withJsonBody('{"name":"Fido"}', true);
    assert.strictEqual(req.opts.body, '{"name":"Fido"}');
    assert.strictEqual(req.opts.headers['Content-Type'], 'application/json');
});

test('accept sets the Accept header without disturbing the others', () => {
    setHttpDefaults({ headers: { app_version: '1.2.3' } });
    var req = http('/api/pets').withTextBody('x').accept('application/json');
    assert.deepStrictEqual(req.opts.headers, {
        Accept: 'application/json',
        app_version: '1.2.3',
        'Content-Type': 'text/plain',
    });
});

test('post, put, patch and del set the method', () => {
    assert.strictEqual(http('/api/pets').post().opts.method, 'POST');
    assert.strictEqual(http('/api/pets').put().opts.method, 'PUT');
    assert.strictEqual(http('/api/pets').patch().opts.method, 'PATCH');
    assert.strictEqual(http('/api/pets').del().opts.method, 'DELETE');
});

test('a method set in the options survives until a builder overrides it', () => {
    assert.strictEqual(http('/api/pets', { method: 'PATCH' }).opts.method, 'PATCH');
    assert.strictEqual(http('/api/pets', { method: 'PATCH' }).post().opts.method, 'POST');
});

test('withSignal sets the abort signal', () => {
    var controller = new AbortController();
    assert.strictEqual(http('/api/pets').withSignal(controller.signal).opts.signal, controller.signal);
});

test('every builder returns the same instance so calls can be chained', () => {
    var req = http('/api/pets');
    var builders = [
        [ 'accept', 'application/json' ],
        [ 'del' ],
        [ 'patch' ],
        [ 'post' ],
        [ 'put' ],
        [ 'withArrayBufferBody', new ArrayBuffer(1) ],
        [ 'withBlobBody', new Blob([ 'x' ]) ],
        [ 'withBody', 'x' ],
        [ 'withCreds' ],
        [ 'withFormDataBody', new FormData(), 'b' ],
        [ 'withJsonBody', {} ],
        [ 'withReadableStreamBody', new ReadableStream() ],
        [ 'withSignal', new AbortController().signal ],
        [ 'withTextBody', 'x' ],
        [ 'withUrlSearchParamsBody', new URLSearchParams() ],
    ];
    builders.forEach(([ name, ...args ]) => {
        assert.strictEqual(req[name](...args), req, name + ' should return this');
    });
});
