const express = require('express');
const resolve = require('path').resolve

class videoApp{
  constructor(port) {
    this.port = port;
    this.app = express();

    this.app.get('/*', (req, res) => {
      let abs_path = resolve(__dirname + req.path)
      res.sendFile(abs_path);
      });
  }

  start() {
    this.server = this.app.listen(this.port);
  }

  stop() {
    this.server.close();
  }
}

module.exports = {videoApp: videoApp};
