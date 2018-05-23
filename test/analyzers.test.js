const HttpStatus = require('http-status-codes');

const config = require('./config');
const video = require('./video/app.js');
const { resetDatabse, request, createWebSocket } = require('./utils');
const { WS_TIMEOUT } = require('./constants');

describe('Analyzer Operations: ', () => {
    describe('green path(create => start => get status => delete): ', () => {
        let adminToken = null;
        let analyzerId = null;
        let videoApp = null;
        const testStartTime = (new Date().getTime() / 1000)

        const analyzerInfo = {
            name: 'Front Gate 1',
            source: {
                mode: 'streaming',
                url: video.url,
            },
            pipelines: [{
                type: 'IntrusionDetection',
                params: {
                    roi: [{
                        x: 0.156257813,
                        y: 0.138902778
                    }, {
                        x: 0.312507813,
                        y: 0.138902778
                    }, {
                        x: 0.312507813,
                        y: 0.833347222,
                    }, {
                        x: 0.156257813,
                        y: 0.833347222,
                    }],
                    triggers: ['person'],
                }
            }]
        };

        beforeAll(async () => {
            // Create an application that serves the video.
            videoApp = new video.VideoApp();
            videoApp.start();

            // Reset the database to initial state.
            await resetDatabse();

            // Get the admin token.
            const {
                username: adminUsername,
                default_password: adminPassword,
            } = config.services.api.admin;
            const loginAdminResult = await request({
                url: 'login',
                method: 'POST',
                body: {
                    username: adminUsername,
                    password: adminPassword,
                },
            });
            adminToken = loginAdminResult.body.token;
        });

        afterAll(() => {
            videoApp.stop();
        });

        test('create an analyzer', async (done) => {
            const result = await request({
                url: 'analyzers',
                method: 'POST',
                body: analyzerInfo,
                token: adminToken,
            });

            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result).toHaveProperty('body');
            expect(result.body).toHaveProperty('_id');
            analyzerId = result.body._id;
            done();
        });
        // ----- test('create analyzer')

        test('start the analyzer', async () => {
            const result = await request({
                url: `analyzer/${analyzerId}/start`,
                method: 'POST',
                token: adminToken,
            });

            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });
        // ----- test('start the analyzer')

        test('get status of the analyzer', async () => {
            const result = await request({
                method: 'GET',
                url: `analyzer/${analyzerId}`,
                token: adminToken,
            });

            expect(result.statusCode).toBe(HttpStatus.OK);
            expect(result).toHaveProperty('body');
            expect(result.body).toHaveProperty('_id');
            expect(result.body._id).toBe(analyzerId);
            expect(result.body).toHaveProperty('name');
            expect(result.body.name).toBe(analyzerInfo.name);
            expect(result.body).toHaveProperty('source');
            expect(result.body.source).toEqual(analyzerInfo.source);
            expect(result.body).toHaveProperty('pipelines');
            expect(result.body.pipelines).toEqual(analyzerInfo.pipelines);
            expect(result.body).toHaveProperty('status');
            // The status may be 'starting' or 'running' after starting the analyzer.
            expect(
                result.body.status === 'starting' ||
                result.body.status === 'running'
            ).toBe(true);
        });
        // ----- test('get status of the analyzer')

        test('wait for notification', (done) => {
            const ws = createWebSocket();

            ws.on('message', function incoming(data) {
                data = data.replace(/'/g, '"');
                notifiedInfo = JSON.parse(data);

                expect(notifiedInfo).toHaveProperty('category');
                expect(notifiedInfo.category).toBe('Analyzer');
                expect(notifiedInfo).toHaveProperty('message');
                const msg = notifiedInfo.message;
                expect(msg).toHaveProperty('date');
                expect(msg).toHaveProperty('content');
                expect(msg).toHaveProperty('type');
                expect(msg.type).toBe('intrusion_detection.alert');
                expect(msg).toHaveProperty('analyzerId');
                expect(msg.analyzerId).toBe(analyzerId);
                expect(msg).toHaveProperty('timestamp');
                expect(typeof(msg.timestamp)).toBe('number');

                const content = msg.content;
                expect(content).toHaveProperty('video');
                expect(content).toHaveProperty('metadata');
                expect(content).toHaveProperty('thumbnail');
                expect(content).toHaveProperty('triggered');
                ws.close();
                done();
            });
        }, WS_TIMEOUT);
        // ----- test('wait for events')

        test('query events', async () => {
            let now = (new Date().getTime() / 1000)
            const result = await request({
                url: 'events',
                method: 'POST',
                body: {
                    timestamp: {
                        start: testStartTime,
                        end: now
                    },
                    analyzers: [analyzerId]
                },
                token: adminToken,
            });

            expect(result.statusCode).toBe(HttpStatus.OK);
            expect(result).toHaveProperty('body');

            const eventInfo = result.body[0];
            expect(eventInfo).toHaveProperty('timestamp');
            expect(eventInfo).toHaveProperty('date');
            expect(eventInfo).toHaveProperty('_id');
            expect(typeof(eventInfo.timestamp)).toBe('number');
            expect(eventInfo).toHaveProperty('analyzerId');
            expect(eventInfo.analyzerId).toBe(analyzerId);
            expect(eventInfo).toHaveProperty('type');
            expect(eventInfo.type).toBe('intrusion_detection.alert');
            expect(eventInfo).toHaveProperty('content');
            const content = eventInfo.content;
            expect(content).toHaveProperty('video');
            expect(content).toHaveProperty('metadata');
            expect(content).toHaveProperty('thumbnail');
            expect(content).toHaveProperty('triggered');
        });
        // ----- test('query events')

        test('delete the analyzer', async () => {
            const result = await request({
                url: `analyzer/${analyzerId}`,
                method: 'DELETE',
                token: adminToken,
            });

            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });
        // ----- test('delete the analyzer')
    });
});
