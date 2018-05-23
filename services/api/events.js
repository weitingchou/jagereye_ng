const express = require('express')
const router = express.Router()
const Ajv = require('ajv');
const forEach = require('lodash/forEach');
const isString = require('lodash/isString');

const { createError } = require('./utils')
const { routesWithAuth } = require('./auth')
const objectStore = require('./objectStore');

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
                start: {type: 'number'},
                end: {type: 'number'}
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
            // TODO: need error handling,
            // when body['events']['gt'] is not object id format
            // it will throw error.
            // All of the below
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

function deleteEvent(req, res, next) {
    let eventId = null;
    try {
        eventId = ObjectId(req.params['id']);
    }
    catch(err) {
        // TODO: logging
        console.error(err);
        return next(createError(404, {msg: 'invalid event id'}))
    }
    eventModel.findById(eventId)
    .then((eventInfo) => {
        if (!eventInfo) {
            return next(createError(404, {msg: 'event not found'}))
        }

        // id event exist, then delete objects of the event
        objKeys = [];
        forEach(eventInfo.content, (value) => {
            // Each type of events has its own content structure. To
            // generalize, we assume object key is stored in string type.
            if (isString(value)) {
                objKeys.push(value);
            }
        });
        return objectStore.deleteObjects(objKeys)
        .then(() => {
            // delete the event
            return eventModel.findByIdAndRemove(eventId);
        })
        .then(() => {
            return res.status(200).send();
        })
    })
    .catch((err) => {
        // TODO: logging
        console.error(err)
        return next(createError(500, null))
    });
}

/*
 * Routing Table
 */
routesWithAuth(
    router,
    ['post', '/events', validateEventQuery, searchEvents],
    ['delete', '/event/:id', deleteEvent],
)

module.exports = router
