const express = require('express');
//const { body, validationResult } = require('express-validator/check')
const httpError = require('http-errors');
const router = express.Router();

const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const conn = mongoose.createConnection('mongodb://localhost:27017/jager_test');

// TODO(Ray): collection name 'events_tripwire' should not be hard code in the future
const baseSchema = Schema({
    appName: String,
    timestamp: Number,
    analyzerId: String,
    content: {type: Schema.Types.ObjectId, ref: 'events_tripwire'},
    date: Date,
    type: String
}, {collection: 'events'});

const subSchema = Schema({
    video_name: String,
    thumbnail_name: String,
    triggered: [String]
},{collection: 'events_tripwire'})

const baseModel = conn.model('events', baseSchema)
const subModel = conn.model('events_tripwire', subSchema)

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

function searchEvents(req, res, next) {
    let query = {};
    let body = req.body;

    // TODO(Ray): there will be a validator being reponsible for it 
    if (!body['timestamp']['start'] || !body['timestamp']['end']) {
        return next(createError(400, null));
    }
    if ((typeof body['timestamp']['start'] !== 'number') || (typeof body['timestamp']['end'] !== 'number')) {
        return next(createError(400, null));
    }
    query['timestamp'] = {$gte: body['timestamp']['start'], $lt: body['timestamp']['end']};

    if (body['analyzers']) {
        // TODO(Ray): there will be a validator being reponsible for it 
        if (!Array.isArray(body['analyzers'])) { return next(createError(400, null)); }
        query['analyzerId'] = {'$in': body['analyzers']}
    }
    
    if (body['types']) {
        // TODO(Ray): there will be a validator being reponsible for it 
        if (!Array.isArray(body['types'])) { return next(createError(400, null)); }
        query['type'] = {'$in': body['types']}
    }

    baseModel.find(query).
    populate('content').
    exec( (err, list) => {
        if (err){
          return next(createError(500, null))
        }
        res.send(list) 
    })
}

/*
 * Routing Table
 */
router.post('/events', searchEvents)

module.exports = router
