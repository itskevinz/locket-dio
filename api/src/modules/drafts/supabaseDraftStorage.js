const { createClient } = require("@supabase/supabase-js");

// Publishable credentials are intentionally safe for application code. All
// privileged operations are performed by the Supabase Edge Function, which
// keeps its secret key inside Supabase and verifies the Locket owner through
// the production API before issuing a short-lived ticket.
const PROJECT_URL = String(
  process.env.DRAFT_SUPABASE_URL || "https://bekueuthzafjncmqpnve.supabase.co",
).replace(/\/$/, "");
const PUBLISHABLE_KEY = String(
  process.env.DRAFT_SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_AyyeoO3uYlqsmZcRQR9xZA_-H3xQU2X",
);
const EDGE_URL = `${PROJECT_URL}/functions/v1/draft-storage`;
const BUCKET = "huy-locket-drafts";
const KEY_PREFIX = "supabase:";

let client = null;
function storageClient() {
  if (!client) {
    client = createClient(PROJECT_URL, PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

function safeUid(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function isSupabaseKey(key) {
  return String(key || "").startsWith(KEY_PREFIX);
}

function pathFromKey(key) {
  return isSupabaseKey(key) ? String(key).slice(KEY_PREFIX.length) : null;
}

async function edgeRequest(body, { idToken } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  const response = await fetch(EDGE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.success) {
    const error = new Error(data?.code || `draft_storage_${response.status}`);
    error.code = data?.code || "DRAFT_STORAGE_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return data;
}

async function upload({ ownerUid, draftId, role, buffer, contentType, idToken }) {
  const uid = safeUid(ownerUid);
  const id = safeId(draftId);
  if (!uid || !id || !idToken) throw new Error("draft_storage_auth_missing");

  const ticket = await edgeRequest(
    {
      action: "upload-ticket",
      ownerUid: uid,
      draftId: id,
      role,
    },
    { idToken },
  );

  const { data, error } = await storageClient()
    .storage
    .from(BUCKET)
    .uploadToSignedUrl(ticket.path, ticket.token, buffer, {
      contentType,
      cacheControl: "3600",
      upsert: true,
    });

  if (error) {
    const uploadError = new Error(error.message || "supabase_upload_failed");
    uploadError.code = "SUPABASE_UPLOAD_FAILED";
    throw uploadError;
  }

  return {
    ok: true,
    key: ticket.key || `${KEY_PREFIX}${ticket.path}`,
    path: data?.path || ticket.path,
    size: buffer.length,
    contentType,
    provider: "supabase",
  };
}

async function createDownloadUrl({ ownerUid, draftId, role, idToken, signedProof }) {
  const uid = safeUid(ownerUid);
  const id = safeId(draftId);
  const body = {
    action: "download-ticket",
    ownerUid: uid,
    draftId: id,
    role,
  };
  if (signedProof) body.proof = signedProof;
  const data = await edgeRequest(body, { idToken });
  return data.signedUrl || null;
}

async function deleteDraft({ ownerUid, draftId, idToken }) {
  const uid = safeUid(ownerUid);
  const id = safeId(draftId);
  if (!uid || !id || !idToken) return false;
  await edgeRequest(
    {
      action: "delete-draft",
      ownerUid: uid,
      draftId: id,
    },
    { idToken },
  );
  return true;
}

module.exports = {
  upload,
  createDownloadUrl,
  deleteDraft,
  isSupabaseKey,
  pathFromKey,
  KEY_PREFIX,
  PROJECT_URL,
  BUCKET,
};
