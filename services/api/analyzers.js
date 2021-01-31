const express = require('express')
const { body, validationResult } = require('express-validator/check')
const models = require('./database')
const { createError } = require('./utils')
const { routesWithAuth } = require('./auth')
const NATS = require('nats')
const fs = require('fs')
const forEach = require('lodash/forEach');
const isString = require('lodash/isString');
const map = require('lodash/map');
const router = express.Router()

const objectStore = require('./objectStore');
const msg = JSON.parse(fs.readFileSync('../../shared/messaging.json', 'utf8'))
const MAX_ANALYZERS = 8
const NUM_OF_BRAINS = 1
const DEFAULT_REQUEST_TIMEOUT = 15000

//  setup for prometheus
const prometheusClient = require('prom-client')
const register = prometheusClient.register
const Gauge = prometheusClient.Gauge
const g = new Gauge({
    name: 'analyzer_status',
    help: 'Analyzer status',
    labelNames: ['analyzer']
});

// status mapping
const analyzerStatus = ['created','starting','running','source_down','stopped']

/*
 * Projections
 */
const getConfProjection = {
    '_id': 1,
    'name': 1,
    'source': 1,
    'pipelines': 1
}
const getConfSourceProjection = {
    '_id': 0,
    'name': 0,
    'source': 1,
    'pipelines': 0
}
const getConfPipelineProjection = {
    '_id': 0,
    'name': 0,
    'source': 0,
    'pipelines': 1
}

function postReqValidator(req, res, next) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
        return next(createError(400, null))
    }

    // TODO: Should find a way to enforce maximum enabled analyzers
    //       at MongoDB writing
    models['analyzers'].count({}, (err, count) => {
        if (err) { return next(createError(500, null, err)) }
        if (count >= MAX_ANALYZERS) {
            return next(createError(400, 'Exceeded maximum number of analyzers allow to be enabled'))
        }
        next()
    })
}

function requestBackend(request, timeout, callback) {
    let reqTimeout = timeout
    let cb = callback
    let ignore = false
    let count = 0

    if (typeof reqTimeout === 'function') {
        reqTimeout = DEFAULT_REQUEST_TIMEOUT
        cb = timeout
    }

    // Set a timeout for aggregating the replies
    const timer = setTimeout(() => {
        ignore = true
        cb({ code: NATS.REQ_TIMEOUT })
    }, reqTimeout)

    function closeResponse() {
        ignore = true
        clearTimeout(timer)
    }

    nats.request('api.analyzer', request, {'max': NUM_OF_BRAINS}, (reply) => {
        if (!ignore) {
            count += 1
            let isLastReply = count === NUM_OF_BRAINS
            if (isLastReply) {
                // All replies are received, cancel the timeout
                clearTimeout(timer)
            }
            try {
                const replyJSON = JSON.parse(reply)
                if (replyJSON['code'] &&
                    replyJSON['code'] === msg['ch_api_brain_reply']['NOT_AVAILABLE']) {
                    const errReply = {
                        error: {
                            code: msg['ch_api_brain_reply']['NOT_AVAILABLE'],
                            message: 'Runtime instance is not available to accept request right now'
                        }
                    }
                    return cb(errReply, isLastReply, closeResponse)
                }
                cb(replyJSON, isLastReply, closeResponse)
            } catch (e) {
                const errReply = { error: { message: e } }
                cb(errReply, isLastReply, closeResponse)
            }
        }
    })
}

function getAnalyzers(req, res, next) {
    models['analyzers'].find({}, getConfProjection, (err, list) => {
        if (err) { return next(createError(500, null, err)) }
        if (list.length === 0) { return res.status(200).send([]) }
        const request = JSON.stringify({
            command: 'READ',
            params: list.map(x => x['_id'])
        })
        requestBackend(request, (reply, isLastReply, closeResponse) => {
            if (reply['code'] && reply['code'] === NATS.REQ_TIMEOUT) {
                let error = new Error('Timeout Error: Request: getting analyzers')
                return next(createError(500, null, error))
            }
            if (reply['error']) {
                closeResponse()
                return next(createError(500, reply['error']['message']))
            }
            // TODO: rollback saved record if any error occurred
            closeResponse()
            result = list.map(x => {
                data = x.toJSON()
                data.status = reply['result'][x['_id']]
                return data
            })
            return res.status(200).send(result)
        })
    })
}

