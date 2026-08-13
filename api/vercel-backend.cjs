// Vercel adapter for the existing Huy Locket Express backend.
// Keeps api/app.js usable on a traditional Node host while preventing it from
// opening a TCP listener inside a Vercel Function.
const http = require("http");

let capturedServer = null;
const originalCreateServer = http.createServer;
const originalListen = http.Server.prototype.listen;

http.createServer = function patchedCreateServer(...args) {
  capturedServer = originalCreateServer.apply(this, args);
  return capturedServer;
};
http.Server.prototype.listen = function patchedListen() {
  // app.js starts long-lived workers from the listen callback. Intentionally do
  // not invoke that callback in serverless; HTTP requests are handled per invocation.
  return this;
};

process.env.VERCEL = process.env.VERCEL || "1";
require("./app.js");

http.createServer = originalCreateServer;
http.Server.prototype.listen = originalListen;

if (!capturedServer) {
  throw new Error("Huy Locket API server was not initialized");
}

function applyForwardedPath(req) {
  const incoming = new URL(req.url || "/", "http://vercel.local");
  const forwarded = incoming.searchParams.get("__path");
  if (!forwarded) return;
  incoming.searchParams.delete("__path");
  const query = incoming.searchParams.toString();
  req.url = `${forwarded.startsWith("/") ? forwarded : `/${forwarded}`}${query ? `?${query}` : ""}`;
}

module.exports = function handler(req, res) {
  applyForwardedPath(req);
  capturedServer.emit("request", req, res);
};
