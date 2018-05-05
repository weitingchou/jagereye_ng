const express = require('express')
const router = express.Router()
const Ajv = require('ajv');
const { createError } = require('./utils')

const { routesWithAuth } = require('./auth')

const mongoose = require('mongoose')
const ObjectId = mongoose.Types.ObjectId;
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

const ajv = new Ajv();
const eventQuerySchema = {
    type: 'object',
    properties: {
        timestamp: {
            type: 'object',
            properties: {
                start: {type: 'integer'},
                end: {type: 'integer'}
            },
            additionalProperties: false
        },
        events: {
            type: 'object',
            properties: {
                gt: {type: 'string'},
                lt: {type: 'string'},
                gte: {type: 'string'},
                lte: {type: 'string'}
            },
            minProperties: 1,
            additionalProperties: false
        },
        analyzers: {
            type: 'array',
            items: {
                type: 'string'
            },
        },
        types: {
            type: 'array',
            items: {
                type: 'string'
            },
        }
    }
    ,additionalProperties: false
}

const eventQueryValidator = ajv.compile(eventQuerySchema);

function validateEventQuery(req, res, next) {
    if(!eventQueryValidator(req.body)) {
        return next(createError(400, eventQueryValidator.errors));
    }
    next();
}

function searchEvents(req, res, next) {
    let query = {}
    let body = req.body

    if(body['timestamp']) {
        let timestampQuery = {};
        if (body['timestamp']['start']) {
            timestampQuery.$gte = body['timestamp']['start']
        }
        if (body['timestamp']['end']) {
            timestampQuery.$lte = body['timestamp']['end']
        }
        query['timestamp'] = timestampQuery
    }

    if(body['events']) {
        let eventIdQuery = {};
        if (body['events']['gt']) {
            eventIdQuery.$gt = ObjectId(body['events']['gt'])
        }
        if (body['events']['lt']) {
            eventIdQuery.$lt = ObjectId(body['events']['lt'])
        }
        if (body['events']['gte']) {
            eventIdQuery.$lt = ObjectId(body['events']['gte'])
        }

        if (body['events']['lte']) {
            eventIdQuery.$lt = ObjectId(body['events']['lte'])
        }
        query['_id'] = eventIdQuery
    }

    if (body['analyzers']) {
        query['analyzerId'] = {'$in': body['analyzers']}
    }

    if (body['types']) {
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
routesWithAuth(
    router,
    ['post', '/events', validateEventQuery, searchEvents],
)

module.exports = router
