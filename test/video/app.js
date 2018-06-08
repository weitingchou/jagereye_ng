const express = require('express');
const resolve = require('path').resolve

const { API_HOST, VIDEO_APP_PORT } = require('../constants');

const port = VIDEO_APP_PORT;
const url = `http://${API_HOST}:${VIDEO_APP_PORT}/video.mp4`
const width = 1280;
const height = 720;

class VideoApp {
    constructor() {
        this.app = express();

        this.app.get('/*', (req, res) => {
            const abs_path = resolve(__dirname + req.path)
            res.sendFile(abs_path);
        });
    }

    start() {
        this.server = this.app.listen(port);
    }

    stop() {
        this.server.close();
    }
}

module.exports = {
    VideoApp,
    port,
    url,
    width,
    height,
};
