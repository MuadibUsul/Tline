import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeViewFragment, needsViewRewrite } from "./viewQuality";

test("real views with figures pass; layout fragments do not", () => {
  // Genuine observations — numbers and units are normal and must not be filtered.
  assert.equal(looksLikeViewFragment("我们预计美联储将在12月降息25个基点，10年期美债收益率回落至4.2%附近。"), false);
  assert.equal(looksLikeViewFragment("We stay overweight equities into year-end, with S&P 500 fair value near 6,100."), false);
  assert.equal(looksLikeViewFragment("核心商品通胀预计将反弹（图3），核心服务通胀预计将保持坚挺（图4）。"), false);

  // Fragments seen in production on 2026-10-17.
  assert.equal(looksLikeViewFragment("销售与新增挂牌量比率（%；季调）单位销量（%）平均售价（%）新增挂牌量（%）1 如果某一市场的销售与新增挂牌量比率高于长期均值加一个标准差，则该市场倾向于卖方市场，并可能见证价格面临上行压力。"), true);
  assert.equal(looksLikeViewFragment("因此，在贸易和地缘政治紧张局势——以及其对预期通胀和购买力状况所产生的影响——开始降温之前，潜在买家的这种观望态度预计将拖累住房需求。-30 -20 -10 0 10 20 NL（St."), true);
  assert.equal(looksLikeViewFragment("Johns）63.2 10.0 3.0 1.1 卖家 9.1 5.1 3.7 7.0 -8.1 1.7"), true);
  assert.equal(looksLikeViewFragment("短句"), true);
  assert.equal(looksLikeViewFragment("• Headline inflation expected to pick up to 3.6–3.7% y/y, activity remains firm."), true);
  assert.equal(looksLikeViewFragment("1 Westpac新西兰经济研究：下调2027前景预期。我们已更新对新西兰未来一年的经济展望。"), true);
  assert.equal(looksLikeViewFragment("图表 1：JCI抛售超过新冠疫情时期的回撤幅度 来源：Bloomberg、MUFG GMR。"), true);
  assert.equal(looksLikeViewFragment("“但这只是让其他拥有机器的人得以奴役他们”——弗兰克·赫伯特，《沙丘》 ► 美国9月通胀走高。"), true);
  assert.equal(looksLikeViewFragment("因此，我们维持对USD/IDR进一步上行的偏向，现有预测为Q4 2026达18,350、Q1 2027达18,500。"), false);
  assert.equal(looksLikeViewFragment("Commodity Spot Prices** Foreign Exchange Cross Rates Fixed Income Yields Stock Market"), true);
  assert.equal(looksLikeViewFragment("Danske Bank / Nordic Outlook 1 Euro area 3 September 2026 Important disclosures"), true);
});

test("the language a reader sees decides whether a view needs rewriting", () => {
  const mixed = { viewZh: "（%；季调）单位销量（%）平均售价（%）新增挂牌量（%）1", viewEn: "Sales to new listings ratio" };
  assert.equal(needsViewRewrite(mixed, true), true);
  // The English side is a clean phrase, so an English page has nothing to rewrite.
  assert.equal(needsViewRewrite(mixed, false), false);
  const englishFragment = { viewZh: "我们维持对黄金的看多观点，年底目标价3,400美元。", viewEn: "Table 1 62.3 10.0 3.0 1.1 9.1 5.1" };
  assert.equal(needsViewRewrite(englishFragment, false), true);
  assert.equal(needsViewRewrite(englishFragment, true), false);
  const both = { viewZh: "我们维持对黄金的看多观点，年底目标价3,400美元。", viewEn: "We stay bullish gold with a year-end target of 3,400." };
  assert.equal(needsViewRewrite(both, true), false);
  assert.equal(needsViewRewrite(both, false), false);
});
