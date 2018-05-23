const fs = require('fs');
const mongoose = require('mongoose');
const httpRequest = require('request-promise');
const WebSocket = require('ws');

const config = require('./config');
const { API_HOST, ROLES } = require('./constants');

const {
    db_name: dbName,
    ports: dbPorts,
} = config.services.database;
const {
    ports: apiPorts,
    base_url: apiBaseUrl,
} = config.services.api;

const SCHEMA_URL = '../shared/database.json';
const DB_URL = `mongodb://${API_HOST}:${dbPorts.client}/${dbName}`;
const API_URI_PREFIX = `http://${API_HOST}:${apiPorts.client}/${apiBaseUrl}`;
const WS_URI = `http://${API_HOST}:${apiPorts.client}/notification`;

async function resetDatabse() {
    // Drop the database.
    const conn = mongoose.createConnection(DB_URL);

    await conn.dropDatabase();

    // Create the admin user.
    const schemaJSON = JSON.parse(fs.readFileSync(SCHEMA_URL, 'utf8'));
    const usersSchemaObj = new mongoose.Schema(schemaJSON.users);
    const usersModel = conn.model('users', usersSchemaObj);
    const {
        username,
        default_password: password,
    } = config.services.api.admin;

    await usersModel.create({
        username,
        password,
        role: ROLES.ADMIN,
    });

    // Close the database connection.
    await conn.close()
}

async function request({ url, method, body, token }) {
    try {
        const headers = !token ? {} : {
            Authorization: `Bearer ${token}`,
        };
        const response = await httpRequest({
            method,
            uri: `${API_URI_PREFIX}/${url}`,
            headers,
            body,
            json: true,
            resolveWithFullResponse: true,
        });

        return response;
    } catch (err) {
        return err;
    }
}

function createWebSocket() {
    return new WebSocket(WS_URI);
}

module.exports = {
    resetDatabse,
    request,
    createWebSocket,
}
