const assert = require("assert");
const util = require("../lib/util");
const jobManager = require("../lib/jobManager");
const crypto = require("crypto")
const blockTemplate = require("../lib/blockTemplate")
const algos = require("../lib/algoProperties")
const bignum = require('bignum');
const merkleTree = require("../lib/merkleTree")

describe("jobManager", function() {
    it("ExtraNonceCounter", function() {
        var ExtraNonceCounter = function(configInstanceId){

            var instanceId = configInstanceId || crypto.randomBytes(4).readUInt32LE(0);
            var counter = instanceId << 27;
        
            this.next = function(){
                var extraNonce = util.packUInt32BE(Math.abs(counter++));
                return extraNonce.toString('hex');
            };
        
            this.size = 4; //bytes
        };
        const enc = new ExtraNonceCounter(null)
        
        console.log(enc.next().toString("hex"))
    });
});

const options = {
    "coin": {
      "name": "Litecoin",
      "symbol": "LTC",
      "algorithm": "scrypt"
    },
  
    "address": "QPxrDq3sorCk8DWaYX2GeCkxoePhm1asyY",
    "rewardRecipients": {},
  
    "blockRefreshInterval": 1000,
    "jobRebroadcastTimeout": 55,
  
    "connectionTimeout": 600,
  
    "emitInvalidBlockHashes": false,
    "tcpProxyProtocol": false,
    "banning": {
      "enabled": true,
      "time": 600,
      "invalidPercent": 50,
      "checkThreshold": 500,
      "purgeInterval": 300
    },
  
    "ports": {
      "3032": {
        "diff": 15,
        "varDiff": {
          "minDiff": 1,
          "maxDiff": 100000,
          "targetTime": 15,
          "retargetTime": 90,
          "variancePercent": 30
        }
      }
    },
  
    "daemons": [{
      "host": "127.0.0.1",
      "port": 19332,
      "user": "litecoinrpc",
      "password": "testnet"
    }]
  }

