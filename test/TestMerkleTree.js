const assert = require("assert")
const merkleTree = require("../src/merkleTree")

describe("MerkleTree", function() {
    it("new", async function() {
        const mt = new merkleTree([Buffer("hello"), Buffer("world")])
        assert(mt.withFirst(Buffer("first")).toString("hex"), "11f206ce3848f46083c5f30d01b95a8dd75194ef5781b24202d34720b2b4c12f")
    });
});