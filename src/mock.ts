/**
 * @module http-mock
 * @description Mocking library for http requests, the mock helpers are added to the `http` instance passed
 * in to the initialization method.
 * @see https://github.com/hoomanlogic/http/-/blob/main/doc/README.md
 */

/**
 * The http methods the mock, unmocked and recorded maps each keep a bucket for.
 */
const METHODS = [ 'delete', 'get', 'patch', 'post', 'put' ];

/**
 * The methods that carry a request body. Their mocks and recordings are broken
 * out by that body, since the same url can mean different things depending on
 * what was sent to it.
 */
const BODY_METHODS = [ 'patch', 'post', 'put' ];

/**
 * A map with an empty bucket per method - the shape of `mockMap`,
 * `requestCatcher` and `unmockedMap`.
 */
function emptyMethodMap () : {} {
    var map = {};
    METHODS.forEach(method => {
        map[method] = {};
    });
    return map;
}

/**
 * Copy a method map with its urls in sorted order, and - for the methods that
 * break their recordings out by request body - the bodies sorted within each
 * url. Every standard method gets a bucket in the output whether it recorded
 * anything or not, so the shape is stable enough to diff between runs.
 */
function sortMethodMap (map) : {} {
    var sorted = emptyMethodMap();
    Object.keys(map).sort().forEach(method => {
        var urls = Object.keys(map[method]);
        urls.sort();
        sorted[method] = {};
        urls.forEach(url => {
            if (BODY_METHODS.indexOf(method) === -1) {
                sorted[method][url] = map[method][url];
                return;
            }
            sorted[method][url] = {};
            var bodies = Object.keys(map[method][url]);
            bodies.sort();
            bodies.forEach(body => {
                sorted[method][url][body] = map[method][url][body];
            });
        });
    });
    return sorted;
}