const rpcData = {
    "version": 536870912,
    "bits": "1d0ffff0",
    "curtime": 1582121794,
    "height": 1379222,
    "rules": [
      "csv",
      "segwit"
    ],
    "previousblockhash": "c89e7dc13413003e98aa8b6a4fb69771b2d70c61a2f41a9b6d301f4a554de277",
    "previousbits": "",
    "sigoplimit": 80000,
    "sizelimit": 4000000,
    "weightlimit": 4000000,
    "transactions": [
      {
        "data": "01000000000101899522d55c2fdf575cfb549f15f6c7c34e43e98b17300ae34edc63f8272311410100000000ffffffff020000000000000000136a0c0701007ac01b000140000000530345d471abcc1e0b000000001600148d5ce2c127c03ad8d1f9fc9bbe3fad1023bb2aa202473044022029ba3fbd618616a48ff211450008d0ced9654ffdd3f46640e51535322cef122c022017db76be63a080580144cebdefceee4032d4c481f2961a8dc67f23f2d0ccfc70012103df64a645452a26c559adeff4825e6ab5a4935a0627b4b13b5f5d716e818906a700000000",
        "hash": "d12deb5951b796a3c478ae446598f5591b3ee571188980eba4c8bb3276260c0d",
        "depends": [],
        "fee": 3450,
        "sigops": 1,
        "txid": "78c1505e1312bdc723e4a86aad3e2e798cd6761d0a589b87de248b33f2c5773f"
      },
      {
        "data": "0100000000010112d8e244e6daa7b4d04d1724318b335d63291e60a80bda9760f76b79462c37470000000000ffffffff020000000000000000146a0d07080003a67427265646564640530345d4716db4eb0b000000001600142aeb9224a6491f75aa3a8fdaa60b17cae735b8ce0247304402207ed0d9b0e044f5cc3d68129931c8cb8e8ec1f941d4f820d1595b75b384e753bf022024fade5ed065e8e6916c2fe9e8a5e585c6ce9d9b7a831406250f9ac11a7a1b660121028d20c4336c742ef18bd958b2db1289e93f7f158d1d0e462b958fe2f3e2018ac100000000",
        "hash": "ef7f84c048d8cb4f55bc824264199a0e752aba47d54c897e46f2a240ffa58386",
        "depends": [],
        "fee": 3475,
        "sigops": 1,
        "txid": "03bef03f26f28fe5bd2b5ef89d3dc1fe498da2b215b1570e924810079dc7fd42"
      },
      {
        "data": "010000000001015af7409fdc3f99f8b5ec2638a16f4f249d0dc2dd13b42fe5ced9b4af8bb6620a0100000000ffffffff020000000000000000136a0c0701000c4001000080000000530345d47139b3810b00000000160014de9d9a2c541fce2c54d7bf7e88bb038071a329ad0247304402201a668bf396d01b29055fa7e1d996643a6df5da74a9b0000674f44bfea8c7bdbd022006615dfd0ac4dcd3036948e672107f8241f257e4ba4b6ca2f7bf5e2227eea442012102d788d048abf4325a4ac018f5b369aa8ea9b252cb9239dd6abc5270673041a7b100000000",
        "hash": "ec2857e3e6874ceed835e7b6949d98e383a929c9bff5951ab3c8a9d0067a0a4c",
        "depends": [],
        "fee": 3450,
        "sigops": 1,
        "txid": "18133eb939f15814826de97ace1cff26de7d0378666989c59c00beb0c9cb4151"
      },
      {
        "data": "0100000000010134d0cbd4f023d9aaa5aab78b81fd1ed17ea2ac512e9b462936a4eaaa3ae5f0de0100000000ffffffff030000000000000000226a1b0701027ac001000083001000003000b0003000f0000c001c000000530345d471a0252600000000001976a914b66c71c784d8804ec8591011f3d78f3e1e23c2f288ac61f49e0b00000000160014bb471c71724b39beadf55fc1b334b75f45aa8b4c0247304402200dd0adaa9949c4e0fd269d1472b556145eec542f914ede27fffe87586c2eb9c90220542797fac36d7e1b041837d85e688396f0e7b9ae2283fe1c60f9486e0a8e693801210317993020134466e9db343f04f56f3c53c65e7984565ddaf1e0ebe4cde521861000000000",
        "hash": "a0127b166709395c3c0fdf919c4563d9f2d8fdb7a81367c63932cc8088b4760a",
        "depends": [],
        "fee": 4675,
        "sigops": 5,
        "txid": "3b94cc39ddb80b052f7135b09c791c34fdcc726ade24ed9d0d7369167ef1a66d"
      },
      {
        "data": "010000000001013f77c5f2338b24de879b580a1d76d68c792e3ead6aa8e423c7bd12135e50c1780100000000ffffffff020000000000000000136a0c0701007ac0010000c0000000530345d47131bf1e0b000000001600148d5ce2c127c03ad8d1f9fc9bbe3fad1023bb2aa2024730440220359e9d5d96dadf5bddf276ab5f0d5d5ceed433b57039dc5d1f572568b465a7ec022011c1379815a50a58e73cfd69ec590540f31342b1cbac1f533e0900bd670df1d7012103df64a645452a26c559adeff4825e6ab5a4935a0627b4b13b5f5d716e818906a700000000",
        "hash": "864359eeabe597f57dbfb65975fde5b6ecbd191baddc2f29d5d738728583c840",
        "depends": [
          1
        ],
        "fee": 3450,
        "sigops": 1,
        "txid": "d4bda2d38acd3815a45636f4d06db1acc0ec9b713226b131989f057b9bd8a988"
      },
      {
        "data": "010000000001015141cbc9b0be009cc589696678037dde26ff1cce7ae96d821458f139b93e13180100000000ffffffff020000000000000000136a0c0701000c4001000040000000530345d471bfa5810b00000000160014de9d9a2c541fce2c54d7bf7e88bb038071a329ad0247304402201569f50e32a337e06214398756d4517612e757e82f185d8c28f891b07a9fa3480220770e8e2ee2c25022eb6289e9504fca132040e207369a45c30c5e2a3fa4d7e137012102d788d048abf4325a4ac018f5b369aa8ea9b252cb9239dd6abc5270673041a7b100000000",
        "hash": "799c4a377661d3d2cdd2f5ab225413fa54e0cc58a3028fe7cab7bc8ce4626abd",
        "depends": [
          3
        ],
        "fee": 3450,
        "sigops": 1,
        "txid": "2c5f761385fe6c79901b39a8ef09af38c544214805ac3f6eebb07dcffc122abb"
      },
      {
        "data": "0100000000010188a9d89b7b059f9831b12632719becc0acb16dd0f43656a41538cd8ad3a2bdd40100000000ffffffff020000000000000000136a0c0701007ac001800080000000530345d471b7b11e0b000000001600148d5ce2c127c03ad8d1f9fc9bbe3fad1023bb2aa2024730440220322d0a9466f5b1af4ecf9c549748b0377825433589c55f16fcde8c34d825e804022009f60c98c18425495d7acd081dc2b81649d5ca4821f17d52ffe16e0f5db76b26012103df64a645452a26c559adeff4825e6ab5a4935a0627b4b13b5f5d716e818906a700000000",
        "hash": "b53eb9b0af014e1903d4689d1a7d6cc6d07eeb3ef027956dfb862fbd9ba4020f",
        "depends": [
          5
        ],
        "fee": 3450,
        "sigops": 1,
        "txid": "85fbc84d63b76346fbac28c005cba5bbe5153e6851d0432963d3651f4559e5dd"
      }
    ],
    "coinbaseaux": {
      "flags": ""
    },
    "coinbasevalue": 2500025400,
    "capabilities": [
      "proposal"
    ],
    "vbavailable": {},
    "vbrequired": 0,
    "default_witness_commitment": "6a24aa21a9eda9cde9bc89d87cf1d26a817c8f9a6b9075d6a86046bf19b8fdff0bdee22419c9",
    "longpollid": "c89e7dc13413003e98aa8b6a4fb69771b2d70c61a2f41a9b6d301f4a554de2777740",
    "target": "0000000ffff00000000000000000000000000000000000000000000000000000",
    "mintime": 1582120972,
    "mutable": [
      "time",
      "transactions",
      "prevblock"
    ],
    "noncerange": "00000000ffffffff",
    "masternode": null,
    "masternode_payments_started": false,
    "masternode_payments_enforced": false,
    "superblock": null,
    "superblocks_started": false,
    "superblocks_enabled": false,
    "coinbase_payload": "",
    "Votes": null,
    "MasternodePayments": null,
    "Payee": null,
    "PayeeAmount": null
  }
  
