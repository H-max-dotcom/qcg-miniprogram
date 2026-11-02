// 本地演示脚手架（scaffold）
//
// 目的：后端目前只配了 1 个内部验收分类、0 个活动、0 个商品，导致首页与分类页
//       大面积空白，没法做后续的视觉创作。这里提供一层「本地演示数据兜底」：
//
//   · 后端有真实数据  → 原样使用后端数据，本模块不介入
//   · 后端数据为空/只有内部验收数据 → 用本地演示数据补齐，页面立刻有内容可看可改
//
// 边界（重要）：
//   1. 演示数据一律带 __demo: true 标记，且**不带 priceAccess**，
//      因此永远不会被判定为"可见价格/可下单"，价格区仍显示"登录后查看价格"。
//   2. 不修改 utils/request.js、config/ 与任何身份/价格/库存/订单/支付逻辑。
//   3. 演示素材在 assets/demo/ 下，全部包内文件，不依赖接口域名。
//   4. 想整体关掉：把 DEMO_ENABLED 改为 false。

const catalog = require("./demo-catalog");
const { resolveMallAssetUrl } = require("../utils/request");
// 分类图标映射：已抽成独立零依赖模块，便于单独同步到其他工程
const {
  CATEGORY_ICON_DIR,
  DEFAULT_CATEGORY_ICON,
  CATEGORY_ICON_MAP,
  categoryIconPath,
} = require("../utils/category-icons");

const DEMO_ENABLED = true;

// 后端已经有公开分类时，是否把「参考稿里有、后端还没配」的分类补上。
// 当前 true：左栏要凑齐 调料/冷链/干货/配料/粮油/香精/酒水/用品 八个专区，
// 后端目前只有前 3 个，所以其余 5 个用演示分类补齐（点进去是演示商品，带 __demo 标记）。
// 只想看后端真实分类时改成 false。
const DEMO_FILL_MISSING_CATEGORIES = true;

// 内部/验收类分类名，不对外展示（真实后端出现这类名字时会被过滤掉）
const INTERNAL_NAME_RE = /非生产验收|内部验收|内部测试|验收环境|测试分类|\btest\b|\bdemo\b|acceptance/i;
// 形如 "098D"、"09B"、"104" 这类纯编号分类名
const CODE_LIKE_RE = /^\s*\d{2,4}[a-z]?\s*$/i;

function isInternalCategoryName(value) {
  const name = String(value || "").trim();
  if (!name) return true;
  return INTERNAL_NAME_RE.test(name) || CODE_LIKE_RE.test(name);
}

function isInternalCategory(item) {
  if (!item || typeof item !== "object") return true;
  return isInternalCategoryName(item.name || item.categoryName);
}

// 本地演示素材不能被拼上接口域名，否则图片全部 404
function demoAwareAssetUrl(item, raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (item && item.__demo === true) return value;
  return resolveMallAssetUrl(value);
}

// ---- 分类图标（设计师提供，assets/icons/）---------------------------------
// 映射表与兜底逻辑已抽到独立零依赖模块 utils/category-icons.js，本文件仅在上面 require
// 并原样透传导出，供既有调用方（首页宫格 / 分类页左栏）继续使用。

// ---- 演示分类 -------------------------------------------------------------

function countProducts(categoryId) {
  return catalog.PRODUCTS.filter((p) => p.categoryId === categoryId || p.subCategoryId === categoryId).length;
}

function demoCategories() {
  const primaries = catalog.PRIMARY_CATEGORIES.map((c) => ({
    __demo: true,
    id: c.id,
    parentId: null,
    level: 1,
    name: c.name,
    rawName: c.name,
    imageUrl: categoryIconPath(c.name),
    iconText: "",
    sort: c.sort,
    sortNo: c.sort,
    productCount: countProducts(c.id),
  }));
  const subs = catalog.SUB_CATEGORIES.map((c) => ({
    __demo: true,
    id: c.id,
    parentId: c.parentId,
    level: 2,
    name: c.name,
    rawName: c.name,
    imageUrl: "",
    iconText: "",
    sort: c.sort,
    sortNo: c.sort,
    productCount: countProducts(c.id),
  }));
  return primaries.concat(subs);
}

