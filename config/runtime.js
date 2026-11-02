const MALL055_LOCAL_CONFIG = typeof require === "function" ? require("./mall055-local") : { enabled: false };
const MALL055_LOCAL_API_BASE = "http://127.0.0.1:3560";
const PRODUCTION_API_BASE = "https://erp.wzzhenshang.com";
const ACCEPTANCE_API_BASE = "https://mall-acceptance.wzzhenshang.com";
// Final Composite previews and trials are pinned to the isolated 060 backend.
const ISOLATED_API_BASE = `${ACCEPTANCE_API_BASE}/__mall060`;
const TRIAL_API_BASE = ISOLATED_API_BASE;

const API_BASES = Object.freeze({
  development: ISOLATED_API_BASE,
  acceptance: TRIAL_API_BASE,
  production: PRODUCTION_API_BASE,
});

const ENV_VERSION_TO_RUNTIME_MODE = Object.freeze({
  develop: "development",
  trial: "acceptance",
  release: "production",
});

function runtimeError(code, message) {
  return Object.assign(new Error(message), { code });
}

function parseOrigin(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return null;
  const match = /^(https?):\/\/(\[[^\]]+\]|[^\/:?#]+)(?::(\d{1,5}))?$/i.exec(text);
  if (!match || match[2].includes("@")) return null;
  const port = match[3] ? Number(match[3]) : null;
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null;
  const protocol = match[1].toLowerCase();
  const hostname = match[2].toLowerCase();
  return {
    origin: `${protocol}://${hostname}${port === null ? "" : `:${port}`}`,
    protocol,
    hostname,
  };
}

function parseApiBase(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  const match = /^(https?:\/\/[^/?#]+)(\/[^?#]*)?$/i.exec(text);
  if (!match) return null;
  const origin = parseOrigin(match[1]);
  if (!origin) return null;
  return Object.assign({}, origin, { path: match[2] || "", base: origin.origin + (match[2] || "") });
}

function normalizedOrigin(value) {
  const parsed = parseOrigin(value);
  return parsed ? parsed.origin : "";
}


function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function getWechatEnvVersion() {
  if (typeof wx === "undefined" || typeof wx.getAccountInfoSync !== "function") {
    throw runtimeError("MALL_RUNTIME_ENV_MISSING", "无法读取小程序环境版本，已停止商城请求");
  }
  const account = wx.getAccountInfoSync();
  const envVersion = String((account && account.miniProgram && account.miniProgram.envVersion) || "").trim().toLowerCase();
  if (!envVersion) {
    throw runtimeError("MALL_RUNTIME_ENV_MISSING", "小程序环境版本缺失，已停止商城请求");
  }
  return envVersion;
}

function resolveRuntimeMode(envVersion) {
  const normalized = String(envVersion || "").trim().toLowerCase();
  const runtimeMode = ENV_VERSION_TO_RUNTIME_MODE[normalized];
  if (!runtimeMode) {
    throw runtimeError("MALL_RUNTIME_ENV_INVALID", "小程序环境版本无效，已停止商城请求");
  }
  return runtimeMode;
}

function resolveMallApiBase(runtimeMode, apiBases) {
  const mode = String(runtimeMode || "").trim().toLowerCase();
  const bases = apiBases || API_BASES;
  if (!Object.prototype.hasOwnProperty.call(API_BASES, mode)) {
    throw runtimeError("MALL_RUNTIME_ENV_INVALID", "商城服务暂不可用，请联系管理员");
  }

  const target = parseApiBase(bases[mode]);
  if (!target) {
    const code = mode === "acceptance" ? "MALL_ACCEPTANCE_API_INVALID" : mode === "production" ? "MALL_PRODUCTION_API_INVALID" : "MALL_ISOLATED_API_MISSING";
    throw runtimeError(code, "商城服务暂不可用，请联系管理员");
  }

  const production = parseOrigin(PRODUCTION_API_BASE);
  if (!production) {
    throw runtimeError("MALL_PRODUCTION_API_INVALID", "商城服务暂不可用，请联系管理员");
  }

  if (mode === "development" || mode === "acceptance") {
    if (target.protocol !== "https" || isLoopbackHostname(target.hostname) ||
        target.base !== ISOLATED_API_BASE || target.origin === production.origin) {
      throw runtimeError("MALL_ACCEPTANCE_TARGET_INVALID", "商城验收服务暂不可用，请联系管理员");
    }
  } else if (target.base !== production.origin) {
    throw runtimeError("MALL_RELEASE_TARGET_INVALID", "商城服务暂不可用，请联系管理员");
  }

  return target.base;
}

function getMallRuntime() {
  const envVersion = getWechatEnvVersion();
  const runtimeMode = resolveRuntimeMode(envVersion);
  const local055 = MALL055_LOCAL_CONFIG.enabled === true && envVersion === "develop"
    && typeof wx.getSystemInfoSync === "function" && wx.getSystemInfoSync().platform === "devtools";
  return {
    envVersion,
    runtimeMode,
    apiBase: local055 ? MALL055_LOCAL_API_BASE : resolveMallApiBase(runtimeMode),
  };
}

function isMall055LocalRuntime() {
  return getMallRuntime().apiBase === MALL055_LOCAL_API_BASE;
}

function getApiBase() {
  return getMallRuntime().apiBase;
}

function assertMallRequestTarget(url) {
  const runtime = getMallRuntime();
  const text = String(url || "");
  // Do not let the network stack normalize an ambiguous authority or path outside the configured acceptance path.
  if (/[\s\\]/.test(text)) throw runtimeError("MALL_REQUEST_TARGET_INVALID", "商城服务暂不可用，请联系管理员");
  const match = /^(https?:\/\/[^/?#]+)([^?#]*)(?:\?[^#]*)?$/i.exec(text);
  const targetOrigin = match && normalizedOrigin(match[1]);
  if (!targetOrigin) throw runtimeError("MALL_REQUEST_TARGET_INVALID", "商城服务暂不可用，请联系管理员");
  const base = parseApiBase(runtime.apiBase);
  const pathname = match[2] || "/";
  // Encoded separators/dot segments can be decoded again by proxies. Reject them
  // rather than guessing how each hop will canonicalize the target.
  if (/%(?:2e|2f|5c|25)/i.test(pathname) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(pathname) || pathname.includes("//")) {
    throw runtimeError("MALL_REQUEST_TARGET_INVALID", "商城服务暂不可用，请联系管理员");
  }
  if (!base || targetOrigin !== base.origin || (base.path && pathname !== base.path && !pathname.startsWith(base.path + "/"))) {
    throw runtimeError("MALL_REQUEST_TARGET_MISMATCH", "商城服务暂不可用，请联系管理员");
  }
  if (runtime.runtimeMode === "development" && targetOrigin === normalizedOrigin(PRODUCTION_API_BASE)) {
    throw runtimeError("FAIL_PRODUCTION_TARGET_DETECTED", "商城服务暂不可用，请联系管理员");
  }
  return runtime;
}

module.exports = {
  API_BASES,
  TRIAL_API_BASE,
  ACCEPTANCE_API_BASE,
  PRODUCTION_API_BASE,
  ISOLATED_API_BASE,
  ENV_VERSION_TO_RUNTIME_MODE,
  normalizedOrigin,
  getWechatEnvVersion,
  resolveRuntimeMode,
  resolveMallApiBase,
  getMallRuntime,
  getApiBase,
  isMall055LocalRuntime,
  assertMallRequestTarget,
};
