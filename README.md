## :dash: :dash: **The Binder Project is moving to a [new repo](https://github.com/jupyterhub/binderhub).** :dash: :dash:

:books: Same functionality. Better performance for you. :books:

Over the past few months, we've been improving Binder's architecture and infrastructure. We're retiring this repo as it will no longer be actively developed. Future development will occur under the [JupyterHub](https://github.com/jupyterhub/) organization.

* All development of the Binder technology will occur in the [binderhub repo](https://github.com/jupyterhub/binderhub)
* Documentation for *users* will occur in the [jupyterhub binder repo](https://github.com/jupyterhub/binder) 
* All conversations and chat for users will occur in the [jupyterhub binder gitter channel](https://gitter.im/jupyterhub/binder)

Thanks for updating your bookmarked links.

## :dash: :dash: **The Binder Project is moving to a [new repo](https://github.com/jupyterhub/binderhub).** :dash: :dash:

---

# binder-module
Base class for a PM2-managed, Express-based Binder module

An instance of `BinderModule` implements a subset of the API defined in
[`binder-protocol`](https:/github.com/binder-project/binder-protocol), with HTTP handlers defined
for each implemented endpoint.

A `BinderModule` is initialized with a list of components it will implement (currently chosen from
`build`, `registry`, and `deploy`). Once the desired API subset has been declared, the
`_makeBinderAPI` method is responsible for binding instance methods (HTTP handlers) to their appropriate API
endpoints.

`_makeOtherRoutes` lets you define other HTTP handlers external to the Binder API that will also be
registered on the Express app at launch time.

### install

`binder-module` is designed to make the lifecycles of independent Binder servers simpler to manage,
but it has limited use outside of that context.

If you're modifying or extending the Binder API, and you'd like to make another module, from within
that module's directory:
```
npm install binder-module --save
```
Then extend your existing module with
```
inherits(YourBinderModule, BinderModule)
```

### usage

The correct behavior for every Binder API endpoint is described in [the Binder protocol
file](https://github.com/binder-project/binder-protocol/blob/master/index.js). Handlers are
registered in `_makeBinderAPI` as a list of mappings from handler name to instance method:
```
BinderBuild.prototype._makeBinderAPI = function () {
  return {
    statusAll: this._getAllBuilds.bind(this),
    status: this._getBuild.bind(this),
    start: this._startBuild.bind(this),
    fetch: this._fetchTemplate.bind(this),
    fetchAll: this._fetchAllTemplates.bind(this)
  }
}
```

Each handler is passed a reference to an API object, when provides success/error handlers matching
the success/error conditions defined in the protocol file:

```
BinderBuild.prototype._getBuild = function (api) {
  var self = this
  if (!this.buildInfo) {
    return api._noBuildInfo()
  }
  console.log('api.params: {0}'.format(JSON.stringify(api.params)))
  this.buildInfo.findOne({ name: api.params['image-name'] }, function (err, info) {
    if (err) {
      return api._badQuery({ error: err })
    }
    if (!info || (info === {})) {
      return api._noBuildInfo()
    }
    return api._success({
      'name': info.name,
      'start-time': info.startTime,
      'status': info.status,
      'phase': info.phase,
      'repository': info.repo,
      'error': info.error
    })
  })
}
```

In this example from `binder-build`, the input/output properties of the `noBuildInfo` and `badQuery`
error conditions are defined in the protocol file, as is the return value for the `success`
condition. Additionally, the value of `api.params` is type-checked prior to the `_getBuild` method
being invoked, and error handling for bad parameters are all handled in a single place.

### examples

Currently, the
[`binder-build`](https://github.com/binder-project/binder-build/blob/master/lib/server.js) and
[`binder-deploy-kubernetes`](https://github.com/binder-project/binder-deploy-kubernetes/blob/master/lib/server.js)
modules implement instances of `BinderModule` in their `lib/server.js`  files.


