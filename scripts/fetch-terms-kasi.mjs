/**
 * 🌤️ 절기 검증 세트 수집 — KASI 가 제공하는 2000~2028 구간
 *
 *   SAJU_API_KEY=... node scripts/fetch-terms-kasi.mjs
 *
 * KASI 24절기 API 는 **2000~2028년만** 준다(실측). 사주는 출생 연도가 필요해
 * 그 범위로는 못 쓰므로 절기를 직접 계산하기로 했고(docs/saju-calendar.md §6),
 * 이 구간은 **계산이 맞는지 대조할 정답지**로 쓴다.
 *
 * 정답지가 손에 있는 구간에서 전건 일치하면, 바깥 연도도 같은 알고리즘이므로
 * 신뢰할 근거가 된다. 표를 못 구한 대신 이 검증이 그 자리를 대신한다.
 */

import { writeFileSync, mkdirSync } from "node:fs";

const raw = (process.env.SAJU_API_KEY ?? "").trim();
if (!raw) {
  console.error("SAJU_API_KEY 가 없습니다. (docs/saju-calendar.md §5)");
  process.exit(1);
}
const KEY = /%[0-9A-Fa-f]{2}/.test(raw) ? decodeURIComponent(raw) : raw;

const URL_TERMS =
  "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/get24DivisionsInfo";

const FROM = 2000;
const TO = 2028;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const items = (xml) =>
  [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const o = {};
    for (const f of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) o[f[1]] = f[2].trim();
    return o;
  });

(async () => {
  const out = [];
  for (let y = FROM; y <= TO; y++) {
    for (let m = 1; m <= 12; m++) {
      const q = new URLSearchParams({
        serviceKey: KEY,
        _type: "xml",
        numOfRows: "100",
        solYear: String(y),
        solMonth: String(m).padStart(2, "0"),
      });
      const xml = await (await fetch(`${URL_TERMS}?${q}`)).text();
      for (const r of items(xml)) {
        if (!r.locdate) continue;
        const kst = (r.kst ?? "0000").padStart(4, "0");
        out.push({
          name: r.dateName,
          at: `${r.locdate.slice(0, 4)}-${r.locdate.slice(4, 6)}-${r.locdate.slice(6, 8)}T${kst.slice(0, 2)}:${kst.slice(2, 4)}`,
        });
      }
      await sleep(50);
    }
    if (y % 5 === 0) console.log(`  ${y}년까지 ${out.length}건`);
  }

  out.sort((a, b) => a.at.localeCompare(b.at));
  mkdirSync("data", { recursive: true });
  writeFileSync(
    "data/saju-terms-kasi.json",
    JSON.stringify({ source: "KASI get24DivisionsInfo", from: FROM, to: TO, terms: out }),
  );
  console.log(`\n✓ data/saju-terms-kasi.json — ${out.length}건 (기대 ${(TO - FROM + 1) * 24}건)`);
})();
