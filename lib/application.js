'use strict'
// **Github:** https://github.com/toajs/toa
//
// **License:** MIT

const util = require('util')
const http = require('http')
const Stream = require('stream')
const thunks = require('thunks')
const accepts = require('accepts')
const Cookies = require('cookies')
const statuses = require('statuses')
const onFinished = require('on-finished')
const EventEmitter = require('events').EventEmitter

const contextProto = require('./context')
const requestProto = require('./request')
const responseProto = require('./response')
const packageInfo = require('../package.json')

const OnErrorHeaderReg = /^(Accept|Allow|Retry-After|Warning|Access-Control-Allow-)/i
const pwdReg = new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')

module.exports = Toa

Toa.NAME = packageInfo.name
Toa.VERSION = packageInfo.version
Toa.AUTHORS = packageInfo.authors

function Toa (server, mainHandle, options) {
  if (!(this instanceof Toa)) return new Toa(server, mainHandle, options)
  const app = this

  this.middleware = []
  this.request = Object.create(requestProto)
  this.response = Object.create(responseProto)
  this.context = Object.create(contextProto, {
    onerror: {
      enumerable: true,
      value: function (err) {
        if (err == null) return
        // if error trigger by context, try to respond
        if (app.context.isPrototypeOf(this)) err = onResError.call(this, err)
        if (err != null) app.onerror(err)
      }
    },
    onPreEnd: {
      enumerable: true,
      get: function () {
        return this._preEndHandlers
      },
      set: function (handle) {
        assertFunction(handle)
        this._preEndHandlers.push(handle)
      }
    }
  })

  this.server = server && isFunction(server.listen) ? server : null
  if (this.server !== server) {
    options = mainHandle
    mainHandle = server
  }

  if (!isFunction(mainHandle)) {
    options = mainHandle
    mainHandle = null
  }

  options = options || {}
  this.mainHandle = mainHandle

  if (isFunction(options)) {
    this.debug = null
    this.errorHandle = options
  } else {
    this.debug = isFunction(options.debug) ? options.debug : null
    this.errorHandle = isFunction(options.onerror) ? options.onerror : null
  }

  const config = {
    proxy: false,
    poweredBy: 'Toa',
    subdomainOffset: 2,
    env: process.env.NODE_ENV || 'development'
  }

  Object.defineProperty(this, 'config', {
    enumerable: true,
    get: () => config,
    set: (obj) => {
      for (let key of Object.keys(obj)) {
        config[key] = obj[key]
      }
    }
  })
}

/**
 * A [Keygrip](https://github.com/expressjs/keygrip) object or an array of keys,
 * will be passed to Cookies to enable cryptographic signing.
 */
Toa.prototype.keys = null

/**
 * Use the given middleware `fn`.
 *
 * @param {Function} fn
 * @return {this}
 * @api public
 */
Toa.prototype.use = function (fn) {
  assertFunction(fn)
  this.middleware.push(fn)
  return this
}

/**
 * start server
 *
 * @param {Mixed} ...
 * @return {this}
 * @api public
 */
Toa.prototype.listen = function () {
  this.server = this.server || http.createServer()
  return this.server
    .on('request', this.toListener())
    .listen.apply(this.server, arguments)
}

/**
 * Return a request listener
 * for node's native http server.
 *
 * @return {Function}
 * @api public
 */
Toa.prototype.toListener = function () {
  let app = this
  let debug = this.debug
  let mainHandle = this.mainHandle
  let errorHandle = this.errorHandle || noOp
  let middleware = this.middleware.slice()
  if (mainHandle) {
    middleware.push(function (done) {
      this.thunk(mainHandle.call(this))(done)
    })
  }

  return function requestListener (req, res) {
    let ctx = createContext(app, req, res)
    ctx.thunk = thunks(new Scope(ctx, errorHandle, debug))

    ctx.on('error', ctx.onerror)
    onFinished(res, (err) => {
      ctx._finished = true
      let body = ctx.body
      if (body && body.toaCleanHandle) body.toaCleanHandle(err)
      else if (err != null) ctx.onerror(err)
      ctx.emit('finished', err)
    })

    res.statusCode = 404
    ctx.thunk.seq.call(ctx, middleware)(function () {
      return this.thunk.seq.call(this, this.onPreEnd)
    })(respond)
  }
}

/**
 * Default system error handler.
 *
 * @param {Error} err
 * @api private
 */
