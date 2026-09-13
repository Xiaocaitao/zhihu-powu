import { ZhihuError } from "./errors.ts";
import { parseJson } from "./transport.ts";

export type ZhihuOAuthProfile = {
  uid: string;
  hash_id?: string | null;
  fullname?: string | null;
  gender?: string | null;
  headline?: string | null;
  description?: string | null;
  avatar_path?: string | null;
  url?: string | null;
  email?: string | null;
  phone_no?: string | null;
};

export type ZhihuOAuthProvider = {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<{ accessToken: string; expiresAt: number }>;
  getUserInfo(accessToken: string): Promise<ZhihuOAuthProfile>;
};

type OAuthOptions = { fetch?: typeof fetch; now?: () => number };

function config() {
  const appId = process.env.ZHIHU_OAUTH_APP_ID?.trim() ?? "";
  const appKey = process.env.ZHIHU_OAUTH_APP_KEY?.trim() ?? "";
  const redirectUri = process.env.ZHIHU_OAUTH_REDIRECT_URI?.trim() ?? "";
  if (!appId || !appKey || !redirectUri) throw new ZhihuError("OAUTH_CONFIG_REQUIRED", "请配置 ZHIHU_OAUTH_APP_ID、ZHIHU_OAUTH_APP_KEY 和 ZHIHU_OAUTH_REDIRECT_URI。 ");
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch { throw new ZhihuError("OAUTH_CONFIG_INVALID", "知乎 OAuth 回调地址无效。 "); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname);
  if (redirect.username || redirect.password || redirect.hash || (redirect.protocol !== "https:" && !(local && redirect.protocol === "http:"))) {
    throw new ZhihuError("OAUTH_CONFIG_INVALID", "知乎 OAuth 回调地址必须使用 HTTPS（本机开发可使用 HTTP）。");
  }
  return { appId, appKey, redirectUri };
}

function unwrap(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return object.data ?? object.Data ?? value;
}

async function json(response: Response): Promise<unknown> {
  let body: unknown;
  try { body = parseJson(await response.text()); } catch { throw new ZhihuError("OAUTH_INVALID_RESPONSE", "知乎 OAuth 接口未返回有效 JSON。", response.status); }
  if (!response.ok) throw new ZhihuError("OAUTH_FAILED", "知乎 OAuth 请求失败，请重新登录。", response.status);
  return body;
}

export function createZhihuOAuth(options: OAuthOptions = {}): ZhihuOAuthProvider {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  return {
    authorizationUrl(state) {
      const { appId, redirectUri } = config();
      const url = new URL("https://openapi.zhihu.com/authorize");
      url.search = new URLSearchParams({ redirect_uri: redirectUri, app_id: appId, response_type: "code", state }).toString();
      return url.toString();
    },
    async exchangeCode(code) {
      if (!code.trim()) throw new ZhihuError("OAUTH_CODE_REQUIRED", "知乎 OAuth 回调缺少 authorization_code。 ");
      const { appId, appKey, redirectUri } = config();
      const response = await request("https://openapi.zhihu.com/access_token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ app_id: appId, app_key: appKey, grant_type: "authorization_code", redirect_uri: redirectUri, code }),
        redirect: "error",
      });
      const raw = unwrap(await json(response));
      const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const accessToken = typeof data.access_token === "string" ? data.access_token : "";
      const expiresIn = typeof data.expires_in === "number" ? data.expires_in : Number(data.expires_in);
      if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new ZhihuError("OAUTH_INVALID_RESPONSE", "知乎 OAuth 响应缺少有效 access_token。 ");
      return { accessToken, expiresAt: now() + expiresIn * 1000 };
    },
    async getUserInfo(accessToken) {
      if (!accessToken.trim()) throw new ZhihuError("OAUTH_TOKEN_REQUIRED", "知乎 OAuth access_token 缺失。 ");
      const response = await request("https://openapi.zhihu.com/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: "error",
      });
      const raw = unwrap(await json(response));
      const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      if (data.uid === undefined || data.uid === null) throw new ZhihuError("OAUTH_INVALID_RESPONSE", "知乎用户信息响应缺少 uid。 ");
      const profile: ZhihuOAuthProfile = {
        uid: String(data.uid),
        hash_id: typeof data.hash_id === "string" ? data.hash_id : null,
        fullname: typeof data.fullname === "string" ? data.fullname : null,
        gender: typeof data.gender === "string" ? data.gender : null,
        headline: typeof data.headline === "string" ? data.headline : null,
        description: typeof data.description === "string" ? data.description : null,
        avatar_path: typeof data.avatar_path === "string" ? data.avatar_path : null,
        url: typeof data.url === "string" ? data.url : null,
        email: typeof data.email === "string" ? data.email : null,
        phone_no: typeof data.phone_no === "string" ? data.phone_no : null,
      };
      return profile;
    },
  };
}
