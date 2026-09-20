import assert from "node:assert/strict";
import test from "node:test";
import { dashboardTemplate, parseDashboardWidgets, validAccent, validWallpaperUrl } from "./dashboards";

test("dashboard layouts keep supported cards and clamp unsafe geometry", () => {
  const widgets = parseDashboardWidgets(JSON.stringify([
    { id: "gold", type: "market", title: "Gold", ref: "XAUUSD", x: -99_999, y: 10, w: 99_999, h: 20 },
    { id: "bad", type: "iframe", title: "No" },
  ]));
  assert.equal(widgets.length, 1);
  assert.deepEqual({ x: widgets[0].x, w: widgets[0].w, h: widgets[0].h }, { x: -8000, w: 1200, h: 180 });
});

test("wallpaper and accent inputs refuse executable or insecure values", () => {
  assert.equal(validWallpaperUrl("javascript:alert(1)"), null);
  assert.equal(validWallpaperUrl("http://example.com/a.jpg"), null);
  assert.equal(validWallpaperUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
  assert.equal(validAccent("red; background:url(x)"), "#9e7a42");
});

test("gold template includes price, ETF flow source, yields, rates and inflation", () => {
  const refs = dashboardTemplate("gold")!.widgets.map((widget) => widget.ref ?? widget.url);
  assert.ok(refs.includes("XAUUSD"));
  assert.ok(refs.includes("US_10Y_TREASURY_YIELD"));
  assert.ok(refs.includes("US_FED_FUNDS_TARGET_UPPER"));
  assert.ok(refs.includes("US_CPI_HEADLINE"));
  assert.ok(refs.some((ref) => ref?.includes("gold-etfs-holdings-and-flows")));
});

test("regional central-bank templates include Japan and the United Kingdom", () => {
  assert.deepEqual(dashboardTemplate("boj")?.widgets.map((widget) => widget.ref).filter(Boolean), ["JP_CALL_RATE", "USDJPY", "JP_GDP", "bank-of-japan"]);
  assert.deepEqual(dashboardTemplate("boe")?.widgets.map((widget) => widget.ref).filter(Boolean), ["UK_CALL_RATE", "GBPUSD", "UK_GDP", "UK_UNEMPLOYMENT", "bank-of-england"]);
});
