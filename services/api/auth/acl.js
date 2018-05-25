const fs = require('fs')
const includes = require('lodash/includes')
const forEach = require('lodash/forEach')
const slice = require('lodash/slice')
const split = require('lodash/split')
const startsWith = require('lodash/startsWith')
const replace = require('lodash/replace')

const config = require('../config')
const { createError } = require('../utils')

const ACL_DEF_PATH = './auth/acl.json'

const { base_url: baseUrl } = config.services.api
const aclPolicies = mapDefinitionsToPolicies()

function mapDefinitionsToPolicies() {
    const definitions = JSON.parse(fs.readFileSync(ACL_DEF_PATH, 'utf8'))
    const policies = new Map()

    forEach(definitions, (definition) => {
        forEach(definition.permissions, (permission) => {
            if (permission.action !== 'allow' && permission.action !== 'deny') {
                throw new Error('TypeError: ACL action should be either "deny" or "allow"')
            }
        })
        policies.set(definition.group, definition.permissions)
    })

    return policies
}

function stripQueryStrings (url) {
    return split(url, /[?#]/)[0]
}

function getPrefix(resource) {
    return slice(resource, 0, resource.length - 2)
}

function urlToArray(url) {
    return split(replace(url, /^\/+|\/+$/gm, ''), '/')
}

function createRegexFromResource(resource) {
    if (startsWith(resource, ':') || resource === '*') {
        return '.*'
    }

    return `^${resource}$`
}

function matchUrlToResource(route, resource) {
    if (resource === '*') {
        return true
    }

    // Create an array form both route URL and resource.
    const routeArray = urlToArray(route)
    const resourceArray = urlToArray(resource)

    for (const key in routeArray) {
        if (key >= resourceArray.length) {
            return false
        }

        if (resourceArray[key] === '*') {
            return true
        }

        if (!routeArray[key].match(createRegexFromResource(resourceArray[key]))) {
            return false
        }
    }

    if (resourceArray.length > routeArray.length) {
        return resourceArray[routeArray.length] === '*'
    }

    return true
}

function findPermissionForRoute(route, method, prefix = '', policy) {
    // Strip query strings from route
    route = stripQueryStrings(route)

    for (const permission of policy) {
        let resource = permission.resource

        // check if route prefix has been specified
        if (prefix) {
            resource = replace(`${prefix}/${resource}`, /\/+/g, '/')
        }

        if (permission.subRoutes && permission.resource !== '*') {
            const currentPrefix = resource.endsWith('/*')
                ? getPrefix(resource)
                : resource

            const currentPermission = findPermissionForRoute(
                route,
                method,
                currentPrefix,
                permission.subRoutes
            )

            if (currentPermission) {
                return currentPermission
            }
        }

        if (matchUrlToResource(route, resource)) {
            return permission
        }
    }
}

function isAllowed(method, permission) {
    const isGlobOrHasMethod =
        permission.methods === '*' || includes(permission.methods, method)

    if (isGlobOrHasMethod) {
        return permission.action === 'allow'
    } else {
        return permission.action !== 'allow'
    }
}

function authorize(req, res, next) {
    const { role } = req.user
    const policy = aclPolicies.get(role)

    if (!policy) {
        return next(createError(500, `REQUIRED: Policy for role ${role} is not defined`))
    }

    const permission = findPermissionForRoute(
        req.originalUrl,
        req.method,
        baseUrl,
        policy,
    )

    if (!permission) {
        return next(createError(403, 'Unauthorized access'))
    }

    if (isAllowed(req.method, permission)) {
        return next()
    }

    return next(createError(403, 'Unauthorized access'))
}

module.exports = {
    authorize,
}
