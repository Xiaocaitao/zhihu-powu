import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createZhihuOAuth } from "../src/integrations/zhihu/oauth.ts";
import { createPowuServer } from "../src/server.ts";

function withEnv(values: Record<string, string>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  return run().finally(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test("知乎 OAuth provider uses authorization code and keeps uid as a string", async () => withEnv({
  ZHIHU_OAUTH_APP_ID: "476",
  ZHIHU_OAUTH_APP_KEY: "test-app-key",
  ZHIHU_OAUTH_REDIRECT_URI: "https://example.test/auth/zhihu/callback",
}, async () => {
  const requests: Request[] = [];
  const oauth = createZhihuOAuth({
    now: () => 1_000,
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      if (String(input).endsWith("/access_token")) return new Response(JSON.stringify({ access_token: "secret-token", expires_in: 3600 }), { status: 200 });
      return new Response('{"uid":9007199254740993,"fullname":"测试用户"}', { status: 200 });
    },
  });
  const authorizationUrl = oauth.authorizationUrl("state-value");
  assert.equal(new URL(authorizationUrl).searchParams.get("app_id"), "476");
  assert.equal(new URL(authorizationUrl).searchParams.get("state"), "state-value");
  assert.equal(authorizationUrl.includes("test-app-key"), false);
  const token = await oauth.exchangeCode("one-time-code");
  assert.equal(token.accessToken, "secret-token");
  assert.equal(token.expiresAt, 3_601_000);
  const profile = await oauth.getUserInfo(token.accessToken);
  assert.equal(profile.uid, "9007199254740993");
  assert.equal(requests[0].headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.match(await requests[0].text(), /app_id=476/);
  assert.equal(requests[1].headers.get("authorization"), "Bearer secret-token");
}));

test("OAuth callback binds the profile to the existing owner cookie", async t => {
  const oauth = {
    authorizationUrl: (state: string) => `https://example.test/authorize?state=${encodeURIComponent(state)}`,
    exchangeCode: async (code: string) => { assert.equal(code, "one-time-code"); return { accessToken: "secret-token", expiresAt: Date.now() + 60_000 }; },
    getUserInfo: async (token: string) => { assert.equal(token, "secret-token"); return { uid: "12345", fullname: "测试用户" }; },
  };
  const server = createPowuServer({ oauth });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const start = await fetch(`${base}/auth/zhihu/start`, { redirect: "manual" });
  assert.equal(start.status, 302);
  const cookie = start.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const callback = await fetch(`${base}/auth/zhihu/callback?authorization_code=one-time-code`, { headers: { cookie }, redirect: "manual" });
  assert.equal(callback.status, 302);
  const status = await fetch(`${base}/api/auth/zhihu/status`, { headers: { cookie } });
  assert.deepEqual(await status.json(), { ok: true, authorized: true, profile: { uid: "12345", fullname: "测试用户" }, uid: "12345", state_verified: false, error: null });
});
