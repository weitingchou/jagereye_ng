const fs = require('fs');

const { CronJob } = require('cron');
const yaml = require('js-yaml');

const EventAgent = require('./EventAgent');
const config = require('./config');

// Path to the database schema.
const DATABASE_SCHEMA_PATH = '../../shared/database.json';

try {
    const {
        expiration_days: expirationDays,
        max_event_records: maxEventRecords,
        repeat_period_mins: repeatPeriodMins,
    } = config.services.expiration.params;
    const {
        db_name: dbName,
        ports,
    } = config.services.database;
    const dbHost = `mongodb://localhost:${ports.client}/${dbName}`

    const job = new CronJob(`00 */${repeatPeriodMins} * * * *`, async () => {
        try {
            const eventAgent = new EventAgent(dbHost, DATABASE_SCHEMA_PATH);

            await eventAgent.deleteBefore(expirationDays);
            await eventAgent.deleteIfMoreThan(maxEventRecords);
        } catch (err) {
            console.error(err);
        }
    }, null, true);

    console.log(`Start a expiration cron job every ${repeatPeriodMins} minute(s)`);
} catch (e) {
    console.error(e)
}
