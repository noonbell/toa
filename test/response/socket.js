'use strict'
// **Github:** https://github.com/toajs/toa
//
// modified from https://github.com/koajs/koa/tree/master/test
//
// **License:** MIT
/*global describe, it */

var assert = require('assert')
var response = require('../context').response
var Stream = require('stream')

describe('res.socket', function () {
  it('should return the request socket object', function () {
    var res = response()
    assert.strictEqual(res.socket instanceof Stream, true)
  })
})
