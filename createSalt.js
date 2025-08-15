const crypto = require('crypto');

const salt = crypto.randomBytes(32).toString('hex');

console.log(`Generated salt: ${salt}`);