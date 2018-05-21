const request = require('request-promise');
const HttpStatus = require('http-status-codes');
const WebSocket = require('ws');
const MongoClient = require('mongodb').MongoClient;

const video = require('./video/app.js');

const videoAppPort = 8081;

describe('Analyzer Operations: ', () => {
    describe('green path(create => start => get status => delete): ', () => {
        let analyzerId = null;
        let videoApp = null;
        const testStartTime = (new Date().getTime() / 1000)

        const analyzerInfo = {
            "name": "Front Gate 1",
            "source": {
                "mode": "streaming",
                "url": "http://localhost:"+videoAppPort+"/video.mp4"
            },
            "pipelines": [
                {
                    "type": "IntrusionDetection",
                    "params": {
                        "roi": [
                            {"x": 200.1,"y": 100.01},
                            {"x": 400.1,"y": 100.01},
                            {"x": 400.1, "y": 600.01},
                            {"x": 200.1, "y": 600.01}
                        ],
                        "triggers": ["person"]
                    }
                }
            ]
        };

        beforeAll(async () => {
            videoApp = new video.VideoApp(videoAppPort);
            videoApp.start();

            const mongoConn = await MongoClient.connect('mongodb://localhost:27017');
            const mongoDB = mongoConn.db('jager_test');
            const analColl = mongoDB.collection('analyzers');
            const eventColl = mongoDB.collection('events');
            await analColl.remove({});
            await eventColl.remove({});
            mongoConn.close();
            return;
        });

        afterAll(() => {
            videoApp.stop();
        });

        test('create an analyzer', async (done) => {
            let postData = analyzerInfo;
            let options =  {
                method: 'POST',
                uri: 'http://localhost:5000/api/v1/analyzers',
                body: postData,
                json: true,
                resolveWithFullResponse: true
            };
            const result = await request(options);
            expect(result.statusCode).toBe(HttpStatus.CREATED);
            expect(result).toHaveProperty('body');
            expect(result.body).toHaveProperty('_id');
            analyzerId = result.body._id;
            done();
        });
        // ----- test('create analyzer')

        test('start the analyzer', async (done) => {
            let options =  {
                method: 'POST',
                uri: 'http://localhost:5000/api/v1/analyzer/' + analyzerId + '/start',
                json: true,
                resolveWithFullResponse: true
            };
            const result = await request(options);

            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
            done();
        });
        // ----- test('start the analyzer')

        test('get status of the analyzer', async (done) => {
            let options =  {
                method: 'GET',
                uri: 'http://localhost:5000/api/v1/analyzer/' + analyzerId,
                json: true,
                resolveWithFullResponse: true
            };
            const result = await request(options);
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
            expect(result.body.status).toBe('running');

            done();
        });
        // ----- test('get status of the analyzer')

        test('wait for notification', async (done) => {
            const ws = new WebSocket('ws://localhost:5000/notification');

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

        });
        // ----- test('wait for events')

        test('query events', async (done) => {
            let now = (new Date().getTime() / 1000)
            let postData = {
                timestamp: {
                    start: testStartTime,
                    end: now
                },
                analyzers: [analyzerId]
            };

            let options =  {
                method: 'POST',
                uri: 'http://localhost:5000/api/v1/events',
                body: postData,
                json: true,
                resolveWithFullResponse: true
            };
            const result = await request(options);
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

            done();
        });
        // ----- test('query events')

        test('delete the analyzer', async (done) => {
            let options =  {
                method: 'DELETE',
                uri: 'http://localhost:5000/api/v1/analyzer/' + analyzerId,
                json: true,
                resolveWithFullResponse: true
            };
            const result = await request(options);
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
            done();
        });
        // ----- test('delete the analyzer')
    });
});
