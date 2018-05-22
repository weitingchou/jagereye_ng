const fs = require('fs');

const forEach = require('lodash/forEach');
const isString = require('lodash/isString');
const mongoose = require('mongoose');
const Promise = require('bluebird');
const map = require('lodash/map');

const { deleteObjects } = require('./utils');

mongoose.Promise = require('bluebird');

const { Schema } = mongoose;

class EventAgent {
    constructor(dbHost, schemaPath) {
        this.dbHost = dbHost;
        this.schemaPath = schemaPath;
        this.eventsModel = this.createEventsModel();
    }

    // Create model for events.
    createEventsModel() {
        const conn = mongoose.createConnection(this.dbHost);
        const schemaJSON = JSON.parse(fs.readFileSync(this.schemaPath, 'utf8'));
        const eventsSchemaObj = new Schema(schemaJSON.events);
        const eventsModel = conn.model('events', eventsSchemaObj);

        return eventsModel;
    }

    // Delete events before a given day(s) ago.
    async deleteBefore(days) {
        console.log(`== Try to delete data before ${days} day(s) ago ==`);

        // Convert days into seconds.
        const seconds = days * 24 * 60 * 60;
        // Calculate the maximum timestamp (in seconds) that allows events to
        // live.
        const maxTimestamp = Date.now() / 1000 - seconds;

        await this.delete([{
            $match: {
                timestamp: {
                    $lte: maxTimestamp,
                },
            },
        }]);

        console.log(`== Success to delete data before ${days} day(s) ago ==`);
    }

    // Delete events if the number of stored records is more than a given
    // maximum number. If exceeds, the oldest records will be deleted first.
    // TODO(JiaKuan SU): We can also consider to calculate the storage space
    // directly.
    async deleteIfMoreThan(maxNum) {
        console.log(`== Try to delete data if the stored records is more than ${maxNum} ==`);

        const count = await this.eventsModel.count();

        if (count > maxNum) {
            await this.delete([{
                $sort: {
                    timestamp: 1
                },
            }, {
                $limit: count - maxNum
            }]);
        }

        console.log(`== Success to delete data if the stored records is more than ${maxNum} ==`);
    }

    // Generic function for events deletion.
    async delete(filters) {
        // Find all matched events.
        const events = await this.eventsModel.aggregate(filters);

        if (events.length === 0) {
            return;
        }

        const objKeys = [];

        // Collect of the object keys stored in the contents.
        forEach(events, (event) => {
            forEach(event.content, (value) => {
                // Each type of events has its own content structure. To
                // generalize, we assume object key is stored in string type.
                if (isString(value)) {
                    objKeys.push(value);
                }
            });
        });

        // Delete all objects by keys.
        if (objKeys.length > 0) {
            await deleteObjects(objKeys);

            console.log(`Delete objects: ${objKeys}`);
        }

        const eventIds = map(events, event => event._id);

        // Delete all events.
        await this.eventsModel.remove({
            _id: {
                $in: eventIds,
            },
        });

        console.log(`Delete ${eventIds.length} event records: ${eventIds}`);
    }
}

module.exports = EventAgent;
