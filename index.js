var EventEmitter = require('events').EventEmitter
var http = require('http')

var _ = require('lodash')
var inherits = require('inherits')
var hat = require('hat')
var express = require('express')
var bodyParser = require('body-parser')
var path = require('path')
var format = require('string-format')
format.extend(String.prototype)

var binderProtocol = require('binder-protocol')
var getLogger = require('binder-logging').getLogger

/**
 * An HTTP server that implements API of a Binder component
 * @constructor
 */
var BinderModule = function (name, api, options) {
  this.name = name
  this.opts = options
  this.apiKey = this.opts.apiKey || process.env['BINDER_API_KEY'] || hat()
  this.opts.apiKey = this.apiKey
  this.port = this.opts.port
  this.logger = getLogger(this.name)
  if (api) {
    if (_.isArray(api)) {
      this.protocols  = _.map(api, function (a) { return binderProtocol[a] })
    } else {
      this.protocols = [binderProtocol[api]]
    }
  }

  var self = this
  process.on('SIGINT', function () {
    self.stop()
  })
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
  var stream = {
    write: function (message, encoding) {
      self.logger.info(message)
    }
  }
  app.use(require('morgan')({ stream: stream }))

  var authHandler = function (req, res, next) {
    var credentials = req.headers['authorization']
    if (credentials && credentials === self.apiKey) {
      next()
    } else {
      res.sendStatus(403)
    }
  }

  function _makeAPI(api) {

    self.logger.info('creating Binder API endpoints for the {0} API'.format(api))
    var apiHandlers = self._makeBinderAPI()
    _.forEach(apiHandlers, function (handler, name) {
      var endpoint = api[name]
      if (!endpoint) {
        self.logger.error('handler trying to handle nonexistent endpoint: {0}'.format(name))
        return
      }
      var basePath = endpoint.path
      var params = _.mapValues(endpoint.params, function (val, key) {
        var id = ':' + _.camelCase(key)
        if (val.required === false) {
          id += '?'
        }
        return id
      })
      var fullPath = basePath.format(params)
      var method = _.lowerCase(endpoint.request.method)
      var apiFunc = function (req, res, next) {
        var api = {}
        var params = (endpoint.request.body) ? req.body : req.params
        params = _.mapKeys(params, function (val, key) {
          return _.kebabCase(key)
        })
        // ensure that all required parameters are contained in the request
        _.forEach(endpoint.params, function (type, name) {
          if (!(name in params)) {
            if (typeof type === 'object' && (type.required !== false)) {
              var error = binderProtocol.global.response.error.malformedRequest
              var msg = error.msg.format({ name: name })
              self.logger.info(msg)
              res.status(error.status).send(msg)
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
              type: name,
              // do not send implementation details in the error to the client
              error: info.msg
            }).end()
          }
        })
        api._success = function (obj) {
          var bodyParams = endpoint.response.body
          var valid = true
          if (bodyParams) {
            // ensure that all the required response parameters are included
            // TODO check fully-typed schema
            var paramsIsArray = _.isArray(bodyParams)
            var objIsArray = _.isArray(obj)
            // make sure that the types match
            if ((!obj !== !bodyParams) || (paramsIsArray !== objIsArray)) {
              var error = binderProtocol.global.response.error.badResponse
              var str = 'type mismatch between expected and received values'
              var msg = error.msg.format({ name: str })
              self.logger.info(msg)
              res.status(error.status).send(msg)
            } else {
              var missingKeys = {}
              var keysObj = paramsIsArray ? bodyParams[0] : bodyParams
              var checkKeys = function (o) {
                var valid = _.map(keysObj, function (value, key) {
                  if (!(key in o)) {
                    missingKeys[key] = 1
                    return false
                  }
                  return true
                })
                return _.every(valid, Boolean)
              }
              if (paramsIsArray) {
                valid = _.every(_.map(obj, checkKeys))
              } else {
                valid = checkKeys(obj)
              }
            }
          }
          if (!valid) {
            error = binderProtocol.global.response.error.badResponse
            msg = error.msg.format({ name: _.keys(missingKeys) })
            self.logger.info(msg)
            res.status(error.status).send(msg)
          } else {
            var success = endpoint.response.success
            self.logger.info(success.msg.format(obj))
            if (!obj) {
              res.sendStatus(success.status)
            } else {
              res.status(success.status).json(obj)
            }
          }
        }
        handler(api)
      }
      var noop = function (req, res, next) {
        next(null, req, res)
      }
      var maybeAuth = (endpoint.request.authorized) ? authHandler : noop
      app[method](fullPath, maybeAuth, apiFunc)
    })
  }

  if (this.protocols) {
    _.forEach(this.protocols, function (p) {
      _makeAPI(p)
    })
  }

  this.logger.info('creating any other endpoints not associated with the Binder API')
  this._makeOtherRoutes(app, authHandler)
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
      self.logger.info('Starting {0} on port {1}...'.format(self.name, self.port))
      console.log(' - Using API key: {0}'.format(self.apiKey))
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
  this._stop(function (err) {
    if (err) {
      self.logger.error(err)
    }
    if (self.server) self.server.close()
    self.emit('stop')
  })
}

// export a PM2 application description

module.exports = BinderModule
