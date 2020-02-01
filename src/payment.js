const fs = require("fs");

const redis = require("async-redis");

const DaemonManager = require("./daemonManager");
const utils = require("./utils");


module.exports = class Payment {
    constructor(options) {
        this.coin = options.coin.name;
        this.daemon = new DaemonManager([options.payment.daemon]);
        this.redisClient = redis.createClient(options.redis.port, options.redis.host, options.redis);

        this.magnitude;
        this.minPaymentSatoshis;
        this.coinPrecision;

        this.paymentInterval;
    }

    async init() {
        let isSetup = await this.SetupForPool();
        if (isSetup) {
            this.paymentInterval = setInterval(() => {
                this.processPayments();
            }, this.options.payment.paymentInterval * 1000);
        }
        setTimeout(this.processPayments, 100);
    }

    // return whether pool setuped correctly
    async SetupForPool() {
        let validateaddressResult = await this.daemon.cmd("validateaddress", [this.options.address]);

        if (validateaddressResult.error) {
            throw new Error("Error with payment processing daemon " + JSON.stringify(validateaddressResult.error));
        } else if (!validateaddressResult.response || !validateaddressResult.response.ismine) {
            let result = await this.daemon.cmd("getaddressinfo", [this.options.address]);
        
            if (result.error) {
                throw new Error("Error with payment processing daemon, getaddressinfo failed ... " + JSON.stringify(result.error));
            } else if (!result.response || !result.response.ismine) {
                throw new Error("Daemon does not own pool address - payment processing can not be done with this daemon, " + JSON.stringify(result.response));
            }
        }

        let getbalanceResult = await this.daemon.cmd("getbalance", []);

        if (getbalanceResult.error) {
            throw new Error(getbalanceResult.error);
        }

        try {
            let d = getbalanceResult.data.split("result\":")[1].split(",")[0].split(".")[1];
            this.magnitude = parseInt("10" + new Array(d.length).join("0"));
            this.minPaymentSatoshis = parseInt(this.options.payment.minimumPayment * this.magnitude);
            this.coinPrecision = this.magnitude.toString().length - 1;
        } catch (e) {
            throw new Error("Error detecting number of satoshis in a coin, cannot do payment processing. Tried parsing: " + getbalanceResult.data);
        }

        return;
        /* Deal with numbers in smallest possible units (satoshis) as much as possible. This greatly helps with accuracy
           when rounding and whatnot. When we are storing numbers for only humans to see, store in whole coin units. */

    }

    satoshisToCoins(satoshis) {
        return parseFloat((satoshis / this.magnitude).toFixed(this.coinPrecision));
    }

    coinsToSatoshies(coins) {
        return coins * this.magnitude;
    }

    getProperAddress(address) {
        if (address.length === 40) {
            return utils.addressFromEx(this.options.address, address);
        } else return address;
    }

    
    /* 0. Call redis to get an array of rounds - which are coinbase transactions and block heights from submitted
               blocks. */ 
    async fetchWorkersTxs() {
        let error, results = await this.redisClient.multi([
            ["hgetall", this.coin + ":balances"],
            ["smembers", this.coin + ":blocksPending"]
        ]).exec();

        if (error) {
            return Error("Could not get blocks from redis " + JSON.stringify(error));
        }

        let workers = {};
        for (let w in results[0]) {
            workers[w] = {
                balance: this.coinsToSatoshies(parseFloat(results[0][w]))
            };
        }

        let rounds = results[1].map(function (r) {
            let details = r.split(":");
            return {
                blockHash: details[0],
                txHash: details[1],
                height: details[2],
                serialized: r
            };
        });

        return workers, rounds;
    }

    /* 1. Does a batch rpc call to daemon with all the transaction hashes to see if they are confirmed yet.
               It also adds the block reward amount to the round object - which the daemon gives also gives us. */
    async checkTx(workers, rounds) {

        let batchRPCcommand = rounds.map(function (r) {
            return ["gettransaction", [r.txHash]];
        });

        batchRPCcommand.push(["getaccount", [this.options.address]]);

        this.daemon.batchCmd(batchRPCcommand, function (error, txDetails) {
            if (error || !txDetails) {
                return Error("Check finished - daemon rpc error with batch gettransactions " + JSON.stringify(error));
            }

            let addressAccount;

            txDetails.forEach(function (tx, i) {

                if (i === txDetails.length - 1) {
                    addressAccount = tx.result;
                    return;
                }

                let round = rounds[i];

                if (tx.error && tx.error.code === -5) {
                    console.warning("Daemon reports invalid transaction: " + round.txHash);
                    round.category = "kicked";
                    return;
                } else if (!tx.result.details || (tx.result.details && tx.result.details.length === 0)) {
                    console.warning("Daemon reports no details for transaction: " + round.txHash);
                    round.category = "kicked";
                    return;
                } else if (tx.error || !tx.result) {
                    throw new Error("Odd error with gettransaction " + round.txHash + " " +
                        JSON.stringify(tx));
                }

                let generationTx = tx.result.details.filter(function (tx) {
                    return tx.address === this.options.address;
                })[0];


                if (!generationTx && tx.result.details.length === 1) {
                    generationTx = tx.result.details[0];
                }

                if (!generationTx) {
                    throw new Error("Missing output details to pool address for transaction " + round.txHash);
                }

                round.category = generationTx.category;
                if (round.category === "generate") {
                    round.reward = generationTx.amount || generationTx.value;
                }

            });

            let canDeleteShares = function (r) {
                for (let i = 0; i < rounds.length; i++) {
                    let compareR = rounds[i];
                    if ((compareR.height === r.height) &&
                        (compareR.category !== "kicked") &&
                        (compareR.category !== "orphan") &&
                        (compareR.serialized !== r.serialized)) {
                        return false;
                    }
                }
                return true;
            };


            //Filter out all rounds that are immature (not confirmed or orphaned yet)
            rounds = rounds.filter(function (r) {
                switch (r.category) {
                case "orphan":
                case "kicked":
                    r.canDeleteShares = canDeleteShares(r);
                    break;
                case "generate":
                    return true;

                default:
                    return false;
                }
            });


            return workers, rounds, addressAccount;

        });
    }
    
    /* Does a batch redis call to get shares contributed to each round. Then calculates the reward
               amount owned to each miner for each round. */
    async distributeRewards(workers, rounds, addressAccount) {

        let shareLookups = rounds.map(function (r) {
            return ["hgetall", this.coin + ":shares:round" + r.height];
        });

        let error, allWorkerShares =  await this.redisClient.multi(shareLookups).exec();

        if (error) {
            throw new Error("Check finished - redis error with multi get rounds share");
        }

        rounds.forEach(function (round, i) {
            let workerShares = allWorkerShares[i];

            if (!workerShares) {
                throw new Error("No worker shares for round: " +
                    round.height + " blockHash: " + round.blockHash);
            }

            switch (round.category) {
            case "kicked":
            case "orphan":
                round.workerShares = workerShares;
                break;

            case "generate":
                /* We found a confirmed block! Now get the reward for it and calculate how much
                                       we owe each miner based on the shares they submitted during that block round. */
                {
                    let reward = parseInt(round.reward * this.magnitude);

                    let totalShares = Object.keys(workerShares).reduce(function (p, c) {
                        return p + parseFloat(workerShares[c]);
                    }, 0);

                    for (let workerAddress in workerShares) {
                        let percent = parseFloat(workerShares[workerAddress]) / totalShares;
                        let workerRewardTotal = Math.floor(reward * percent);
                        let worker = workers[workerAddress] = (workers[workerAddress] || {});
                        worker.reward = (worker.reward || 0) + workerRewardTotal;
                    }
                }
                break;
            }
        });

        return workers, rounds, addressAccount;
    }

    async trySending(workers, rounds, addressAccount) {
        async function trySend(withholdPercent) {
            let addressAmounts = {};
            let totalSent = 0;
            
            for (let w in workers) {
                let worker = workers[w];
                worker.balance = worker.balance || 0;
                worker.reward = worker.reward || 0;
                let toSend = (worker.balance + worker.reward) * (1 - withholdPercent);
                if (toSend >= this.minPaymentSatoshis) {
                    totalSent += toSend;
                    let address = worker.address = (worker.address || this.getProperAddress(w));
                    worker.sent = addressAmounts[address] = this.satoshisToCoins(toSend);
                    worker.balanceChange = Math.min(worker.balance, toSend) * -1;
                } else {
                    worker.balanceChange = Math.max(toSend - worker.balance, 0);
                    worker.sent = 0;
                }
            }
    
            if (Object.keys(addressAmounts).length === 0) {
                return (null, workers, rounds);
            }
    
            let result = await this.daemon.cmd("sendmany", [addressAccount || "", addressAmounts]);
            return result, totalSent, addressAmounts;
        }


        let withholdPercent = 0;
        let result, totalSent, addressAmounts = await trySend(withholdPercent);

        //Check if payments failed because wallet doesn't have enough coins to pay for tx fees
        if (result.error && result.error.code === -6) {
            let higherPercent = withholdPercent + 0.01;
            console.warning("Not enough funds to cover the tx fees for sending out payments"
             + ", decreasing rewards by " + (higherPercent * 100) + "% and retrying");
            result, totalSent, addressAmounts = await trySend(higherPercent); //should not decrease it
        } else if (result.error) {
            return Error("Error trying to send payments with RPC sendmany " + JSON.stringify(result.error));
        } else {
            console.debug("Sent out a total of " + (totalSent / this.magnitude) + " to " + Object.keys(addressAmounts).length + " workers");
            if (withholdPercent > 0) {
                console.warning("Had to withhold " + (withholdPercent * 100) + "% of reward from miners to cover transaction fees. Fund pool wallet with coins to prevent this from happening");
            }
            return workers, rounds;
        }
    }

    /* Calculate if any payments are ready to be sent and trigger them sending
             Get balance different for each address and pass it along as object of latest balances such as
             {worker1: balance1, worker2, balance2}
             when deciding the sent balance, it the difference should be -1*amount they had in db,
             if not sending the balance, the differnce should be +(the amount they earned this round)
             */
    async ensurePayments(workers, rounds) {
        let totalPaid = 0;

        let balanceUpdateCommands = [];
        let workerPayoutsCommand = [];

        for (let w in workers) {
            let worker = workers[w];
            if (worker.balanceChange !== 0) {
                balanceUpdateCommands.push([ "hincrbyfloat", this.coin + ":balances", w, this.satoshisToCoins(worker.balanceChange)]);
            }
            if (worker.sent !== 0) {
                workerPayoutsCommand.push(["hincrbyfloat", this.coin + ":payouts", w, worker.sent]);
                totalPaid += worker.sent;
            }
        }

        let movePendingCommands = [];
        let roundsToDelete = [];
        let orphanMergeCommands = [];

        let moveSharesToCurrent = function (r) {
            let workerShares = r.workerShares;
            Object.keys(workerShares).forEach(function (worker) {
                orphanMergeCommands.push(["hincrby", this.coin + ":shares:roundCurrent",
                    worker, workerShares[worker]
                ]);
            });
        };

        rounds.forEach(function (r) {
            switch (r.category) {
            case "kicked":
                movePendingCommands.push(["smove", this.coin + ":blocksPending", this.coin + ":blocksKicked", r.serialized]);
                break;
            case "orphan":
                movePendingCommands.push(["smove", this.coin + ":blocksPending", this.coin + ":blocksOrphaned", r.serialized]);
                if (r.canDeleteShares) {
                    moveSharesToCurrent(r);
                    roundsToDelete.push(this.coin + ":shares:round" + r.height);
                }
                return;
            case "generate":
                movePendingCommands.push(["smove", this.coin + ":blocksPending", this.coin + ":blocksConfirmed", r.serialized]);
                roundsToDelete.push(this.coin + ":shares:round" + r.height);
                return;
            }

        });

        let finalRedisCommands = [];

        if (movePendingCommands.length > 0)
            finalRedisCommands = finalRedisCommands.concat(movePendingCommands);

        if (orphanMergeCommands.length > 0)
            finalRedisCommands = finalRedisCommands.concat(orphanMergeCommands);

        if (balanceUpdateCommands.length > 0)
            finalRedisCommands = finalRedisCommands.concat(balanceUpdateCommands);

        if (workerPayoutsCommand.length > 0)
            finalRedisCommands = finalRedisCommands.concat(workerPayoutsCommand);

        if (roundsToDelete.length > 0)
            finalRedisCommands.push(["del"].concat(roundsToDelete));

        if (totalPaid !== 0)
            finalRedisCommands.push(["hincrbyfloat", this.coin + ":stats", "totalPaid", totalPaid]);

        if (finalRedisCommands.length === 0) {
            return;
        }

        this.redisClient.multi(finalRedisCommands).exec(function (error) {
            if (error) {
                clearInterval(this.paymentInterval);
                console.error("Payments sent but could not update redis. " + JSON.stringify(error) +
                            " Disabling payment processing to prevent possible double-payouts. The redis commands in " +
                            this.coin + "_finalRedisCommands.txt must be ran manually");
                fs.writeFile(this.coin + "_finalRedisCommands.txt", JSON.stringify(finalRedisCommands), function (err) {
                    console.error("Could not write finalRedisCommands.txt: ", err);
                });
            }

            return;
        });
    }


    async processPayments() {
        const startPaymentProcess = Date.now();
        let workers, rounds, addressAccount;
        workers, rounds = await this.fetchWorkersTxs();
        workers, rounds, addressAccount = await this.checkTx(workers, rounds);
        workers, rounds = await this.trySending(workers, rounds, addressAccount);
        await this.ensurePayments(workers, rounds);
        const paymentProcessTime = Date.now() - startPaymentProcess;
        console.debug("Finished interval - " + paymentProcessTime);

    }
};