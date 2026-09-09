import { createSign } from "node:crypto";

const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || "kossip-helpers";
const BQ_LOCATION = process.env.BQ_LOCATION || "asia-south1";
const DATASET = "niat_post_onboarding_engagement_ai_analytics_workspace";
const sa = JSON.parse(process.env.BIGQUERY_SERVICE_ACCOUNT_JSON);

function base64url(data) {
  return (typeof data === "string" ? Buffer.from(data) : data).toString("base64url");
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/bigquery.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const signing = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signing);
  const sig = sign.sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signing}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`token error: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function bqGet(token, path) {
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT_ID}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function bqQuery(token, sql) {
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT_ID}/queries`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 30000, location: BQ_LOCATION }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.schema || !data.rows) return { columns: [], rows: [] };
  const cols = data.schema.fields.map((f) => f.name);
  const rows = data.rows.map((r) => Object.fromEntries(r.f.map((c, i) => [cols[i], c.v])));
  return { columns: cols, rows };
}

const token = await getAccessToken();
const { tables = [] } = await bqGet(token, `datasets/${DATASET}/tables`);
console.log(`=== ${DATASET}: ${tables.length} tables ===`);
for (const t of tables) console.log(" -", t.tableReference.tableId);

for (const t of tables) {
  const tableId = t.tableReference.tableId;
  console.log(`\n--- preview: ${tableId} ---`);
  try {
    const { columns, rows } = await bqQuery(token, `SELECT * FROM \`${BQ_PROJECT_ID}.${DATASET}.${tableId}\` LIMIT 3`);
    console.log("columns:", columns);
    console.log("sample rows:", JSON.stringify(rows, null, 2));
  } catch (err) {
    console.log("preview failed:", err.message.slice(0, 200));
  }
}
