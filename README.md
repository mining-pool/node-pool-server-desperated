# node-stratum

[![Build Status](https://travis-ci.org/node-standalone-pool/node-pool-server.svg?branch=master)](https://travis-ci.org/node-standalone-pool/node-pool-server)

Designed for one-algorithm bitcoin-fork pool.

High performance Stratum poolserver in Node.js. One instance of this software can startup and manage multiple coin
pools, each with their own daemon and stratum port :)

Supporting all algorithms based on the `node-hashing-algo` lib series.

## Notice

This is a module for Node.js that will do nothing on its own. Unless you're a Node.js developer who would like to
handle stratum authentication and raw share data then this module will not be of use to you. For a full featured portal

Update: I think Node.js is not a great language for open-sourcing web backend design, so I will desperate all work what I have done. 

## Features

- Daemon RPC interface
- Stratum TCP socket server
- Block template / job manager
- P2P to get block notifications as peer node
- Optimized generation transaction building
- Connecting to multiple daemons for redundancy
- Process share submissions
- Session managing for purging DDoS/flood initiated zombie workers
- Auto ban IPs that are flooding with invalid shares
- __POW__ (proof-of-work) & __POS__ (proof-of-stake) support
- Transaction messages support
- Vardiff (variable difficulty / share limiter)
- When started with a coin deamon that hasn't finished syncing to the network it shows the blockchain download progress and initializes once synced

## Requirements

- NodeJS **>= v13**
- Coin daemon (preferably one with a relatively updated API and not some crapcoin :p)

## Example Usage

### Install as a node module by cloning repository

```bash
git clone https://github.com/node-standalone-pool/node-pool-server node_modules/node-stratum
npm update
```

### Module usage

Create the configuration for your coin:

Possible options for `algorithm`: *sha256, scrypt, scrypt-jane, scrypt-n, quark, x11, keccak, blake,
skein, groestl, fugue, shavite3, hefty1, qubit, or sha1*.

```javascript
const myCoin = {
    "name": "Dogecoin",
    "symbol": "DOGE",
    "algorithm": "scrypt",
    "nValue": 1024, //optional - defaults to 1024
    "rValue": 1, //optional - defaults to 1
    "txMessages": false, //optional - defaults to false,
};
```

Create and start new pool with configuration options and authentication function

```javascript
const createPool = require('node-stratum');

const poolConfig = {
    "coin": myCoin,

    "address": "mi4iBXbBsydtcc5yFmsff2zCFVX4XG7qJc", //Address to where block rewards are given

    /* Block rewards go to the configured pool wallet address to later be paid out to miners,
       except for a percentage that can go to, for examples, pool operator(s) as pool fees or
       or to donations address. Addresses or hashed public keys can be used. Here is an example
       of rewards going to the main pool op, a pool co-owner, and NOMP donation. */
    "rewardRecipients": {
        "n37vuNFkXfk15uFnGoVyHZ6PYQxppD3QqK": 1.5, //1.5% goes to pool op
        "mirj3LtZxbSTharhtXvotqtJXUY7ki5qfx": 0.5, //0.5% goes to a pool co-owner

        /* 0.1% donation to NOMP. This pubkey can accept any type of coin, please leave this in
           your config to help support NOMP development. */
        "22851477d63a085dbc2398c8430af1c09e7343f6": 0.1
    },

    "blockRefreshInterval": 1000, //How often to poll RPC daemons for new blocks, in milliseconds


    /* Some miner apps will consider the pool dead/offline if it doesn't receive anything new jobs
       for around a minute, so every time we broadcast jobs, set a timeout to rebroadcast
       in this many seconds unless we find a new job. Set to zero or remove to disable this. */
    "jobRebroadcastTimeout": 55,

    //instanceId: 37, //Recommend not using this because a crypto-random one will be generated

    /* Some attackers will create thousands of workers that use up all available socket connections,
       usually the workers are zombies and don't submit shares after connecting. This features
       detects those and disconnects them. */
    "connectionTimeout": 600, //Remove workers that haven't been in contact for this many seconds

    /* Sometimes you want the block hashes even for shares that aren't block candidates. */
    "emitInvalidBlockHashes": false,

    /* Enable for client IP addresses to be detected when using a load balancer with TCP proxy
       protocol enabled, such as HAProxy with 'send-proxy' param:
       http://haproxy.1wt.eu/download/1.5/doc/configuration.txt */
    "tcpProxyProtocol": false,

    /* If a worker is submitting a high threshold of invalid shares we can temporarily ban their IP
       to reduce system/network load. Also useful to fight against flooding attacks. If running
       behind something like HAProxy be sure to enable 'tcpProxyProtocol', otherwise you'll end up
       banning your own IP address (and therefore all workers). */
    "banning": {
        "enabled": true,
        "time": 600, //How many seconds to ban worker for
        "invalidPercent": 50, //What percent of invalid shares triggers ban
        "checkThreshold": 500, //Check invalid percent when this many shares have been submitted
        "purgeInterval": 300 //Every this many seconds clear out the list of old bans
    },

    /* Each pool can have as many ports for your miners to connect to as you wish. Each port can
       be configured to use its own pool difficulty and variable difficulty settings. varDiff is
       optional and will only be used for the ports you configure it for. */
    "ports": {
        "3032": { //A port for your miners to connect to
            "diff": 32, //the pool difficulty for this port

            /* Variable difficulty is a feature that will automatically adjust difficulty for
               individual miners based on their hashrate in order to lower networking overhead */
            "varDiff": {
                "minDiff": 8, //Minimum difficulty
                "maxDiff": 512, //Network difficulty will be used if it is lower than this
                "targetTime": 15, //Try to get 1 share per this many seconds
                "retargetTime": 90, //Check to see if we should retarget every this many seconds
                "variancePercent": 30 //Allow time to very this % from target without retargeting
            }
        },
        "3256": { //Another port for your miners to connect to, this port does not use varDiff
            "diff": 256 //The pool difficulty
        }
    },

    /* Recommended to have at least two daemon instances running in case one drops out-of-sync
       or offline. For redundancy, all instances will be polled for block/transaction updates
       and be used for submitting blocks. Creating a backup daemon involves spawning a daemon
       using the "-datadir=/backup" argument which creates a new daemon instance with it's own
       RPC config. For more info on this see:
          - https://en.bitcoin.it/wiki/Data_directory
          - https://en.bitcoin.it/wiki/Running_bitcoind */
    "daemons": [
        {   //Main daemon instance
            "host": "127.0.0.1",
            "port": 19332,
            "user": "litecoinrpc",
            "password": "testnet"
        },
        {   //Backup daemon instance
            "host": "127.0.0.1",
            "port": 19344,
            "user": "litecoinrpc",
            "password": "testnet"
        }
    ],

    // redis's option, https://github.com/NodeRedis/node_redis#options-object-properties
    "redis": {
        "host": "127.0.0.1",
        "port": 6379,
        "password": null
    },

    "api": {
        "enabled": true,
        "host": "0.0.0.0",
        "port": 8888
        "admin": {
            "enabled": true,
            "password": "123456"
        },
        "stats": {
            "updateInterval": 60,
            "historicalRetention": 43200,
            "hashrateWindow": 300
        }
    },

    "payment": {
        "enabled": true,
        "paymentInterval": 20,
        "minimumPayment": 70,
        "daemon": {
            "host": "127.0.0.1",
            "port": 19332,
            "user": "litecoinrpc",
            "password": "testnet"
        }
    },

};

//stratum authorization function
authorizationFunction = (ip, port , workerName, password, callback) => {
    console.log("Authorize " + workerName + ":" + password + "@" + ip);
    callback({
        error: null,
        authorized: true,
        disconnect: false
    });
}

const pool = createPool(poolConfig, authorizationFunction);

pool.on('log', function(severity, logText){
    console.log("[" + severity + "]: " + message);
});

```

Start pool

```javascript
pool.start();
```

## License

Released under the GNU General Public License v2

<http://www.gnu.org/licenses/gpl-2.0.html>
