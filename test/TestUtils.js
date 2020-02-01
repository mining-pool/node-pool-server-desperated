const assert = require("assert");
const utils = require("../src/utils");

describe("utils", function() {
    it("reverseBuffer", function() {
        let t = Buffer.from([0x00, 0x01, 0x02]);
        assert.deepEqual(utils.reverseBuffer(t), Buffer.from([0x02, 0x01, 0x00]));
    });
});
