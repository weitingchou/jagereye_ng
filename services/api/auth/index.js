const forEach = require('lodash/forEach')
const slice = require('lodash/slice')

const { authenticate } = require('./passport')
const { authorize } = require('./acl')
const config = require('../config')

function routesWithAuth(router, ...routes) {
    forEach(routes, route => {
        const method = route[0]
        const url = route[1]
        const middlewares = slice(route, 2, route.length)

        if (config.services.api.token.enabled) {
            router[method](url, authenticate, authorize, ...middlewares)
        } else {
            router[method](url, ...middlewares)
        }
    })
}

module.exports = {
    routesWithAuth,
}
