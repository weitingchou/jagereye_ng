const HttpStatus = require('http-status-codes');

const config = require('./config');
const { resetDatabse, request } = require('./utils')
const { ROLES } = require('./constants');

function testLoginResult(result) {
    // Test the status code, must be 200 OK.
    expect(result.statusCode).toBe(HttpStatus.OK);

    // Test the return body, must have "_id" and "token".
    expect(result).toHaveProperty('body');
    expect(result.body).toHaveProperty('_id');
    expect(result.body).toHaveProperty('token');

    const { _id, token } = result.body;

    // Test the types of "_id" and "token".
    expect(typeof(_id)).toBe('string');
    expect(typeof(token)).toBe('string');
}

function testCreateUserResult(result) {
    // Test the status code, must be 201 CREATED.
    expect(result.statusCode).toBe(HttpStatus.CREATED);

    // Test the return body, must have "_id".
    expect(result).toHaveProperty('body');
    expect(result.body).toHaveProperty('_id');

    // Test the types of "_id" and "token".
    expect(typeof(result.body._id)).toBe('string');
}

function testGetUserResult(result, expectedUser) {
    // Test the status code, must be 200 OK.
    expect(result.statusCode).toBe(HttpStatus.OK);

    // Test the return body, must be equal to the expected user information.
    expect(result).toHaveProperty('body');
    expect(result.body).toEqual(expectedUser);
}

function testGetUsersResult(result, expectedUsers) {
    // Test the status code, must be 200 OK.
    expect(result.statusCode).toBe(HttpStatus.OK);

    // Test the return body, must be an array and the its length must be the
    // number of current created users.
    expect(result).toHaveProperty('body');
    expect(result.body).toHaveLength(expectedUsers.length);

    // Test the content of return body, must be equal to the informaiton of
    // current created users.
    expect(result.body).toEqual(expectedUsers)
}

function testGetUserPasswordLastUpdated(result) {
    // Test the return body, must have a string "passwordLastUpdated".
    expect(result).toHaveProperty('body');
    expect(result.body).toHaveProperty('passwordLastUpdated');
    expect(typeof(result.body.passwordLastUpdated)).toBe('string');
}

