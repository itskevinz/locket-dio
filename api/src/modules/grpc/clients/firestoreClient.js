const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

// Vercel executes Functions with `/var/task` as cwd, while this backend lives
// under `/var/task/api`. Resolve static protobuf assets from the module instead
// of relying on the process working directory.
const PROJECT_ROOT = path.resolve(__dirname, "../../../..");
const PROTO_PATH = path.join(PROJECT_ROOT, "google/firestore/v1/firestore.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [
    path.join(PROJECT_ROOT, "google"),
    path.join(PROJECT_ROOT, "src"),
    PROJECT_ROOT,
  ],
});

const loaded = grpc.loadPackageDefinition(packageDefinition);
const firestoreProto = loaded.google.firestore.v1;

const client = new firestoreProto.Firestore(
  "firestore.googleapis.com:443",
  grpc.credentials.createSsl()
);

module.exports = { client };
