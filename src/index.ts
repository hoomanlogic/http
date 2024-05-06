
type HttpOptions = RequestInit & {
    /**
     * Prevent the default headers from being added to the request.
     */
    noHeaderDefaults?: boolean;
    /**
     * An array of functions that will be applied to the response object before the promise is resolved.
     */
    responsePipeline?: ResponsePipelineJob[];
};

/**
 * @class HttpRequest
 * @classdesc A class that represents a fetch request. This class is chainable and can be used to build a fetch request with various options.
 */
export class HttpRequest {
    opts: RequestInit;
    url: string;
    responsePipeline: ResponsePipelineJob[];

    /**
     * @constructor
     * @param {string} url - The URL to send the request to.
     * @param {HttpOptions} opts - Options to configure the request.
     */
    constructor (url: string, opts: HttpOptions) {
        var { noHeaderDefaults, responsePipeline, ...requestInitOptions } = opts || {};
        this.url = url;
        this.opts = requestInitOptions;
        this.opts.headers = {
            ...(noHeaderDefaults ? {} : defaults.headers),
        };

        this.responsePipeline = responsePipeline || defaults.responsePipeline || [];
    }

    /*************************************************************
     * REQUEST BUILDER - CHAINABLE FUNCTIONS
     *************************************************************/
    /**
     * Add credentials header, defaults to same-origin.
     * Note that the underlying fetch api defaults to
     * same-origin, so unless you pass an arg, it's almost
     * certainly not necessary to call this method.
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    withCreds (credentials: 'same-origin' | 'include' | 'omit' = 'same-origin') : HttpRequest {
        Object.assign(this.opts, {
            credentials,
        });
        return this;
    }

    /**
     * Add body to a request. You can either supply the content type as a second argument or it will be inferred by the body type.
     * @param {any} body - Any body that you want to add to your request: this can be a Blob, an ArrayBuffer, a TypedArray, a DataView, a FormData, a URLSearchParams, a string, or a ReadableStream object. Note that a request using the GET or HEAD method cannot have a body.
     * @param {string} contentType - The content type of the body.
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    withBody (body, contentType = '') : HttpRequest {
        this.opts.body = body;

        if (contentType) {
            // Merge Headers nested object
            var headers = Object.assign({}, this.opts.headers, {
                'Content-Type': contentType,
            });

            this.opts.headers = headers;
        }

        return this;
    }

    /**
     * Add Blob body and set content type header.
     * @param {Blob} body - Blob to set to the body.
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    withBlobBody (body: Blob) : HttpRequest {
        return this.withBody(body, 'application/octet-stream');
    }

    /**
     * Add ArrayBuffer body and set content type header.
     * @param {ArrayBuffer} body - ArrayBuffer to set to the body.
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    withArrayBufferBody (body: ArrayBuffer) : HttpRequest {
        return this.withBody(body, 'application/octet-stream');
    }

    /**
     * Add FormData body and set content type header. In the browser, just use `withBody`
     * and pass the FormData object, the browser will automatically set the content type header.
     * @param {FormData} body
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    withFormDataBody (body: FormData, boundary) : HttpRequest {
        return this.withBody(body, 'multipart/form-data; boundary=' + boundary);
    }

    /**
     * Add ReadableStream body and set content type header.
     * @param {ReadableStream} body
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    withReadableStreamBody (body: ReadableStream) : HttpRequest {
        return this.withBody(body, 'application/octet-stream');
    }

    /**
     * Add text body and set content type header.
     * @param {string} body
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    withTextBody (body: string) : HttpRequest {
        return this.withBody(body, 'text/plain');
    }

    /**
     * Add URLSearchParams body and set content type header.
     * @param {URLSearchParams} body
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    withUrlSearchParamsBody (body: URLSearchParams) : HttpRequest {
        return this.withBody(body, 'application/x-www-form-urlencoded');
    }

    /**
     * Add JSON body and set content type header.
     * @param {{} | null | number | string | []} body - JS value to stringify() and set to the body.
     * @param {boolean} skipStringify - Skip JSON.stringify() on the body. Set this to true if it's already stringified.
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    withJsonBody (body: {} | null | number | string | [], skipStringify = false) : HttpRequest {
        return this.withBody(skipStringify ? body : JSON.stringify(body), 'application/json');
    }

    /**
     * Add accept header to the request. This is generally not needed because the various `request*` methods
     * will set the accept header for you. However, if you need to set the accept header manually, you can use this method.
     * @param {string} contentType - The content type to set the accept header to.
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    accept (contentType) : HttpRequest {
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
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    post () : HttpRequest {
        this.opts.method = 'POST';
        return this;
    }

    /**
     * Set the method of the fetch request to PUT.
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    put () : HttpRequest {
        this.opts.method = 'PUT';
        return this;
    }

    /**
     * Set the method of the fetch request to DELETE.
     * @returns {HttpRequest} - Returns the current instance of the HttpRequest.
     */
    del () : HttpRequest {
        this.opts.method = 'DELETE';
        return this;
    }

    /*************************************************************
     * REQUESTS (DISPATCH HTTP REQUEST AND RETURN PROMISE)
     *************************************************************/
    /**
     * Initiate the fetch request and return the fetch `Response` object.
     * see: https://developer.mozilla.org/en-US/docs/Web/API/Response
     */
    request () : Promise<Response> {
        // Build request promise
        var request = (http.tryMocked && http.tryMocked(this.url, this.opts)) || fetch(this.url, this.opts as RequestInit);
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
     */
    requestArrayBuffer () : Promise<ArrayBuffer> {
        this.accept('application/octet-stream');
        return this.request().then(res => res.status === 204 ? null : res.arrayBuffer());
    }

    /**
     * Initiate the fetch request w/ the Accept Blob header and return the body as a `Blob`.
     */
    requestBlob () : Promise<Blob> {
        this.accept('application/octet-stream');
        return this.request().then(res => res.status === 204 ? null : res.blob());
    }

    /**
     * Initiate the fetch request w/ the Accept Form Data header and return the body as `FormData`.
     */
    requestFormData () : Promise<FormData> {
        this.accept('multipart/form-data');
        return this.request().then(res => res.status === 204 ? null : res.formData());
    }

    /**
     * Initiate the fetch request w/ the Accept JSON header and return the parsed JSON body (or null if no body).
     */
    requestJson () : Promise<{} | null | number | string | []> {
        // Set Accept header to json
        // and build request promise
        this.accept('application/json');
        return this.request().then(res => res.status === 204 ? null : res.json());
    }

    /**
     * Initiate the fetch request w/ the Accept Text header and return the body as text.
     * @returns {Promise<string>}
     */
    requestText () {
        this.accept('text/plain');
        return this.request().then(res => res.status === 204 ? null : res.text());
    }
}

/**
 * Create a response pipeline.
 */
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

type HttpDefaults = {
    headers?: {}
    responsePipeline?: ResponsePipelineJob[]
};

/**
 * Set the default options for the http function. Options are `headers` and `responsePipeline`.
 * @param newDefaults 
 */
export function setHttpDefaults (newDefaults: HttpDefaults) {
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
 * @param {HttpOptions} opts
 * @returns {HttpRequest}
 */
const http = function (url: string, opts: HttpOptions): HttpRequest {
    return new HttpRequest(url, opts);
};
http.tryMocked = null;
http.record = null;

export default http;
