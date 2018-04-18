const express = require('express')
const router = express.Router()
const { createError } = require('./utils')
const find = require('lodash/find');

const ffmpeg = require('fluent-ffmpeg');
const Promise = require('bluebird');

const TIMEOUT_PERIOD = 30000


function getStreamMetadata(req, res, next) {
    const url = req.query.url
    let isTimeout = false

    const timeout = setTimeout(() => {
        isTimeout = true
        next(createError(404, null))
    }, TIMEOUT_PERIOD)

    ffmpeg.ffprobe(url, (err, metadata) => {
        if (isTimeout) { return }
        else { clearTimeout(timeout) }

        if (err) { return next(createError(404, null, err)) }

        let width
        let height
        let stream

        stream = find(metadata.streams, (stream) => (
            stream.width > 0 && stream.height > 0
        ))

        if (stream) {
            width = stream.width
            height = stream.height
        } else {
            stream = find(metadata.streams, (stream) => (
                stream.coded_width > 0 && stream.coded_height > 0
            ))

            if (!stream) {
                // XXX: Does 400 make sense?
                return next(createError(400, 'Unable to get video frame size'))
            }

            width = stream.coded_width
            height = stream.coded_height
        }

        return res.send({width, height})
    })
}


router.get('/helpers/stream_metadata', getStreamMetadata)

module.exports = router
