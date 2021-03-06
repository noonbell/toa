'use strict'
// **Github:** https://github.com/toajs/toa
//
// modified from https://github.com/koajs/koa/tree/master/test
//
// **License:** MIT
/*global describe, it */

var assert = require('assert')
var response = require('../context').response

describe('res.etag=', function () {
  it('should not modify an etag with quotes', function () {
    var res = response()
    res.etag = '"asdf"'
    assert.strictEqual(res.header.etag, '"asdf"')
  })

  it('should not modify a weak etag', function () {
    var res = response()
    res.etag = 'W/"asdf"'
    assert.strictEqual(res.header.etag, 'W/"asdf"')
  })

  it('should add quotes around an etag if necessary', function () {
    var res = response()
    res.etag = 'asdf'
    assert.strictEqual(res.header.etag, '"asdf"')
  })
})

describe('res.etag', function () {
  it('should return etag', function () {
    var res = response()
    res.etag = '"asdf"'
    assert.strictEqual(res.etag, '"asdf"')
  })
})
