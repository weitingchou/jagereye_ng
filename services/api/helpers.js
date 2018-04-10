const express = require('express')
const router = express.Router()

const ffmpeg = require('fluent-ffmpeg');
const Promise = require('bluebird');

const find = require('lodash/find');

const ffprobe = Promise.promisify(ffmpeg.ffprobe);


function getStreamMetadata(req, res, next) {
    const url = req.query.url
    return ffprobe(url).then(metadata => {
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
                throw 'Can not get video size'
            }

            width = stream.coded_width
            height = stream.coded_height
        }

        res.send({width, height})
    })
}


router.get('/helpers/stream_metadata', getStreamMetadata)

module.exports = router
