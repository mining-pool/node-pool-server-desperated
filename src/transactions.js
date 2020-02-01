const utils = require("./utils");

/*
This function creates the generation transaction that accepts the reward for
successfully mining a new block.
For some (probably outdated and incorrect) documentation about whats kinda going on here,
see: https://en.bitcoin.it/wiki/Protocol_specification#tx
 */

const generateOutputTransactions = (poolRecipient, recipients, rpcData) => {
    let payeeScript;
    let payeeReward = 0;
    let reward = rpcData.coinbasevalue;
    let rewardToPool = reward;

    const txOutputBuffers = [];


    /* Dash 12.1 */
    if (rpcData.masternode && rpcData.superblock) {
        if (rpcData.masternode.payee) {

            payeeReward = rpcData.masternode.amount;
            reward -= payeeReward;
            rewardToPool -= payeeReward;

            payeeScript = utils.addressToScript(rpcData.masternode.payee);
            txOutputBuffers.push(Buffer.concat([
                utils.packUInt64LE(payeeReward),
                utils.varIntBuffer(payeeScript.length),
                payeeScript
            ]));
        } else if (rpcData.superblock.length > 0) {
            for (const i in rpcData.superblock) {
                payeeReward = 0;

                payeeReward = rpcData.superblock[i].amount;
                reward -= payeeReward;
                rewardToPool -= payeeReward;

                payeeScript = utils.addressToScript(rpcData.superblock[i].payee);
                txOutputBuffers.push(Buffer.concat([
                    utils.packUInt64LE(payeeReward),
                    utils.varIntBuffer(payeeScript.length),
                    payeeScript
                ]));
            }
        }
    }

    if (rpcData.payee) {
        payeeReward = 0;

        if (rpcData.payee_amount) {
            payeeReward = rpcData.payee_amount;
        } else {
            payeeReward = Math.ceil(reward / 5);
        }

        reward -= payeeReward;
        rewardToPool -= payeeReward;

        payeeScript = utils.addressToScript(rpcData.payee);
        txOutputBuffers.push(Buffer.concat([
            utils.packUInt64LE(payeeReward),
            utils.varIntBuffer(payeeScript.length),
            payeeScript
        ]));
    }


    for (let i = 0; i < recipients.length; i++) {
        const recipientReward = Math.floor(recipients[i].percent * reward);
        rewardToPool -= recipientReward;

        txOutputBuffers.push(Buffer.concat([
            utils.packUInt64LE(recipientReward),
            utils.varIntBuffer(recipients[i].script.length),
            recipients[i].script
        ]));
    }


    txOutputBuffers.unshift(Buffer.concat([
        utils.packUInt64LE(rewardToPool),
        utils.varIntBuffer(poolRecipient.length),
        poolRecipient
    ]));

    if (rpcData.default_witness_commitment !== undefined) {
        let witness_commitment = Buffer.from(rpcData.default_witness_commitment, "hex");
        txOutputBuffers.unshift(Buffer.concat([
            utils.packUInt64LE(0),
            utils.varIntBuffer(witness_commitment.length),
            witness_commitment
        ]));
    }

    return Buffer.concat([
        utils.varIntBuffer(txOutputBuffers.length),
        Buffer.concat(txOutputBuffers)
    ]);
};


const createGeneration = (rpcData, publicKey, extraNoncePlaceholder, reward, txMessages, recipients) => {
    const txInputsCount = 1;
    // const txOutputsCount = 1;
    const txVersion = txMessages === true ? 2 : 1;
    const txLockTime = 0;

    const txInPrevOutHash = "";
    const txInPrevOutIndex = Math.pow(2, 32) - 1;
    const txInSequence = 0;

    //Only required for POS coins
    const txTimestamp = reward === "POS" ?
        utils.packUInt32LE(rpcData.curtime) : Buffer.from([]);

    //For coins that support/require transaction comments
    const txComment = txMessages === true ?
        utils.serializeString("https://github.com/node-standalone-pool/node-pool-server") :
        Buffer.from([]);


    const scriptSigPart1 = Buffer.concat([
        utils.serializeNumber(rpcData.height),
        Buffer.from(rpcData.coinbaseaux.flags, "hex"),
        utils.serializeNumber(Date.now() / 1000 | 0),
        Buffer.from([extraNoncePlaceholder.length])
    ]);

    const scriptSigPart2 = utils.serializeString("/nodeStratum/");

    const p1 = Buffer.concat([
        utils.packUInt32LE(txVersion),
        txTimestamp,

        //transaction input
        utils.varIntBuffer(txInputsCount),
        utils.uint256BufferFromHash(txInPrevOutHash),
        utils.packUInt32LE(txInPrevOutIndex),
        utils.varIntBuffer(scriptSigPart1.length + extraNoncePlaceholder.length + scriptSigPart2.length),
        scriptSigPart1
    ]);


    /*
    The generation transaction must be split at the extranonce (which located in the transaction input
    scriptSig). Miners send us unique extranonces that we use to join the two parts in attempt to create
    a valid share and/or block.
     */


    const outputTransactions = generateOutputTransactions(publicKey, recipients, rpcData);

    const p2 = Buffer.concat([
        scriptSigPart2,
        utils.packUInt32LE(txInSequence),
        //end transaction input

        //transaction output
        outputTransactions,
        //end transaction ouput

        utils.packUInt32LE(txLockTime),
        txComment
    ]);

    return [p1, p2];
};

module.exports = {createGeneration};
