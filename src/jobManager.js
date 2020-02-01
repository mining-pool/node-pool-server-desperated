const events = require("events");
const crypto = require("crypto");
const BN = require("bn.js");

const utils = require("./utils");
const BlockTemplate = require("./blockTemplate");
const Algorithm = require("./algorithm");

//Unique extranonce per subscriber
class ExtraNonce1Generator {
    static getExtraNonce1() {
        let size = ExtraNonce1Generator.getSize();
        let extraNonce = crypto.randomBytes(size);
        return extraNonce.toString("hex");
    }

    static getSize() {
        return 2;
    }
}


//Unique job per new block template
class JobCounter {
    constructor() {
        this.counter;
    }

    next() {
        this.counter = new BN(crypto.randomBytes(8).toString("hex"), "hex");
        return this.cur();
    }

    cur() {
        return this.counter.toString(16);
    }
}

/**
 * Emits:
 * - newBlock(blockTemplate) - When a new block (previously unknown to the JobManager) is added, use this event to broadcast new jobs
 * - share(shareData, blockHex) - When a worker submits a share. It will have blockHex if a block was found
**/

module.exports = class JobManager extends events.EventEmitter {
    constructor(options) {
        super();
        this.options = options;
        this.jobCounter = new JobCounter();

        this.shareMultiplier = Algorithm.multiplier();

        //public members

        this.ExtraNonce1Generator = new ExtraNonce1Generator(options.instanceId);
        this.extraNoncePlaceholder = Buffer.from("f000000ff111111f", "hex");
        this.extraNonce2Size = this.extraNoncePlaceholder.length - ExtraNonce1Generator.getSize();

        this.currentJob = undefined;
        this.validJobs = {};

        this.hashDigest = Algorithm.hash;

        this.coinbaseHasher = utils.sha256d;
    }

    hashBlock(block) {
        return utils.reverseBuffer(this.hashDigest(block));
    }

    updateCurrentJob(rpcData) {
        const tmpBlockTemplate = new BlockTemplate(
            this.jobCounter.next(),
            rpcData,
            this.options.poolAddressScript,
            this.extraNoncePlaceholder,
            this.options.coin.reward,
            this.options.coin.txMessages,
            this.options.recipients
        );

        this.currentJob = tmpBlockTemplate;

        this.emit("updatedBlock", tmpBlockTemplate, true);

        this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;

    }

    processTemplate(rpcData) {
        /* 
        Block is new if A) its the first block we have seen so far or B) the blockhash is different and the
        block height is greater than the one we have 
        */

        let isNewBlock = typeof (this.currentJob) == "undefined";
        if (!isNewBlock && this.currentJob.rpcData.previousblockhash !== rpcData.previousblockhash) {
            isNewBlock = true;

            //If new block is outdated/out-of-sync than return
            if (rpcData.height < this.currentJob.rpcData.height)
                return false;
        }

        if (!isNewBlock) return false;

        const tmpBlockTemplate = new BlockTemplate(
            this.jobCounter.next(),
            rpcData,
            this.options.poolAddressScript,
            this.extraNoncePlaceholder,
            this.options.coin.reward,
            this.options.coin.txMessages,
            this.options.recipients
        );

        this.currentJob = tmpBlockTemplate;

        this.validJobs = {};
        this.emit("newBlock", tmpBlockTemplate);

        this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;

        return true;
    }



    processShare(jobId, previousDifficulty, difficulty, extraNonce1, extraNonce2, nTime, nonce, ipAddress, port, workerName) {
        const submitTime = Date.now() / 1000 | 0;

        if (extraNonce2.length / 2 !== this.extraNonce2Size) {
            let error = [20, "incorrect size of extranonce2"];

            this.emit("share", {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                error: error[1]
            });
            return { error: error, result: null };
        }

        const job = this.validJobs[jobId];
        if (typeof job === "undefined" || job.jobId != jobId) {
            let error = [21, "job not found"];

            this.emit("share", {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                error: error[1]
            });

            return { error: error, result: null };
        }

        if (nTime.length !== 8) {
            let error = [20, "incorrect size of ntime"];
            
            this.emit("share", {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                error: error[1]
            });
            
            return { error: error, result: null };
        }

        const nTimeInt = parseInt(nTime, 16);
        if (nTimeInt < job.rpcData.curtime || nTimeInt > submitTime + 7200) {
            let error = [20, "ntime out of range"];
            
            this.emit("share", {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                error: error[1]
            });
            
            return { error: error, result: null };
        }

        if (nonce.length != 8) {
            let error = [20, "incorrect size of nonce"];
            
            this.emit("share", {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                error: error[1]
            });
            
            return { error: error, result: null };
        }

        if (!job.registerSubmit(extraNonce1, extraNonce2, nTime, nonce)) {
            let error  = [22, "duplicate share"];
            
            this.emit("share", {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                error: error[1]
            });
            
            return { error: error, result: null };
        }


        const extraNonce1Buffer = Buffer.from(extraNonce1, "hex");
        const extraNonce2Buffer = Buffer.from(extraNonce2, "hex");

        const coinbaseBuffer = job.serializeCoinbase(extraNonce1Buffer, extraNonce2Buffer);

        const coinbaseHash = this.coinbaseHasher(coinbaseBuffer);
        const merkleRoot = utils.reverseBuffer(job.merkleTree.withFirst(coinbaseHash)).toString("hex");
        const headerBuffer = job.serializeHeader(merkleRoot, nTime, nonce);
        const headerHash = this.hashDigest(headerBuffer, nTimeInt);
        const headerBigNum = new BN(headerHash, 32, "le");

        const shareDiff = Algorithm.diff1() / headerBigNum * this.shareMultiplier;
        const blockDiffAdjusted = job.difficulty * this.shareMultiplier;

        //Check if share is a block candidate (matched network difficulty)
        if (job.target.gte(headerBigNum)) {
            let blockHex = job.serializeBlock(headerBuffer, coinbaseBuffer).toString("hex");
            let blockHash = this.blockHasher(headerBuffer, nTime).toString("hex");

            this.emit("share", {
                job: jobId,
                ip: ipAddress,
                port: port,
                worker: workerName,
                height: job.rpcData.height,
                blockReward: job.rpcData.coinbasevalue,
                difficulty: difficulty,
                shareDiff: shareDiff.toFixed(8),
                blockDiff: blockDiffAdjusted,
                blockDiffActual: job.difficulty,
                blockHash: blockHash,
            }, blockHex);

            return { result: true, error: null, blockHash: blockHash };
        } else {
            //Check if share didn't reached the miner's difficulty)
            if (shareDiff / difficulty < 0.99) {

                //Check if share matched a previous difficulty from before a vardiff retarget
                if (previousDifficulty && shareDiff >= previousDifficulty) {
                    difficulty = previousDifficulty;

                    this.emit("share", {
                        job: jobId,
                        ip: ipAddress,
                        port: port,
                        worker: workerName,
                        height: job.rpcData.height,
                        blockReward: job.rpcData.coinbasevalue,
                        difficulty: difficulty,
                        shareDiff: shareDiff.toFixed(8),
                        blockDiff: blockDiffAdjusted,
                        blockDiffActual: job.difficulty,
                    }, null);

                    return { result: true, error: null, blockHash: null };
                } else {
                    let error = [23, "low difficulty share of " + shareDiff];
                            
                    this.emit("share", {
                        job: jobId,
                        ip: ipAddress,
                        worker: workerName,
                        difficulty: difficulty,
                        error: error[1]
                    });
                    
                    return { error: error, result: false };
                }

            } else {
                return { result: true, error: null, blockHash: null };
            }
        }
    }
};
