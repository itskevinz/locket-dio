const handler = require("./app.js");

module.exports = function vercelWeb(req, res) {
  return handler(req, res);
};
