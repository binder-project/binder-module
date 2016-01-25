var fs = require('fs')
var path = require('path')
var http = require('http')

var _ = require('lodash')
var hat = require('hat')
var express = require('express')
var bodyParser = require('body-parser')
var format = require('string-format')
format.extend(String.prototype)

var settings = require('./settings.js')

var getLogger = require('binder-logging').getLogger

/**
 * An HTTP server that implements API of a Binder component
 * @constructor
 */
var BinderModule = function (options) {
  options = options || {}
  this.options = options
  this.name = options.name || 'binder-module'

  this.apiKey = options.apiKey || process.env.BINDER_API_KEY || hat()
  this.port = options.port || process.env.BINDER_DEPLOY_PORT || settings.port

  this.backgroundTasks = []
  this.logger = getLogger(settings.name)
}

BinderModule.prototype._createServer = function () {
  var app = express()

  var authHandler = function (req, res, next) {
    var credentials = req.headers['authorization']
    if (credentials && credentials === this.apiKey) {
      next()
    } else {
      res.status(403).end()
    }
  }

  app.use(bodyParser.json())
  this._makeRoutes(authHandler)
  return http.createServer(app)
}

/**
 * Abstract method
 */
BinderModule.prototype._makeBackgroundTasks = function () {
  return []
}

/**
 * Abstract method
 */
BinderModule.prototype._start = function () {

}

BinderModule.prototype.start = function () {
  if (!this.server) {
    // Launch background processes
    var tasks = this._makeBackgroundTasks()
    this.backgroundTasks = tasks
    _.forEach(tasks, function (task) {
      task.start()
    })

    // Start any module-specific services
    this._start()

    this.server = this._createServer()
    this.logger.info('Starting {0} on port {1} ...'.format(this.name, this.port))
    this.server.listen(this.port)
    return this.apiKey
  } else {
    this.logger.error('{} has already been started'.format(this.name))
  }
}

BinderModule.prototype.stop = function () {
  this.logger.info('Stopping {}...'.format(this.name))
  if (this.server) {
    this.server.close()
    _.forEach(this.backgroundTasks, function (task) {
      task.stop()
    })
  }
}

// export a PM2 application description

module.exports = BinderModule