describe("jobManager", function() {
    it("jobManager", function() {

        var tmpBlockTemplate = new blockTemplate(
            "111",
            rpcData,
            util.addressToScript(options.address),
            new Buffer('f000000ff111111f', 'hex'),
            options.coin.reward,
            options.coin.txMessages,
            []
        );


        var submitTime = Date.now() / 1000 | 0;

        var job = tmpBlockTemplate

        const nTime = "5e4d4342";
        const nonce = "4e9c3700";
        const extraNonce1 = Buffer([103, 42, 104, 220]).toString("hex")
        const extraNonce2 = "08000000"
        // const difficulty = 


        if (nTime.length !== 8) {
            console.log([20, 'incorrect size of ntime']);
        }

        var nTimeInt = parseInt(nTime, 16);
        if (nTimeInt < job.rpcData.curtime || nTimeInt > submitTime + 7200) {
            console.log([20, 'ntime out of range']);
        }

        if (nonce.length !== 8) {
            console.log([20, 'incorrect size of nonce']);
        }

        if (!job.registerSubmit(extraNonce1, extraNonce2, nTime, nonce)) {
            console.log([22, 'duplicate share']);
        }


        var extraNonce1Buffer = new Buffer(extraNonce1, 'hex');
        var extraNonce2Buffer = new Buffer(extraNonce2, 'hex');

        var coinbaseBuffer = job.serializeCoinbase(extraNonce1Buffer, extraNonce2Buffer);
        var coinbaseHash = util.sha256d(coinbaseBuffer);
        console.log("coinbaseBuffer: " + coinbaseBuffer.toString("hex"))
        console.log("coinbaseHash: " + coinbaseHash.toString("hex"))
        console.log("job.merkleTree: " + job.merkleTree.steps)
        var merkleRoot = util.reverseBuffer(job.merkleTree.withFirst(coinbaseHash)).toString('hex');

        var headerBuffer = job.serializeHeader(merkleRoot, nTime, nonce);

        var hashDigest = algos[options.coin.algorithm].hash(options.coin);
        var headerHash = hashDigest(headerBuffer, nTimeInt);
        var headerBigNum = bignum.fromBuffer(headerHash, {endian: 'little', size: 32});

        var blockHashInvalid;
        var blockHash;
        var blockHex;

        var diff1 = 0x00000000ffff0000000000000000000000000000000000000000000000000000;
        var shareMultiplier = algos[options.coin.algorithm].multiplier;
        // var shareDiff = diff1 / headerBigNum.toNumber() * shareMultiplier;

        // var blockDiffAdjusted = job.difficulty * shareMultiplier;

        //Check if share is a block candidate (matched network difficulty)
            blockHex = job.serializeBlock(headerBuffer, coinbaseBuffer).toString('hex');
            // if (options.coin.algorithm === 'blake' || options.coin.algorithm === 'neoscrypt') {                
            //     blockHash = util.reverseBuffer(util.sha256d(headerBuffer, nTime)).toString('hex');
            // }
            // else {
            // 	blockHash = blockHasher(headerBuffer, nTime).toString('hex');
            // }

            console.log(blockHex)


    });
});

