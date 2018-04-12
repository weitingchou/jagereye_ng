const express = require('express')
const router = express.Router()
//const { body, validationResult } = require('express-validator/check')
const { createError } = require('./utils')

const mongoose = require('mongoose')
const Schema = mongoose.Schema
const conn = mongoose.createConnection('mongodb://localhost:27017/jager_test')

const eventSchema = Schema({
    timestamp: Number,
    analyzerId: String,
    content: Object,
    date: Date,
    type: String
}, { collection: 'events' })
const eventModel = conn.model('events', eventSchema)


function searchEvents(req, res, next) {
    let query = {}
    let body = req.body

    // TODO(Ray): there will be a validator being reponsible for it
    if (!body['timestamp']['start'] || !body['timestamp']['end']) {
        return next(createError(400, 'Should specify a time range for querying.'))
    }
    if ((typeof body['timestamp']['start'] !== 'number') ||
        (typeof body['timestamp']['end'] !== 'number')) {
        return next(createError(400, "Invalid timestamp format, should be number"))
    }
    query['timestamp'] = {$gte: body['timestamp']['start'], $lt: body['timestamp']['end']}

    if (body['analyzers']) {
        // TODO(Ray): there will be a validator being reponsible for it
        if (!Array.isArray(body['analyzers'])) {
            return next(createError(400, 'analyzers should be a list'))
        }
        query['analyzerId'] = {'$in': body['analyzers']}
    }

    if (body['types']) {
        // TODO(Ray): there will be a validator being reponsible for it
        if (!Array.isArray(body['types'])) {
            return next(createError(400, 'type should be a list'))
        }
        query['type'] = {'$in': body['types']}
    }

    eventModel.find(query, (err, list) => {
        if (err){ return next(createError(500, null)) }
        res.send(list)
    })
}


/*
 * Routing Table
 */
router.post('/events', searchEvents)

module.exports = router