describe('Users Operations', () => {
    const {
        username: adminUsername,
        default_password: adminPassword,
    } = config.services.api.admin;

    const admin = {
        username: adminUsername,
        password: adminPassword,
        newPassword: `${adminPassword}_new`,
    };
    const writer = {
        username: 'writer',
        password: 'writer',
        newPassword: 'writer_new',
    };
    const reader = {
        username: 'reader',
        password: 'reader',
        newPassword: 'reader_new',
    };

    let adminId;
    let writerId;
    let readerId;

    let adminToken;
    let writerToken;
    let readerToken;

    let adminPasswordLastUpdated;

    beforeAll(async () => {
        await resetDatabse();
    });

    describe('In view of admin user', () => {
        test('Login admin with right password', async () => {
            const result = await request({
                url: 'login',
                method: 'POST',
                body: {
                    username: admin.username,
                    password: admin.password,
                },
            });

            testLoginResult(result);

            adminId = result.body._id;
            adminToken = result.body.token;
        });

        test('Login admin with wrong password', async () => {
            const result = await request({
                url: 'login',
                method: 'POST',
                body: {
                    username: admin.username,
                    password: `${admin.password}_wrong`,
                },
            });

            // Test the status code, must be 401 UNAUTHORIZED.
            expect(result.statusCode).toBe(HttpStatus.UNAUTHORIZED);
        });

        test('Get user information of admin', async () => {
            const result = await request({
                url: `user/${adminId}`,
                method: 'GET',
                token: adminToken,
            });

            testGetUserResult(result, {
                _id: adminId,
                username: admin.username,
                role: ROLES.ADMIN,
            });
        });

        test('Create a writer user', async () => {
            const result = await request({
                url: 'users',
                method: 'POST',
                body: {
                    username: writer.username,
                    password: writer.password,
                    role: ROLES.WRITER,
                },
                token: adminToken,
            });

            testCreateUserResult(result);

            writerId = result.body._id;
        });

        test('Get user information of writer', async () => {
            const result = await request({
                url: `user/${writerId}`,
                method: 'GET',
                token: adminToken,
            });

            testGetUserResult(result, {
                _id: writerId,
                username: writer.username,
                role: ROLES.WRITER,
            });
        });

        test('Create a reader user', async () => {
            const result = await request({
                url: 'users',
                method: 'POST',
                body: {
                    username: reader.username,
                    password: reader.password,
                    role: ROLES.READER,
                },
                token: adminToken,
            });

            testCreateUserResult(result);

            readerId = result.body._id;
        });

        test('Create a duplicate reader user', async () => {
            const result = await request({
                url: 'users',
                method: 'POST',
                body: {
                    username: reader.username,
                    password: reader.password,
                    role: ROLES.READER,
                },
                token: adminToken,
            });

            // Test the status code, must be 409 CONFLICT.
            expect(result.statusCode).toBe(HttpStatus.CONFLICT);
        });

        test('Get user information of reader', async () => {
            const result = await request({
                url: `user/${readerId}`,
                method: 'GET',
                token: adminToken,
            });

            testGetUserResult(result, {
                _id: readerId,
                username: reader.username,
                role: ROLES.READER,
            });
        });

        test('Get users that contains admin, writer and reader', async () => {
            const result = await request({
                url: 'users',
                method: 'GET',
                token: adminToken,
            });

            testGetUsersResult(result, [{
                _id: adminId,
                username: admin.username,
                role: ROLES.ADMIN,
            }, {
                _id: writerId,
                username: writer.username,
                role: ROLES.WRITER,
            }, {
                _id: readerId,
                username: reader.username,
                role: ROLES.READER,
            }]);
        });

        test('Change password of admin', async () => {
            const result = await request({
                url: `user/${adminId}/password`,
                method: 'PATCH',
                body: {
                    password: admin.newPassword,
                },
                token: adminToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Get user informaiton of admin again', async () => {
            const result = await request({
                url: `user/${adminId}`,
                method: 'GET',
                token: adminToken,
            });

            testGetUserPasswordLastUpdated(result);

            adminPasswordLastUpdated = result.body.passwordLastUpdated;
        });

        test('Login admin again with new password', async () => {
            const result = await request({
                url: 'login',
                method: 'POST',
                body: {
                    username: admin.username,
                    password: admin.newPassword,
                },
            });

            testLoginResult(result);
        });

        test('Login admin again with old password', async () => {
            const result = await request({
                url: 'login',
                method: 'POST',
                body: {
                    username: admin.username,
                    password: admin.password,
                },
            });

            // Test the status code, must be 401 UNAUTHORIZED.
            expect(result.statusCode).toBe(HttpStatus.UNAUTHORIZED);
        });

        test('Change password of reader', async () => {
            const result = await request({
                url: `user/${readerId}/password`,
                method: 'PATCH',
                body: {
                    password: reader.newPassword,
                },
                token: adminToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Get user informaiton of reader again', async () => {
            const result = await request({
                url: `user/${readerId}`,
                method: 'GET',
                token: adminToken,
            });

            testGetUserPasswordLastUpdated(result);
        });

        test('Delete admin that is not allowed to be deleted', async () => {
            const result = await request({
                url: `user/${adminId}`,
                method: 'DELETE',
                token: adminToken,
            });

            // Test the status code, must be 400 BAD_REQUEST.
            expect(result.statusCode).toBe(HttpStatus.BAD_REQUEST);
        });

        test('Delete reader', async () => {
            const result = await request({
                url: `user/${readerId}`,
                method: 'DELETE',
                token: adminToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Get users that contains only admin and writer', async () => {
            const result = await request({
                url: 'users',
                method: 'GET',
                token: adminToken,
            });

            testGetUsersResult(result, [{
                _id: adminId,
                username: admin.username,
                role: ROLES.ADMIN,
                passwordLastUpdated: adminPasswordLastUpdated,
            }, {
                _id: writerId,
                username: writer.username,
                role: ROLES.WRITER,
            }]);
        });
    });

    describe('In view of writer', () => {
        test('Login writer with right password', async () => {
            const result = await request({
                url: 'login',
                method: 'POST',
                body: {
                    username: writer.username,
                    password: writer.password,
                },
            });

            testLoginResult(result);

            writerToken = result.body.token;
        });

        test('Login writer with wrong password', async () => {
            const result = await request({
                url: 'login',
                method: 'POST',
                body: {
                    username: writer.username,
                    password: `${writer.password}_wrong`,
                },
            });

            // Test the status code, must be 401 UNAUTHORIZED.
            expect(result.statusCode).toBe(HttpStatus.UNAUTHORIZED);
        });

        test('Get user information of writer', async () => {
            const result = await request({
                url: `user/${writerId}`,
                method: 'GET',
                token: writerToken,
            });

            testGetUserResult(result, {
                _id: writerId,
                username: writer.username,
                role: ROLES.WRITER,
            });
        });

        test('Change password of writer', async () => {
            const result = await request({
                url: `user/${writerId}/password`,
                method: 'PATCH',
                body: {
                    password: writer.newPassword,
                },
                token: writerToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });

        test('Get user informaiton of writer again', async () => {
            const result = await request({
                url: `user/${writerId}`,
                method: 'GET',
                token: writerToken,
            });

            testGetUserPasswordLastUpdated(result);
        });

        test('Login writer again with new password', async () => {
            const result = await request({
                url: 'login',
                method: 'POST',
                body: {
                    username: writer.username,
                    password: writer.newPassword,
                },
            });

            testLoginResult(result);
        });

        test('Login writer again with old password', async () => {
            const result = await request({
                url: 'login',
                method: 'POST',
                body: {
                    username: writer.username,
                    password: writer.password,
                },
            });

            // Test the status code, must be 401 UNAUTHORIZED.
            expect(result.statusCode).toBe(HttpStatus.UNAUTHORIZED);
        });

        test('Create a new user, which is not allowed', async () => {
            const result = await request({
                url: 'users',
                method: 'POST',
                body: {
                    username: reader.username,
                    password: reader.password,
                    role: ROLES.reader,
                },
                token: writerToken,
            });

            // Test the status code, must be 401 UNAUTHORIZED.
            expect(result.statusCode).toBe(HttpStatus.UNAUTHORIZED);
        });

        test('Get users, which is not allowed', async () => {
            const result = await request({
                url: 'users',
                method: 'GET',
                token: writerToken,
            });

            // Test the status code, must be 401 UNAUTHORIZED.
            expect(result.statusCode).toBe(HttpStatus.UNAUTHORIZED);
        });

        test('Get user information of admin, which is not allowed', async () => {
            const result = await request({
                url: `user/${adminId}`,
                method: 'GET',
                token: writerToken,
            });

            // Test the status code, must be 400 BAD_REQUEST.
            expect(result.statusCode).toBe(HttpStatus.BAD_REQUEST);
        });

        test('Change password of admin, which is not allowed', async () => {
            const result = await request({
                url: `user/${adminId}/password`,
                method: 'PATCH',
                body: {
                    password: admin.newPassword,
                },
                token: writerToken,
            });

            // Test the status code, must be 400 BAD_REQUEST.
            expect(result.statusCode).toBe(HttpStatus.BAD_REQUEST);
        });

        test('Delete admin, which is not allowed', async () => {
            const result = await request({
                url: `user/${adminId}`,
                method: 'DELETE',
                token: writerToken,
            });

            // Test the status code, must be 400 BAD_REQUEST.
            expect(result.statusCode).toBe(HttpStatus.BAD_REQUEST);
        });

        test('Delete writer', async () => {
            const result = await request({
                url: `user/${writerId}`,
                method: 'DELETE',
                token: writerToken,
            });

            // Test the status code, must be 204 NO_CONTENT.
            expect(result.statusCode).toBe(HttpStatus.NO_CONTENT);
        });
    });
});
