const fs = require('fs');
const yaml = require('js-yaml');

// Path to the config file.
const CONFIG_PATH = '../../shared/config.yml';
// The read configuration.
const config = yaml.safeLoad(fs.readFileSync(CONFIG_PATH))

module.exports = config
