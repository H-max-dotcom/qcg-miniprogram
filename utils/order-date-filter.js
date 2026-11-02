// Use the business calendar even when a device has another local timezone.
function orderDateRange(preset, now) {
  const today = new Date((now === undefined ? Date.now() : Number(now)) + 28800000);
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const from = new Date(day);
  if (preset === "昨天") { from.setUTCDate(from.getUTCDate() - 1); day.setUTCDate(day.getUTCDate() - 1); }
  else if (preset === "本周") from.setUTCDate(from.getUTCDate() - (from.getUTCDay() + 6) % 7);
  else if (preset === "本月") from.setUTCDate(1);
  else if (preset === "今年") { from.setUTCMonth(0); from.setUTCDate(1); }
  else if (preset !== "今天") return { dateFrom: "", dateTo: "" };
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: day.toISOString().slice(0, 10) };
}
module.exports = { orderDateRange };
