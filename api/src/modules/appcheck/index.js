const {
  initializeAppCheck,
  initializeOptionalAppCheck,
} = require("./middlewares");
const { appCheckRoutes } = require("./routes");

module.exports = {
  appCheckRoutes,
  initializeAppCheck,
  initializeOptionalAppCheck,
};
