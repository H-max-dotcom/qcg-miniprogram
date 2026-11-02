const { getMallCartCustomerId } = require("./request");
const CART_KEY = "QCG_CART_ITEMS_V3";
const MISSING_PRODUCT_UNIT_MESSAGE = "请重新选择规格后再加入购物车";

function getCartLineKey(item) {
  return `${String((item && item.productId) || "")}:${String((item && item.productUnitId) || "")}`;
}

function getCartKey(storefrontCode) {
  const code = String(storefrontCode || "zhenshang").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "zhenshang";
  const customerId = getMallCartCustomerId(code);
  // Never adopt an older storefront-only draft whose customer is unknown.
  return customerId ? `${CART_KEY}:${code}:customer:${encodeURIComponent(customerId)}` : "";
}

function isBlockedCartProduct(product) {
  const productId = String((product && (product.id || product.productId)) || "");
  return (
    productId.indexOf("demo-") === 0 ||
    productId.indexOf("fallback-") === 0 ||
    !!(product && (product.isFallback || product.isDemo || product.isMock))
  );
}

function hasValidProductUnitId(item) {
  return !!String((item && item.productUnitId) || "").trim();
}

function sanitizeCartItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const productId = String((item && item.productId) || "").trim();
      const productUnitId = String((item && item.productUnitId) || "").trim();
      if (!productId || !productUnitId) {
        return Object.assign({}, item, {
          productId,
          productUnitId: "",
          lineKey: productId ? `${productId}:` : "",
          invalidReason: MISSING_PRODUCT_UNIT_MESSAGE,
          canOrder: false,
          canAddToCart: false,
          priceVisible: false,
        });
      }
      return Object.assign({}, item, {
        productId,
        productUnitId,
        lineKey: `${productId}:${productUnitId}`,
      });
    })
    .filter((item) => item.productId);
}

function getCartItems(storefrontCode) {
  const key = getCartKey(storefrontCode);
  return key ? sanitizeCartItems(wx.getStorageSync(key) || []) : [];
}

function getCartCount(storefrontCode) {
  return getCartItems(storefrontCode)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function formatCartBadgeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return "";
  if (count > 99) return "99+";
  return String(count);
}

function saveCartItems(items, storefrontCode) {
  if ((items || []).some((item) => item.saleMode === "FIXED_WEIGHT_SPEC" && (!Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1))) return false;
  const key = getCartKey(storefrontCode);
  if (!key) return false;
  const next = sanitizeCartItems(items).filter((item) => hasValidProductUnitId(item));
  wx.setStorageSync(key, next);
  return true;
}

