"use strict";
const http = require("http");
const events = require("events");

/**
 * The daemon interface interacts with the coin daemon by using the rpc interface.
 * in order to make it work it needs, as constructor, an array of objects containing
 * - 'host'    : hostname where the coin lives
 * - 'port'    : port where the coin accepts rpc connections
 * - 'user'    : username of the coin for the rpc interface
 * - 'password': password for the rpc interface of the coin
**/
module.exports = class DaemonManager extends events.EventEmitter {
    constructor(daemons) {
        super();
        this.instances = (() =>  {
            for (let i = 0; i < daemons.length; i++)
                daemons[i]["index"] = String(i);
            return daemons;
        })();
    }

    async init() {
        let online = await this.isOnline();

        if (online) {
            console.log("online");
        }
    }

    async isOnline() {
        let results = await this.cmd("getpeerinfo", []);

        const allOnline = results.every((result) => {
            return !result.error;
        });

        if (!allOnline) {
            throw new Error("Failed to connect daemon(s): " + JSON.stringify(results));
        }
        return allOnline;
    }

    async performHttpRequest(instance, reqRawData) {
        const options = {
            hostname: (typeof (instance.host) == "undefined" ? "127.0.0.1" : instance.host),
            port: instance.port,
            method: "POST",
            auth: instance.user + ":" + instance.password,
            headers: {
                "Content-Length": reqRawData.length
            }
        };

        return new Promise( 
            (resolve) => {
                let req = http.request(options, (res) => {
                    let data = "";
                    res.setEncoding("utf8");
                    res.on("data", (chunk) => { data += chunk; });
                    res.on("end", () => { 
                        while (data.indexOf(":-nan") !== -1) {
                            data = data.replace(/:-nan,/g, ":0");
                        }
        
                        try {
                            const dataJson = JSON.parse(data);
                            
                            resolve({
                                error: dataJson.error, 
                                result: dataJson, 
                                data: data
                            });
                        } catch (e) {
                            console.error("Could not parse rpc data from daemon instance " + instance.index + "\nRequest Data: " + reqRawData + "\nReponse Data: " + data);
                        }
                    });
                });
        
                req.on("error", (e) => {
                    if (e.name === "ECONNREFUSED") {
                        resolve({
                            error: {type: "offline", message: e.message}, 
                            result: null, 
                            data: null
                        });
                    } else {
                        resolve({
                            error: {type: "request error", message: e.message},
                            result: null, 
                            data: null
                        });
                    }
                });
        
                req.end(reqRawData);
            }
        );

    }

    async batchCmd(cmdArray) {
        const requestJson = [];
        cmdArray.map(
            (cmd)=> {
                requestJson.push({
                    method: cmd[0],
                    params: cmd[1],
                    id: Date.now() + Math.floor(Math.random() * 10)
                });
            }
        );

        const serializedRequest = JSON.stringify(requestJson);

        let { error, result, data } = await this.performHttpRequest(this.instances[0], serializedRequest);
        let results = result;
        return { error, results, data };
    }

    async cmd(method, params) {
        let request = async (instance) => {
            let reqRawData = JSON.stringify({
                method: method,
                params: params,
                id: Date.now() + Math.floor(Math.random() * 10)
            });

            let res = await this.performHttpRequest(instance, reqRawData);

            return {
                data: res.data,
                error: res.error,
                response: (res.result || {}).result,
                instance: instance
            };
        };

        const promises = this.instances.map(request);
        
        let results = await Promise.all(promises);

        return results;
    }
};

