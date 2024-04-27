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
        header?: {}
        noHeaderDefaults?: boolean;
        recordQueryParams?: boolean;
        responsePipeline?: ResponsePipelineJob[];
    };
    url: string;
    responsePipeline: ResponsePipelineJob[];

    constructor (url, opts) {
        this.url = url;
        this.opts = opts || {};
        this.opts.headers = {
            ...(this.opts.noHeaderDefaults ? {} : defaults.headers),
            ...(this.opts.header || {}),
        };

        this.responsePipeline = this.opts.responsePipeline || defaults.responsePipeline || [];

        // Remove non `fetch` options
        delete this.opts.header;
        delete this.opts.noHeaderDefaults;
        delete this.opts.responsePipeline;
    }

    /*************************************************************
     * REQUEST BUILDER - CHAINABLE FUNCTIONS
     *************************************************************/
    /**
     * Add body to a request
     * @param {*} body
     * @memberof http
     * @instance
     */
    withBody (body) {
        Object.assign(this.opts, {
            body: body,
        });
        return this;
    }

    /**
     * Add credentials header, defaults to same-origin.
     * Note that the underlying fetch api defaults to
     * same-origin, so unless you pass an arg, it's almost
     * certainly not necessary to call this method.
     * @memberof http
     * @instance
     */
    withCreds (credentials: 'same-origin' | 'include' | 'omit' = 'same-origin') {
        Object.assign(this.opts, {
            credentials,
        });
        return this;
    }

    /**
     * Add JSON body and set content type header.
     * @param {*} body - JS value to stringify() and set to the body.
     * @memberof http
     * @instance
     */
    withJsonBody (body) {
        // Merge Headers nested object
        var headers = Object.assign({}, this.opts.headers, {
            'Content-Type': 'application/json',
        });

        // Merge object
        Object.assign(this.opts, {
            body: JSON.stringify(body),
            headers: headers,
        });
        return this;
    }

    /**
     * Add JSON body and set content type header, without stringifying the value.
     * @param {string} body
     * @memberof http
     * @instance
     */
    withStringBody (body: string) {
        // Merge Headers nested object
        var headers = Object.assign({}, this.opts.headers, {
            'Content-Type': 'application/json',
        });

        // Merge object
        Object.assign(this.opts, {
            body: body,
            headers: headers,
        });
        return this;
    }

    /**
     * Set the Accept header to JSON. You can also end your functional chain w/ `requestJson()`
     * to both set this header and initiate the fetch request, returning a Promise.
     * @memberof http
     * @instance
     */
    acceptJson () {
        // Merge Headers nested object
        var headers = Object.assign({}, this.opts.headers, {
            Accept: 'application/json',
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
     * Initiate the fetch request
     * @memberof http
     * @returns {Promise<Response>}
     * @instance
     */
    request () {
        // Build request promise
        var request = (http.tryMocked && http.tryMocked(this.url, this.opts)) || fetch(this.url, this.opts)
        for (let job of this.responsePipeline) {
            if (job.catch) {
                request = request.catch(job.job);
            }
            else {
                request = request.then(job.job);
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
     * Initiate the fetch request w/ the Accept JSON header and return the parsed JSON body (or null if no body).
     * @memberof http
     * @returns {Promise<Response>}
     * @instance
     */
    requestJson () {
        // Set Accept header to json
        // and build request promise
        this.acceptJson();
        return this.request().then(res => res.status === 204 ? null : res.json());
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
 * Start building a fetch request, defaults to GET method.
 * @param {*} url
 * @param {*} opts
 * @memberof http
 */
const http = function (url, opts) {
    return new HttpRequest(url, opts);
} as any;

export default http;
