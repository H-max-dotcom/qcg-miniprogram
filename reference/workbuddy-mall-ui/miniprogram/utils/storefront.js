const STOREFRONTS = [
  { code: "zhenshang", name: "全渠供", brand: "全渠供" },
];

const DEFAULT_STOREFRONT_CODE = "zhenshang";
const STORE_KEY = "QCG_STOREFRONT_CODE";

const SCENE_MAP = {
  zs: "zhenshang",
  zhenshang: "zhenshang",
  sf_zhenshang: "zhenshang",
  qcg: "zhenshang",
  quanqugong: "zhenshang",
};

function normalizeStorefrontCode(code) {
  return typeof code === "string" ? code.trim().toLowerCase() : "";
}

function isAllowedStorefrontCode(code) {
  return STOREFRONTS.some((item) => item.code === normalizeStorefrontCode(code));
}

function getStorefront(code) {
  const normalized = normalizeStorefrontCode(code);
  return STOREFRONTS.find((item) => item.code === normalized) || STOREFRONTS[0];
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value || "");
  } catch (error) {
    return value || "";
  }
}

function parseScene(scene) {
  const decoded = normalizeStorefrontCode(safeDecode(scene));
  if (!decoded) return "";
  if (SCENE_MAP[decoded]) return SCENE_MAP[decoded];

  const pairs = decoded.split("&");
  for (let index = 0; index < pairs.length; index += 1) {
    const parts = pairs[index].split("=");
    if (parts.length === 2 && ["storefrontcode", "mallcode", "code"].includes(parts[0])) {
      const mapped = SCENE_MAP[parts[1]] || parts[1];
      if (isAllowedStorefrontCode(mapped)) return mapped;
    }
  }
  return "";
}

function getCachedStorefrontCode() {
  return DEFAULT_STOREFRONT_CODE;
}

function saveStorefrontCode(code) {
  wx.setStorageSync(STORE_KEY, DEFAULT_STOREFRONT_CODE);
}

function resolveStorefrontEntrance(query) {
  const sourceScene = safeDecode((query && query.scene) || "");
  return {
    storefrontCode: DEFAULT_STOREFRONT_CODE,
    sourceScene: sourceScene || "single_storefront",
  };
}

module.exports = {
  STOREFRONTS,
  DEFAULT_STOREFRONT_CODE,
  STORE_KEY,
  normalizeStorefrontCode,
  isAllowedStorefrontCode,
  getStorefront,
  getCachedStorefrontCode,
  saveStorefrontCode,
  resolveStorefrontEntrance,
};
