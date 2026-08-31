import assert from "node:assert/strict";
import test from "node:test";
import { decideRevision } from "../revisions";
import { createEcbProvider } from "./ecb";
import { createEurostatProvider } from "./eurostat";
import { parseSdmxCsv } from "./sdmx";

const eurostatFixture = `STRUCTURE,STRUCTURE_ID,freq,unit,coicop,geo,TIME_PERIOD,OBS_VALUE,OBS_FLAG,CONF_STATUS
dataflow,ESTAT:PRC_HICP_MANR(1.0),M,RCH_A,CP00,EA20,2026-06,1.9,p,
dataflow,ESTAT:PRC_HICP_MANR(1.0),M,RCH_A,CP00,EA20,2026-07,2.0,,`;

const ecbFixture = `KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,PROVIDER_FM_ID,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE,OBS_STATUS,TITLE,UNIT,UNIT_MULT
FM.D.U2.EUR.4F.KR.DFR.LEV,D,U2,EUR,4F,KR,DFR,LEV,2026-07-29,2.25,A,"Deposit facility, official",PCPA,0`;

test("SDMX-CSV deterministically retains dataflow, dimensions, unit, frequency and status", () => {
  const row = parseSdmxCsv(eurostatFixture, "PRC_HICP_MANR")[0];
  assert.equal(row.dataflow, "PRC_HICP_MANR");
  assert.equal(row.timePeriod, "2026-06");
  assert.equal(row.value, "1.9");
  assert.equal(row.unit, "RCH_A");
  assert.equal(row.frequency, "M");
  assert.equal(row.status, "p");
  assert.deepEqual(row.dimensions, { freq: "M", unit: "RCH_A", coicop: "CP00", geo: "EA20" });
});

test("Eurostat adapter uses configured dimensions and marks provisional observations", async () => {
  let url = "";
  const provider = createEurostatProvider({ now: () => new Date("2026-08-29T00:00:00Z"), fetch: async (input) => {
    url = String(input);
    return new Response(eurostatFixture, { status: 200 });
  } });
  const rows = await provider.fetchSeries({ externalSeriesId: "EA_HICP_HEADLINE", from: new Date("2026-06-01T00:00:00Z") });
  assert.match(url, /c%5Bgeo%5D=EA/);
  assert.doesNotMatch(url, /TIME_PERIOD/);
  assert.equal(rows[0].status, "PRELIMINARY");
  assert.equal(rows[0].period.toISOString(), "2026-06-01T00:00:00.000Z");
});

test("ECB adapter parses official daily policy rate CSV", async () => {
  const provider = createEcbProvider({ now: () => new Date("2026-08-29T00:00:00Z"), fetch: async () => new Response(ecbFixture, { status: 200 }) });
  const rows = await provider.fetchSeries({ externalSeriesId: "ECB_DEPOSIT_RATE" });
  assert.equal(rows[0].value, "2.25");
  assert.equal(rows[0].period.toISOString(), "2026-07-29T00:00:00.000Z");
  assert.equal(rows[0].metadata?.sdmxUnit, "PCPA");
});

test("a changed Eurostat latest value appends a Tline vintage instead of updating history", () => {
  const history = [{ id: "v1", value: "1.9", status: "PUBLISHED", vintageAt: new Date("2026-08-01T00:00:00Z"), revisionNo: 0, isInitial: true }];
  assert.deepEqual(decideRevision(history, { value: "2.0", status: "PUBLISHED", vintageAt: new Date("2026-08-29T00:00:00Z") }), { action: "insert", revisionNo: 1, isInitial: false });
});
