"use strict";
const events = require("events");

/*

Vardiff ported from stratum-mining share-limiter
 https://github.com/ahmedbodi/stratum-mining/blob/master/mining/basic_share_limiter.py

 */

class RingBuffer { 
    constructor(maxSize) {
        this.data = [];
        this.cursor = 0;
        this.isFull = false;
        this.append = (x) => {
            if (this.isFull){
                this.data[this.cursor] = x;
                this.cursor = (this.cursor + 1) % maxSize;
            }
            else{
                this.data.push(x);
                this.cursor++;
                if (this.data.length === maxSize){
                    this.cursor = 0;
                    this.isFull = true;
                }
            }
        };
    }

    avg() {
        const sum = this.data.reduce((a, b) => {return a + b;});
        return sum / (this.isFull ? this.maxSize : this.cursor);
    }

    size(){
        return this.isFull ? this.maxSize : this.cursor;
    }

    clear(){
        this.data = [];
        this.cursor = 0;
        this.isFull = false;
    }
}

module.exports = class VarDiff extends events.EventEmitter {
    constructor(port, varDiffOptions) {
        super();
        this.port = port;
        this.options = varDiffOptions;

        this.variance = varDiffOptions.targetTime * (varDiffOptions.variancePercent / 100);

        this.bufferSize = varDiffOptions.retargetTime / varDiffOptions.targetTime * 4;
        this.tMin = varDiffOptions.targetTime - this.variance;
        this.tMax = varDiffOptions.targetTime + this.variance;
    }

    manageClient(client) {
        const stratumPort = client.socket.localPort;

        if (stratumPort != this.port) {
            console.error("Handling a client which is not of this vardiff?"+stratumPort+"|"+this.port);
        }

        let lastTs;
        let lastRtc;
        let timeBuffer;

        client.on("submit", () => {
            const ts = (Date.now() / 1000) | 0;

            if (!lastRtc){
                lastRtc = ts - this.options.retargetTime / 2;
                lastTs = ts;
                timeBuffer = new RingBuffer(this.bufferSize);
                return;
            }

            const sinceLast = ts - lastTs;

            timeBuffer.append(sinceLast);
            lastTs = ts;

            if ((ts - lastRtc) < this.options.retargetTime && timeBuffer.size() > 0)
                return;

            lastRtc = ts;
            const avg = timeBuffer.avg();
            let ddiff = this.options.targetTime / avg;

            if (avg > this.tMax && client.difficulty > this.options.minDiff) {
                if (this.options.x2mode) {
                    ddiff = 0.5;
                }
                if (ddiff * client.difficulty < this.options.minDiff) {
                    ddiff = this.options.minDiff / client.difficulty;
                }
            } else if (avg < this.tMin) {
                if (this.options.x2mode) {
                    ddiff = 2;
                }
                const diffMax = this.options.maxDiff;
                if (ddiff * client.difficulty > diffMax) {
                    ddiff = diffMax / client.difficulty;
                }
            }
            else{
                return;
            }

            const newDiff = parseFloat((client.difficulty*ddiff).toFixed(8));
            timeBuffer.clear();
            this.emit("newDifficulty", client, newDiff);
        });
    }
};
