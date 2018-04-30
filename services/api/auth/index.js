const forEach = require('lodash/forEach')
const slice = require('lodash/slice')

const { authenticate } = require('./passport')
const { authorize } = require('./acl')

function routesWithAuth(router, ...routes) {
    forEach(routes, route => {
        const method = route[0]
        const url = route[1]
        const middlewares = slice(route, 2, route.length)

        router[method](url, authenticate, authorize, ...middlewares)
    })
}

module.exports = {
    routesWithAuth,
}