function createAnalyzer(req, res, next) {
    /* Validate request */
    req.checkBody('name', 'name is required').notEmpty()
    req.checkBody('source', 'source is required').notEmpty()
    req.checkBody('pipelines', 'pipeline is required').notEmpty()
    const errors = req.validationErrors()
    if (errors) {
        return next(createError(400, errors[0]['msg']))
    }

    name = req.body['name']
    source = req.body['source']
    pipelines = req.body['pipelines']
    let config = { name, source, pipelines }
    const analyzer = new models['analyzers'](config)
    analyzer.save((err, saved) => {
        if (err) {
            if (err.name === 'ValidationError') {
                return next(createError(400, null, err))
            }
            if (err.name === 'MongoError' && err.code === 11000) {
                let dupKey = err.errmsg.slice(err.errmsg.lastIndexOf('dup key:') + 14, -3)
                return next(createError(400, `Duplicate key error: ${dupKey}`, err))
            }
            return next(createError(500, null, err))
        }
        const request = JSON.stringify({
            command: 'CREATE',
            params: { id: saved.id, name, source, pipelines }
        })
        requestBackend(request, (reply, isLastReply, closeResponse) => {
            if (reply['code'] && reply['code'] === NATS.REQ_TIMEOUT) {
                let error = new Error(`Timeout Error: Request: creating analyzer "${saved.id}"`)
                return next(createError(500, null, error))
            }
            if (reply['error']) {
                closeResponse()
                return next(createError(500, reply['error']['message']))
            }
            // TODO: rollback saved record if any error occurred
            closeResponse()
            return res.status(201).send({_id: saved.id})
        })
    })
}

function deleteAnalyzers(req, res, next) {
    models['analyzers'].find({}, (err, list) => {
        if (err) { return next(createError(500, null, err)) }
        if (list.length === 0) { return res.status(204).send() }
        list = list.map(x => x['_id'])
        const request = JSON.stringify({
            command: 'DELETE',
            params: list
        })
        requestBackend(request, (reply, isLastReply, closeResponse) => {
            if (reply['code'] && reply['code'] === NATS.REQ_TIMEOUT) {
                let error = new Error('Timeout Error: Request: deleting analyzers')
                return next(createError(500, null, error))
            }
            if (reply['error']) {
                closeResponse()
                return next(createError(500, reply['error']['message']))
            }
            closeResponse()
            models['analyzers'].remove({_id: {$in: list}}, (err) => {
                if (err) { return next(createError(500, null, err)) }
                res.status(204).send()
            })
        })
    })
}

function getSettings(req, res, next) {
    models['analyzers'].count({}, (err, count) => {
        if (err) { return next(createError(500, null, err)) }
        result = {
            maxAnalyzerCount: MAX_ANALYZERS,
            currentAnalyzerCount: count
        }
        res.status(200).send(result)
    })
}

function getAnalyzer(req, res, next) {
    const id = req.params['id']
    models['analyzers'].findById(id, getConfProjection, (err, result) => {
        if (err) { return next(createError(500, null, err)) }
        if (result === null) { return next(createError(404)) }
        let data = result.toJSON()
        const request = JSON.stringify({
            command: 'READ',
            params: id
        })
        requestBackend(request, (reply, isLastReply, closeResponse) => {
            if (reply['code'] && reply['code'] === NATS.REQ_TIMEOUT) {
                let error = new Error(`Timeout Error: Request: getting analyzer "${id}"`)
                return next(createError(500, null, error))
            }
            if (reply['error']) {
                closeResponse()
                return next(createError(500, reply['error']['message']))
            }
            // TODO: rollback saved record if any error occurred
            closeResponse()
            data.status = reply['result']
            return res.status(200).send(data)
        })
    })
}

