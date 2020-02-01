const assert = require("assert");
const DaemonManager = require("../src/daemonManager");

describe("DaemonManager", function() {
    it("performHttpRequest", async function() {
        let dm = new DaemonManager([
            {
                "host": "127.0.0.1",
                "port": 19332,
                "user": "litecoinrpc",
                "password": "testnet"
            }
        ]);
        let {error, result, data} = await dm.performHttpRequest(
            {
                "host": "127.0.0.1",
                "port": 19332,
                "user": "litecoinrpc",
                "password": "testnet"
            },
            ""
        );
        console.log({error, result, data});
    });
});

describe("DaemonManager", function() {
    it("cmd", async function() {
        let dm = new DaemonManager([
            {
                "host": "127.0.0.1",
                "port": 19332,
                "user": "litecoinrpc",
                "password": "testnet"
            }
        ]);
        let res = await dm.cmd("getpeerinfo", []);
        console.log(res);
    });
});

describe("DaemonManager", function() {
    it("isOnline", async function() {
        let dm = new DaemonManager([
            {
                "host": "127.0.0.1",
                "port": 19332,
                "user": "litecoinrpc",
                "password": "testnet"
            }
        ]);
        let res = await dm.isOnline();
        assert(typeof res, "Boolean")
        console.log(res);
    });
});
