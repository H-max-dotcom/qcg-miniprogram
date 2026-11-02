const { request } = require("./request");
function prepare(page) {
  page._subscribeChallenge = null;
  return request({ path: "/api/mall/subscriptions", method: "POST", storefrontCode: page.data.storefrontCode, data: { action: "prepare" } })
    .then(result => { page._subscribeChallenge = result.ready ? result : null; page.setData({ subscribeReady: !!result.ready }); })
    .catch(() => page.setData({ subscribeReady: false }));
}
// Called synchronously by a user tap; no network await before the native authorization dialog.
function requestFromTap(page) {
  const challenge = page._subscribeChallenge;
  if (!challenge || !wx.requestSubscribeMessage) { wx.showToast({ title: "提醒暂不可用，请稍后重试", icon: "none" }); return; }
  page._subscribeChallenge = null;
  page.setData({ subscribeReady: false });
  wx.requestSubscribeMessage({ tmplIds: challenge.templates,
    success(results) {
      request({ path: "/api/mall/subscriptions", method: "POST", storefrontCode: page.data.storefrontCode,
        data: { action: "record", challenge: challenge.challenge, results } })
        .then(() => wx.showToast({ title: challenge.templates.some(id => results[id] === "accept") ? "已记录提醒授权" : "未开启提醒", icon: "none" }))
        .catch(() => wx.showToast({ title: "授权记录失败，请重试", icon: "none" }))
        .finally(() => prepare(page));
    },
    fail() { wx.showToast({ title: "未开启提醒", icon: "none" }); prepare(page); },
  });
}
module.exports = { prepare, requestFromTap };