export default function (http) {
    global.http = http;

    // Set this to true to include query params in the recorded urls
    http.recordQueryParams = false;

    http.requestCatcher = emptyMethodMap();

    http.unmockedMap = emptyMethodMap();

    /**
     * Clear the map of mocked requests.
     * @memberof http-mock
     * @method clearMocks
     */
    http.clearMocks = function () {
        http.hasMocks = false;
        http.mockMap = emptyMethodMap();
    };

    // Ensure mockMap is defined
    http.clearMocks();

    /**
     * Output the recorded requests and responses in a sorted map.
     * @memberof http-mock
     */
    http.dumpRequestMap = function () {
        return JSON.stringify(sortMethodMap(http.requestCatcher), null, 4);
    };

    /**
     * Output the recorded requests that were not mocked in a sorted map.
     * @memberof http-mock
     */
    http.dumpUnmockedRequestMap = function () {
        return JSON.stringify(sortMethodMap(http.unmockedMap), null, 4);
    };

    /**
     * Mock an http request based on the method and url, optionally pass a request map
     * object in the shape { delete: {}, get: {}, post: {}, put: {} }.
     *
     * Handler should return a fetch `Response` object
     * or undefined to leave the request unhandled.
     * 
     * You can use `http.mockResponse` to build a `Response` object.
     * @memberof http-mock
     */
    http.mock = function (method, url, handler) {
        if (typeof method === 'string') {
            http.hasMocks = true;
            http.mockMap[method.toLowerCase()][url] = handler;
        }
        else {
            http.mockRequestMap(method);
        }
    };

    /**
     * Mock an http request based on a request map object
     * in the shape { delete: {}, get: {}, post: {}, put: {} }
     * @memberof http-mock
     */
    http.mockRequestMap = function (requestMap) {
        METHODS.forEach(method => {
            // A map that doesn't mention a method simply has nothing to mock
            // for it.
            var recorded = requestMap[method];
            if (!recorded) {
                return;
            }

            Object.keys(recorded).forEach(url => {
                if (BODY_METHODS.indexOf(method) === -1) {
                    http.mock(method, url, () => {
                        return http.mockResponse(200, recorded[url]);
                    });
                    return;
                }

                // Only the bodies that were recorded are answered; anything
                // else is left for the caller to handle.
                http.mock(method, url, ({ requestBody }) => {
                    var response = recorded[url][requestBody];
                    if (response === undefined) {
                        return;
                    }
                    return http.mockResponse(200, response);
                });
            });
        });
    };

    /**
     * Create a fetch style response from a status and body
     * @param {*} status
     * @param {*} body
     * @memberof http-mock
     */
    http.mockResponse = function (status, body, headers = {}) {
        return new Response(
            typeof body === 'string' ? body : JSON.stringify(body),
            {
                status,
                headers,
            }
        );
    };

    /**
     * Given a request map (aka refresh map), initiate http requests
     * and return a Promise that will complete when all requests have
     * completed.
     * @param {*} refreshObj
     * @memberof http-mock
     */
    http.refreshMap = function (refreshObj) {
        var promises = [];
        if (refreshObj.get) {
            promises = promises.concat(refreshObj.get.map(url => {
                return http(url).requestJson().catch(() => {});
            }));
        }
        if (refreshObj.post) {
            promises = promises.concat(refreshObj.post.map((request, idx) => {
                return new Promise((resolve) => {
                    setTimeout(function () {
                        http(request[0]).post().withTextBody(request[1]).requestJson().then(resolve).catch(resolve);
                    }, (idx + 1) * 500);
                });
            }));
        }

        return Promise.all(promises);
    };

    http.tryRecord = function (response) {
        var recordReponseHandled = false;
        if (http.onRecordResponse) {
            recordReponseHandled = http.onRecordResponse(this, response);
        }
        if (!recordReponseHandled) {
            // Recorded request urls do not include query params by default
            var url = http.recordQueryParams ? this.url : this.url.split('?')[0];
            let method = (this.opts.method || 'get').toLowerCase();
            http.requestCatcher[method] = http.requestCatcher[method] || {};
            // Breakout the body-carrying requests by the request body
            if (BODY_METHODS.includes(method)) {
                http.requestCatcher[method][url] = http.requestCatcher[method][url] || {};
                http.requestCatcher[method][url][this.opts.body] = 'OK';
            }
            else {
                http.requestCatcher[method][url] = response.body || 'OK';
            }
        }
        return response;
    } 

    /**
     * This is used internally by the `http` module when wrapped with this mock module.
     * @param {*} httpMethod
     * @param {*} url
     * @param {*} requestBody
     * @private
     */
    http.tryMocked = function (url, opts) {
        // Use mock when available
        if (!http.hasMocks) {
            return;
        }
        var method = (opts.method || 'get').toLowerCase();
        var urlNoParams = url.split('?')[0];
        var params = getQueryParams(url);
        // A method with no bucket of its own has no mocks to offer. Leave the
        // request alone rather than throwing on the lookup.
        var methodMocks = http.mockMap[method] || {};

        // First try to match w query params (if applicable), then try to match base url
        var handler = methodMocks[url] || methodMocks[urlNoParams];
        if (handler) {
            let response = handler({ params, requestBody: opts.body, url });
            if (response) {
                return Promise.resolve(response);
            }
        }
        else {
            // Try to match pattern on url
            let mockUrls = Object.keys(methodMocks);
            let urlParts = urlNoParams.split('/');

            for (let i = 0; i < mockUrls.length; i++) {
                // Not a pattern url, can't match, continue
                let mockUrl = mockUrls[i];
                if (!mockUrl.includes(':')) {
                    continue;
                }

                // Differing lengths won't match, continue
                let mockUrlParts = mockUrl.split('?')[0].split('/');
                if (mockUrlParts.length !== urlParts.length) {
                    continue;
                }

                let mockQueryParams = getQueryParams(mockUrl);
                let noMatch = false;

                // Match query params if mock url included any for matching
                if (Object.keys(mockQueryParams).some(param => mockQueryParams[param] !== params[param])) {
                    // Not a match, move on
                    noMatch = true;
                }

                // Match url pattern
                if (!noMatch) {
                    for (let j = 0; j < urlParts.length; j++) {
                        if (urlParts[j] !== mockUrlParts[j] && mockUrlParts[j][0] !== ':') {
                            // Not a match, move on
                            noMatch = true;
                            break;
                        }
                        else if (mockUrlParts[j][0] === ':') {
                            // Set parameter based on the mocked
                            params[mockUrlParts[j].slice(1)] = parseParam(urlParts[j]);
                        }
                    }
                }

                if (!noMatch) {
                    // Invoke the mocked request handler
                    handler = methodMocks[mockUrl];
                    let response = handler({ params, requestBody: opts.body, url });
                    if (response) {
                        return Promise.resolve(response);
                    }

                    // Break out of outer loop of mock keys
                    // once we've matched a pattern, whether
                    // the request has been handled or not.
                    // In fact, this will only be hit if it
                    // wasn't handled, due to the `return` statement.
                    break;
                }
            }
        }

        if (http.onUnmockedRequest) {
            http.unmockedMap[method] = http.unmockedMap[method] || {};
            if (BODY_METHODS.includes(method)) {
                http.unmockedMap[method][url] = http.unmockedMap[method][url] || {};
                http.unmockedMap[method][url][opts.body] = '';
            }
            else {
                http.unmockedMap[method][url] = opts.body || '';
            }
            let response = http.onUnmockedRequest(method, url, opts.body);
            if (response) {
                return Promise.resolve(response);
            }
        }
    };
}

// TODO: Determine if we can use the `getQueryParams` and `parseParam` from `browser`,
//       but i think i recall an issue with trying to use that one,
//       perhaps related to the test environment. Since this is excluded from production,
//       not a big deal to leave it here.
function getQueryParams (url) : {} {
    var query = url.split('?')[1];
    var vars = query ? query.split('&') : [];
    var queryParams = {};
    for (let i = 0; i < vars.length; i++) {
        let [ key, value ] = vars[i].split('=');
        if (!key) {
            continue;
        }
        // Set param
        queryParams[decodeURIComponent(key)] = parseParam(value);
    }
    return queryParams;
}

function parseParam (value) {
    // Decode the string
    var param = decodeURIComponent(value);
    // Try to parse; this will fail for strings,
    // but numbers, objects, and arrays
    // will all be parsed fine. Dates will remain
    // as ISO8601 strings, but that's ok since we
    // generally don't want to pass Date objects
    // around and prefer ISO8601 until a manipulation
    // needs to occur
    try {
        param = JSON.parse(param);
    }
    catch (ex) { /* No worries */ }
    return param;
}

window.addEventListener('unhandledrejection', (event) => {
    console.error(event);
});