// 过滤内部/验收分类；规则：
//   · 后端已有真实一级分类 → 只保留真实的（真实数据优先，便于核对接口）
//   · 后端一条可用分类都没有 → 全部用演示分类
//   · DEMO_FILL_MISSING_CATEGORIES = true 时，额外补齐参考稿里存在但后端还没配的一级分类
function resolveCategories(backendItems) {
  const source = (Array.isArray(backendItems) ? backendItems : []).filter((item) => item && (item.id || item.name));
  const publicItems = source.filter((item) => !isInternalCategory(item));
  if (!DEMO_ENABLED) return publicItems;
  if (!publicItems.length) return demoCategories();
  if (!DEMO_FILL_MISSING_CATEGORIES) return publicItems;

  const existingNames = {};
  publicItems.forEach((item) => { existingNames[String(item.name || "").trim()] = true; });
  const missingPrimaries = catalog.PRIMARY_CATEGORIES.filter((c) => !existingNames[c.name]);
  if (!missingPrimaries.length) return publicItems;

  const missingIds = {};
  missingPrimaries.forEach((c) => { missingIds[c.id] = true; });
  const extra = demoCategories().filter((item) => missingIds[item.id]
    || (item.parentId && missingIds[item.parentId]));
  return publicItems.concat(extra);
}

// 该门店后端是否已经有真实商品（用分类的 productCount 判断，不额外发请求）
function hasRealProducts(categories) {
  return (Array.isArray(categories) ? categories : [])
    .some((item) => Number(item && item.productCount) > 0);
}

// ---- 演示商品 -------------------------------------------------------------

function toProductDto(record) {
  const unitName = record.minOrderText || "件";
  return {
    __demo: true,
    id: record.id,
    productId: record.id,
    name: record.name,
    mallTitle: record.name,
    displayName: record.name,
    shortDescription: record.brand + " · " + record.categoryName,
    brandName: record.brand,
    categoryId: record.categoryId,
    mallCategoryId: record.categoryId,
    subCategoryId: record.subCategoryId,
    imageUrl: record.imageUrl,
    image: record.imageUrl,
    imageUrls: [record.imageUrl],
    spec: record.specText,
    mallSpecText: record.specText,
    saleMode: "STANDARD",
    baseUnit: unitName,
    unitName,
    minOrderQty: 1,
    allowDecimalQuantity: false,
    canOrderByStock: true,
    stockStatus: "IN_STOCK",
    stockText: "库存以结算时为准",
    tags: [record.brand, record.categoryName],
    specOptions: [
      {
        productUnitId: record.id + "-U1",
        unitName,
        displayUnitLabel: record.specText,
        specName: record.specText,
        isDefault: true,
        isActive: true,
        mallSellable: true,
        // 演示商品不提供价格与下单能力（后端没有这批货）
        canOrder: false,
        priceVisible: false,
        displayPrice: "",
        minOrderQty: 1,
        allowDecimalQuantity: false,
      },
    ],
  };
}

function demoProductsDto() {
  return catalog.PRODUCTS.map(toProductDto);
}

function matchProducts(query) {
  const q = query || {};
  const categoryId = String(q.categoryId || "");
  const keyword = String(q.keyword || "").trim().toLowerCase();
  const brand = String(q.brandName || "").trim();
  let items = demoProductsDto();
  if (categoryId) {
    items = items.filter((p) => p.categoryId === categoryId || p.subCategoryId === categoryId);
  }
  if (keyword) {
    items = items.filter((p) => (p.name + " " + p.brandName + " " + p.spec).toLowerCase().indexOf(keyword) >= 0);
  }
  if (brand) {
    items = items.filter((p) => p.brandName === brand);
  }
  if (String(q.section || "") !== "all" && q.section) {
    // section 只用于区分楼层，这里按 section 名做稳定重排，保证不同楼层内容不完全相同
    const offset = String(q.section).length % items.length;
    items = items.slice(offset).concat(items.slice(0, offset));
  }
  if (q.sort === "latest") items = items.slice().reverse();
  return items;
}

