var assert = require('assert')
var settings = require('../lib/settings.js')

describe(settings.name, function () {
  // TODO mocha tests go here
  it('should load the settings file', function () {
    assert(settings.name)
  })
})
