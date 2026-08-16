const { neon } = require("@neondatabase/serverless");

const databaseUrl = String(
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "",
).trim();
const sql = databaseUrl ? neon(databaseUrl) : null;
let schemaPromise = null;

function databaseError() {
  const error = new Error("DATABASE_URL is required for Huy Locket polls");
  error.code = "WEB_POLL_DATABASE_UNAVAILABLE";
  error.status = 503;
  return error;
}

async function ensureSchema() {
  if (!sql) throw databaseError();
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS web_profile_polls (
        owner_uid TEXT PRIMARY KEY,
        question TEXT NOT NULL,
        poll_version INTEGER NOT NULL DEFAULT 1,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS web_profile_poll_votes (
        owner_uid TEXT NOT NULL,
        poll_version INTEGER NOT NULL,
        voter_uid TEXT NOT NULL,
        choice TEXT NOT NULL CHECK (choice IN ('up', 'down')),
        voter_username TEXT,
        voter_display_name TEXT,
        voter_avatar_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (owner_uid, poll_version, voter_uid)
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_web_profile_poll_votes_owner_version
      ON web_profile_poll_votes (owner_uid, poll_version, updated_at DESC)
    `;
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

function mapPoll(row, votes, viewerUid) {
  if (!row) return null;
  const normalizedVotes = (votes || []).map((vote) => ({
    uid: vote.voter_uid,
    username: vote.voter_username || "",
    displayName: vote.voter_display_name || vote.voter_username || "Người dùng Huy Locket",
    avatar: vote.voter_avatar_url || "",
    choice: vote.choice,
    updatedAt: vote.updated_at ? new Date(vote.updated_at).getTime() : null,
  }));

  const upCount = normalizedVotes.filter((vote) => vote.choice === "up").length;
  const downCount = normalizedVotes.filter((vote) => vote.choice === "down").length;
  const viewerVote = normalizedVotes.find(
    (vote) => String(vote.uid) === String(viewerUid || ""),
  );

  return {
    ownerUid: row.owner_uid,
    question: row.question,
    version: Number(row.poll_version) || 1,
    active: Boolean(row.active),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
    upCount,
    downCount,
    totalVotes: upCount + downCount,
    viewerChoice: viewerVote?.choice || null,
    voters: normalizedVotes,
  };
}

async function getPoll(ownerUid, viewerUid, { includeInactive = false } = {}) {
  await ensureSchema();
  const rows = await sql`
    SELECT owner_uid, question, poll_version, active, created_at, updated_at
    FROM web_profile_polls
    WHERE owner_uid = ${String(ownerUid)}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (!includeInactive && !row.active) return null;

  const votes = await sql`
    SELECT voter_uid, choice, voter_username, voter_display_name,
           voter_avatar_url, updated_at
    FROM web_profile_poll_votes
    WHERE owner_uid = ${String(ownerUid)}
      AND poll_version = ${Number(row.poll_version) || 1}
    ORDER BY updated_at DESC
    LIMIT 250
  `;

  return mapPoll(row, votes, viewerUid);
}

async function savePoll(ownerUid, question, active = true) {
  await ensureSchema();
  const normalizedQuestion = String(question || "").trim().slice(0, 140);
  if (!normalizedQuestion) {
    const error = new Error("Bạn cần nhập câu hỏi bình chọn.");
    error.code = "WEB_POLL_QUESTION_REQUIRED";
    error.status = 400;
    throw error;
  }

  const existingRows = await sql`
    SELECT question, poll_version
    FROM web_profile_polls
    WHERE owner_uid = ${String(ownerUid)}
    LIMIT 1
  `;
  const existing = existingRows[0] || null;
  const questionChanged = !existing || String(existing.question) !== normalizedQuestion;
  const nextVersion = existing
    ? questionChanged
      ? (Number(existing.poll_version) || 1) + 1
      : Number(existing.poll_version) || 1
    : 1;

  await sql`
    INSERT INTO web_profile_polls
      (owner_uid, question, poll_version, active, updated_at)
    VALUES (
      ${String(ownerUid)}, ${normalizedQuestion}, ${nextVersion},
      ${Boolean(active)}, NOW()
    )
    ON CONFLICT (owner_uid) DO UPDATE SET
      question = EXCLUDED.question,
      poll_version = EXCLUDED.poll_version,
      active = EXCLUDED.active,
      updated_at = NOW()
  `;

  return getPoll(ownerUid, ownerUid, { includeInactive: true });
}

async function setPollActive(ownerUid, active) {
  await ensureSchema();
  await sql`
    UPDATE web_profile_polls
    SET active = ${Boolean(active)}, updated_at = NOW()
    WHERE owner_uid = ${String(ownerUid)}
  `;
  return getPoll(ownerUid, ownerUid, { includeInactive: true });
}

async function votePoll(ownerUid, voterUid, choice, voter = {}) {
  await ensureSchema();
  const normalizedChoice = String(choice || "").toLowerCase();
  if (!['up', 'down'].includes(normalizedChoice)) {
    const error = new Error("Lựa chọn bình chọn không hợp lệ.");
    error.code = "WEB_POLL_INVALID_CHOICE";
    error.status = 400;
    throw error;
  }
  if (String(ownerUid) === String(voterUid)) {
    const error = new Error("Bạn không thể tự bình chọn câu hỏi của mình.");
    error.code = "WEB_POLL_SELF_VOTE";
    error.status = 400;
    throw error;
  }

  const pollRows = await sql`
    SELECT owner_uid, poll_version, active
    FROM web_profile_polls
    WHERE owner_uid = ${String(ownerUid)}
    LIMIT 1
  `;
  const poll = pollRows[0];
  if (!poll || !poll.active) {
    const error = new Error("Người này chưa có bình chọn đang hoạt động.");
    error.code = "WEB_POLL_NOT_ACTIVE";
    error.status = 404;
    throw error;
  }

  await sql`
    INSERT INTO web_profile_poll_votes (
      owner_uid, poll_version, voter_uid, choice,
      voter_username, voter_display_name, voter_avatar_url, updated_at
    ) VALUES (
      ${String(ownerUid)}, ${Number(poll.poll_version) || 1},
      ${String(voterUid)}, ${normalizedChoice},
      ${String(voter.username || "").slice(0, 120) || null},
      ${String(voter.displayName || "").slice(0, 180) || null},
      ${String(voter.avatar || "").slice(0, 1200) || null}, NOW()
    )
    ON CONFLICT (owner_uid, poll_version, voter_uid) DO UPDATE SET
      choice = EXCLUDED.choice,
      voter_username = EXCLUDED.voter_username,
      voter_display_name = EXCLUDED.voter_display_name,
      voter_avatar_url = EXCLUDED.voter_avatar_url,
      updated_at = NOW()
  `;

  return getPoll(ownerUid, voterUid);
}

module.exports = {
  ensureSchema,
  getPoll,
  savePoll,
  setPollActive,
  votePoll,
};