function addCartItem(product, quantity, storefrontCode) {
  if (!product || isBlockedCartProduct(product)) return null;
  const productId = String(product.id || product.productId || "").trim();
  const productUnitId = String(product.productUnitId || "").trim();
  if (!productId || !productUnitId) return null;
  if (product.canOrder === false || product.canAddToCart === false || !product.priceVisible) return null;
  if (!(Number(product.priceValue) > 0 || parseFloat(String(product.displayPrice || "").replace(/[^\d.]/g, "")) > 0)) {
    return null;
  }

  const items = getCartItems(storefrontCode).filter((item) => hasValidProductUnitId(item));
  const lineKey = getCartLineKey({ productId, productUnitId });
  const existing = items.find((item) => getCartLineKey(item) === lineKey);
  const qty = Number(quantity);
  const nextQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const fixed = product.saleMode === "FIXED_WEIGHT_SPEC";
  if (fixed && (!Number.isSafeInteger(qty) || qty < 1 || (existing && !Number.isSafeInteger(Number(existing.quantity))))) return null;
  const allowDecimalQuantity = !fixed && product.allowDecimalQuantity === true;
  const rawMinimum = Number(product.minOrderQty || product.mallMinOrderQty || 1);
  const minOrderQty = fixed ? 1 : allowDecimalQuantity
    ? null
    : (Number.isFinite(rawMinimum) && rawMinimum > 0 ? rawMinimum : 1);
  const minOrderText = fixed ? "1份起订" : allowDecimalQuantity ? "可输入任意正数小数" : `起订量 ${minOrderQty}`;
  if (existing) {
    existing.quantity = Number(existing.quantity || 0) + nextQty;
    existing.saleMode = product.saleMode || "STANDARD";
    existing.baseUnit = product.baseUnit || "";
    existing.unitConversionRate = product.unitConversionRate == null && product.conversionRate == null ? null : String(product.unitConversionRate ?? product.conversionRate);
    existing.priceValue = product.priceValue == null ? null : product.priceValue;
    existing.shareTokens = [...new Set([...(existing.shareTokens || (existing.shareToken ? [existing.shareToken] : [])), ...(product.shareToken ? [product.shareToken] : [])])];
    existing.spec = product.spec || product.specification || existing.spec || "";
    existing.unitName = product.unitName || existing.unitName || "";
    existing.barcode = product.barcode || existing.barcode || "";
    existing.displayPrice = product.displayPrice || existing.displayPrice || "";
    existing.priceVisible = !!product.priceVisible;
    existing.canOrder = product.canOrder !== false && !!product.priceVisible;
    existing.canAddToCart = product.canAddToCart !== false && !!product.priceVisible;
    existing.stockStatus = product.stockStatus || existing.stockStatus || "";
    existing.stockText = product.stockText || product.stockHint || existing.stockText || "";
    existing.minOrderQty = minOrderQty;
    existing.minOrderText = product.minOrderText || minOrderText;
    if (typeof product.allowDecimalQuantity === "boolean") {
      existing.allowDecimalQuantity = allowDecimalQuantity;
    }
    existing.quantityScale = allowDecimalQuantity ? 4 : 0;
    existing.qtyStep = 1;
    if (product.lineRemark) existing.lineRemark = product.lineRemark;
  } else {
    items.push({
      productId,
      productUnitId,
      lineKey,
      name: product.name || product.productName || "未命名商品",
      spec: product.spec || product.specification || "",
      unitName: product.unitName || "",
      barcode: product.barcode || "",
      minOrderQty,
      minOrderText: product.minOrderText || minOrderText,
      allowDecimalQuantity,
      quantityScale: allowDecimalQuantity ? 4 : 0,
      qtyStep: 1,
      quantity: nextQty,
      saleMode: product.saleMode || "STANDARD",
      baseUnit: product.baseUnit || "",
      unitConversionRate: product.unitConversionRate == null && product.conversionRate == null ? null : String(product.unitConversionRate ?? product.conversionRate),
      priceValue: product.priceValue == null ? null : product.priceValue,
      priceVisible: !!product.priceVisible,
      displayPrice: product.displayPrice || "",
      canOrder: product.canOrder !== false && !!product.priceVisible,
      canAddToCart: product.canAddToCart !== false && !!product.priceVisible,
      stockStatus: product.stockStatus || "",
      stockText: product.stockText || product.stockHint || "",
      isFallback: !!product.isFallback,
      isDemo: !!product.isDemo,
      isMock: !!product.isMock,
      lineRemark: product.lineRemark || "",
      shareToken: product.shareToken || "",
      shareTokens: product.shareToken ? [product.shareToken] : [],
    });
  }
  return saveCartItems(items, storefrontCode) ? items : null;
}

function updateCartQuantity(lineKey, quantity, storefrontCode) {
  const current = getCartItems(storefrontCode);
  if (current.some((item) => getCartLineKey(item) === String(lineKey) && item.saleMode === "FIXED_WEIGHT_SPEC" && (!Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1))) return current;
  const nextItems = getCartItems(storefrontCode)
    .filter((item) => hasValidProductUnitId(item))
    .map((item) => (getCartLineKey(item) === String(lineKey) ? Object.assign({}, item, { quantity }) : item))
    .filter((item) => item.quantity > 0);
  saveCartItems(nextItems, storefrontCode);
  return nextItems;
}

function updateCartRemark(lineKey, lineRemark, storefrontCode) {
  const nextItems = getCartItems(storefrontCode)
    .filter((item) => hasValidProductUnitId(item))
    .map((item) => (
      getCartLineKey(item) === String(lineKey) ? Object.assign({}, item, { lineRemark: lineRemark || "" }) : item
    ));
  saveCartItems(nextItems, storefrontCode);
  return nextItems;
}

function clearCart(storefrontCode) {
  const key = getCartKey(storefrontCode);
  if (key) wx.removeStorageSync(key);
}

function repeatPurchaseError(code, message) {
  return Object.assign(new Error(message), { code });
}

function repeatPurchaseQuantity(value) {
  const text = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) throw repeatPurchaseError("MALL_REORDER_INVALID_QUANTITY", "商品数量暂不支持，请手动选购");
  const parts = text.split(".");
  const scaled = Number(parts[0]) * 10000 + Number((parts[1] || "").padEnd(4, "0"));
  if (!Number.isSafeInteger(scaled) || scaled <= 0) throw repeatPurchaseError("MALL_REORDER_INVALID_QUANTITY", "商品数量暂不支持，请手动选购");
  return scaled;
}

