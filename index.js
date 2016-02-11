var EventEmitter = require('events')
var http = require('http')

var _ = require('lodash')
var inherits = require('inherits')
var hat = require('hat')
var express = require('express')
var bodyParser = require('body-parser')
var format = require('string-format')
format.extend(String.prototype)

var binderProtocol = require('binder-protocol')
var getLogger = require('binder-logging').getLogger

var processOptions = function (name, options) {
  if (!options) {
    return {}
  }
  if (name in options) {
    var limited = options[name]
    limited.logging = options.logging
    limited.db = options.db
    limited.name = name
    _.forEach(_.keys(options), function (key) {
      if (!(typeof options[key] === 'object') && key !== name) {
        limited[key] = options[key]
      }
    })
    return limited
  }
  return options
}

/**
 * An HTTP server that implements API of a Binder component
 * @constructor
 */
var BinderModule = function (name, settings, options) {
  this.name = name
  this.opts = _.merge(settings, processOptions(this.name, options))
  this.apiKey = this.opts.apiKey || hat()
  this.port = this.opts.port

  this.logger = getLogger(this.name)
  if (name) {
    this.protocol = binderProtocol[name]
  }
}
inherits(BinderModule, EventEmitter)

/**
 * Declare all Binder API handlers
 *
 * Abstract method
 */
BinderModule.prototype._makeBinderAPI = function (app, authHandler) {}

/**
 * Attach any other routes (that are not part of the Binder API) to the app, optionally
 * authenticated
 *
 * Abstract method
 */
BinderModule.prototype._makeOtherRoutes = function (app, authHandler) {}

BinderModule.prototype._createServer = function () {
  var self = this

  var app = express()
  app.use(bodyParser.json())

  var authHandler = function (req, res, next) {
    var credentials = req.headers['authorization']
    if (credentials && credentials === self.apiKey) {
      next()
    } else {
      res.status(403).end()
    }
  }
  if (this.protocol) {
    this.logger.info('creating Binder API endpoints for the {0} API'.format(this.name))
    var apiHandlers = this._makeBinderAPI()
    _.forEach(apiHandlers, function (handler, name) {
      var endpoint = self.protocol[name]
      if (!endpoint) {
        self.logger.error('handler trying to handle nonexistent endpoint: {0}'.format(name))
        return
      }
      var basePath = endpoint.path
      var params = _.map(endpoint.request.queryParams, function (param) {
        return _.camelCase(param)
      })
      var fullPath = basePath + params.join('/')
      var method = _.lowerCase(endpoint.request.method)
      app[method](fullPath, function (req, res, next) {
        var api = {}
        var params = (method === 'get') ? req.params : req.body
        // ensure that all required parameters are contained in the request
        _.forEach(endpoint.params, function (type, name) {
          if (!(name in params)) {
            if (typeof type === 'object' && type.required === true) {
              res.sendStatus(422)
            }
          }
        })
        // if the request made it to this point, it is a valid request
        api.params = params
        // attach error and success functions to the api object
        _.forEach(endpoint.response.error, function (info, name) {
          api['_' + name] = function (obj) {
            var msg = obj ? info.msg.format(obj) : info.msg
            self.logger.error(msg)
            res.status(info.status).send({
              // do not send implementation details in the error to the client
              error: info.msg
            }).end()
          }
        })
        api._success = function (obj) {
          self.logger.info(endpoint.success.msg)
          if (!obj) {
            res.sendStatus(endpoint.success.status)
          } else {
            res.status(endpoint.success.status).json(obj)
          }
        }
        handler(api)
      })
    })
  }
  this.logger.info('creating any other endpoints not associated with the Binder API')
  this._makeRoutes(app, authHandler)
  return http.createServer(app)
}

/**
 * Perform any module-specific startup behaviors
 *
 * Abstract method
 *
 * @param {function} cb - callback(error)
 */
BinderModule.prototype._start = function (cb) {}

BinderModule.prototype.start = function () {
  var self = this
  if (!this.server) {
    // Start any module-specific services
    this._start(function (err) {
      if (err) {
        self.logger.error(err)
        process.exit(2)
      }
      self.server = self._createServer()
      self.logger.info('Starting {0} on port {1} ...'.format(self.name, self.port))
      self.emit('start')
      self.server.listen(self.port)
    })
  } else {
    this.logger.error('{} has already been started'.format(this.name))
  }
}

/**
 * Perform any module-specific stopping behaviors
 *
 * Abstract method
 *
 * @param {function} cb - callback(error)
 */
BinderModule.prototype._stop = function (cb) {}

BinderModule.prototype.stop = function () {
  var self = this
  this.logger.info('Stopping {}...'.format(this.name))
  if (this.server) {
    this._stop(function (err) {
      if (err) {
        self.logger.error(err)
      }
      self.server.close()
      self.emit('stop')
    })
  }
}

// export a PM2 application description

module.exports = BinderModule
