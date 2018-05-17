const P = require('bluebird');
const TimeoutError = P.TimeoutError;
const fs = P.promisifyAll(require('fs'));
const execAsync = P.promisify(require('child_process').exec);
const format = require('util').format;

const dataportInterfaceFilename = 'jagereye_dataport_interface';
const shellTimeout = 4000

class ResetNetworkError extends Error {
    constructor (message, status) {
        super(message);
        this.name = this.constructor.name;
        // Capturing stack trace, excluding constructor call from it.
        Error.captureStackTrace(this, this.constructor);
        this.status = status || 500;
    }
};

async function resetNetworkInterface(networkInterface, mode, address, netmask, gateway) {
    // flush the dataport ip
    await execAsync(format('sudo ip addr flush dev %s', networkInterface), {timeout: shellTimeout});
    if(mode === 'static') {
        await execAsync(format('sudo ifconfig %s %s', networkInterface, address), {timeout: shellTimeout});
    }
    else if(mode === 'dhcp') {
        try {
            await execAsync(format('sudo dhclient %s', networkInterface), {timeout: shellTimeout});
        } catch(e){
            // it happened when the dataport cannot find out dhcp server
            console.error(e);
            throw new ResetNetworkError('dhcp failed');
        }
    }
}

async function getInterfaceIp(networkInterface) {
    return await execAsync(format('/sbin/ifconfig %s | grep "inet addr:" | cut -d: -f2 | awk "{ print $1}"', networkInterface), {timeout: shellTimeout});
}


module.exports = {
    resetNetworkInterface: resetNetworkInterface,
    getInterfaceIp: getInterfaceIp,
    ResetNetworkError: ResetNetworkError
};
