const net = require("net");
const events = require("events");
const tls = require("tls");
const StratumClient = require("./stratumClient");
const utils = require("./utils");


class SubscriptionCounter {
    constructor() {
        this.count = 0;
        this.padding = "deadbeefcafebabe";
    }

    next() {
        this.count++;
        if (Number.MAX_VALUE === this.count) this.count = 0;
        return this.padding + utils.packUInt64LE(this.count).toString("hex");
    }
}

/**
 * The actual stratum server.
 * It emits the following Events:
 *   - 'client.connected'(StratumClientInstance) - when a new miner connects
 *   - 'client.disconnected'(StratumClientInstance) - when a miner disconnects. Be aware that the socket cannot be used anymore.
 *   - 'started' - when the server is up and running
 **/
module.exports = class StratumServer extends events.EventEmitter {
    constructor(options, authorizeFn) {
        super();
        this.options = options;
        this.authorizeFn = authorizeFn;
        this.bannedMS = options.banning ? options.banning.time * 1000 : null;
        this.stratumClients = {};
        this.subscriptionCounter = new SubscriptionCounter();
        this.bannedIPs = {};

        this.init();
    }

    init() {
        //Interval to look through bannedIPs for old bans and remove them in order to prevent a memory leak
        if (this.options.banning && this.options.banning.enabled) {
            setInterval(() => {
                for (let ip in this.bannedIPs) {
                    const banTime = this.bannedIPs[ip];
                    if (Date.now() - banTime > this.options.banning.time) {
                        delete this.bannedIPs[ip];
                    }
                }
            }, 1000 * this.options.banning.purgeInterval);
        }


        // SetupBroadcasting();

        let serversStarted = 0;
        for (let port in this.options.ports) {
            if (this.options.ports[port].tls != true || this.options.ports[port].tls != "true") {
                net.createServer({allowHalfOpen: false}, (socket) => {
                    this.handleNewClient(socket);
                }).listen(parseInt(port), () => {
                    serversStarted++;
                    if (serversStarted === Object.keys(this.options.ports).length)
                        this.emit("started");
                });
            } else {
                tls.createServer(this.TLSOptions, (socket) => {
                    this.handleNewClient(socket);
                }).listen(parseInt(port), () => {
                    serversStarted++;
                    if (serversStarted === Object.keys(this.options.ports).length)
                        this.emit("started");
                });
            }
        }
    }

    checkBan(client) {
        if (this.options.banning && this.options.banning.enabled && client.remoteAddress in this.bannedIPs) {
            const bannedTime = this.bannedIPs[client.remoteAddress];
            const bannedTimeAgo = Date.now() - bannedTime;
            const timeLeft = this.bannedMS - bannedTimeAgo;
            if (timeLeft > 0){
                client.socket.destroy();
                client.emit("kickedBannedIP", timeLeft / 1000 | 0);
            }
            else {
                delete this.bannedIPs[client.remoteAddress];
                client.emit("forgaveBannedIP");
            }
        }
    }

    handleNewClient(socket) {
        socket.setKeepAlive(true);
        const subscriptionId = this.subscriptionCounter.next();
        const client = new StratumClient(
            {
                subscriptionId: subscriptionId,
                authorizeFn: this.authorizeFn,
                socket: socket,
                banning: this.options.banning,
                connectionTimeout: this.options.connectionTimeout,
                tcpProxyProtocol: this.options.tcpProxyProtocol
            }
        );

        this.stratumClients[subscriptionId] = client;
        this.emit("client.connected", client);
        client.on("socketDisconnect", () => {
            this.removeStratumClientBySubId(subscriptionId);
            this.emit("client.disconnected", client);
        }).on("checkBan", () => {
            this.checkBan(client);
        }).on("triggerBan", () => {
            this.addBannedIP(client.remoteAddress);
        }).init();

        return subscriptionId;
    }

    broadcastMiningJobs(jobParams) {
        for (const clientId in this.stratumClients) {
            const client = this.stratumClients[clientId];
            client.sendMiningJob(jobParams);
        }
        /* Some miners will consider the pool dead if it doesn't receive a job for around a minute.
           So every time we broadcast jobs, set a timeout to rebroadcast in X seconds unless cleared. */
        clearTimeout(this.rebroadcastTimeout);
        this.rebroadcastTimeout = setTimeout(() => {
            this.emit("broadcastTimeout");
        }, this.options.jobRebroadcastTimeout * 1000);
    }

    addBannedIP(ipAddress) {
        this.bannedIPs[ipAddress] = Date.now();
    }

    removeStratumClientBySubId(subscriptionId) {
        delete this.stratumClients[subscriptionId];
    }

    getStratumClients() {
        return this.stratumClients;
    }

    manuallyAddStratumClient(clientObj) {
        const subId = this.handleNewClient(clientObj.socket);
        if (subId != null) { // not banned!
            this.stratumClients[subId].manuallyAuthClient(clientObj.workerName, clientObj.workerPass);
            this.stratumClients[subId].manuallySetValues(clientObj);
        }
    }
};

