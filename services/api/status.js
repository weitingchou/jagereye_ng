const express = require('express')
const router = express.Router()
const { routesWithAuth } = require('./auth')
const { createError } = require('./utils')
const request = require('request-promise-native');

// status mapping
const analyzerStatus = ['created','starting','running','source_down','stopped']

async function getStatus(req, res, next) {
    let analyzers, targets
    try {
        analyzers = await request('http://localhost:9090/api/v1/query?query=analyzer_status', { json: true })
        targets = await request('http://localhost:9090/api/v1/targets', { json: true })
    } catch(e) {
        return next(createError(500, e))
    }
    let result = {
        analyzers: [],
        services: []
    }
    // analyzers
    if (analyzers['status'] !== 'success') { return next(createError(500, err)) }
    analyzers = analyzers['data']['result']
    for(let i = 0 ; i < analyzers.length ; i++) {
        let statusCode = parseInt(analyzers[i]['value'][1])
        result.analyzers.push({
            analyzer : analyzers[i]['metric']['analyzer'],
            status : statusCode === -1 ? 'unknown' : analyzerStatus[statusCode]
        })
    }
    // targets
    if (targets['status'] !== 'success') { return next(createError(500, err)) }
    targets = targets['data']['activeTargets']
    for(let i = 0 ; i < targets.length ; i++) {
        result.services.push({
            service: targets[i].labels.job,
            status: targets[i].health
        })
    }

    return res.send(result)
}

/*
 * Routing Table
 */
routesWithAuth(
    router,
    ['get', '/status', getStatus],
)

module.exports = router