function deleteAnalyzer(req, res, next) {
    const id = req.params['id']
    models['analyzers'].findById(id, (err, result) => {
        if (err) {
            return next(createError(500, null, err))
        }
        if (result === null) {
            return next(createError(404))
        }
        const request = JSON.stringify({
            command: 'DELETE',
            params: id
        })
        requestBackend(request, (reply, isLastReply, closeResponse) => {
            if (reply['code'] && reply['code'] === NATS.REQ_TIMEOUT) {
                let error = new Error(`Timeout Error: Request: deleting analyzer "${id}"`)
                return next(createError(500, null, error))
            }
            if (reply['error']) {
                closeResponse()
                return next(createError(500, reply['error']['message']))
            }
            closeResponse()

            // get all corresponding events
            models['events'].find({analyzerId: id})
            .then((events) => {
                // collect & delete all objects key of all events id
                objKeys = []
                forEach(events, (event) => {
                    forEach(event.content, (value) => {
                        // Each type of events has its own content structure. To
                        // generalize, we assume object key is stored in string type.
                        if (isString(value)) {
                            objKeys.push(value);
                        }
                    });
                });
                // Delete all objects by keys.
                return objectStore.deleteObjects(objKeys).then(() => {return events});
            })
            .then((events) => {
                // delete all corresponding events
                const eventIds = map(events, event => event._id);
                return models['events'].deleteMany({
                    _id: {
                        $in: eventIds,
                    },
                });
            })
            .then(() => {
                // delete analyzer
                return models['analyzers'].findByIdAndRemove(id);
            })
            .then(() => {
                return res.status(204).send();
            })
            .catch((err) => {
                return next(createError(500, null, err))
            });

        })
    })
}

function updateAnalyzer(req, res, next) {
    const id = req.params['id']
    const update = {}
    if (req.body.hasOwnProperty('name')) {
        update['name'] = req.body['name']
    }
    if (req.body.hasOwnProperty('source')) {
        update['source'] = req.body['source']
    }
    if (req.body.hasOwnProperty('pipelines')) {
        update['pipelines'] = req.body['pipelines']
    }
    const options = {
        new: true,
        runValidators: true
    }
    models['analyzers'].findByIdAndUpdate(id, update, options, (err, result) => {
        if (err) {
            if (err.name === 'ValidationError') {
                return next(createError(400, null, err))
            }
            if (err.name === 'MongoError' && err.code === 11000) {
                let dupKey = err.errmsg.slice(err.errmsg.lastIndexOf('dup key:') + 14, -3)
                return next(createError(400, `Duplicate key error: ${dupKey}`, err))
            }
            return next(createError(500, null, err))
        }
        if (result === null) {
            return next(createError(404))
        }
        const request = JSON.stringify({
            command: 'UPDATE',
            params: { id, params: update }
        })
        requestBackend(request, (reply, isLastReply, closeResponse) => {
            if (reply['code'] && reply['code'] === NATS.REQ_TIMEOUT) {
                let error = new Error(`Timeout Error: Request: updating analyzer "${id}"`)
                return next(createError(500, null, error))
            }
            if (reply['error']) {
                closeResponse()
                return next(createError(500, reply['error']['message']))
            }
            closeResponse()
            return res.status(204).send()
        })
    })
}

