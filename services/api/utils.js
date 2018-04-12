const httpError = require('http-errors')


function createError(status, message, origErrObj) {
    let error = new Error()
    error.status = status
    if (message) {
        error.message = message
    } else {
        error.message = httpError(status).message
    }

    if (origErrObj) {
        if (origErrObj.kind === 'ObjectId') {
            error.status = 400
            error.message = 'Invalid ObjectId format'
        }
        error.stack = origErrObj.stack
    }

    return error
}

module.exports = { createError }
