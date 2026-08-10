const crypto = require("node:crypto");

const REPO_OWNER = String(process.env.GITHUB_REPO_OWNER || "buiduchuy2010qn-prog").trim();
const REPO_NAME = String(process.env.GITHUB_REPO_NAME || "duchi-locketgold").trim();
const GITHUB_API = "https://api.github.com";
const MAX_COMMITS = 12;

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function githubToken() {
  return clean(process.env.GITHUB_ADMIN_TOKEN || process.env.GITHUB_TOKEN, 1000);
}

function headers({ authenticated = false } = {}) {
  const out = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Duchi-Locket-Admin-Ops/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = githubToken();
  if (token && authenticated) out.Authorization = `Bearer ${token}`;
  return out;
}

async function githubJson(path, options = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      ...headers({ authenticated: Boolean(options.authenticated) }),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(12000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }
  if (!response.ok) {
    const error = new Error(data?.message || `GitHub API ${response.status}`);
    error.status = response.status;
    error.code = "GITHUB_API_FAILED";
    throw error;
  }
  return data;
}

function shortSha(value) {
  return clean(value, 80).slice(0, 8);
}

async function getRecentDeployments() {
  const commits = await githubJson(
    `/repos/${encodeURIComponent(REPO_OWNER)}/${encodeURIComponent(REPO_NAME)}/commits?sha=main&per_page=${MAX_COMMITS}`,
  );
  const currentSha = clean(
    process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT_SHA,
    80,
  );
  return {
    repo: `${REPO_OWNER}/${REPO_NAME}`,
    currentSha,
    rollbackConfigured: Boolean(githubToken()),
    commits: (Array.isArray(commits) ? commits : []).map((entry) => ({
      sha: entry.sha,
      shortSha: shortSha(entry.sha),
      message: clean(entry.commit?.message, 500).split("\n")[0],
      author: clean(entry.commit?.author?.name || entry.author?.login || "unknown", 120),
      date: entry.commit?.author?.date || entry.commit?.committer?.date || null,
      url: entry.html_url || null,
      isCurrent: Boolean(currentSha && entry.sha?.startsWith(currentSha)),
    })),
  };
}

async function rollbackMainToCommit({ sha, requestedBy }) {
  const token = githubToken();
  if (!token) {
    const error = new Error("Chưa cấu hình GITHUB_ADMIN_TOKEN trên Railway API nên nút rollback đang ở chế độ chỉ xem.");
    error.code = "ROLLBACK_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }

  const targetSha = clean(sha, 80);
  if (!/^[a-f0-9]{40}$/i.test(targetSha)) {
    const error = new Error("Commit SHA không hợp lệ.");
    error.code = "INVALID_COMMIT_SHA";
    error.status = 400;
    throw error;
  }

  const targetCommit = await githubJson(
    `/repos/${encodeURIComponent(REPO_OWNER)}/${encodeURIComponent(REPO_NAME)}/commits/${encodeURIComponent(targetSha)}`,
    { authenticated: true },
  );
  if (!targetCommit?.sha) {
    const error = new Error("Không tìm thấy commit cần rollback.");
    error.code = "COMMIT_NOT_FOUND";
    error.status = 404;
    throw error;
  }

  const mainRef = await githubJson(
    `/repos/${encodeURIComponent(REPO_OWNER)}/${encodeURIComponent(REPO_NAME)}/git/ref/heads/main`,
    { authenticated: true },
  );
  const previousSha = mainRef?.object?.sha;
  if (!previousSha) {
    const error = new Error("Không đọc được HEAD của nhánh main.");
    error.code = "MAIN_REF_UNAVAILABLE";
    error.status = 502;
    throw error;
  }
  if (previousSha === targetSha) {
    return {
      ok: true,
      noChange: true,
      previousSha,
      targetSha,
      backupBranch: null,
    };
  }

  const suffix = `${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
  const backupBranch = `rollback-backup-${suffix}`;

  await githubJson(
    `/repos/${encodeURIComponent(REPO_OWNER)}/${encodeURIComponent(REPO_NAME)}/git/refs`,
    {
      method: "POST",
      authenticated: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: `refs/heads/${backupBranch}`,
        sha: previousSha,
      }),
    },
  );

  try {
    await githubJson(
      `/repos/${encodeURIComponent(REPO_OWNER)}/${encodeURIComponent(REPO_NAME)}/git/refs/heads/main`,
      {
        method: "PATCH",
        authenticated: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: targetSha, force: true }),
      },
    );
  } catch (error) {
    error.backupBranch = backupBranch;
    throw error;
  }

  return {
    ok: true,
    noChange: false,
    previousSha,
    targetSha,
    backupBranch,
    requestedBy: clean(requestedBy, 180),
  };
}

module.exports = {
  getRecentDeployments,
  rollbackMainToCommit,
};