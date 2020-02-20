const assert = require("assert");
const utils = require("../lib/util");

describe("utils", function() {
    it("reverseBuffer", function() {
        let t = Buffer.from([0x00, 0x01, 0x02]);
        assert.deepEqual(utils.reverseBuffer(t), Buffer.from([0x02, 0x01, 0x00]));
    });
});


describe("utils", function() {
    it("range", function() {
        console.log(utils.range(0, 8, 2))
    });
});


describe("utils", function() {
    it("varIntBuffer", function() {
        console.log( ((1 << 31) -1 ) >>> 0 )
        console.log(utils.varIntBuffer(((1 << 31) -1 ) >>> 0).toString("hex"))
    });
});


describe("utils", function() {
    it("varStringBuffer", function() {
        console.log(utils.varStringBuffer("Hello").toString("hex"))
    });
});

describe("utils", function() {
    it("serializeNumber", function() {
        // console.log(Date.now() / 1000 | 0)
        // "04fe5a4d5e" "0443434d5e"
        console.log(utils.serializeNumber(Date.now() / 1000 | 0).toString("hex"))
    });
});

