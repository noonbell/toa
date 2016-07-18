'use strict'
// **License:** MIT
// wrk -t10 -c1000 -d30s http://127.0.0.1:3000

const toa = require('..')
const app = toa()
const port = 3333

var n = parseInt(process.env.MW || '1', 10)
process.stdout.write('  toa, ' + n + ' middleware:')

while (n--) {
  app.use(function * () {
    yield (done) => setImmediate(done) // fake task
  })
}

var body = new Buffer('Hello World')
app.use(function * () {
  this.body = body
})

app.listen(port)

 // toa, 1 middleware:  5654.46
 // toa, 5 middleware:  5534.19
 // toa, 10 middleware:  5221.89
 // toa, 15 middleware:  5078.84
 // toa, 20 middleware:  4965.41
 // toa, 30 middleware:  4568.19
 // toa, 50 middleware:  4038.22
 // toa, 100 middleware:  3088.40
