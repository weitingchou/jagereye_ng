const HttpStatus = require('http-status-codes');

const includes = require('lodash/includes');
const isArray = require('lodash/isArray');
const isObject = require('lodash/isObject');
const merge = require('lodash/merge');
const zipWith = require('lodash/zipWith');

const config = require('./config');
const video = require('./video/app.js');
const { resetDatabse, request, createWebSocket, now } = require('./utils');
const {
    ANALYZER_STATUS,
    MAX_ANALYZERS,
    ROLES,
    WS_TIMEOUT,
} = require('./constants');

function testCreateAnalyzerResult(result) {
    // Test the status code, must be 201 CREATED.
    expect(result.statusCode).toBe(HttpStatus.CREATED);

    // Test the return body, must contain "_id".
    expect(result).toHaveProperty('body');
    expect(result.body).toHaveProperty('_id');
}

function testGetAnalyzerContent(body, expectedId, expectedInfo, expectedStatus) {
    expect(isObject(body)).toBe(true);

    // Test the analyzer ID and infromation.
    expect(body._id).toBe(expectedId);
    expect(body.name).toBe(expectedInfo.name);
    expect(body.source).toEqual(expectedInfo.source);
    expect(body.pipelines).toEqual(expectedInfo.pipelines);

    // Test the analyzer status.
    if (isArray(expectedStatus)) {
        expect(includes(expectedStatus, body.status)).toEqual(true);
    } else {
        expect(body.status).toEqual(expectedStatus);
    }
}

function testGetAnalyzerResult(result, expectedId, expectedInfo, expectedStatus) {
    // Test the status code, must be 200 OK.
    expect(result.statusCode).toBe(HttpStatus.OK);

    // Test the return body.
    testGetAnalyzerContent(result.body, expectedId, expectedInfo, expectedStatus);
}

function testGetAnalyzersResult(result, expectedAnalyzers) {
    // Test the status code, must be 200 OK.
    expect(result.statusCode).toBe(HttpStatus.OK);

    // The the length of result body.
    expect(result.body).toHaveLength(expectedAnalyzers.length);

    // Test the return body.
    zipWith(result.body, expectedAnalyzers, (analyzer, expectedAnalyzer) => {
        testGetAnalyzerContent(
            analyzer,
            expectedAnalyzer.id,
            expectedAnalyzer.info,
            expectedAnalyzer.status,
        );
    });
}

function testGetAnalyzerSettingsResult(result, expectedSettings) {
    // Test the status code, must be 200 OK.
    expect(result.statusCode).toBe(HttpStatus.OK);

    // Test the return body.
    expect(result.body).toEqual(expectedSettings);
}

function testQueryEventsResult(result, expectedEvents) {
    // Test the status code, must be 200 OK.
    expect(result.statusCode).toBe(HttpStatus.OK);

    // Test the return body.
    expect(result.body).toHaveLength(expectedEvents.length);

    zipWith(result.body, expectedEvents, (event, expectedEvent) => {
        expect(event).toHaveProperty('_id');
        expect(event.type).toBe(expectedEvent.type);
        expect(event.analyzerId).toBe(expectedEvent.analyzerId);
        expect(event.timestamp).toBe(expectedEvent.timestamp);
        expect(event.date).toBe(expectedEvent.date);
        expect(event.content).toEqual(expectedEvent.content);
    });
}

