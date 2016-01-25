var path = require('path')
var fs = require('fs')

// Binder module settings must be stored in conf/main.json
module.exports = JSON.parse(fs.readFileSync(path.join(__dirname, '../conf/main.json')))