// ---- 对外的三个入口（在页面的请求回调里调用） --------------------------------

// 1) pages/index：/api/mall/home
function applyHome(result) {
  if (!DEMO_ENABLED || !result || typeof result !== "object") return result;
  const out = Object.assign({}, result);

  const categories = resolveCategories(out.mallCategoryItems || out.categories);
  out.categories = categories;
  out.categoryEntries = categories;
  out.mallCategoryItems = categories;

  const backendBanners = (Array.isArray(out.banners) ? out.banners : [])
    .filter((b) => b && String(b.imageUrl || "").trim());
  out.banners = backendBanners.length
    ? backendBanners
    : catalog.BANNERS.map((b) => Object.assign({ __demo: true }, b));

  const backendActivities = Array.isArray(out.weeklyActivities) ? out.weeklyActivities : [];
  out.weeklyActivities = backendActivities.length
    ? backendActivities
    : catalog.ACTIVITIES.map((a) => Object.assign({ __demo: true }, a));

  if (!Array.isArray(out.brands) || !out.brands.length) out.brands = catalog.BRANDS.slice();

  // 后端已有真实商品时，绝不混入演示商品：首页楼层留空，由页面去 /api/mall/products 取真实商品
  if (hasRealProducts(categories)) return out;

  const all = demoProductsDto();
  const sections = Array.isArray(out.productSections) ? out.productSections : [];
  const hasShelfProducts = sections.some((s) => s && Array.isArray(s.products) && s.products.length);
  if (!hasShelfProducts && sections.length) {
    const plan = { frequent: 8, featured: 6, promotion: 6, new: 6, hot: 6 };
    out.productSections = sections.map((s, index) => {
      const take = plan[s.key] || 6;
      const offset = (index * 3) % Math.max(all.length, 1);
      const rotated = all.slice(offset).concat(all.slice(0, offset));
      return Object.assign({}, s, { products: rotated.slice(0, take) });
    });
  }
  if (!Array.isArray(out.restockProducts) || !out.restockProducts.length) {
    out.restockProducts = all.slice(0, 4);
  }
  if (!Array.isArray(out.recommendProducts) || !out.recommendProducts.length) {
    out.recommendProducts = all.slice(4, 10);
  }
  return out;
}

// 2) pages/category：/api/mall/categories
function applyCategories(result) {
  if (!result || typeof result !== "object") return result;
  const items = resolveCategories(result.items || result.categories);
  return Object.assign({}, result, {
    categories: items,
    items,
    brands: (Array.isArray(result.brands) && result.brands.length) ? result.brands : catalog.BRANDS.slice(),
  });
}

// 3) pages/category：/api/mall/products
function applyProducts(result, query) {
  if (!result || typeof result !== "object") return result;
  const backend = (Array.isArray(result.items) ? result.items : []).filter((item) => item && (item.id || item.productId));
  if (backend.length || !DEMO_ENABLED) return result;
  const items = matchProducts(query);
  const page = Number(query && query.page) || 1;
  const pageSize = Number(query && query.pageSize) || 30;
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return Object.assign({}, result, {
    items: slice,
    total: items.length,
    page,
    pageSize,
    hasNextPage: start + pageSize < items.length,
  });
}

module.exports = {
  DEMO_ENABLED,
  DEMO_FILL_MISSING_CATEGORIES,
  isInternalCategoryName,
  hasRealProducts,
  demoAwareAssetUrl,
  categoryIconPath,
  CATEGORY_ICON_DIR,
  DEFAULT_CATEGORY_ICON,
  resolveCategories,
  demoCategories,
  matchProducts,
  applyHome,
  applyCategories,
  applyProducts,
};
