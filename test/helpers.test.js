const HttpStatus = require('http-status-codes');

const video = require('./video/app.js');
const { request } = require('./utils');

describe('Helpers Operations', () => {
    let videoApp;

    beforeAll(async () => {
        videoApp = new video.VideoApp();
        videoApp.start();
    });

    afterAll(() => {
        videoApp.stop();
    });

    test('Get metadata of a video streaming', async () => {
        const encodedURL = encodeURIComponent(video.url);
        const result = await request({
            url: `helpers/stream_metadata?url=${encodedURL}`,
            method: 'GET',
        });

        // Test the status code, must be 200 OK.
        expect(result.statusCode).toBe(HttpStatus.OK);

        expect(result).toHaveProperty('body');
        expect(result.body).toEqual({
            width: video.width,
            height: video.height,
        })
    });
});
