const API_HOST = 'localhost';

const ROLES = {
    ADMIN: 'admin',
    WRITER: 'writer',
    READER: 'reader',
}

const VIDEO_APP_PORT = 8081;

const WS_TIMEOUT = 10000;

const MAX_ANALYZERS = 8;

const ANALYZER_STATUS = {
    CREATED: 'created',
    STARTING: 'starting',
    RUNNING: 'running',
    STOPPED: 'stopped',
    SOURCE_DOWN: 'source_down',
};

module.exports = {
    ROLES,
    API_HOST,
    VIDEO_APP_PORT,
    WS_TIMEOUT,
    MAX_ANALYZERS,
    ANALYZER_STATUS,
}
