const Pool = require("./src/index");
const config = require("./config");

const pool = new Pool(config, (ip, port , workerName, password, callback) => {
    console.log("Authorize " + workerName + ":" + password + "@" + ip);
    callback({
        error: null,
        authorized: true,
        disconnect: false
    });
});


pool.on("share", function(isValidShare, isValidBlock, data){

    if (isValidBlock)
        console.log("Block found");
    else if (isValidShare)
        console.log("Valid share submitted");
    else if (data.blockHash)
        console.log("We thought a block was found but it was rejected by the daemon");
    else
        console.log("Invalid share submitted");

    console.log("share data: " + JSON.stringify(data));
});



/*
'severity': can be 'debug', 'warning', 'error'
'logKey':   can be 'system' or 'client' indicating if the error
            was caused by our system or a stratum client
*/
pool.on("log", function(severity, logText){
    console.log("[" + severity + "]: " + logText);
});

pool.StartInDefault();