function startAnalyzer(req, res, next) {
    const id = req.params['id']
    models['analyzers'].findById(id, (err, result) => {
        if (err) {
            return next(createError(500, null, err))
        }
        if (result === null) {
            return next(createError(404))
        }
        const request = JSON.stringify({
            command: 'START',
            params: id
        })
        requestBackend(request, (reply, isLastReply, closeResponse) => {
            if (reply['code'] && reply['code'] === NATS.REQ_TIMEOUT) {
                let error = new Error(`Timeout Error: Request: starting analyzer "${id}"`)
                return next(createError(500, null, error))
            }
            if (reply['error']) {
                closeResponse()
                return next(createError(500, reply['error']['message']))
            }
            // TODO: rollback saved record if any error occurred
            closeResponse()
            return res.status(204).send()
        })
    })
}

function stopAnalyzer(req, res, next) {
    const id = req.params['id']
    models['analyzers'].findById(id, (err, result) => {
        if (err) {
            return next(createError(500, null, err))
        }
        if (result === null) {
            return next(createError(404))
        }
        const request = JSON.stringify({
            command: 'STOP',
            params: id
        })
        requestBackend(request, (reply, isLastReply, closeResponse) => {
            if (reply['code'] && reply['code'] === NATS.REQ_TIMEOUT) {
                let error = new Error(`Timeout Error: Request: stopping analyzer "${id}"`)
                return next(createError(500, null, error))
            }
            if (reply['error']) {
                closeResponse()
                return next(createError(500, reply['error']['message']))
            }
            // TODO: rollback saved record if any error occurred
            closeResponse()
            return res.status(204).send()
        })
    })
}

function getAnalyzerSource(req, res, next) {
    const id = req.params['id']
    models['analyzers'].findById(id, getConfSourceProjection, (err, result) => {
        if (err) {
            return next(createError(500, null, err))
        }
        if (result === null) {
            return next(createError(404))
        }
        res.send(result)
    })
}

function getAnalyzerPipeline(req, res, next) {
    const id = req.params['id']
    models['analyzers'].findById(id, getConfSourceProjection, (err, result) => {
        if (err) {
            return next(createError(500, null, err))
        }
        if (result === null) {
            return next(createError(404))
        }
        res.send(result)
    })
}

function getMetrics(req, res, next) {
    models['analyzers'].find({}, getConfProjection, (err, list) => {
        if (err) { return next(createError(500, null, err)) }
        if (list.length === 0) { return res.status(200).send([]) }
        const request = JSON.stringify({
            command: 'READ',
            params: list.map(x => x['_id'])
        })
        requestBackend(request, (reply, isLastReply, closeResponse) => {
            if (reply['code'] && reply['code'] === NATS.REQ_TIMEOUT) {
                let error = new Error('Timeout Error: Request: getting analyzers')
                return next(createError(500, null, error))
            }
            if (reply['error']) {
                closeResponse()
                return next(createError(500, reply['error']['message']))
            }
            closeResponse()
            result = list.map(x => {
                let status = reply['result'][x['_id']]
                g.labels(x['name']).set(analyzerStatus.indexOf(status))
                return
            })

            res.set('Content-Type', register.contentType);
            res.status(200).send(register.metrics())
            return
        })
    })
}

/*
 * Routing Table
 */
routesWithAuth(
    router,
    ['get', '/analyzers', getAnalyzers],
    ['post', '/analyzers', postReqValidator, createAnalyzer],
    ['delete', '/analyzers', deleteAnalyzers],
)
routesWithAuth(
    router,
    ['get', '/analyzers/settings', getSettings],
)
routesWithAuth(
    router,
    ['get', '/analyzer/:id', getAnalyzer],
    ['patch', '/analyzer/:id', updateAnalyzer],
    ['delete', '/analyzer/:id', deleteAnalyzer],
    ['get', '/analyzer/:id/source', getAnalyzerSource],
    ['get', '/analyzer/:id/pipelines', getAnalyzerPipeline],
    ['post', '/analyzer/:id/start', startAnalyzer],
    ['post', '/analyzer/:id/stop', stopAnalyzer],
)
routesWithAuth(
    router,
    ['get', '/metrics', getMetrics]
)

module.exports = router
