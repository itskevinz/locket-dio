const backendHandler = require("../app.js");

module.exports = function vercelWeb(req, res) {
  return backendHandler(req, res);
};
