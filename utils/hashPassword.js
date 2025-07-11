const bcrypt = require('bcrypt');
const saltRounds = 10;

function hashPassword(password) {
  return bcrypt.hash(password, saltRounds);
}

function comparePassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

module.exports = {
  hashPassword,
  comparePassword
};
