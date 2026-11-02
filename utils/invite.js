const MALL_INVITE_SCENE_STORAGE_KEY = "qcg.mall.invite.scene.v1";
const INVITE_SCENE_PATTERN = /^i[A-Za-z0-9_-]{30}$/;

let navigating = false;

function normalizeInviteScene(value) {
  const text = String(value || "").trim();
  return INVITE_SCENE_PATTERN.test(text) ? text : "";
}

function saveInviteScene(value) {
  const scene = normalizeInviteScene(value);
  if (!scene || typeof wx === "undefined" || typeof wx.setStorageSync !== "function") return "";
  try {
    wx.setStorageSync(MALL_INVITE_SCENE_STORAGE_KEY, scene);
    return scene;
  } catch {
    return "";
  }
}

function readInviteScene() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return "";
  try {
    const scene = normalizeInviteScene(wx.getStorageSync(MALL_INVITE_SCENE_STORAGE_KEY));
    if (!scene) clearInviteScene();
    return scene;
  } catch {
    return "";
  }
}

function clearInviteScene() {
  if (typeof wx === "undefined" || typeof wx.removeStorageSync !== "function") return;
  try {
    wx.removeStorageSync(MALL_INVITE_SCENE_STORAGE_KEY);
  } catch {
    // Fail closed without logging invitation material.
  }
}

function captureInviteEntrance(query) {
  const input = query || {};
  return saveInviteScene(input.inviteScene || input.scene);
}

function inviteConfirmUrl(storefrontCode, scene) {
  const value = normalizeInviteScene(scene) || readInviteScene();
  if (!value) return "";
  return `/pages/auth/invite-confirm?inviteScene=${encodeURIComponent(value)}&storefrontCode=${encodeURIComponent(storefrontCode || "zhenshang")}`;
}

function navigateToPendingInvite(storefrontCode) {
  const url = inviteConfirmUrl(storefrontCode);
  if (!url || navigating || typeof wx === "undefined" || typeof wx.navigateTo !== "function") return false;
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  const current = pages.length ? pages[pages.length - 1] : null;
  if (current && current.route === "pages/auth/invite-confirm") return false;
  navigating = true;
  wx.navigateTo({
    url,
    complete() {
      navigating = false;
    },
  });
  return true;
}

module.exports = {
  MALL_INVITE_SCENE_STORAGE_KEY,
  INVITE_SCENE_PATTERN,
  normalizeInviteScene,
  saveInviteScene,
  readInviteScene,
  clearInviteScene,
  captureInviteEntrance,
  inviteConfirmUrl,
  navigateToPendingInvite,
};
