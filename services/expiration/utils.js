const map = require('lodash/map');
const Promise = require('bluebird');
const S3 = require('aws-sdk/clients/s3');

const config = require('./config');

// Delete objects in object storage.
function deleteObjects(keys) {
    return new Promise((resolve, reject) => {
        // Get configurations.
        const { obj_storage: objectStorageConfig } = config.services;
        const {
            endpoint_url: endpoint,
            bucket_name: bucketName,
        } = objectStorageConfig.params;
        const {
            access_key: accessKeyId,
            secret_key: secretAccessKey,
        } = objectStorageConfig.credentials;

        // Connect to object store.
        const store = new S3({
            endpoint,
            accessKeyId,
            secretAccessKey,
            s3ForcePathStyle: true,
        });

        // The parameters of objects deletion.
        const params = {
            Bucket: bucketName,
            Delete: {
                Objects: map(keys, key => ({ Key: key }))
            },
        };

        // Delete objects by the given keys.
        store.deleteObjects(params, (err, data) => {
            if (err) {
                reject(err)
            } else {
                resolve()
            }
        });
    })
}

module.exports = {
    deleteObjects,
};
