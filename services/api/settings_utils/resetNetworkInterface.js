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

async function genInterfaceFile(filename, networkInterface, mode, address, netmask, gateway) {
    await fs.writeFileAsync(filename, 'auto ' + networkInterface + '\n');
    await fs.appendFileAsync(filename, 'iface ' + networkInterface + ' inet ' + mode + '\n');
    if(mode !== 'static') {
        return;
    }
    await fs.appendFileAsync(filename, format('address %s\nnetmask %s\ngateway %s', address, netmask, gateway));
}

async function resetNetworkInterface(networkInterface, mode, address, netmask, gateway) {
    await genInterfaceFile(dataportInterfaceFilename, networkInterface, mode, address, netmask, gateway);
    await execAsync('sudo ip addr flush dev '+ networkInterface, {timeout: shellTimeout});
    await execAsync('sudo cp ' + dataportInterfaceFilename + ' /etc/network/interfaces.d/', {timeout: shellTimeout});
    await execAsync('sudo /etc/init.d/networking restart', {timeout: shellTimeout});
}


module.exports = {
    resetNetworkInterface: resetNetworkInterface,
    ResetNetworkError: ResetNetworkError
};
