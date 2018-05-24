# Deployment 

### Disable auto upgrade of OS
The Ubuntu OS use cron-daily to do "unattended-upgrades". Once it leads to replace the nvidia driver.
Then the nvidia-docker cannot work with msg as below:
``` shell
nvidia-docker | 2018/01/11 15:09:04 Error: nvml: Driver/library version mismatch
```
So we need to disable "unattended-upgrades".

1. Edit /etc/apt/apt.conf.d/20auto-upgrades:  
change 2 properties from
```
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```
to

```
APT::Periodic::Update-Package-Lists "0";
APT::Periodic::Unattended-Upgrade "0";
```

### Enable & config syslog server
1. Edit /etc/rsyslog.conf:  
change 2 properties from
```
#module(load="imudp")
#input(type="imudp" port="514")
```
to
```
module(load="imudp")
input(type="imudp" port="514")
```
2. Create a file /etc/rsyslog.d/30-jager.conf  
It is the config to redirect specific log facility to a file.  
For example:  
```
local1.info                     /var/log/jager/jager.info
local1.debug                    /var/log/jager/jager.debug
```

Then if you just inject logging code with the setting 'local1' as facility in logging library


### For API /settings/networking

##### Set fixed IP for control port
Assume the network interface 'enp1s0' is control port, and the fixed IP is '192.168.101.1'
1. edit /etc/network/interfaces
```
auto enp1s0
ifcace enp1s0 inet static
address 192.168.101.1
netmask 255.255.255.0
```
**note**: No need to assign gateway. The control port is only connect to the SI's computer, it doesn't connet to Internet. So it should not assign gateway 


##### Add privilege for network setting 
make the user **'jager'** has previledge to execute the network setting cmds

1. edit /etc/sudoers:
``` $ sudo vim /etc/sudoers```  or ``` $ visudo ``` (more safe) 

2. add the configurations below:
``` 
Cmnd_Alias FLUSH_IP = /sbin/ip addr flush dev enp*
Cmnd_Alias IFCONFIG = /sbin/ifconfig enp* *
Cmnd_Alias DHCLIENT = /sbin/dhclient enp*

#at the end:
jager ALL=(ALL) NOPASSWD: FLUSH_IP, IFCONFIG, DHCLIENT
```

##### Disable service 'network-manager'
The service 'network-manager' on Ubuntu 16.04 will auto-config each network interfaces for conncetivity. For example, After setting static IP for a interface, when unplug the cable, the IP will be lost. Whenever plugging the cable again, network-manager will auto-config IP. It   
may be not the IP u set originally.
``` shell
$ sudo systemctl disable network-manager.service
