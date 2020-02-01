const crypto = require("crypto");
const bs58 = require("bs58");
const BN = require("bn.js");

module.exports.addressFromEx = (exAddress, ripmd160Key) => {
    try {
        const versionByte = exports.getVersionByte(exAddress);
        const addrBase = Buffer.concat([versionByte, Buffer.from(ripmd160Key, "hex")]);
        const checksum = exports.sha256d(addrBase).slice(0, 4);
        const address = Buffer.concat([addrBase, checksum]);
        return bs58.encode(address);
    } catch(e) {
        return null;
    }
};

module.exports.getVersionByte = (addr) => {
    return bs58.decode(addr).slice(0, 1);
};

module.exports.sha256 = (buffer) => {
    const hash1 = crypto.createHash("sha256");
    hash1.update(buffer);
    return hash1.digest();
};

module.exports.sha256d = (buffer) => {
    return exports.sha256(exports.sha256(buffer));
};

module.exports.reverseBuffer = (buff) => {
    const reversed = Buffer.alloc(buff.length);
    for (let i = buff.length - 1; i >= 0; i--) {
        reversed[buff.length - i - 1] = buff[i];
    }
    return reversed;
};

module.exports.reverseHex = (hex) => {
    return exports.reverseBuffer(Buffer.from(hex, "hex")).toString("hex");
};

module.exports.reverseByteOrder = (buff) => {
    for (let i = 0; i < 8; i++) buff.writeUInt32LE(buff.readUInt32BE(i * 4), i * 4);
    return exports.reverseBuffer(buff);
};

module.exports.uint256BufferFromHash = (hex) => {
    let fromHex = Buffer.from(hex, "hex");

    if (fromHex.length != 32) {
        const empty = Buffer.alloc(32);
        empty.fill(0);
        fromHex.copy(empty);
        fromHex = empty;
    }

    return exports.reverseBuffer(fromHex);
};

module.exports.hexFromReversedBuffer = (buffer) => {
    return exports.reverseBuffer(buffer).toString("hex");
};


/*
Defined in bitcoin protocol here:
 https://en.bitcoin.it/wiki/Protocol_specification#Variable_length_integer
 */
module.exports.varIntBuffer = (n) => {
    let buff;
    if (n < 0xfd)
        return Buffer.from([n]);
    else if (n <= 0xffff){
        buff = Buffer.alloc(3);
        buff[0] = 0xfd;
        buff.writeUInt16LE(n, 1);
        return buff;
    }
    else if (n <= 0xffffffff){
        buff = Buffer.alloc(5);
        buff[0] = 0xfe;
        buff.writeUInt32LE(n, 1);
        return buff;
    }
    else{
        buff = Buffer.alloc(9);
        buff[0] = 0xff;
        exports.packUInt16LE(n).copy(buff, 1);
        return buff;
    }
};

module.exports.varStringBuffer = (string) => {
    const strBuff = Buffer.from(string);
    return Buffer.concat([exports.varIntBuffer(strBuff.length), strBuff]);
};

/*
"serialized CScript" formatting as defined here:
 https://github.com/bitcoin/bips/blob/master/bip-0034.mediawiki#specification
Used to format height and date when putting into script signature when transaction createGeneration:
 https://en.bitcoin.it/wiki/Script
 */
module.exports.serializeNumber = (n) => {
    //New version from TheSeven
    if (n >= 1 && n <= 16) return Buffer.from([0x50 + n]);
    let l = 1;
    const buff = Buffer.alloc(9);
    while (n > 0x7f)
    {
        buff.writeUInt8(n & 0xff, l++);
        n >>= 8;
    }
    buff.writeUInt8(l, 0);
    buff.writeUInt8(n, l++);
    return buff.slice(0, l);
};


/*
Used for serializing strings used in script signature when transaction createGeneration
 */
module.exports.serializeString = (s) => {
    if (s.length < 253) {
        return Buffer.concat([
            Buffer.from([s.length]),
            Buffer.from(s)
        ]);
    } else if (s.length < 0x10000 ) {
        return Buffer.concat([
            Buffer.from([253]),
            exports.packUInt16LE(s.length),
            Buffer.from(s)
        ]);
    } else if (s.length < 0x100000000) {
        return Buffer.concat([
            Buffer.from([254]),
            exports.packUInt32LE(s.length),
            Buffer.from(s)
        ]);
    } else {
        return Buffer.concat([
            Buffer.from([255]),
            exports.packUInt16LE(s.length),
            Buffer.from(s)
        ]);
    }
};

module.exports.packUInt16LE = (num) => {
    const buff = Buffer.alloc(2);
    buff.writeUInt16LE(num, 0);
    return buff;
};

module.exports.packUInt16BE = (num) => {
    const buff = Buffer.alloc(2);
    buff.writeUInt16BE(num, 0);
    return buff;
};

module.exports.packInt32LE = (num) => {
    const buff = Buffer.alloc(4);
    buff.writeInt32LE(num, 0);
    return buff;
};

module.exports.packInt32BE = (num) => {
    const buff = Buffer.alloc(4);
    buff.writeInt32BE(num, 0);
    return buff;
};

module.exports.packUInt32LE = (num) => {
    const buff = Buffer.alloc(4);
    buff.writeUInt32LE(num, 0);
    return buff;
};

module.exports.packUInt32BE = (num) => {
    const buff = Buffer.alloc(4);
    buff.writeUInt32BE(num, 0);
    return buff;
};