describe("jobManager", function() {
    it("JobMerkleTree", function() {
        const txs = 
        [
              {
                "data": "01000000000101899522d55c2fdf575cfb549f15f6c7c34e43e98b17300ae34edc63f8272311410100000000ffffffff020000000000000000136a0c0701007ac01b000140000000530345d471abcc1e0b000000001600148d5ce2c127c03ad8d1f9fc9bbe3fad1023bb2aa202473044022029ba3fbd618616a48ff211450008d0ced9654ffdd3f46640e51535322cef122c022017db76be63a080580144cebdefceee4032d4c481f2961a8dc67f23f2d0ccfc70012103df64a645452a26c559adeff4825e6ab5a4935a0627b4b13b5f5d716e818906a700000000",
                "hash": "d12deb5951b796a3c478ae446598f5591b3ee571188980eba4c8bb3276260c0d",
                "depends": [],
                "fee": 3450,
                "sigops": 1,
                "txid": "78c1505e1312bdc723e4a86aad3e2e798cd6761d0a589b87de248b33f2c5773f"
              },
              {
                "data": "0100000000010112d8e244e6daa7b4d04d1724318b335d63291e60a80bda9760f76b79462c37470000000000ffffffff020000000000000000146a0d07080003a67427265646564640530345d4716db4eb0b000000001600142aeb9224a6491f75aa3a8fdaa60b17cae735b8ce0247304402207ed0d9b0e044f5cc3d68129931c8cb8e8ec1f941d4f820d1595b75b384e753bf022024fade5ed065e8e6916c2fe9e8a5e585c6ce9d9b7a831406250f9ac11a7a1b660121028d20c4336c742ef18bd958b2db1289e93f7f158d1d0e462b958fe2f3e2018ac100000000",
                "hash": "ef7f84c048d8cb4f55bc824264199a0e752aba47d54c897e46f2a240ffa58386",
                "depends": [],
                "fee": 3475,
                "sigops": 1,
                "txid": "03bef03f26f28fe5bd2b5ef89d3dc1fe498da2b215b1570e924810079dc7fd42"
              },
              {
                "data": "010000000001015af7409fdc3f99f8b5ec2638a16f4f249d0dc2dd13b42fe5ced9b4af8bb6620a0100000000ffffffff020000000000000000136a0c0701000c4001000080000000530345d47139b3810b00000000160014de9d9a2c541fce2c54d7bf7e88bb038071a329ad0247304402201a668bf396d01b29055fa7e1d996643a6df5da74a9b0000674f44bfea8c7bdbd022006615dfd0ac4dcd3036948e672107f8241f257e4ba4b6ca2f7bf5e2227eea442012102d788d048abf4325a4ac018f5b369aa8ea9b252cb9239dd6abc5270673041a7b100000000",
                "hash": "ec2857e3e6874ceed835e7b6949d98e383a929c9bff5951ab3c8a9d0067a0a4c",
                "depends": [],
                "fee": 3450,
                "sigops": 1,
                "txid": "18133eb939f15814826de97ace1cff26de7d0378666989c59c00beb0c9cb4151"
              },
              {
                "data": "0100000000010134d0cbd4f023d9aaa5aab78b81fd1ed17ea2ac512e9b462936a4eaaa3ae5f0de0100000000ffffffff030000000000000000226a1b0701027ac001000083001000003000b0003000f0000c001c000000530345d471a0252600000000001976a914b66c71c784d8804ec8591011f3d78f3e1e23c2f288ac61f49e0b00000000160014bb471c71724b39beadf55fc1b334b75f45aa8b4c0247304402200dd0adaa9949c4e0fd269d1472b556145eec542f914ede27fffe87586c2eb9c90220542797fac36d7e1b041837d85e688396f0e7b9ae2283fe1c60f9486e0a8e693801210317993020134466e9db343f04f56f3c53c65e7984565ddaf1e0ebe4cde521861000000000",
                "hash": "a0127b166709395c3c0fdf919c4563d9f2d8fdb7a81367c63932cc8088b4760a",
                "depends": [],
                "fee": 4675,
                "sigops": 5,
                "txid": "3b94cc39ddb80b052f7135b09c791c34fdcc726ade24ed9d0d7369167ef1a66d"
              },
              {
                "data": "010000000001013f77c5f2338b24de879b580a1d76d68c792e3ead6aa8e423c7bd12135e50c1780100000000ffffffff020000000000000000136a0c0701007ac0010000c0000000530345d47131bf1e0b000000001600148d5ce2c127c03ad8d1f9fc9bbe3fad1023bb2aa2024730440220359e9d5d96dadf5bddf276ab5f0d5d5ceed433b57039dc5d1f572568b465a7ec022011c1379815a50a58e73cfd69ec590540f31342b1cbac1f533e0900bd670df1d7012103df64a645452a26c559adeff4825e6ab5a4935a0627b4b13b5f5d716e818906a700000000",
                "hash": "864359eeabe597f57dbfb65975fde5b6ecbd191baddc2f29d5d738728583c840",
                "depends": [
                  1
                ],
                "fee": 3450,
                "sigops": 1,
                "txid": "d4bda2d38acd3815a45636f4d06db1acc0ec9b713226b131989f057b9bd8a988"
              },
              {
                "data": "010000000001015141cbc9b0be009cc589696678037dde26ff1cce7ae96d821458f139b93e13180100000000ffffffff020000000000000000136a0c0701000c4001000040000000530345d471bfa5810b00000000160014de9d9a2c541fce2c54d7bf7e88bb038071a329ad0247304402201569f50e32a337e06214398756d4517612e757e82f185d8c28f891b07a9fa3480220770e8e2ee2c25022eb6289e9504fca132040e207369a45c30c5e2a3fa4d7e137012102d788d048abf4325a4ac018f5b369aa8ea9b252cb9239dd6abc5270673041a7b100000000",
                "hash": "799c4a377661d3d2cdd2f5ab225413fa54e0cc58a3028fe7cab7bc8ce4626abd",
                "depends": [
                  3
                ],
                "fee": 3450,
                "sigops": 1,
                "txid": "2c5f761385fe6c79901b39a8ef09af38c544214805ac3f6eebb07dcffc122abb"
              },
              {
                "data": "0100000000010188a9d89b7b059f9831b12632719becc0acb16dd0f43656a41538cd8ad3a2bdd40100000000ffffffff020000000000000000136a0c0701007ac001800080000000530345d471b7b11e0b000000001600148d5ce2c127c03ad8d1f9fc9bbe3fad1023bb2aa2024730440220322d0a9466f5b1af4ecf9c549748b0377825433589c55f16fcde8c34d825e804022009f60c98c18425495d7acd081dc2b81649d5ca4821f17d52ffe16e0f5db76b26012103df64a645452a26c559adeff4825e6ab5a4935a0627b4b13b5f5d716e818906a700000000",
                "hash": "b53eb9b0af014e1903d4689d1a7d6cc6d07eeb3ef027956dfb862fbd9ba4020f",
                "depends": [
                  5
                ],
                "fee": 3450,
                "sigops": 1,
                "txid": "85fbc84d63b76346fbac28c005cba5bbe5153e6851d0432963d3651f4559e5dd"
              }
            ]

            function getTransactionBuffers(txs){
                var txHashes = txs.map(function(tx){
                    if (tx.txid !== undefined) {
                        return util.uint256BufferFromHash(tx.txid);
                    }
                    return util.uint256BufferFromHash(tx.hash);
                });
                return [null].concat(txHashes);
            }

            const txsBuff = getTransactionBuffers(txs)
            // console.log(txsBuff)
            const mt = new merkleTree(txsBuff)
            console.log(mt.steps)
            const coinbaseBuffer = Buffer("01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff1f03960b150443434d5e08672a68dc080000000c2f627920436f6d6d616e642f00000000020000000000000000266a24aa21a9eda9cde9bc89d87cf1d26a817c8f9a6b9075d6a86046bf19b8fdff0bdee22419c9385c0395000000001976a91424da8749fde8fcdcde60ba1c5afea8d2bd4a4f2688ac00000000","hex")
            const coinbaseHash = util.sha256d(coinbaseBuffer)

            const merkleRoot = util.reverseBuffer(mt.withFirst(coinbaseHash))
            console.log(coinbaseHash.toString("hex"))
            console.log(merkleRoot.toString("hex"))
    });
});
