/**
 * Generate public/version.json + src/config/buildMeta.json for ultra-sensitive update checks.
 * Run before vite build so the file is copied into dist.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function providedCommitShort() {
  const commit = [
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.GITHUB_SHA,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);

  return commit ? commit.slice(0, 7) : "";
}

function gitShort() {
  const provided = providedCommitShort();
  if (provided) return provided;

  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const commitHash = gitShort();
const buildId = `${Date.now().toString(36)}-${commitHash}`;
const meta = {
  version: pkg.version || "0.0.0",
  buildId,
  commitHash,
  deployedAt: new Date().toISOString(),
};

const publicPath = path.join(root, "public", "version.json");
const metaPath = path.join(root, "src", "config", "buildMeta.json");

fs.mkdirSync(path.dirname(publicPath), { recursive: true });
fs.mkdirSync(path.dirname(metaPath), { recursive: true });

const json = JSON.stringify(meta, null, 2) + "\n";
fs.writeFileSync(publicPath, json);
fs.writeFileSync(metaPath, json);

// Also stamp dist if it already exists (post-build re-run)
const distPath = path.join(root, "dist", "version.json");
if (fs.existsSync(path.join(root, "dist"))) {
  fs.writeFileSync(distPath, json);
}

console.log(
  `[write-version] ${meta.version} buildId=${meta.buildId} commit=${meta.commitHash}`,
);
