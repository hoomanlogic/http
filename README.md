# http

[![npm version](http://img.shields.io/npm/v/@hoomanlogic/http.svg?style=flat-square)](http://browsenpm.org/package/@hoomanlogic/http)

A function that wraps fetch api for semantically creating and dispatching an http request with functional chaining

## Installing

```
npm install --save @hoomanlogic/http
```

## Basic Usage

```js
import http from '@hoomanlogic/http';

// Simple get request returning a JSON response
var jsonResponse = await http('/api/pets').requestJson();

// Post JSON request returning a JSON response
var jsonResponse = await http('/api/pets').post().withJsonBody({ name: 'Fido', type: 'dog', age: 5 }).requestJson();

// Delete request returning a fetch `Response` response
// See: <https://developer.mozilla.org/en-US/docs/Web/API/Response> for more info.
var fetchResponse = await http(`/api/pets/${response.id}`).del().request();
```

## Options

Akin to `fetch`, `http` supports a second argument with options.

Aside from the options supported by fetch, there are two additional options:

- `noHeaderDefaults` - a boolean that, when true, will prevent the default headers from being added to the request
- `responsePipeline`. The former is an array of functions that will be applied to the response object before the promise is resolved. Use `buildResponsePipeline` to create a response pipeline.
 
 See: <https://developer.mozilla.org/en-US/docs/Web/API/Request/Request> for more info on fetch options.

## Configuring Defaults

You can configure default headers for requests and a default response pipeline to handle
responses. 

```js
import { setHttpDefaults } from '@hoomanlogic/http';

setHttpDefaults({
    headers: {
        app_version: global.appVersion,
    },
    responsePipeline: buildResponsePipeline((response) => {
        if (response.status >= 200 && response.status < 300) {
            return response;
        }
        else {
            var error = new Error(response.statusText);
            error.response = response;
            throw error;
        }
    }).catch((err) => {
        // Get response object from error
        var response;
        if (err && err.response) {
            response = err.response;
        }
        else {
            response = err;
        }

        // Session not valid or redirect code
        if (!redirecting && response && [ 302, 419 ].includes(response.status)) {
            // Redirect to logon page
            window.location.href = '/Login?ReturnUrl=' + encodeURIComponent(window.location.pathname);
        }

        // Rethrow all other errors down the chain
        throw err;
    }).build(),
});
```

## Mocking Requests

### Quick Overview

To bootstrap http with mocking functions, first do the following:

```js
import http from '@hoomanlogic/http';
import mockHttp from '@hoomanlogic/http/dist/mock';
mockHttp(http);
```

Mocking a request can be done at any time in a dev environment by calling `http.mock(method, url, handler)`
where the handler will be passed an object that may contain a 'requestBody' value if a body was supplied. The handler
should return a `http.mockResponse(status, body)`, or `undefined` to signal that it was not handled.

Alternatively, `http.mock(requestMap)` can be called to build mocks based on a request map.

Call `http.clearMocks()` to disable mocks and clear the mock map.

Call `http.dumpRequestMap()` to output a key sorted request map in JSON format. This can be parsed and passed to
`http.mock(parsedRequestMap)`. While in the dev environment runtime, all requests are automatically recorded.

Set `http.onUnmockedRequest` to a function w signature (method, url, body) to be invoked whenever a request was not
handled by a mock.

Set `http.onRecordResponse` to a function w signature (request, response) to be invoked whenever a reponse has been captured
in order to use custom logic of recording the response. Return true to indicate that you've handled the record so the default
recording logic is not invoked. 

Set `http.recordQueryParams` to `true` if you want to match the request by params.

For pattern matching on the URL of a mocked request, prefix a part with a colon and the value will be extracted from the matching url
and passed in the `params` object that is passed to the request handler. Ie, `/api/pets/:id` would match a url of `/api/pets/823` and
pass a `params` of `{ id: 823 }`.

If you want to ensure that unmocked requests do not fallback to make actual server requests you
can throw an error in the `http.onUnmockedRequest` function.

TIP: `http` is available globally when augmented with the mockHttp function, which means you can use it in the Dev Tools Console.
