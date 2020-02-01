const events = require("events");
const async = require("async");

const vardiff = require("./varDiff");
const DaemonManager = require("./daemonManager");
const StratumServer = require("./stratumServer");
const JobManager = require("./jobManager");
const utils = require("./utils");
const Algorithm = require("./algorithm");


module.exports = class Pool extends events.EventEmitter {
    constructor(options, authorizeFn) {
        super();
        this.options = options;
        this.authorizeFn = authorizeFn;
    }

    async StartInDefault() {
        await this.SetupVarDiff();
        await this.SetupApi();
        await this.SetupDaemonManager();
        await this.DetectCoinData();
        await this.SetupRecipients();
        await this.SetupJobManager();
        await this.EnsureBlockchainSynced();
        await this.GetFirstJob();
        await this.SetupBlockPolling();
        await this.StartStratumServer();
        await this.stratumServer.emit("started");
        await this.OutputPoolInfo();
    }

    async GetFirstJob() {
        try {
            await this.GetBlockTemplate();
        }catch {
            throw new Error("Error with getblocktemplate on creating first job, server cannot start");
        }

        let portWarnings = [];

        let networkDiffAdjusted = this.options.initStats.difficulty;

        Object.keys(this.options.ports).forEach((port) => {
            let portDiff = this.options.ports[port].diff;
            if (networkDiffAdjusted < portDiff)
                portWarnings.push("port " + port + " w/ diff " + portDiff);
        });

        //Only let the first fork show synced status or the log wil look flooded with it
        if (portWarnings.length > 0 && (!process.env.forkId || process.env.forkId === "0")) {
            let warnMessage = "Network diff of " + networkDiffAdjusted + " is lower than "
                    + portWarnings.join(" and ");
            console.warn(warnMessage);
        }
    }

    OutputPoolInfo() {
        let startMessage = "Stratum Pool Server Started for " + this.options.coin.name +
            " [" + this.options.coin.symbol.toUpperCase() + "] ";
        if (process.env.forkId && process.env.forkId !== "0") {
            console.log(startMessage);
            return;
        }
        let infoLines = [startMessage,
            "Network Connected:\t" + (this.options.testnet ? "Testnet" : "Mainnet"),
            "Detected Reward Type:\t" + this.options.coin.reward,
            "Current Block Height:\t" + this.jobManager.currentJob.rpcData.height,
            "Current Connect Peers:\t" + this.options.initStats.connections,
            "Current Block Diff:\t" + this.jobManager.currentJob.difficulty * Algorithm.multiplier(),
            "Network Difficulty:\t" + this.options.initStats.difficulty,
            "Network Hash Rate:\t" + utils.getReadableHashRateString(this.options.initStats.networkHashRate),
            "Stratum Port(s):\t" + this.options.initStats.stratumPorts.join(", "),
            "Pool Fee Percent:\t" + this.options.feePercent + "%"
        ];

        if (typeof this.options.blockRefreshInterval === "number" && this.options.blockRefreshInterval > 0)
            infoLines.push("Block polling every:\t" + this.options.blockRefreshInterval + " ms");

        console.log(infoLines.join("\n\t"));
    }

    // return isSynced: bool
    async checkSynced() {
        let results = await this.daemonManager.cmd("getblocktemplate", [{ "capabilities": ["coinbasetxn", "workid", "coinbase/append"], "rules": ["segwit"] }]);
        let isSynced = results.every(function (r) {
            return !r.error || r.error.code !== -10;
        });
        return isSynced;
    }

    async generateProgress() {
        const cmd = this.options.coin.hasGetInfo ? "getinfo" : "getblockchaininfo";
        let results = await this.daemonManager.cmd(cmd, []);

        const blockCount = results.sort((a, b) => {
            return b.response.blocks - a.response.blocks;
        })[0].response.blocks;

        //get list of peers and their highest block height to compare to ours
        results = await this.daemonManager.cmd("getpeerinfo", []);
        let peers = results[0].response;
        let totalBlocks = peers.sort((a, b) => { return b.startingheight - a.startingheight; })[0].startingheight;
        let percent = (blockCount / totalBlocks * 100).toFixed(2);
        console.warn("Downloaded " + percent + "% of blockchain from " + peers.length + " peers");
    }

    async EnsureBlockchainSynced() {
        const timeout = function (ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        };

        let isSynced = await this.checkSynced();
        while (!isSynced) {
            //Only let the first fork show synced status or the log wil look flooded with it
            if (!process.env.forkId || process.env.forkId === "0") {
                this.generateProgress();
                console.error("Daemon is still syncing with network (download blockchain) - server will be started once synced");
            }

            await timeout(5000);
            isSynced = await this.checkSynced();
        }
    }

    async SetupApi() {
        if (typeof (this.options.api) === "object" && typeof (this.options.api.start) === "function") {
            this.options.api.start(this); //??
        }
    }

    async SetupVarDiff() {
        this.varDiff = {};
        Object.keys(this.options.ports).forEach((port) => {
            if (this.options.ports[port].varDiff)
                this.setVarDiff(port, this.options.ports[port].varDiff);
        });
        return;
    }


    /*
     Coin daemons either use submitblock or getblocktemplate for submitting new blocks
     */
    async SubmitBlock(blockHex) {
        let rpcCommand, rpcArgs;
        if (this.options.hasSubmitMethod) {
            rpcCommand = "submitblock";
            rpcArgs = [blockHex];
        } else {
            rpcCommand = "getblocktemplate";
            rpcArgs = [{ "mode": "submit", "data": blockHex }];
        }

        let results = await this.daemonManager.cmd(rpcCommand, rpcArgs);

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.error) {
                throw new Error("rpc error with daemon instance " +
                    result.instance.index + " when submitting block with " + rpcCommand + " " +
                    JSON.stringify(result.error));
            } else if (result.response === "rejected") {
                throw new Error("Daemon instance " + result.instance.index + " rejected a supposedly valid block");
            }

            console.log("Daemon instance " + result.instance.index + ": " + JSON.stringify(result));
        }

        console.log("Submitted Block using " + rpcCommand + " successfully to daemon instance(s)");
        return;
    }

    SetupRecipients() {
        const recipients = [];
        this.options.feePercent = 0;
        this.options.rewardRecipients = this.options.rewardRecipients || {};
        for (const r in this.options.rewardRecipients) {
            const percent = this.options.rewardRecipients[r];
            const rObj = {
                percent: percent / 100,
                script: undefined
            };
            try {
                if (r.length === 40)
                    rObj.script = utils.miningKeyToScript(r);
                else
                    rObj.script = utils.addressToScript(r);
                recipients.push(rObj);
                this.options.feePercent += percent;
            }
            catch (e) {
                console.error("Error generating transaction output script for " + r + " in rewardRecipients");
            }
        }
        if (recipients.length === 0) {
            console.error("No rewardRecipients have been setup which means no fees will be taken");
        }
        this.options.recipients = recipients;
    }

    SetupJobManager() {
        this.jobManager = new JobManager(this.options);

        this.jobManager.on("newBlock", (blockTemplate) => {
            // Check if stratumServer has been initialized yet
            if (this.stratumServer) {
                this.stratumServer.broadcastMiningJobs(blockTemplate.getJobParams());
            }
        }).on("updatedBlock", (blockTemplate) => {
            // Check if stratumServer has been initialized yet
            if (this.stratumServer) {
                const job = blockTemplate.getJobParams();
                job[8] = false;
                this.stratumServer.broadcastMiningJobs(job);
            }
        }).on("share", async (shareData, blockHex) => {
            let isValidShare = !shareData.error;
            let isValidBlock = !!blockHex;
            /* If we calculated that the block solution was found,
               before we emit the share, lets submit the block,
               then check if it was accepted using RPC getblock
             */
            if (!isValidBlock)
                this.emit("share", isValidShare, isValidBlock, shareData);
            else {
                this.SubmitBlock(blockHex);
                console.log("blockHex" + blockHex);
                
                let {isAccepted, tx} = this.CheckBlockAccepted(shareData.blockHash);
                
                isValidBlock = isAccepted;
                if (isAccepted) {
                    console.log("Accepted");
                }
                shareData.txHash = tx;
                this.emit("share", isValidShare, isValidBlock, shareData);

                let {error, result, foundNewBlock} = await this.GetBlockTemplate();

                if (error) {
                    console.error(error);
                }
                
                if (foundNewBlock) {
                    console.log("Found new Block: " + JSON.stringify(result));
                }                
            }
        });
    }

    async SetupDaemonManager() {
        if (!Array.isArray(this.options.daemons) || this.options.daemons.length < 1) {
            console.error("No daemons have been configured - pool cannot start");
            return;
        }

        this.daemonManager = new DaemonManager(this.options.daemons);

        this.daemonManager
            .once("online", () => {
                return;
            })
            .on("connectionFailed", (error) => {
                console.error("Failed to connect daemon(s): " + JSON.stringify(error));
            })
            .on("error", (message) => {
                console.error(message);
            });

        this.daemonManager.init();
    }

    async DetectCoinData() {
        const batchRpcCalls = [
            ["validateaddress", [this.options.address]],
            ["getdifficulty", []],
            ["getmininginfo", []],
            ["submitblock", []],
            ["getblockchaininfo", []],
            ["getnetworkinfo", []],
            ["getwalletinfo", []],
        ];

        if (this.options.coin.hasGetInfo) {
            batchRpcCalls.push(["getinfo", []]);
        } else {
            batchRpcCalls.push(["getblockchaininfo", []], ["getnetworkinfo", []]);
        }
        let {error, results} = await this.daemonManager.batchCmd(batchRpcCalls);

        if (error || !results) {
            throw new Error("Could not start pool, error with init batch RPC call: " + JSON.stringify(error));
        }

        const rpcResults = {
            "validateaddress": undefined,
            "rpcCall": undefined,
            "getdifficulty": undefined,
            "getinfo": undefined,
            "getmininginfo": undefined,
            "getblockchaininfo": undefined,
            "getnetworkinfo": undefined,
            "getwalletinfo": undefined,
            "submitblock": undefined,
        };

        for (let i = 0; i < results.length; i++) {
            const rpcCall = batchRpcCalls[i][0];
            const r = results[i];
            rpcResults[rpcCall] = r.result || r.error;

            if (rpcCall !== "submitblock" && (r.error || !r.result)) {
                console.error();
                throw new Error("Could not start pool, error with init RPC " + rpcCall + " - " + JSON.stringify(r.error));
            }
        }

        if (!rpcResults.validateaddress.isvalid) {
            throw new Error("Daemon reports address is not valid");
        }

        if (!this.options.coin.reward) {
            if (isNaN(rpcResults.getdifficulty) && "proof-of-stake" in rpcResults.getdifficulty)
                this.options.coin.reward = "POS";
            else
                this.options.coin.reward = "POW";
        }

        /* POS coins must use the pubkey in coinbase transaction, and pubkey is
           only given if address is owned by wallet.*/
        if (this.options.coin.reward === "POS" && typeof (rpcResults.validateaddress.pubkey) == "undefined") {
            console.error("The address provided is not from the daemon wallet - this is required for POS coins.");
            return;
        }

        this.options.poolAddressScript = (() => {
            switch (this.options.coin.reward) {
            case "POS":
                return utils.pubkeyToScript(rpcResults.validateaddress.pubkey);
            case "POW":
                return utils.addressToScript(rpcResults.validateaddress.address);
            }
        })();

        this.options.testnet = this.options.coin.hasGetInfo ? rpcResults.getinfo.testnet : (rpcResults.getblockchaininfo.chain === "test");

        this.options.protocolVersion = this.options.coin.hasGetInfo ? rpcResults.getinfo.protocolversion : rpcResults.getnetworkinfo.protocolversion;

        let difficulty = this.options.coin.hasGetInfo ? rpcResults.getinfo.difficulty : rpcResults.getblockchaininfo.difficulty;
        if (typeof (difficulty) == "object") {
            difficulty = difficulty["proof-of-work"];
        }
        this.options.initStats = {
            connections: (this.options.coin.hasGetInfo ? rpcResults.getinfo.connections : rpcResults.getnetworkinfo.connections),
            difficulty: difficulty * Algorithm.multiplier(),
            networkHashRate: rpcResults.getmininginfo.networkhashps
        };


        if (rpcResults.submitblock.message === "Method not found") {
            this.options.hasSubmitMethod = false;
        }
        else if (rpcResults.submitblock.code === -1) {
            this.options.hasSubmitMethod = true;
        }
        else {
            throw new Error("Could not detect block submission RPC method, " + JSON.stringify(results));
        }

        return;
    }

    async StartStratumServer() {
        this.stratumServer = new StratumServer(this.options, this.authorizeFn);

        this.stratumServer.on("started", () => {
            this.options.initStats.stratumPorts = Object.keys(this.options.ports);
            this.stratumServer.broadcastMiningJobs(this.jobManager.currentJob.getJobParams());
        }).on("broadcastTimeout", () => {
            console.log("No new blocks for " + this.options.jobRebroadcastTimeout + " seconds - updating transactions & rebroadcasting work");

            this.GetBlockTemplate((error, rpcData, processedBlock) => {
                if (error || processedBlock) return;
                this.jobManager.updateCurrentJob(rpcData);
            });

        }).on("client.connected", (client) => {
            if (typeof (this.varDiff[client.socket.localPort]) !== "undefined") {
                this.varDiff[client.socket.localPort].manageClient(client);
            }

            client.on("difficultyChanged", (diff) => {
                this.emit("difficultyUpdate", client.workerName, diff);

            }).on("subscription", (params, resultCallback) => {
                const extraNonce = this.jobManager.ExtraNonce1Generator.getExtraNonce1();
                const extraNonce2Size = this.jobManager.extraNonce2Size;
                resultCallback(null,
                    extraNonce,
                    extraNonce2Size
                );

                if (typeof (this.options.ports[client.socket.localPort]) !== "undefined" && this.options.ports[client.socket.localPort].diff) {
                    client.sendDifficulty(this.options.ports[client.socket.localPort].diff);
                } else {
                    client.sendDifficulty(8);
                }

                client.sendMiningJob(this.jobManager.currentJob.getJobParams());

            }).on("submit", (params, resultCallback) => {
                const result = this.jobManager.processShare(
                    params.jobId,
                    client.previousDifficulty,
                    client.difficulty,
                    client.extraNonce1,
                    params.extraNonce2,
                    params.nTime,
                    params.nonce,
                    client.remoteAddress,
                    client.socket.localPort,
                    params.name
                );

                resultCallback(result.error, !!result.result);

            }).on("malformedMessage", (message) => {
                console.warn("Malformed message from " + client.getLabel() + ": " + message);

            }).on("socketError", (err) => {
                console.warn("Socket error from " + client.getLabel() + ": " + JSON.stringify(err));

            }).on("socketTimeout", (reason) => {
                console.warn("Connected timed out for " + client.getLabel() + ": " + reason);

            }).on("socketDisconnect", () => {
                console.log("Socket disconnected from " + client.getLabel());
            }).on("kickedBannedIP", (remainingBanTime) => {
                console.log("Rejected incoming connection from " + client.remoteAddress + " banned for " + remainingBanTime + " more seconds");
            }).on("forgaveBannedIP", () => {
                console.log("Forgave banned IP " + client.remoteAddress);
            }).on("unknownStratumMethod", (fullMessage) => {
                console.log("Unknown stratum method from " + client.getLabel() + ": " + fullMessage.method);
            }).on("socketFlooded", () => {
                console.warn("Detected socket flooding from " + client.getLabel());
            }).on("tcpProxyError", (data) => {
                console.error("Client IP detection failed, tcpProxyProtocol is enabled yet did not receive proxy protocol message, instead got data: " + data);
            }).on("triggerBan", (reason) => {
                console.warn("Banned triggered for " + client.getLabel() + ": " + reason);
                this.emit("banIP", client.remoteAddress, client.workerName);
            });
        });
    }

    SetupBlockPolling() {
        if (typeof this.options.blockRefreshInterval !== "number" || this.options.blockRefreshInterval <= 0) {
            console.log("Block template polling has been disabled");
            return;
        }

        const pollingInterval = this.options.blockRefreshInterval;

        this.blockPollingIntervalId = setInterval(() => {
            this.GetBlockTemplate((error, result, foundNewBlock) => {
                if (error) {
                    console.error(error);
                }
                if (foundNewBlock) {
                    console.log("Block notification via RPC polling");
                }
            });
        }, pollingInterval);
    }

    async GetBlockTemplate() {
        let results = await this.daemonManager.cmd("getblocktemplate", 
            [{"capabilities": ["coinbasetxn", "workid", "coinbase/append"], "rules": ["segwit"] }]);
        let result = results[0];
        if (result.error) {
            throw new Error("getblocktemplate call failed for daemon instance " +
                result.instance.index + " with error " + JSON.stringify(result.error));
        } else {
            const processedNewBlock = this.jobManager.processTemplate(result.response);
            return {result: result.response, foundNewBlock: processedNewBlock};
        }
    }

    async CheckBlockAccepted(blockHash) {
        let results = await this.daemonManager.cmd("getblock", [blockHash]);
        const validResults = results.filter((result) => {
            return result.response && (result.response.hash === blockHash);
        });

        if (validResults.length >= 1) {
            return {isAccepted: true, tx: validResults[0].response.tx[0]};
        } else {
            return {isAccepted: false, tx: null};
        }
    }


    /**
     * This method is being called from the blockNotify so that when a new block is discovered by the daemon
     * We can inform our miners about the newly found block
     **/
    processBlockNotify(blockHash, sourceTrigger) {
        console.log("Block notification via " + sourceTrigger);
        if (typeof (this.jobManager.currentJob) !== "undefined" && blockHash !== this.jobManager.currentJob.rpcData.previousblockhash) {
            this.GetBlockTemplate((error) => {
                if (error)
                    console.error("Block notify error getting block template for " + this.options.coin.name);
            });
        }
    }


    relinquishMiners(filterFn, resultCback) {
        const origStratumClients = this.stratumServer.getStratumClients();
        const stratumClients = [];
        Object.keys(origStratumClients).forEach((subId) => {
            stratumClients.push({ subId: subId, client: origStratumClients[subId] });
        });

        async.filter(
            stratumClients,
            filterFn,
            (clientsToRelinquish) => {
                clientsToRelinquish.forEach((cObj) => {
                    cObj.client.removeAllListeners();
                    this.stratumServer.removeStratumClientBySubId(cObj.subId);
                });
                process.nextTick(() => {
                    resultCback(
                        clientsToRelinquish.map((item) => {
                            return item.client;
                        })
                    );
                });
            }
        );

    }


    attachMiners(miners) {
        miners.forEach((clientObj) => {
            this.stratumServer.manuallyAddStratumClient(clientObj);
        });
        this.stratumServer.broadcastMiningJobs(this.jobManager.currentJob.getJobParams());
    }


    getStratumServer() {
        return this.stratumServer;
    }


    setVarDiff(port, varDiffConfig) {
        if (typeof (this.varDiff[port]) != "undefined") {
            this.varDiff[port].removeAllListeners();
        }
        this.varDiff[port] = new vardiff(port, varDiffConfig);
        this.varDiff[port].on("newDifficulty", (client, newDiff) => {

            /* We request to set the newDiff @ the next difficulty retarget
             (which should happen when a new job comes in - AKA BLOCK) */
            client.enqueueNextDifficulty(newDiff);
        });
    }
};
