const express = require('express')
const { checkSchema } = require('express-validator/check')

const models = require('./database')
const { createError, validate, isValidId } = require('./utils')
const { jwt, jwtOptions } = require('./auth/passport')
const { routesWithAuth } = require('./auth')
const { ROLES } = require('./constants')
const config = require('./config')

/*
 * Projections
 */
const getUserProjection = {
    '_id': 1,
    'username': 1,
    'role': 1,
    'passwordLastUpdated': 1,
}

const router = express.Router()

const userValidator = checkSchema({
    username: {
        exists: true,
        errorMessage: 'Username is required',
    },
    password: {
        exists: true,
        errorMessage: 'Password is required',
    },
})

const createUserValidator = checkSchema({
    role: {
        matches: {
            errorMessage: `Role should be "${ROLES.WRITER}" or "${ROLES.READER}"`,
            options: new RegExp(`\\b(${ROLES.WRITER}|${ROLES.READER})\\b`),
        },
    }
})

const changePasswordValidator = checkSchema({
    newPassword: {
        exists: true,
        errorMessage: 'New password is required',
    },
})

function isSelfOrAdmin(req, res, next) {
    if (config.services.api.token.enabled) {
        const { id: targetId } = req.params
        const { _id: requesterId, role: requesterRole } = req.user

        if (requesterRole !== ROLES.ADMIN && requesterId.toString() !== targetId) {
            return next(createError(400, 'Request non-self user'))
        }
    }

    next()
}

async function getAllUsers(req, res, next) {
    try {
        const list = await models.users.find({}, getUserProjection)

        return res.send(list)
    } catch (err) {
        return next(createError(500, null, err))
    }
}

async function createUser(req, res, next) {
    const { username, password, role } = req.body

    try {
        const { _id } = await models.users.create({
            username,
            password,
            role,
        })

        return res.status(201).send({ _id })
    } catch (err) {
        if (err.name === 'MongoError') {
            if (err.code === 11000) {
                return next(createError(409, 'Username already exists'))
            }
        }

        return next(createError(500, null, err))
    }
}

async function getUser(req, res, next) {
    const { id } = req.params

    if (!isValidId(id)) {
        return next(createError(400, 'Invalid ID'))
    }

    try {
        const result = await models.users.findById(id, getUserProjection)

        if (!result) {
            return next(createError(404, 'User not existed'))
        }

        res.send(result)
    } catch (err) {
        return next(createError(500, null, err))
    }
}

async function deleteUser(req, res, next) {
    const { id } = req.params

    if (!isValidId(id)) {
        return next(createError(400, 'Invalid ID'))
    }

    try {
        const targetUser = await models.users.findById(id)

        if (!targetUser) {
            return next(createError(404, 'User not existed'))
        }

        if (targetUser.role === ROLES.ADMIN) {
            // Deletion of admin user is not allowed.
            return next(createError(400, 'Deletion of admin user is not allowed'))
        }

        const result = await models.users.findByIdAndRemove(id)

        if (!result) {
            return next(createError(404, 'User not existed'))
        }

        return res.status(204).send()
    } catch (err) {
        return next(createError(500, null, err))
    }
}

async function changePassword(req, res, next) {
    const { id: targetId } = req.params
    const { _id: requesterId } = req.user
    const { oldPassword, newPassword } = req.body

    if (!isValidId(targetId)) {
        return next(createError(400, 'Invalid ID'))
    }

    try {
        const targetUser = await models.users.findById(targetId)

        // If the user changes its own password and it is not the first time
        // to be changed, then the request also needs old password.
        if (requesterId.toString() === targetId && targetUser.passwordLastUpdated) {
            if (oldPassword !== targetUser.password) {
                return next(createError(400, 'Incorrect old password'))
            }
        }

        const updated = {
            password: newPassword,
            passwordLastUpdated: new Date(),
        }
        const options = {
            new: true,
            runValidators: true,
        }
        const result = await models.users.findByIdAndUpdate(targetId, updated, options)

        if (!result) {
            return next(createError(404, 'User not existed'))
        }

        return res.status(204).send()
    } catch (err) {
        return next(createError(500, null, err))
    }
}

async function login(req, res, next) {
    const { username, password } = req.body

    try {
        const result = await models.users.findOne({
            username,
            password,
        })

        if (!result) {
            return next(createError(401, 'Incorrect username or password'))
        }

        const { _id } = result
        const payload = { _id }
        const token = jwt.sign(payload, jwtOptions.secretOrKey)

        return res.status(200).send({ _id, token })
    } catch (err) {
        return next(createError(500, null, err))
    }
}

async function createAdminUser() {
    const {
        username,
        default_password: password,
    } = config.services.api.admin;

    try {
        const user = await models.users.findOne({ username })

        if (!user) {
            const result = await models.users.create({
                username,
                password,
                role: ROLES.ADMIN,
            })

            console.log(`Admin user is added, id: ${result.id}`)
        }
    } catch (err) {
        console.error(err)
    }
}

/*
 * Routing Table
 */
routesWithAuth(
    router,
    ['get', '/users', getAllUsers],
    ['post', '/users', userValidator, createUserValidator, validate, createUser],
)
routesWithAuth(
    router,
    ['get', '/user/:id', isSelfOrAdmin, getUser],
    ['delete', '/user/:id', isSelfOrAdmin, deleteUser],
    ['patch', '/user/:id/password', isSelfOrAdmin, changePasswordValidator, validate, changePassword],
)
router.post('/login', userValidator, validate, login)

module.exports = {
    users: router,
    createAdminUser,
}
