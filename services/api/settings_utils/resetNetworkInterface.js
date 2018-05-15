const P = require('bluebird');
const TimeoutError = P.TimeoutError;
const fs = P.promisifyAll(require('fs'));
const shell = require('shelljs');
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
    else {
        await fs.appendFileAsync(filename, format('address %s\nnetmask %s\ngateway %s', address, netmask, gateway));
        return;
    }
}

function execAsync(cmd) {
    return new P((resolve, reject) => {
        let run = shell.exec(cmd, {async: true},
            (code) => {
                if(code !== 0) {
                    throw new ResetNetworkError('Shell cmd failed: "'+ cmd + '"');
                }
                return resolve(code);
            });
    })
    .timeout(shellTimeout)
    .catch((e) => {
        if (e instanceof TimeoutError) {
            throw new ResetNetworkError('Shell cmd timeout: "'+ cmd + '"');
        }
        // TODO: logging
        console.error(e);
    });
}

async function resetNetworkInterface(networkInterface, mode, address, netmask, gateway) {
    await genInterfaceFile(dataportInterfaceFilename, networkInterface, mode, address, netmask, gateway);
    await execAsync('sudo ip addr flush dev '+ networkInterface);
    await execAsync('sudo cp ' + dataportInterfaceFilename + ' /etc/network/interfaces.d/');
    await execAsync('sudo /etc/init.d/networking restart');
}


module.exports = {
    resetNetworkInterface: resetNetworkInterface,
    ResetNetworkError: ResetNetworkError
};

//genInterfaceFile(dataportInterfaceFilename, 'enp5s0', 'dhcp')
//genInterfaceFile(dataportInterfaceFilename, 'enp5s0', 'static', '192.168.1.1', '255.255.255.0', '192.168.1.1')
//    resetNetworkInterface('enp5s0', 'static', '192.168.1.1', '255.255.255.0', '192.168.1.1')
//.catch((e)=>{console.log('llllllllllllll', e)})
//resetNetworkInterface('enp5s0', 'static', '192.168.1.111', '255.255.255.0', '192.168.1.1')