module.exports.packUInt64LE = (num) => {
    const buff = Buffer.alloc(8);
    buff.writeUInt32LE(num % Math.pow(2, 32), 0);
    buff.writeUInt32LE(Math.floor(num / Math.pow(2, 32)), 4);
    return buff;
};

module.exports.packUInt64BE = (num) => {
    const buff = Buffer.alloc(8);
    buff.writeUInt32BE(num % Math.pow(2, 32), 4);
    buff.writeUInt32BE(Math.floor(num / Math.pow(2, 32)), 0);
    return buff;
};

/*
An exact copy of python's range feature. Written by Tadeck:
 http://stackoverflow.com/a/8273091
Used in MerkleTree
 */
module.exports.range = (start, stop, step) => {
    const result = [];
    
    if ((step > 0 && start >= stop) || (step < 0 && start <= stop)){
        return [];
    }
    
    for (let i = start; step > 0 ? i < stop : i > stop; i += step){
        result.push(i);
    }
    
    return result;
};


/*
 For POS coins - used to format wallet address for use in generation transaction's output
 */
module.exports.pubkeyToScript = (key) => {
    if (key.length !== 66) {
        throw new Error("Invalid pubkey: " + key);
    }

    const pubkey = Buffer.alloc(35);
    
    pubkey[0] = 0x21;
    pubkey[34] = 0xac;
    Buffer.from(key, "hex").copy(pubkey, 1);
    
    return pubkey;
};


module.exports.miningKeyToScript = (key) => {
    return Buffer.concat([
        Buffer.from([0x76, 0xa9, 0x14]),
        Buffer.from(key, "hex"),
        Buffer.from([0x88, 0xac])
    ]);
};

/*
For POW coins - used to format wallet address for use in generation transaction's output
 */
module.exports.addressToScript = (addr) => {
    const decoded = bs58.decode(addr);

    if (decoded.length < 25) {
        throw new Error("invalid address length for " + addr);
    }

    if (!decoded){
        throw new Error("bs58 decode failed for " + addr);
    }

    const pubkey = decoded.slice(1, -4);

    return Buffer.concat([
        Buffer.from([0x76, 0xa9, 0x14]), 
        pubkey, 
        Buffer.from([0x88, 0xac])
    ]);
};

module.exports.getReadableHashRateString = (hashrate) => {
    let i = -1;
    const byteUnits = [" KH", " MH", " GH", " TH", " PH"];
    do {
        hashrate = hashrate / 1024;
        i++;
    } while (hashrate > 1024);
    return hashrate.toFixed(2) + byteUnits[i];
};


//Creates a non-truncated max difficulty (diff1) by bitwise right-shifting the max value of a uint256
module.exports.shiftMax256Right = (shiftRight) => {

    //Max value uint256 (an array of ones representing 256 enabled bits)
    let arr256 = Array.apply(null, new Array(256)).map(Number.prototype.valueOf, 1);

    //An array of zero bits for how far the max uint256 is shifted right
    const arrLeft = Array.apply(null, new Array(shiftRight)).map(Number.prototype.valueOf, 0);

    //Add zero bits to uint256 and remove the bits shifted out
    arr256 = arrLeft.concat(arr256).slice(0, 256);

    //An array of bytes to convert the bits to, 8 bits in a byte so length will be 32
    const octets = [];

    for (let i = 0; i < 32; i++){
        octets[i] = 0;

        //The 8 bits for this byte
        const bits = arr256.slice(i * 8, i * 8 + 8);

        //Bit math to add the bits into a byte
        for (let f = 0; f < bits.length; f++){
            const multiplier = Math.pow(2, f);
            octets[i] += bits[f] * multiplier;
        }
    }

    return Buffer.from(octets);
};


module.exports.bufferToCompactBits = (startingBuff) => {
    let bn = new BN(startingBuff);
    let buff = bn.toBuffer();
    
    buff = buff.readUInt8(0) > 0x7f ? Buffer.concat([Buffer.from([0x00]), buff]) : buff;

    buff = Buffer.concat([Buffer.from([buff.length]), buff]);
    return buff.slice(0, 4);
};

/*
 Used to convert getblocktemplate bits field into target if target is not included.
 More info: https://en.bitcoin.it/wiki/Target
 */

module.exports.bignumFromBitsBuffer = (bitsBuff) => {
    const numBytes = bitsBuff.readUInt8(0);
    let bigBits = new BN(bitsBuff.slice(1));
    return bigBits.mul(
        BN(2).pow((
            BN(8).mul(numBytes - 3)
        ))
    );
};

module.exports.bignumFromBitsHex = (bitsString) => {
    const bitsBuff = Buffer.from(bitsString, "hex");
    return exports.bignumFromBitsBuffer(bitsBuff);
};

module.exports.convertBitsToBuff = (bitsBuff) => {
    const target = exports.bignumFromBitsBuffer(bitsBuff);
    let resultBuff = Buffer.alloc(8);
    resultBuff.writeBigUInt64BE(target);
    const buff256 = Buffer.alloc(32);
    buff256.fill(0);
    resultBuff.copy(buff256, buff256.length - resultBuff.length);
    return buff256;
};

module.exports.getTruncatedDiff = (shift) => {
    return exports.convertBitsToBuff(
        exports.bufferToCompactBits(
            exports.shiftMax256Right(shift)
        )
    );
};
