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

// Simple get request with a JSON response
var response = await http('/api/pets').requestJson();

// Post JSON request with JSON response
var response = await http('/api/pets').post().withJsonBody({ name: 'Fido', type: 'dog', age: 5 }).requestJson();

// Delete JSON request with no response
await http(`/api/pets/${response.id}`).del().request();
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
