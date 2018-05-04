const acl = require('express-acl')

const config = require('../config')

acl.config({
    baseUrl: config.services.api.base_url,
    decodedObjectName: 'user',
    path: 'auth',
    filename: 'acl.json',
})

module.exports = {
    // FIXME(JiaKuan Su):
    // Currently, the authorize middleware can not be integrated with
    // "createError()", so the authorization error will not be shown in API
    // service. Please fix it in the future.
    authorize: acl.authorize,
}
