'use strict';
// **Github:** https://github.com/toajs/toa
//
// **License:** MIT

var util = require('util');
var http = require('http');
var Stream = require('stream');
var assert = require('assert');

var thunks = require('thunks');
var statuses = require('statuses');
var Cookies = require('cookies');
var accepts = require('accepts');
var isJSON = require('koa-is-json');

var Context = require('./lib/context');
var request = require('./lib/request');
var response = require('./lib/response');

var pwdReg = new RegExp(process.cwd().replace(/([\^\$\.\*\+\?\=\!\:\|\\\/\(\)\[\]\{\}])/g, '\\$1'), 'g');

module.exports = Toa;

Toa.NAME = 'toa';
Toa.VERSION = 'v0.5.0';

function Toa(server, body, options) {
  if (!(this instanceof Toa)) return new Toa(server, body, options);

  this.middleware = [];
  this.request = Object.create(request);
  this.response = Object.create(response);
  this.server = server && isFunction(server.listen) ? server : http.createServer();

  if (this.server !== server) {
    options = body;
    body = server;
  }

  if (!isFunction(body)) {
    options = body;
    body = noOp;
  }

  options = options || {};
  this.body = body;

  if (isFunction(options)) {
    this.errorHandler = options;
    this.debug = null;
  } else {
    this.debug = isFunction(options.debug) ? options.debug : null;
    this.errorHandler = isFunction(options.onerror) ? options.onerror : null;
  }

  var config = {
    proxy: false,
    env: process.env.NODE_ENV || 'development',
    subdomainOffset: 2,
    poweredBy: 'Toa'
  };

  Object.defineProperty(this, 'config', {
    get: function () {
      return config;
    },
    set: function(obj) {
      assert(obj && obj.constructor === Object, 'require a object');
      for (var key in obj) config[key] = obj[key];
    },
    enumerable: true,
    configurable: false
  });
}

/**
* Toa prototype.
*/

var proto = Toa.prototype;

/**
* A [Keygrip](https://github.com/expressjs/keygrip) object or an array of keys,
* will be passed to Cookies to enable cryptographic signing.
*/

proto.keys = ['toa'];

/**
* Use the given middleware `fn`.
*
* @param {Function} fn
* @return {this}
* @api public
*/

proto.use = function (fn) {
  assert(isFunction(fn), 'require a function');
  this.middleware.push(fn);
  return this;
};

/**
* start server
*
* @param {Mixed} ...
* @return {this}
* @api public
*/

proto.listen = function () {
  var app = this;
  var args = arguments;
  var body = this.body;
  var debug = this.debug;
  var server = this.server;
  var errorHandler = this.errorHandler;
  var middleware = this.middleware.slice();

  setImmediate(function () {
    server.addListener('request', function (req, res) {
      res.statusCode = 404;

      function onerror(err) {
        if (errorHandler) {
          try {
            err = errorHandler.call(ctx, err) || err;
          } catch (error) {
            err = error;
          }
        }
        // ignore err
        if (err === true) return err;

        try {
          onResError.call(ctx, err);
        } catch (error) {
          app.onerror.call(ctx, error);
        }
      }

      var ctx = createContext(app, req, res);
      var Thunk = thunks({
        debug: debug,
        onerror: onerror
      });

      Object.freeze(Thunk);
      ctx.on('error', onerror);
      ctx.catchStream(res);

      if (ctx.config.poweredBy) ctx.set('X-Powered-By', ctx.config.poweredBy);

      Thunk.seq.call(ctx, middleware)(function () {
        return body.call(this, Thunk);
      })(function () {
        return Thunk.seq.call(this, this.onPreEnd);
      })(respond);
    });

    server.listen.apply(server, args);
  });

  return server;
};

/**
* Default system error handler.
*
* @param {Error} err
* @api private
*/

proto.onerror = function (err) {
  // ignore null and response error
  if (err == null || (err.status && err.status !== 500)) return;
  assert(util.isError(err), 'non-error thrown: ' + err);

  // catch system error
  var msg = err.stack || err.toString();
  console.error(msg.replace(/^/gm, '  '));
};

/**
* Response middleware.
*/

function respond() {
  if (this.respond === false) return;

  var res = this.res;
  if (res.headersSent || !this.writable) return;

  var body = this.body;
  var code = this.status;

  // ignore body
  if (statuses.empty[code]) {
    // strip headers
    this.body = null;
    return res.end();
  }

  if (this.method === 'HEAD') {
    if (isJSON(body)) this.length = Buffer.byteLength(JSON.stringify(body));
    return res.end();
  }

  // status body
  if (body == null) {
    this.type = 'text';
    body = this.message || String(code);
    if (body) this.length = Buffer.byteLength(body);
    return res.end(body);
  }

  // responses
  if (typeof body === 'string' || Buffer.isBuffer(body)) return res.end(body);
  if (body instanceof Stream) return body.pipe(res);

  // body: json
  body = JSON.stringify(body);
  this.length = Buffer.byteLength(body);
  res.end(body);
  this.emit('end');
}

/**
* Default response error handler.
*
* @param {Error} err
* @api private
*/

function onResError(err) {
  if (err == null) return;

  // nothing we can do here other
  // than delegate to the app-level
  // handler and log.
  if (this.headerSent || !this.writable) throw err;

  // unset all headers
  this.res._headers = {};

  if (!util.isError(err)) {
    this.body = err;
    if (err.status) this.status = err.status;
    return respond.call(this);
  }

  // ENOENT support
  if (err.code === 'ENOENT') err.status = 404;

  // default to 500
  if (typeof err.status !== 'number' || !statuses[err.status]) err.status = 500;

  this.status = err.status;
  // hide server directory for error response
  this.body = err.toString().replace(pwdReg, '[Server Directory]');
  respond.call(this);
  throw err;
}

/**
* Initialize a new context.
*
* @api private
*/

function createContext(app, req, res) {
  var context = new Context(Object.create(app.config));
  var request = context.request = Object.create(app.request);
  var response = context.response = Object.create(app.response);
  var preEndHandlers = [];

  context.req = request.req = response.req = req;
  context.res = request.res = response.res = res;
  request.ctx = response.ctx = context;
  request.response = response;
  response.request = request;
  context.originalUrl = request.originalUrl = req.url;
  context.cookies = new Cookies(req, res, app.keys);
  context.accept = request.accept = accepts(req);
  context.state = {};

  Object.defineProperty(context, 'onPreEnd', {
    get: function () {
      return preEndHandlers.slice();
    },
    set: function(handler) {
      preEndHandlers.push(handler);
    },
    enumerable: true,
    configurable: false
  });
  return context;
}

function noOp() {}

function isFunction(fn) {
  return typeof fn === 'function';
}
