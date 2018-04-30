const express = require('express')
const jwt = require('jsonwebtoken')
const passport = require('passport')
const passportJWT = require("passport-jwt")

const models = require('../database')
const { createError } = require('../utils')
const config = require('../config')

const router = express.Router()

/*
 * Projections
 */
const getUserProjection = {
    _id: 1,
    role: 1,
}

const jwtOptions = {
    jwtFromRequest: passportJWT.ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: config.services.api.token.secret,
}

passport.use(new passportJWT.Strategy(jwtOptions, (payload, done) => {
    return models.users.findById(payload._id, getUserProjection, (err, user) => {
        if (err) {
            return done(createError(500, null, err), false)
        }

        if (!user) {
            return done(createError(401, 'Unauthenticated'), false)
        }

        return done(null, user.toObject())
    })
}))

const authenticate = passport.authenticate('jwt', { session: false })

module.exports = {
    authenticate,
    jwt,
    jwtOptions,
}
