/**
 * @module      http
 * @description A function that wraps fetch api for semantically creating
 *              and dispatching an http request with functional chaining.
 */
class HttpRequest {
    opts: {
        headers: {};
        credentials: 'same-origin' | 'include' | 'omit';
        method: string;
        body: any;
        // Temporary options used to build the fetch options
        noHeaderDefaults?: boolean;
        responsePipeline?: ResponsePipelineJob[];
    };
    url: string;
    responsePipeline: ResponsePipelineJob[];

    constructor (url, opts) {
        this.url = url;
        this.opts = opts || {};
        this.opts.headers = {
            ...(this.opts.noHeaderDefaults ? {} : defaults.headers),
        };

        this.responsePipeline = this.opts.responsePipeline || defaults.responsePipeline || [];

        // Remove non `fetch` options
        delete this.opts.noHeaderDefaults;
        delete this.opts.responsePipeline;
    }

    /*************************************************************
     * REQUEST BUILDER - CHAINABLE FUNCTIONS
     *************************************************************/
    /**
     * Add credentials header, defaults to same-origin.
     * Note that the underlying fetch api defaults to
     * same-origin, so unless you pass an arg, it's almost
     * certainly not necessary to call this method.
     * @returns {HttpRequest}
     */
    withCreds (credentials: 'same-origin' | 'include' | 'omit' = 'same-origin') {
        Object.assign(this.opts, {
            credentials,
        });
        return this;
    }

    /**
     * Add body to a request. You can either supply the content type as a second argument or it will be inferred by the body type.
     * @returns {HttpRequest}
     */
    withBody (body, contentType = '') {
        if (contentType) {
            // Merge Headers nested object
            var headers = Object.assign({}, this.opts.headers, {
                'Content-Type': contentType,
            });

            // Merge object
            Object.assign(this.opts, {
                body: body,
                headers: headers,
            });
            return this;
        }

        // Detect the type of body and set the content type header
        if (body instanceof Blob) {
            return this.withBlobBody(body);
        }
        if (body instanceof ArrayBuffer) {
            return this.withArrayBufferBody(body);
        }
        if (body instanceof FormData) {
            return this.withFormDataBody(body);
        }
        if (body instanceof ReadableStream) {
            return this.withReadableStreamBody(body);
        }
        if (body instanceof URLSearchParams) {
            return this.withUrlSearchParamsBody(body);
        }
        if (typeof body === 'string') {
            return this.withTextBody(body);
        }
        return this.withJsonBody(body);
    }

    /**
     * Add Blob body and set content type header.
     * @param {Blob} body - Blob to set to the body.
     * @returns {HttpRequest}
     */
    withBlobBody (body: Blob) {
        return this.withBody(body, 'application/octet-stream');
    }

    /**
     * Add ArrayBuffer body and set content type header.
     * @param {ArrayBuffer} body - ArrayBuffer to set to the body.
     * @returns {HttpRequest}
     */
    withArrayBufferBody (body: ArrayBuffer) {
        return this.withBody(body, 'application/octet-stream');
    }

    withFormDataBody (body: FormData) {
        return this.withBody(body, 'multipart/form-data');
    }

    withReadableStreamBody (body: ReadableStream) {
        return this.withBody(body, 'application/octet-stream');
    }

    withTextBody (body: string) {
        return this.withBody(body, 'text/plain');
    }

    withUrlSearchParamsBody (body: URLSearchParams) {
        return this.withBody(body, 'application/x-www-form-urlencoded');
    }

    /**
     * Add JSON body and set content type header.
     * @param {*} body - JS value to stringify() and set to the body.
     * @memberof http
     * @instance
     */
    withJsonBody (body, skipStringify = false) {
        return this.withBody(skipStringify ? body : JSON.stringify(body), 'application/json');
    }

    /**
     * Add accept header to the request. This is generally not needed because the various `request*` methods
     * will set the accept header for you. However, if you need to set the accept header manually, you can use this method.
     * @param {string} key - Header key.
     * @param {string} value - Header value.
     * @returns {HttpRequest}
     */
    accept (contentType) {
        // Merge Headers nested object
        var headers = Object.assign({}, this.opts.headers, {
            Accept: contentType,
        });

        // Merge object
        Object.assign(this.opts, {
            headers: headers,
        });
        return this;
    }

    /**
     * Set the method of the fetch request to POST.
     * @memberof http
     * @instance
     */
    post () {
        this.opts.method = 'POST';
        return this;
    }

    /**
     * Set the method of the fetch request to PUT.
     * @memberof http
     * @instance
     */
    put () {
        this.opts.method = 'PUT';
        return this;
    }

    /**
     * Set the method of the fetch request to DELETE.
     * @memberof http
     * @instance
     */
    del () {
        this.opts.method = 'DELETE';
        return this;
    }

