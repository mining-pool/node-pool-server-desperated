const utils = require("./utils");

/*
Ported from https://github.com/slush0/stratum-mining/blob/master/lib/merkletree.py
 */

module.exports = class MerkleTree {
    constructor(data) {
        this.data = data;
        this.steps = this.calculateSteps(data);
    }

    merkleJoin(h1, h2) {
        return utils.sha256d(Buffer.concat([h1, h2]));
    }

    calculateSteps(data) {
        let L = data;
        const steps = [];
        const PreL = [null];
        const StartL = 2;
        let Ll = L.length;

        if (Ll > 1){
            while (Ll !== 1){
                steps.push(L[1]);

                if (Ll % 2) {
                    L.push(L[L.length - 1]);
                }

                let Ld = [];
                let r = utils.range(StartL, Ll, 2);
                r.forEach((i) => {
                    Ld.push(this.merkleJoin(L[i], L[i + 1]));
                });
                L = PreL.concat(Ld);
                Ll = L.length;
            }
        }
        return steps;
    }

    withFirst(f) {
        this.steps.forEach((s) => {
            f = this.merkleJoin(f,s);
        });
        return f;
    }
};