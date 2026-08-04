/**
 * 📖 회차 그림 서빙 — R2 우선, 없으면 정적 자산
 *
 * ── 왜 Worker 를 거치나 ─────────────────────────────────────────────────
 * 정적 자산으로만 두면 **회차 하나를 올리려고 코드를 배포해야 한다.** 매일
 * 연재하는 구조에서 그 결합이 아프다 — 개발 중이라 배포를 못 하는 날은 연재도
 * 못 나간다(2026-08-04 인수인계 C-2).
 *
 * 그래서 그림만 R2 로 옮긴다. 밖에서 보이는 주소(`/webtoon/w/...`)는 그대로다.
 *
 * ── 없으면 정적 자산으로 넘긴다 ─────────────────────────────────────────
 * 옮기는 도중에는 어떤 회차는 R2 에, 어떤 회차는 `public/` 에 있다. 이 순서면
 * **둘 중 하나에만 있어도 보인다** — 한 번에 다 옮기지 않아도 되고, R2 쪽에
 * 문제가 생겨도 예전 파일이 남아 있는 한 화면이 죽지 않는다.
 *
 * 나중에 `public/webtoon/w/` 를 비우면 이 넘김은 저절로 쓰이지 않게 된다.
 */

/** `/webtoon/w/<작품>/...` → R2 키 `<작품>/...` */
const keyOf = (pathname) => decodeURIComponent(pathname.replace(/^\/webtoon\/w\//, ""));

export async function webtoonAsset(request, env, ctx) {
  const url = new URL(request.url);
  const key = keyOf(url.pathname);

  // 경로를 거슬러 올라가는 키를 막는다. R2 는 `..` 를 폴더로 치지 않지만,
  // 키에 그대로 넣으면 의도치 않은 객체를 가리킬 수 있다.
  if (!key || key.includes("..")) {
    return env.ASSETS.fetch(request);
  }

  const object = await env.WEBTOON?.get(key);
  if (!object) {
    // 아직 R2 에 없다 — 저장소에 남아 있는 파일로 넘긴다
    return env.ASSETS.fetch(request);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // 회차 그림은 발행 뒤 바뀌지 않는다. 조판 규칙이 바뀌면 주소에 `?r=N` 이
  // 붙어 새 주소가 되므로 여기서 길게 잡아도 안전하다(`public/_headers` 와 같은 값).
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
}
