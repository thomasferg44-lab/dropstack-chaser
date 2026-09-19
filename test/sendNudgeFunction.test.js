import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import handler from "../netlify/functions/send-nudge.mjs";

const VALID = {
  to: "test@example.com",
  subject: "Overdue: invoice INV-001",
  body: "Hi Bob,\n\nInvoice INV-001 is overdue.",
  tone: "firm",
  invoiceId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
};

const post = (body, { auth = "Bearer token-123" } = {}) =>
  new Request("https://example.netlify.app/.netlify/functions/send-nudge", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });

let calls = [];
const realFetch = globalThis.fetch;

/** Stub Supabase's user endpoint and Resend's send endpoint. */
function stubFetch({ authOk = true, resendStatus = 200, resendBody = { id: "re_1" } } = {}) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/auth/v1/user")) {
      return authOk
        ? new Response(JSON.stringify({ id: "user-1", email: "owner@example.co.za" }), { status: 200 })
        : new Response(JSON.stringify({ message: "bad jwt" }), { status: 401 });
    }
    return new Response(JSON.stringify(resendBody), { status: resendStatus });
  };
}

beforeEach(() => {
  calls = [];
  globalThis.fetch = realFetch;
  process.env.VITE_SUPABASE_URL = "https://example.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
  process.env.RESEND_API_KEY = "re_test_key";
  delete process.env.DEV_BLOCK_REAL_SENDS;
});

const resendCalls = () => calls.filter((c) => c.url.includes("api.resend.com"));

test("rejects anything other than POST", async () => {
  const res = await handler(new Request("https://x/.netlify/functions/send-nudge", { method: "GET" }));
  assert.equal(res.status, 405);
});

test("rejects a caller with no session", async () => {
  stubFetch();
  const res = await handler(post(VALID, { auth: null }));
  assert.equal(res.status, 401);
  assert.equal(resendCalls().length, 0);
});

test("rejects a caller whose token Supabase does not recognise", async () => {
  stubFetch({ authOk: false });
  const res = await handler(post(VALID));
  assert.equal(res.status, 401);
  assert.equal(resendCalls().length, 0);
});

test("rejects an invalid payload from an authenticated caller", async () => {
  stubFetch();
  const res = await handler(post({ ...VALID, to: "not-an-email" }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /recipient/);
  assert.equal(resendCalls().length, 0);
});

test("blocks real sends unless DEV_BLOCK_REAL_SENDS is exactly false", async () => {
  for (const flag of [undefined, "true", "TRUE", "", "yes"]) {
    calls = [];
    stubFetch();
    if (flag === undefined) delete process.env.DEV_BLOCK_REAL_SENDS;
    else process.env.DEV_BLOCK_REAL_SENDS = flag;

    const log = console.log;
    console.log = () => {};
    const res = await handler(post(VALID));
    console.log = log;

    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.sent, false, `flag ${JSON.stringify(flag)} should block`);
    assert.equal(payload.blocked, true);
    assert.equal(resendCalls().length, 0, `flag ${JSON.stringify(flag)} reached Resend`);
  }
});

test("sends through Resend when explicitly unblocked", async () => {
  process.env.DEV_BLOCK_REAL_SENDS = "false";
  stubFetch();
  const res = await handler(post(VALID));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sent: true, id: "re_1" });

  const [call] = resendCalls();
  assert.equal(call.init.headers.Authorization, "Bearer re_test_key");
  const sent = JSON.parse(call.init.body);
  assert.deepEqual(sent.to, [VALID.to]);
  assert.equal(sent.subject, VALID.subject);
  assert.equal(sent.text, VALID.body);
  assert.ok(sent.from.includes("@"));
  assert.ok(sent.html.includes("white-space:pre-wrap"));
});

test("surfaces a Resend rejection rather than reporting success", async () => {
  process.env.DEV_BLOCK_REAL_SENDS = "false";
  stubFetch({ resendStatus: 422, resendBody: { message: "Domain is not verified" } });
  const err = console.error;
  console.error = () => {};
  const res = await handler(post(VALID));
  console.error = err;
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /not verified/);
});

test("fails loudly when the API key is missing", async () => {
  process.env.DEV_BLOCK_REAL_SENDS = "false";
  delete process.env.RESEND_API_KEY;
  stubFetch();
  const res = await handler(post(VALID));
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /RESEND_API_KEY/);
  assert.equal(resendCalls().length, 0);
});
