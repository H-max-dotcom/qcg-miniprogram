// 一级分类图标映射（独立模块，零依赖）
//
// 用途：把「分类名」映射成「包内本地图标路径」。首页分类宫格与分类页左栏共用同一份，
//       避免两处规则漂移。
//
// 素材：miniprogram/assets/icons/ 下 9 张 PNG（8 个专区 + 1 张通用兜底），
//       统一 128x128 透明画布，内容等比缩放至最长边 96px 居中。
//
//   分类名     → 图标文件
//   调料专区   → icon-seasoning.png      冷链专区 → icon-coldchain.png
//   干货专区   → icon-drygoods.png       配料专区 → icon-ingredients.png
//   粮油专区   → icon-grain.png          香精专区 → icon-flavor.png
//   酒水专区   → icon-alcohol.png        用品专区 → icon-supplies.png
//   其他/未匹配→ icon-default.png（兜底，绝不返回空字符串，避免宫格或左栏开天窗）
//
// 接入方式：把本文件放到 miniprogram/utils/ 下，9 张 PNG 放到 miniprogram/assets/icons/ 下即可。
//           不依赖 scaffold、不依赖 utils/request、不依赖网络，可直接同步到其他小程序工程。

const CATEGORY_ICON_DIR = "/assets/icons";
const DEFAULT_CATEGORY_ICON = CATEGORY_ICON_DIR + "/icon-default.png";

// 名称关键字 → 图标文件名。数组顺序即优先级：先命中先返回。
const CATEGORY_ICON_MAP = [
  { key: "调料", icon: "seasoning" },
  { key: "冷链", icon: "coldchain" },
  { key: "干货", icon: "drygoods" },
  { key: "配料", icon: "ingredients" },
  { key: "粮油", icon: "grain" },
  { key: "香精", icon: "flavor" },
  { key: "酒", icon: "alcohol" },
  { key: "用品", icon: "supplies" },
];

// 分类名 → 图标路径；匹配不到一律 icon-default。
// 用 indexOf 做「包含」匹配，因此「酒水专区」「进口酒类」都会命中关键字「酒」；
// 若后端出现「酒具用品」这类同时含「酒」和「用品」的名字，会按上面的顺序命中「酒」。
function categoryIconPath(name) {
  const text = String(name || "").trim();
  if (!text) return DEFAULT_CATEGORY_ICON;
  for (let i = 0; i < CATEGORY_ICON_MAP.length; i += 1) {
    if (text.indexOf(CATEGORY_ICON_MAP[i].key) >= 0) {
      return CATEGORY_ICON_DIR + "/icon-" + CATEGORY_ICON_MAP[i].icon + ".png";
    }
  }
  return DEFAULT_CATEGORY_ICON;
}

module.exports = {
  CATEGORY_ICON_DIR,
  DEFAULT_CATEGORY_ICON,
  CATEGORY_ICON_MAP,
  categoryIconPath,
};