Toa.prototype.onerror = function (err) {
  // ignore null and response error
  if (err.expose || (err.status && err.status < 500)) return
  if (!util.isError(err)) err = new Error('non-error thrown: ' + err)

  // catch system error
  let msg = err.stack || err.toString()
  console.error(msg.replace(/^/gm, '  '))
}

/**
 * Scope of context.thunk.
 *
 * @api private
 */
class Scope extends thunks.Scope {
  constructor (ctx, errorHandle, debug) {
    super()
    this.ctx = ctx
    this.errorHandle = errorHandle
    this.debug = debug
  }
  onstop (sig) {
    let ctx = this.ctx
    if (ctx.status === 404) {
      ctx.status = 418
      ctx.message = sig.message
    }
    ctx.thunk.seq.call(ctx, ctx.onPreEnd)(respond)
  }
  onerror (err) {
    if (err == null) return
    try {
      err = this.errorHandle.call(this.ctx, err) || err
    } catch (error) {
      err = error
    }
    // if err === true, ignore err and response to client
    if (err === true) respond.call(this.ctx)
    else this.ctx.onerror(err)
  }
}

/**
 * Response middleware.
 */
function respond () {
  let res = this.res
  if (this.respond === false) return endRespond(this)
  if (res.headersSent || !this.writable) return

  let body = this.body
  let code = this.status

  if (this.config.poweredBy) this.set('X-Powered-By', this.config.poweredBy)
  // ignore body
  if (statuses.empty[code]) {
    // strip headers
    this.body = null
    res.end()
  } else if (this.method === 'HEAD') {
    if (isJSON(body)) this.length = Buffer.byteLength(JSON.stringify(body))
    res.end()
  } else if (body == null) {
    // status body
    this.type = 'text'
    body = this.message || String(code)
    this.length = Buffer.byteLength(body)
    res.end(body)
  } else if (typeof body === 'string' || Buffer.isBuffer(body)) {
    res.end(body)
  } else if (body instanceof Stream) {
    body.pipe(res)
  } else {
    // body: json
    body = JSON.stringify(body)
    this.length = Buffer.byteLength(body)
    res.end(body)
  }
  endRespond(this)
}

/**
 * Default response error handler.
 *
 * @param {Error} err
 * @api private
 */
function onResError (err) {
  // nothing we can do here other
  // than delegate to the app-level
  // handler and log.
  if (this.headerSent || !this.writable) {
    err.headerSent = true
    err.context = this
    return err
  }

  if (!util.isError(err)) {
    this.body = err
    if (err.status) this.status = err.status
    respond.call(this)
    return
  }

  // unset headers
  let _headers = this.res._headers
  if (_headers) {
    // retain headers on error
    for (let key of Object.keys(_headers)) {
      if (!OnErrorHeaderReg.test(key)) delete _headers[key]
    }
  }
  // force text/plain
  this.type = 'text'

  // support ENOENT to 404, default to 500
  if (err.code === 'ENOENT') this.status = 404
  else if (typeof err.status !== 'number' || !statuses[err.status]) this.status = 500
  else this.status = err.status

  let msg = err.expose ? err.message : statuses[this.status]

  // hide server directory for error response
  this.body = msg.replace(pwdReg, '[application]')
  respond.call(this)
  return err
}

/**
 * Initialize a new context.
 *
 * @api private
 */
function createContext (app, req, res) {
  let context = Object.create(app.context)
  let request = context.request = Object.create(app.request)
  let response = context.response = Object.create(app.response)

  EventEmitter.call(context)
  response.request = request
  request.response = response
  request.ctx = response.ctx = context
  context.req = request.req = response.req = req
  context.res = request.res = response.res = res
  context.originalUrl = request.originalUrl = req.url
  context.cookies = new Cookies(req, res, {keys: app.keys})
  context.accept = request.accept = accepts(req)
  context.config = Object.create(app.config)
  context.respond = null
  context.thunk = null
  context.state = {}
  context._ended = false
  context._finished = false
  // "setImmediate job" will improve concurrency performance
  context._preEndHandlers = [(done) => setImmediate(done)]

  return context
}

function noOp () {}

function isFunction (fn) {
  return typeof fn === 'function'
}

function assertFunction (fn) {
  if (!isFunction(fn)) throw new Error('require a thunk function or a generator function')
}

function endRespond (ctx) {
  if (ctx._ended) return
  ctx._ended = true
  ctx.emit('end')
}

function isJSON (body) {
  return body && typeof body !== 'string' && !Buffer.isBuffer(body) &&
    !(body instanceof Stream)
}

if (process.env.NODE_ENV === 'test') {
  Toa.createContext = function () {
    return createContext.apply(null, arguments)
  }
}
