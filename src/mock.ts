/**
 * @module http-mock
 * @description Mocking library for http requests, the mock helpers are added to the `http` instance passed
 * in to the initialization method.
 * @see https://github.com/hoomanlogic/http/-/blob/main/doc/README.md
 */

export default function (http) {
    global.http = http;
    
    // Set this to true to include query params in the recorded urls
    http.recordQueryParams = false;

    http.requestCatcher = {
        delete: {},
        get: {},
        post: {},
        put: {},
    };

    http.unmockedMap = {
        delete: {},
        get: {},
        post: {},
        put: {},
    };

    /**
     * Clear the map of mocked requests.
     * @memberof http-mock
     * @method clearMocks
     */
    http.clearMocks = function () {
        http.hasMocks = false;
        http.mockMap = {
            delete: {},
            get: {},
            post: {},
            put: {},
        };
    };

    // Ensure mockMap is defined
    http.clearMocks();

    /**
     * Output the recorded requests and responses in a sorted map.
     * @memberof http-mock
     */
    http.dumpRequestMap = function () {
        var keySortedRequestCatcher = {
            delete: {},
            get: {},
            post: {},
            put: {},
        };

        var deleteKeys = Object.keys(http.requestCatcher.delete);
        deleteKeys.sort();
        deleteKeys.forEach(deleteKey => {
            keySortedRequestCatcher.delete[deleteKey] = http.requestCatcher.delete[deleteKey];
        });

        var getKeys = Object.keys(http.requestCatcher.get);
        getKeys.sort();
        getKeys.forEach(getKey => {
            keySortedRequestCatcher.get[getKey] = http.requestCatcher.get[getKey];
        });

        var postKeys = Object.keys(http.requestCatcher.post);
        postKeys.sort();
        postKeys.forEach(postKey => {
            keySortedRequestCatcher.post[postKey] = {};
            var postRequestKeys = Object.keys(http.requestCatcher.post[postKey]);
            postRequestKeys.sort();
            postRequestKeys.forEach(postRequestKey => {
                keySortedRequestCatcher.post[postKey][postRequestKey] = http.requestCatcher.post[postKey][postRequestKey];
            });
        });

        var putKeys = Object.keys(http.requestCatcher.put);
        putKeys.sort();
        putKeys.forEach(putKey => {
            keySortedRequestCatcher.put[putKey] = http.requestCatcher.put[putKey];
        });

        return JSON.stringify(keySortedRequestCatcher, null, 4);
    };

    /**
     * Output the recorded requests that were not mocked in a sorted map.
     * @memberof http-mock
     */
    http.dumpUnmockedRequestMap = function () {
        var keySortedUnmockedMap = {
            delete: {},
            get: {},
            post: {},
            put: {},
        };

        var deleteKeys = Object.keys(http.unmockedMap.delete);
        deleteKeys.sort();
        deleteKeys.forEach(deleteKey => {
            keySortedUnmockedMap.delete[deleteKey] = http.unmockedMap.delete[deleteKey];
        });

        var getKeys = Object.keys(http.unmockedMap.get);
        getKeys.sort();
        getKeys.forEach(getKey => {
            keySortedUnmockedMap.get[getKey] = http.unmockedMap.get[getKey];
        });

        var postKeys = Object.keys(http.unmockedMap.post);
        postKeys.sort();
        postKeys.forEach(postKey => {
            keySortedUnmockedMap.post[postKey] = {};
            var postRequestKeys = Object.keys(http.unmockedMap.post[postKey]);
            postRequestKeys.sort();
            postRequestKeys.forEach(postRequestKey => {
                keySortedUnmockedMap.post[postKey][postRequestKey] = http.unmockedMap.post[postKey][postRequestKey];
            });
        });

        var putKeys = Object.keys(http.unmockedMap.put);
        putKeys.sort();
        putKeys.forEach(putKey => {
            keySortedUnmockedMap.put[putKey] = http.unmockedMap.put[putKey];
        });

        return JSON.stringify(keySortedUnmockedMap, null, 4);
    };

    /**
     * Mock an http request based on the method and url, optionally pass a request map
     * object in the shape { delete: {}, get: {}, post: {}, put: {} }.
     *
     * Handler should return array of [status : number, headers : {}, body : ?string]
     * or undefined to leave the request unhandled.
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
        // Map recorded GET requests
        Object.keys(requestMap.get).forEach(url => {
            http.mock('get', url, () => {
                return http.mockResponse(200, requestMap.get[url]);
            });
        });

        // Map recorded POST requests
        Object.keys(requestMap.post).forEach(url => {
            http.mock('post', url, ({ requestBody }) => {
                var response = requestMap.post[url][requestBody];
                if (response === undefined) {
                    return;
                }
                return http.mockResponse(200, response);
            });
        });

        // Map recorded PUT requests
        Object.keys(requestMap.put).forEach(url => {
            http.mock('put', url, ({ requestBody }) => {
                var response = requestMap.put[url][requestBody];
                if (response === undefined) {
                    return;
                }
                return http.mockResponse(200, response);
            });
        });

        // Map recorded DELETE requests
        Object.keys(requestMap.delete).forEach(url => {
            http.mock('delete', url, () => {
                return http.mockResponse(200, requestMap.delete[url]);
            });
        });
    };

    /**
     * Create a fetch style response from a status and body
     * @param {*} status
     * @param {*} body
     * @memberof http-mock
     */
    http.mockResponse = function (status, body) {
        return [
            status,
            { 'Content-Type': 'application/json; charset=utf-8' },
            typeof body === 'string' ? body : JSON.stringify(body),
        ];
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
                        http(request[0]).post().withStringBody(request[1]).requestJson().then(resolve).catch(resolve);
                    }, (idx + 1) * 500);
                });
            }));
        }

        return Promise.all(promises);
    };

    /**
     * A promise wrapper around a fetch response.
     * @param {*} response
     * @private
     */
    http.promiseMockedResponse = function (response) {
        if (response[0] === 200) {
            let json = (response[2] && response[2] !== 'OK') ?
                JSON.parse(response[2])
                :
                undefined;
            return Promise.resolve(json);
        }
        else {
            return Promise.resolve({ status: response[0] })
        }
    };

    http.record = function (response) {
        var recordReponseHandled = false;
        if (http.onRecordResponse) {
            recordReponseHandled = http.onRecordResponse(this, response);
        }
        if (!recordReponseHandled) {
            // Recorded request urls do not include query params by default
            var url = http.recordQueryParams ? this.url : this.url.split('?')[0];
            let method = (this.opts.method || 'get').toLowerCase();
            // Breakout POST and PUT requests by the request body
            if ([ 'post', 'put' ].includes(method)) {
                http.requestCatcher[method][url] = http.requestCatcher[method][url] || {};
                http.requestCatcher[method][url][this.opts.body] = 'OK';
            }
            else {
                http.requestCatcher[method][url] = 'OK';
            }
        }
        return response;
    } 

    /**
     * This is used internally by the `http` module when not in production mode,
     * if the request is not handled by a mock it will continue as normal.
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

        // First try to match w query params (if applicable), then try to match base url
        var handler = http.mockMap[method][url] || http.mockMap[method][urlNoParams];
        if (handler) {
            let response = handler({ params, requestBody: opts.body, url });
            if (response) {
                return http.promiseMockedResponse(response);
            }
        }
        else {
            // Try to match pattern on url
            let mockUrls = Object.keys(http.mockMap[method] || {});
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
                    handler = http.mockMap[method][mockUrl];
                    let response = handler({ params, requestBody: opts.body, url });
                    if (response) {
                        return http.promiseMockedResponse(response);
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
            if (method === 'post' || method === 'put') {
                http.unmockedMap[method][url] = http.unmockedMap[method][url] || {};
                http.unmockedMap[method][url][opts.body] = '';
            }
            else {
                http.unmockedMap[method][url] = opts.body || '';
            }
            let response = http.onUnmockedRequest(method, url, opts.body);
            if (response) {
                return http.promiseMockedResponse(response);
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
