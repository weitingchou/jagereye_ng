const express = require('express')
const bodyParser = require('body-parser')
const expressValidator = require('express-validator')
const cors = require('cors')

const config = require('./config')
const { users, createAdminUser } = require('./users')
const analyzers = require('./analyzers')
const status = require('./status')
const events = require('./events')
const helpers = require('./helpers')

const app = express()

app.use(cors({ optionsSuccessStatus: 200 /* some legacy browsers (IE11, various SmartTVs) choke on 204 */ }))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(expressValidator())

// Initialize API
const API_ENTRY = `/${config.services.api.base_url}`
app.use(API_ENTRY, users)
app.use(API_ENTRY, analyzers)
app.use(API_ENTRY, status)
app.use(API_ENTRY, events)
app.use(API_ENTRY, helpers)

// Logging errors
app.use((err, req, res, next) => {
    console.error(err.stack)
    next(err)
})

// Catch-all error handling
app.use((err, req, res, next) => {
    const error = {
        code: err.code,
        message: err.message
    }
    res.status(err.status).send({error: error})
})

// Create admin user if it is not existed
createAdminUser()

module.exports = app
