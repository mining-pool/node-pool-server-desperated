const events = require("events");

/**
 * Defining each client that connects to the stratum server.
 * Emits:
 *  - subscription(obj, cback(error, extraNonce1, extraNonce2Size))
 *  - submit(data(name, jobID, extraNonce2, ntime, nonce))
 **/
module.exports = class StratumClient extends events.EventEmitter {
    constructor(options) {
        super();
        this.pendingDifficulty = null;
        //private members
        this.options = options;
        this.socket = options.socket;
        this.remoteAddress = options.socket.remoteAddress;
        this.lastActivity = Date.now();
        this.shares = {valid: 0, invalid: 0};

        this.considerBan = (!this.options.banning || !this.options.banning.enabled) ? () => {
            return false;
        } : (shareValid) => {
            if (shareValid === true) this.shares.valid++;
            else this.shares.invalid++;
            const totalShares = this.shares.valid + this.shares.invalid;
            if (totalShares >= this.options.banning.checkThreshold) {
                const percentBad = (this.shares.invalid / totalShares) * 100;
                if (percentBad < this.options.banning.invalidPercent) //reset shares
                    this.shares = {valid: 0, invalid: 0};
                else {
                    this.emit("triggerBan", this.shares.invalid + " out of the last " + totalShares + " shares were invalid");
                    this.socket.destroy();
                    return true;
                }
            }
            return false;
        };
    }

    init() {
        this.setupSocket();
    }

    handleMessage(message) {
        switch (message.method) {
        case "mining.subscribe":
            this.handleSubscribe(message);
            break;
        case "mining.authorize":
            this.handleAuthorize(message, true /*reply to socket*/);
            break;
        case "mining.submit":
            this.lastActivity = Date.now();
            this.handleSubmit(message);
            break;
        case "mining.get_transactions":
            this.sendJson({
                id: null,
                result: [],
                error: true
            });
            break;
        default:
            this.emit("unknownStratumMethod", message);
            break;
        }
    }

    handleSubscribe(message) {
        if (!this.authorized) {
            this.requestedSubscriptionBeforeAuth = true;
        }
        this.emit("subscription", {}, (error, extraNonce1, extraNonce2Size) => {
            if (error) {
                this.sendJson({
                    id: message.id,
                    result: null,
                    error: error
                });
                return;
            }
            this.extraNonce1 = extraNonce1;
            this.sendJson({
                id: message.id,
                result: [
                    [
                        ["mining.set_difficulty", this.options.subscriptionId],
                        ["mining.notify", this.options.subscriptionId]
                    ],
                    extraNonce1,
                    extraNonce2Size
                ],
                error: null
            });
        });
    }

    handleAuthorize(message, replyToSocket) {
        this.workerName = message.params[0];
        this.workerPass = message.params[1];
        this.options.authorizeFn(this.remoteAddress, this.options.socket.localPort, this.workerName, this.workerPass, (result) => {
            this.authorized = (!result.error && result.authorized);

            if (replyToSocket) {
                this.sendJson({
                    id: message.id,
                    result: this.authorized,
                    error: result.error
                });
            }

            // If the authorizer wants us to close the socket lets do it.
            if (result.disconnect === true) {
                this.options.socket.destroy();
            }
        });
    }

    handleSubmit(message) {
        if (!this.authorized) {
            this.sendJson({
                id: message.id,
                result: null,
                error: [24, "unauthorized worker", null]
            });
            this.considerBan(false);
            return;
        }
        if (!this.extraNonce1) {
            this.sendJson({
                id: message.id,
                result: null,
                error: [25, "not subscribed", null]
            });
            this.considerBan(false);
            return;
        }
        this.emit("submit",
            {
                name: message.params[0],
                jobId: message.params[1],
                extraNonce2: message.params[2],
                nTime: message.params[3],
                nonce: message.params[4]
            },
            (error, result) => {
                if (!this.considerBan(result)) {
                    this.sendJson({
                        id: message.id,
                        result: result,
                        error: error
                    });
                }
            }
        );

    }

    sendJson(...args) {
        let response = "";
        for (let i = 0; i < args.length; i++) {
            response += JSON.stringify(args[i]) + "\n";
        }
        this.options.socket.write(response);
    }

    setupSocket() {
        const socket = this.options.socket;
        let dataBuffer = "";
        socket.setEncoding("utf8");

        if (this.options.tcpProxyProtocol === true) {
            socket.once("data", (d) => {
                if (d.indexOf("PROXY") === 0) {
                    this.remoteAddress = d.split(" ")[2];
                } else {
                    this.emit("tcpProxyError", d);
                }
                this.emit("checkBan");
            });
        } else {
            this.emit("checkBan");
        }

        socket.on("data", (d) => {
            dataBuffer += d;
            if (Buffer.byteLength(dataBuffer, "utf8") > 10240) { //10KB
                dataBuffer = "";
                this.emit("socketFlooded");
                socket.destroy();
                return;
            }
            
            if (dataBuffer.indexOf("\n") !== -1) {
                const messages = dataBuffer.split("\n");
                const incomplete = dataBuffer.slice(-1) === "\n" ? "" : messages.pop();
                messages.forEach((message) => {
                    if (message === "") return;
                    let messageJson;
                    try {
                        messageJson = JSON.parse(message);
                    } catch (e) {
                        if (this.options.tcpProxyProtocol !== true || d.indexOf("PROXY") !== 0) {
                            this.emit("malformedMessage", message);
                            socket.destroy();
                        }
                        return;
                    }

                    if (messageJson) {
                        this.handleMessage(messageJson);
                    }
                });
                dataBuffer = incomplete;
            }
        });

        socket.on("close", () => {
            this.emit("socketDisconnect");
        });

        socket.on("error", (err) => {
            if (err.code !== "ECONNRESET") {
                this.emit("socketError", err);
            }
        });

    }

    getLabel(){
        return (this.workerName || "(unauthorized)") + " [" + this.remoteAddress + "]";
    }

    enqueueNextDifficulty(requestedNewDifficulty) {
        this.pendingDifficulty = requestedNewDifficulty;
        return true;
    }

    sendDifficulty(difficulty) {
        if (difficulty === this.difficulty)
            return false;

        this.previousDifficulty = this.difficulty;
        this.difficulty = difficulty;
        this.sendJson({
            id: null,
            method: "mining.set_difficulty",
            params: [difficulty] //[512],
        });
        return true;
    }

    sendMiningJob(jobParams) {

        const lastActivityAgo = Date.now() - this.lastActivity;
        if (lastActivityAgo > this.options.connectionTimeout * 1000) {
            this.socket.destroy();
            return;
        }

        if (this.pendingDifficulty !== null) {
            const result = this.sendDifficulty(this.pendingDifficulty);
            this.pendingDifficulty = null;
            if (result) {
                this.emit("difficultyChanged", this.difficulty);
            }
        }

        this.sendJson({
            id: null,
            method: "mining.notify",
            params: jobParams
        });

    }

    manuallyAuthClient(username, password) {
        this.handleAuthorize({id: 1, params: [username, password]}, false /*do not reply to miner*/);
    }

    manuallySetValues(otherClient) {
        this.extraNonce1 = otherClient.extraNonce1;
        this.previousDifficulty = otherClient.previousDifficulty;
        this.difficulty = otherClient.difficulty;
    }
};
