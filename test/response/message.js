'use strict'
// **Github:** https://github.com/toajs/toa
//
// modified from https://github.com/koajs/koa/tree/master/test
//
// **License:** MIT
/*global describe, it */

var assert = require('assert')
var response = require('../context').response

describe('res.message', function () {
  it('should return the response status message', function () {
    var res = response()
    res.status = 200
    assert.strictEqual(res.message, 'OK')
  })

  describe('when res.message not present', function () {
    it('should look up in statuses', function () {
      var res = response()
      res.res.statusCode = 200
      assert.strictEqual(res.message, 'OK')
    })
  })
})

describe('res.message=', function () {
  it('should set response status message', function () {
    var res = response()
    res.status = 200
    res.message = 'ok'
    assert.strictEqual(res.res.statusMessage || res.res.text, 'ok')
    assert.strictEqual(res.inspect().message, 'ok')
  })
})
