/**
 * Shared fixtures for the test suite. Deliberately not named `*.test.js` so the
 * runner's glob doesn't try to execute it.
 */
const { setHttpDefaults } = require('../dist/index.js');
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

/**
 * Run `fn` with `fetch` swapped for `impl`, putting the real one back whether
 * `fn` resolves or rejects.
 */
function withFetch (impl, fn) {
    var original = globalThis.fetch;
    globalThis.fetch = impl;
    return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

/**
 * A `fetch` stand-in that records what it was called with. `responder` is a
 * function so each call can build a fresh Response - a body only reads once.
 */
function fetchSpy (responder) {
    var spy = {
        calls: [],
        get last () { return spy.calls[spy.calls.length - 1]; },
        impl: async function (url, opts) {
            spy.calls.push({ opts, url });
            return typeof responder === 'function' ? responder(url, opts) : responder;
        },
    };
    return spy;
}

/**
 * Put the module-level state back the way a fresh import leaves it. The
 * defaults, the mock hook and the recorder all hang off the one shared `http`
 * object, so a test that sets any of them has to hand it back.
 */
function resetHttpState () {
    http.tryMocked = null;
    http.record = null;
    // Back to unset, not to empty - an empty pipeline is truthy, and would hide
    // the fallbacks that only run when no default was ever configured.
    setHttpDefaults({ headers: undefined, responsePipeline: undefined });
}

module.exports = { collect, fetchSpy, resetHttpState, streamedResponse, withFetch };