    /*************************************************************
     * RESPONSE PIPELINE BUILDER - CHAINABLE FUNCTIONS
     *************************************************************/
    /**
     * Add a handler for a redirect response to the response pipeline.
     * @param fn
     * @returns 
     */
    handleRedirect (fn) {
        this.responsePipeline.push({ job: (response) => { response.redirect && fn(response); } });
        return this;
    }

    /**
     * Add a handler for an unauthorized response to the response pipeline.
     * @param fn 
     * @returns 
     */
    handleUnauthorizedRedirect (fn) {
        this.responsePipeline.push({ job: (response) => { response && [ 302, 419 ].includes(response.status) && fn(response); } });
        return this;
    }


    /*************************************************************
     * REQUESTS (DISPATCH HTTP REQUEST AND RETURN PROMISE)
     *************************************************************/
    /**
     * Initiate the fetch request and return the fetch `Response` object.
     * see: https://developer.mozilla.org/en-US/docs/Web/API/Response
     * @memberof http
     * @returns {Promise<Response>}
     * @instance
     */
    request () {
        // Build request promise
        var request = (http.tryMocked && http.tryMocked(this.url, this.opts)) || fetch(this.url, this.opts)
        for (let { catch: isCatch, job } of this.responsePipeline) {
            if (isCatch) {
                request = request.catch(job);
            }
            else {
                request = request.then(job);
            }
        }

        // Append request recording to promise
        if (http.record) {
            // Record the requests and responses
            // while in dev mode in order to be used
            // as mock server responses for application tests.
            request = request.then(http.record.bind(this));
        }

        // Return request promise
        return request;
    }

    /**
     * Initiate the fetch request w/ the Accept Array Buffer header and return the body as an `ArrayBuffer`.
     * @memberof http
     * @returns {Promise<Response>}
     * @instance
     */
    requestArrayBuffer () {
        this.accept('application/octet-stream');
        return this.request().then(res => res.status === 204 ? null : res.arrayBuffer());
    }

    /**
     * Initiate the fetch request w/ the Accept Blob header and return the body as a `Blob`.
     * @memberof http
     * @returns {Promise<Response>}
     * @instance
     */
    requestBlob () {
        this.accept('application/octet-stream');
        return this.request().then(res => res.status === 204 ? null : res.blob());
    }

    /**
     * Initiate the fetch request w/ the Accept Form Data header and return the body as `FormData`.
     * @memberof http
     * @returns {Promise<Response>}
     * @instance
     */
    requestFormData () {
        this.accept('multipart/form-data');
        return this.request().then(res => res.status === 204 ? null : res.formData());
    }

    /**
     * Initiate the fetch request w/ the Accept JSON header and return the parsed JSON body (or null if no body).
     * @memberof http
     * @returns {Promise<Response>}
     * @instance
     */
    requestJson () {
        // Set Accept header to json
        // and build request promise
        this.accept('application/json');
        return this.request().then(res => res.status === 204 ? null : res.json());
    }

    /**
     * Initiate the fetch request w/ the Accept Text header and return the body as text.
     * @memberof http
     * @returns {Promise<Response>}
     * @instance
     */
    requestText () {
        this.accept('text/plain');
        return this.request().then(res => res.status === 204 ? null : res.text());
    }
}

export function buildResponsePipeline (fn: (any: any) => any) {
    var _this = {} as any;
    _this.responsePipeline = [];
    _this.responsePipeline.push({ job: fn });
    _this.then = (fn: (any: any) => any) => { _this.responsePipeline.push({ job: fn }); return _this; };
    _this.catch = (fn: (any: any) => any) => { _this.responsePipeline.push({ job: fn, catch: true }); return _this; };
    _this.setDefault = () => { _this.responsePipeline = defaults.responsePipeline || [] };
    _this.build = () => { return _this.responsePipeline };
    return _this;
}

export function setHttpDefaults (newDefaults: {}) {
    defaults = { ...defaults, ...newDefaults };
}

let defaults: {
    headers?: {}
    responsePipeline?: ResponsePipelineJob[]
} = {};

type ResponsePipelineJob = {
    job: (any: any) => any,
    catch?: boolean
};

/**
 * Start building a fetch request, defaults to GET method. Aside from the options supported by fetch,
 * there are two additional options: `noHeaderDefaults` and `responsePipeline`. The former is a boolean
 * that, when true, will prevent the default headers from being added to the request. The latter is an
 * array of functions that will be applied to the response object before the promise is resolved. Use
 * `buildResponsePipeline` to create a response pipeline.
 * 
 * See: https://developer.mozilla.org/en-US/docs/Web/API/Request/Request for more info on fetch options.
 * @param {string} url
 * @param {{
 * 
 * headers: {},
 * noHeaderDefaults?: boolean,
 * }} opts
 * @memberof http
 */
const http = function (url, opts) {
    return new HttpRequest(url, opts);
} as any;

export default http;
