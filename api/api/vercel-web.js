const { vercelHandler } = require("../app.js");

module.exports = function vercelWeb(req, res) {
  return vercelHandler(req, res);
};
