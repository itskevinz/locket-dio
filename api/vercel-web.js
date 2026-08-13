import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const handler = require("./app.js");

export default function vercelWeb(req, res) {
  return handler(req, res);
}
