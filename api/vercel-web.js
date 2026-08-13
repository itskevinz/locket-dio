import handler from "./app.js";

export default function vercelWeb(req, res) {
  return handler(req, res);
}
