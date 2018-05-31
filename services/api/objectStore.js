const map = require('lodash/map');
const Promise = require('bluebird');
const S3 = require('aws-sdk/clients/s3');

const config = require('./config');

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
const ObjectStore = new S3({
    endpoint,
    accessKeyId,
    secretAccessKey,
    s3ForcePathStyle: true,
});

function deleteObjects(keys) {
    return new Promise((resolve, reject) => {
        // The parameters of objects deletion.
        const params = {
            Bucket: bucketName,
            Delete: {
                Objects: map(keys, key => ({ Key: key }))
            },
        };

        // Delete objects by the given keys.
        ObjectStore.deleteObjects(params, (err, data) => {
            if (err) {
                reject(err)
            } else {
                resolve()
            }
        });
    })
}

module.exports = {
     deleteObjects: deleteObjects,
}