describe('Analyzer Operations: ', () => {
    let adminToken = null;
    let writerToken = null;
    let readerToken = null;

    let analyzerId0 = null;
    let analyzerId1 = null;

    let generatedEventId = null;
    let generatedEvent = null;

    let videoApp = null;
    let ws = null;

    const testStartTime = now();

    const analyzerInfo0 = {
        name: 'Camera 0',
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
                triggers: [
                    'person',
                ],
            }
        }]
    };
    const analyzerInfo1 = {
        name: 'Camera 1',
        source: {
            mode: 'streaming',
            url: video.url,
        },
        pipelines: [{
            type: 'IntrusionDetection',
            params: {
                roi: [{
                    x: 0.156257813,
                    y: 0.138902778,
                }, {
                    x: 0.312507813,
                    y: 0.138902778,
                }, {
                    x: 0.312507813,
                    y: 0.833347222,
                }],
                triggers: [
                    'dog',
                ],
            },
        }],
    };
    const updatedAnalyzerInfo0 = merge(analyzerInfo1, {
        name: 'Camera 0 Updated',
    });
    const updatedAnalyzerInfo1 = merge(analyzerInfo1, {
        name: 'Camera 1 Updated',
    });

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

        // Create a writer user.
        await request({
            url: 'users',
            method: 'POST',
            body: {
                username: 'writer',
                password: 'writer',
                role: ROLES.WRITER,
            },
            token: adminToken,
        });
        // Create a reader user.
        await request({
            url: 'users',
            method: 'POST',
            body: {
                username: 'reader',
                password: 'reader',
                role: ROLES.READER,
            },
            token: adminToken,
        });

        // Get the writer token.
        const loginWriterResult = await request({
            url: 'login',
            method: 'POST',
            body: {
                username: 'writer',
                password: 'writer',
            },
        });
        // Get the reader token.
        const loginReaderResult = await request({
            url: 'login',
            method: 'POST',
            body: {
                username: 'reader',
                password: 'reader',
            },
        });

        writerToken = loginWriterResult.body.token
        readerToken = loginReaderResult.body.token
    });

    afterAll(() => {
        // Stop the application that serves the video.
        videoApp.stop();

        // Close the websocket if it is not closed yet.
        if (ws.readyState !== ws.CLOSING || ws.readyState !== ws.CLOSED) {
            ws.close();
        }
    });

    describe('Two analyzers, manipulated by admin, writer and reader', () => {
        test('Create first analyzer (by admin)', async () => {
            const result = await request({
                url: 'analyzers',
                method: 'POST',
                body: analyzerInfo0,
                token: adminToken,
            });

            testCreateAnalyzerResult(result);

            analyzerId0 = result.body._id;
        });

        test('Create another duplicate analyzer (by admin) whose name is same as first analyzer', async () => {
            const result = await request({
                url: 'analyzers',
                method: 'POST',
                body: analyzerInfo0,
                token: adminToken,
            });

            // Test the status code, must be 409 CONFLICT.
            expect(result.statusCode).toBe(HttpStatus.CONFLICT);
        });

        test('Create second analyzer (by writer)', async () => {
            const result = await request({
                url: 'analyzers',
                method: 'POST',
                body: analyzerInfo1,
                token: writerToken,
            });

            testCreateAnalyzerResult(result);

            analyzerId1 = result.body._id;
        });

        test('Create another analyzer (by reader) which is not allowed', async () => {
            const result = await request({
                url: 'analyzers',
                method: 'POST',
                body: analyzerInfo1,
                token: readerToken,
            });

            // Test the status code, must be 403 FORBIDDEN.
            expect(result.statusCode).toBe(HttpStatus.FORBIDDEN);
        });

        test('Get first analyzer (by admin) after creating', async () => {
            const result = await request({
                method: 'GET',
                url: `analyzer/${analyzerId0}`,
                token: adminToken,
            });

            testGetAnalyzerResult(
                result,
                analyzerId0,
                analyzerInfo0,
                ANALYZER_STATUS.CREATED,
            );
        });

        test('Get second analyzer (by writer) after creating', async () => {
            const result = await request({
                method: 'GET',
                url: `analyzer/${analyzerId1}`,
                token: writerToken,
            });

            testGetAnalyzerResult(
                result,
                analyzerId1,
                updatedAnalyzerInfo1,
                ANALYZER_STATUS.CREATED,
            );
        });

        test('Get first analyzer (by reader) after creating', async () => {
            const result = await request({
                method: 'GET',
                url: `analyzer/${analyzerId0}`,
                token: readerToken,
            });

            testGetAnalyzerResult(
                result,
                analyzerId0,
                analyzerInfo0,
                ANALYZER_STATUS.CREATED,
            );
        });

        test('Update second analyzer (by admin)', async () => {
            const result = await request({
                method: 'PATCH',
                url: `analyzer/${analyzerId1}`,
                body: updatedAnalyzerInfo1,
                token: adminToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Update second analyzer (by admin) whose has same name with first analyzer', async () => {
            const result = await request({
                method: 'PATCH',
                url: `analyzer/${analyzerId1}`,
                body: analyzerInfo0,
                token: adminToken,
            });

            // Test the status code, must be 409 CONFLICT.
            expect(result.statusCode).toBe(HttpStatus.CONFLICT);
        });

        test('Get second analyzer (by admin) after updating', async () => {
            const result = await request({
                method: 'GET',
                url: `analyzer/${analyzerId1}`,
                token: adminToken,
            });

            testGetAnalyzerResult(
                result,
                analyzerId1,
                updatedAnalyzerInfo1,
                ANALYZER_STATUS.CREATED,
            );
        });

        test('Update second analyzer (by writer)', async () => {
            const result = await request({
                method: 'PATCH',
                url: `analyzer/${analyzerId1}`,
                body: updatedAnalyzerInfo1,
                token: writerToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Update second analyzer (by reader) which is not allowed', async () => {
            const result = await request({
                method: 'PATCH',
                url: `analyzer/${analyzerId1}`,
                body: updatedAnalyzerInfo1,
                token: readerToken,
            });

            // Test the status code, must be 403 FORBIDDEN.
            expect(result.statusCode).toBe(HttpStatus.FORBIDDEN);
        });

        test('Start first analyzer (by admin)', async () => {
            const result = await request({
                url: `analyzer/${analyzerId0}/start`,
                method: 'POST',
                token: adminToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Get first analyzer (by admin) after starting', async () => {
            const result = await request({
                method: 'GET',
                url: `analyzer/${analyzerId0}`,
                token: adminToken,
            });

            testGetAnalyzerResult(
                result,
                analyzerId0,
                analyzerInfo0,
                // The analyzer may be 'starting' or 'running'.
                [ANALYZER_STATUS.STARTING, ANALYZER_STATUS.RUNNING],
            );
        });

        test('Wait for a notification generated by first analyzer', (done) => {
            ws = createWebSocket();

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
                expect(msg.analyzerId).toBe(analyzerId0);
                expect(msg).toHaveProperty('timestamp');
                expect(typeof(msg.timestamp)).toBe('number');

                const content = msg.content;
                expect(content).toHaveProperty('video');
                expect(content).toHaveProperty('metadata');
                expect(content).toHaveProperty('thumbnail');
                expect(content).toHaveProperty('triggered');

                generatedEvent = msg;

                ws.close();
                done();
            });
        }, WS_TIMEOUT);

        test('Stop first analyzer (by admin)', async () => {
            const result = await request({
                url: `analyzer/${analyzerId0}/stop`,
                method: 'POST',
                token: adminToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Get first analyzer (by admin) after stopping', async () => {
            const result = await request({
                method: 'GET',
                url: `analyzer/${analyzerId0}`,
                token: adminToken,
            });

            testGetAnalyzerResult(
                result,
                analyzerId0,
                analyzerInfo0,
                ANALYZER_STATUS.STOPPED,
            );
        });

        test('Get settings of analyzers (by admin)', async () => {
            const result = await request({
                method: 'GET',
                url: 'analyzers/settings',
                token: adminToken,
            });

            testGetAnalyzerSettingsResult(result, {
                maxAnalyzerCount: MAX_ANALYZERS,
                currentAnalyzerCount: 2,
            });
        });

        test('Get settings of analyzers (by writer)', async () => {
            const result = await request({
                method: 'GET',
                url: 'analyzers/settings',
                token: writerToken,
            });

            testGetAnalyzerSettingsResult(result, {
                maxAnalyzerCount: MAX_ANALYZERS,
                currentAnalyzerCount: 2,
            });
        });

        test('Get settings of analyzers (by reader)', async () => {
            const result = await request({
                method: 'GET',
                url: 'analyzers/settings',
                token: readerToken,
            });

            testGetAnalyzerSettingsResult(result, {
                maxAnalyzerCount: MAX_ANALYZERS,
                currentAnalyzerCount: 2,
            });
        });

        test('Get analyzers (by admin)', async () => {
            const result = await request({
                method: 'GET',
                url: 'analyzers',
                token: adminToken,
            });

            testGetAnalyzersResult(result, [{
                id: analyzerId0,
                info: analyzerInfo0,
                status: ANALYZER_STATUS.STOPPED,
            }, {
                id: analyzerId1,
                info: updatedAnalyzerInfo1,
                status: ANALYZER_STATUS.CREATED,
            }]);
        });

        test('Get analyzers (by admin)', async () => {
            const result = await request({
                method: 'GET',
                url: 'analyzers',
                token: adminToken,
            });

            testGetAnalyzersResult(result, [{
                id: analyzerId0,
                info: analyzerInfo0,
                status: ANALYZER_STATUS.STOPPED,
            }, {
                id: analyzerId1,
                info: updatedAnalyzerInfo1,
                status: ANALYZER_STATUS.CREATED,
            }]);
        });

        test('Get analyzers (by writer)', async () => {
            const result = await request({
                method: 'GET',
                url: 'analyzers',
                token: writerToken,
            });

            testGetAnalyzersResult(result, [{
                id: analyzerId0,
                info: analyzerInfo0,
                status: ANALYZER_STATUS.STOPPED,
            }, {
                id: analyzerId1,
                info: updatedAnalyzerInfo1,
                status: ANALYZER_STATUS.CREATED,
            }]);
        });

        test('Get analyzers (by reader)', async () => {
            const result = await request({
                method: 'GET',
                url: 'analyzers',
                token: readerToken,
            });

            testGetAnalyzersResult(result, [{
                id: analyzerId0,
                info: analyzerInfo0,
                status: ANALYZER_STATUS.STOPPED,
            }, {
                id: analyzerId1,
                info: updatedAnalyzerInfo1,
                status: ANALYZER_STATUS.CREATED,
            }]);
        });

        test('Start second analyzer (by writer)', async () => {
            const result = await request({
                url: `analyzer/${analyzerId1}/start`,
                method: 'POST',
                token: writerToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Wait for 5 seconds and no notification should be generated by second analyzer', (done) => {
            ws = createWebSocket();

            ws.on('message', () => {
                ws.close();
                done.fail();
            });

            setTimeout(() => {
                ws.close();
                done();
            }, 5000)
        }, WS_TIMEOUT);

        test('Start first analyzer (by reader) which is not allowed', async () => {
            const result = await request({
                url: `analyzer/${analyzerId0}/start`,
                method: 'POST',
                token: readerToken,
            });

            // Test the status code, must be 403 FORBIDDEN.
            expect(result.statusCode).toBe(HttpStatus.FORBIDDEN);
        });

        test('Stop second analyzer (by reader) which is not allowed', async () => {
            const result = await request({
                url: `analyzer/${analyzerId0}/stop`,
                method: 'POST',
                token: readerToken,
            });

            // Test the status code, must be 403 FORBIDDEN.
            expect(result.statusCode).toBe(HttpStatus.FORBIDDEN);
        });

        test('Stop second analyzer (by writer)', async () => {
            const result = await request({
                url: `analyzer/${analyzerId1}/stop`,
                method: 'POST',
                token: writerToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Query events (by admin)', async () => {
            const result = await request({
                url: 'events',
                method: 'POST',
                body: {
                    timestamp: {
                        start: testStartTime,
                        end: now(),
                    },
                },
                token: adminToken,
            });

            testQueryEventsResult(result, [generatedEvent]);

            generatedEventId = result.body[0]._id;
        });

        test('Query events (by writer)', async () => {
            const result = await request({
                url: 'events',
                method: 'POST',
                body: {
                    timestamp: {
                        start: testStartTime,
                        end: now(),
                    },
                },
                token: writerToken,
            });

            testQueryEventsResult(result, [generatedEvent]);
        });

        test('Query events (by reader)', async () => {
            const result = await request({
                url: 'events',
                method: 'POST',
                body: {
                    timestamp: {
                        start: testStartTime,
                        end: now(),
                    },
                },
                token: readerToken,
            });

            testQueryEventsResult(result, [generatedEvent]);
        });

        test('Query events (by admin) that is specific for first analyzer', async () => {
            const result = await request({
                url: 'events',
                method: 'POST',
                body: {
                    timestamp: {
                        start: testStartTime,
                        end: now(),
                    },
                    analyzers: [analyzerId0],
                },
                token: adminToken,
            });

            testQueryEventsResult(result, [generatedEvent]);
        });

        test('Query events (by admin) that is specific for second analyzer', async () => {
            const result = await request({
                url: 'events',
                method: 'POST',
                body: {
                    timestamp: {
                        start: testStartTime,
                        end: now(),
                    },
                    analyzers: [analyzerId1],
                },
                token: adminToken,
            });

            testQueryEventsResult(result, []);
        });

        test('Query events (by admin) that is specific for intrusion detection', async () => {
            const result = await request({
                url: 'events',
                method: 'POST',
                body: {
                    timestamp: {
                        start: testStartTime,
                        end: now(),
                    },
                    types: ['intrusion_detection.alert'],
                },
                token: adminToken,
            });

            testQueryEventsResult(result, [generatedEvent]);
        });

        test('Query events (by admin) that is specific for unkown type of event', async () => {
            const result = await request({
                url: 'events',
                method: 'POST',
                body: {
                    timestamp: {
                        start: testStartTime,
                        end: now(),
                    },
                    types: ['unkown'],
                },
                token: adminToken,
            });

            testQueryEventsResult(result, []);
        });

        // TODO: The test case should have more generated events, to make it robust enough.
        test('Query events (by admin) for event that have greater ID than the generated event', async () => {
            const result = await request({
                url: 'events',
                method: 'POST',
                body: {
                    timestamp: {
                        start: testStartTime,
                        end: now(),
                    },
                    events: {
                        gt: generatedEventId,
                    },
                },
                token: adminToken,
            });

            testQueryEventsResult(result, []);
        });

        // TODO: The test case should have more generated events, to make it robust enough.
        test('Query events (by admin) for event that have smaller ID than the generated event', async () => {
            const result = await request({
                url: 'events',
                method: 'POST',
                body: {
                    timestamp: {
                        start: testStartTime,
                        end: now(),
                    },
                    events: {
                        lt: generatedEventId,
                    },
                },
                token: adminToken,
            });

            testQueryEventsResult(result, []);
        });

        test('Delete first analyzer (by admin)', async () => {
            const result = await request({
                url: `analyzer/${analyzerId0}`,
                method: 'DELETE',
                token: adminToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Get first analyzer (by admin) after deleting', async () => {
            const result = await request({
                method: 'GET',
                url: `analyzer/${analyzerId0}`,
                token: adminToken,
            });

            // Test the status code, must be 404 NOT_FOUND.
            expect(result.statusCode).toBe(HttpStatus.NOT_FOUND);
        });

        test('Update first analyzer (by admin) after deleting', async () => {
            const result = await request({
                method: 'PATCH',
                url: `analyzer/${analyzerId0}`,
                body: updatedAnalyzerInfo0,
                token: adminToken,
            });

            // Test the status code, must be 404 NOT_FOUND.
            expect(result.statusCode).toBe(HttpStatus.NOT_FOUND);
        });

        test('Start first analyzer (by admin) after deleting', async () => {
            const result = await request({
                method: 'PATCH',
                url: `analyzer/${analyzerId0}/start`,
                token: adminToken,
            });

            // Test the status code, must be 404 NOT_FOUND.
            expect(result.statusCode).toBe(HttpStatus.NOT_FOUND);
        });

        test('Stop first analyzer (by admin) after deleting', async () => {
            const result = await request({
                method: 'POST',
                url: `analyzer/${analyzerId0}/stop`,
                token: adminToken,
            });

            // Test the status code, must be 404 NOT_FOUND.
            expect(result.statusCode).toBe(HttpStatus.NOT_FOUND);
        });

        test('Get settings of analyzers (by admin) after first analyzer is deleted', async () => {
            const result = await request({
                method: 'GET',
                url: 'analyzers/settings',
                token: adminToken,
            });

            testGetAnalyzerSettingsResult(result, {
                maxAnalyzerCount: MAX_ANALYZERS,
                currentAnalyzerCount: 1,
            });
        });

        test('Get analyzers (by admin) after first analyzer is deleted', async () => {
            const result = await request({
                method: 'GET',
                url: 'analyzers',
                token: adminToken,
            });

            testGetAnalyzersResult(result, [{
                id: analyzerId1,
                info: updatedAnalyzerInfo1,
                status: ANALYZER_STATUS.STOPPED,
            }]);
        });

        test('Delete second analyzer (by reader) which is not allowed', async () => {
            const result = await request({
                url: `analyzer/${analyzerId1}`,
                method: 'DELETE',
                token: readerToken,
            });

            // Test the status code, must be 403 FORBIDDEN.
            expect(result.statusCode).toBe(HttpStatus.FORBIDDEN);
        });

        test('Delete second analyzer (by writer)', async () => {
            const result = await request({
                url: `analyzer/${analyzerId1}`,
                method: 'DELETE',
                token: writerToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Create a analyzer and then delete all analyzers (by admin)', async () => {
            await request({
                url: 'analyzers',
                method: 'POST',
                body: analyzerInfo0,
                token: adminToken,
            });

            const result = await request({
                url: 'analyzers',
                method: 'DELETE',
                token: adminToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Get settings of analyzers (by admin) after all analyzers are deleted', async () => {
            const result = await request({
                method: 'GET',
                url: 'analyzers/settings',
                token: adminToken,
            });

            testGetAnalyzerSettingsResult(result, {
                maxAnalyzerCount: MAX_ANALYZERS,
                currentAnalyzerCount: 0,
            });
        });

        test('Get analyzers (by admin) after all analyzers are deleted', async () => {
            const result = await request({
                method: 'GET',
                url: 'analyzers',
                token: adminToken,
            });

            testGetAnalyzersResult(result, []);
        });

        test('Delete all analyzers (by writer)', async () => {
            const result = await request({
                url: 'analyzers',
                method: 'DELETE',
                token: writerToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Delete all analyzers (by reader) which is not allowed', async () => {
            const result = await request({
                url: 'analyzers',
                method: 'DELETE',
                token: readerToken,
            });

            // Test the status code, must be 403 FORBIDDEN.
            expect(result.statusCode).toBe(HttpStatus.FORBIDDEN);
        });
    });
});
