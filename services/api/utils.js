const { validationResult } = require('express-validator/check')
const httpError = require('http-errors')

function createError(status, message, origErrObj) {
    const error = new Error()

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

function validate(req, res, next) {
    const errors = validationResult(req)

    if (!errors.isEmpty()) {
        return next(createError(400, errors.array()[0]['msg']))
    }

    next()
}

function isValidId(id) {
    return id.match(/^[0-9a-fA-F]{24}$/)
}

module.exports = {
    createError,
    validate,
    isValidId,
}