function unquotedCartLine(item, quantity) {
  return Object.assign({}, item, { quantity, priceVisible: false, canOrder: false, canAddToCart: false, displayPrice: "", priceValue: null, lineAmount: null });
}

function repeatPurchaseQuantityValue(scaled) {
  if (!Number.isSafeInteger(scaled) || repeatPurchaseQuantity(scaled / 10000) !== scaled) throw repeatPurchaseError("MALL_REORDER_INVALID_QUANTITY", "合并后的商品数量暂不支持，请手动选购");
  return scaled / 10000;
}

// This is a local draft only. Current cart quote remains the price/stock owner.
function prepareRepeatPurchaseItems(orderItems) {
  if (!Array.isArray(orderItems) || !orderItems.length) throw repeatPurchaseError("MALL_REORDER_EMPTY", "订单没有可加入购物车的商品");
  const lines = [];
  for (const row of orderItems) {
    const productId = row && typeof row.productId === "string" ? row.productId.trim() : "";
    const productUnitId = row && typeof row.productUnitId === "string" ? row.productUnitId.trim() : "";
    if (!productId || !productUnitId || isBlockedCartProduct({ productId, isFallback: row.isFallback, isDemo: row.isDemo, isMock: row.isMock })) throw repeatPurchaseError("MALL_REORDER_INVALID_LINE", "订单包含无法确认规格的商品，请重新选择商品规格");
    const scaled = repeatPurchaseQuantity(row.quantity);
    const key = getCartLineKey({ productId, productUnitId });
    const existing = lines.find((item) => item.lineKey === key);
    if (existing) {
      const sum = repeatPurchaseQuantity(existing.quantity) + scaled;
      existing.quantity = repeatPurchaseQuantityValue(sum);
    } else {
      // Only display labels and formal product/unit/quantity survive the order snapshot.
      lines.push(unquotedCartLine({
        productId, productUnitId, lineKey: key,
        name: String(row.productName || row.name || "商品"),
        spec: String(row.spec || row.specification || ""),
        unitName: String(row.unitName || ""),
      }, repeatPurchaseQuantityValue(scaled)));
    }
  }
  return lines;
}

function appendRepeatPurchaseItems(orderItems, storefrontCode) {
  const additions = prepareRepeatPurchaseItems(orderItems);
  let current;
  try { current = getCartItems(storefrontCode); }
  catch { throw repeatPurchaseError("MALL_REORDER_CART_STORAGE_FAILED", "购物车读取失败，请稍后重试"); }
  const seen = new Set();
  const next = current.map((item) => {
    const key = getCartLineKey(item);
    if (!hasValidProductUnitId(item) || seen.has(key)) throw repeatPurchaseError("MALL_REORDER_CART_REPAIR_REQUIRED", "购物车中有待确认规格，请先整理购物车");
    seen.add(key);
    return Object.assign({}, item);
  });
  for (const added of additions) {
    const index = next.findIndex((item) => getCartLineKey(item) === added.lineKey);
    if (index < 0) next.push(added);
    else {
      const sum = repeatPurchaseQuantity(next[index].quantity) + repeatPurchaseQuantity(added.quantity);
      next[index] = unquotedCartLine(next[index], repeatPurchaseQuantityValue(sum));
    }
  }
  try {
    if (!saveCartItems(next, storefrontCode)) throw new Error("登录状态已变化，请刷新后重试");
  }
  catch { throw repeatPurchaseError("MALL_REORDER_CART_STORAGE_FAILED", "购物车保存失败，请稍后重试"); }
  return next;
}

function assertCartLinesHaveProductUnit(items) {
  const list = Array.isArray(items) ? items : [];
  return list.length > 0 && list.every((item) => hasValidProductUnitId(item));
}

module.exports = {
  CART_KEY,
  MISSING_PRODUCT_UNIT_MESSAGE,
  getCartLineKey,
  getCartKey,
  getCartItems,
  getCartCount,
  formatCartBadgeCount,
  saveCartItems,
  addCartItem,
  updateCartQuantity,
  updateCartRemark,
  clearCart,
  prepareRepeatPurchaseItems,
  appendRepeatPurchaseItems,
  hasValidProductUnitId,
  assertCartLinesHaveProductUnit,
};
