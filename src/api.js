const stats = require("./stats");
const express = require("express");

module.exports = class Api {
    constructor(options) {
        this.options = options;
        this.liveStatConnections = {};
        this.stats = new stats(options);
        
        this.workerStats;
        
        const app = express();
        
        // this.counters = {
        //     validShares: 0,
        //     validBlocks: 0,
        //     invalidShares: 0
        // };

        // this.lastEvents = {
        //     lastValidShare: 0,
        //     lastValidBlock: 0,
        //     lastInvalidShare: 0
        // };

        // this.lastShare = {};

        this.handleAdminApiRequest(app);
        this.handleApiRequest(app);
        this.handleWorkerApiRequest(app);

        app.listen(options.api.port, options.api.host, ()=>{
            console.log("API server running on:", options.api.port, options.api.host);
        });
    }

    handleApiRequest(expressApp){
        expressApp.get("/stats", (req, res) => {
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(this.stats.statsString);
            return;
        });

        expressApp.get("/pool_stats", (req, res) => {
            res.writeHead(200, { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify(this.stats.statPoolHistory));
            return;
        });

        expressApp.get("/live_stats", (req, res) => {
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*"
            });
            res.write("\n");
            let uid = Math.random().toString();
            this.liveStatConnections[uid] = res;
            req.on("close", () => {delete this.liveStatConnections[uid]; });

            return;
        });
    }

    handleAdminApiRequest(expressApp){
        expressApp.get("/admin", (req, res) => {
            res.end(JSON.stringify({result: this.options}));
            return;
        });
    }

    handleWorkerApiRequest(expressApp){
        expressApp.get("/worker/:worker", (req, res) => {
            let worker = req.params["worker"];
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            });
            res.end(JSON.stringify(this.workerStats[worker]));
        });
    }

    listenPoolShare(poolObj) {
        poolObj.on("share", (isValidShare, isValidBlock, shareData) => {
            let now = Date.now();
            let worker = shareData["worker"];
            if (isValidShare) {
                this.workerStats[worker].counters.validShares++;
                this.workerStats[worker].lastEvents.lastValidShare = now;
                if (isValidBlock) {
                    this.workerStats[worker].counters.validBlocks++;
                    this.workerStats[worker].lastEvents.lastValidBlock = now;
                }
            } else {
                this.workerStats[worker].counters.invalidShares++;
                this.workerStats[worker].lastEvents.lastInvalidShare = now;
            }

            this.workerStats[worker].lastShare = shareData;
        });
    }
};
