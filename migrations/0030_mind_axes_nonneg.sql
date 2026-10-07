-- 🔬 오늘의 선택 — 마음 지도 증분 +1 통일 뒤 이번 달 음수 칸 정리 (REQ-62 ⑬ · D5)
--
-- 예전 judge 는 −1 선택지를 그대로 빼서 축이 줄거나 음수가 됐다. 이제 증분은 늘 +1 이라
-- 새로 음수가 생기지 않는다. 남은 것은 **이번 달** 행의 음수 칸뿐이고, 그것만 0 으로 올린다.
--
-- 「이번 달」은 **이 파일이 실행되는 시점의 KST 달**이다(날짜를 박지 않는다 — 스테이징·운영이
-- 각자 그 시점의 달). 지난 달 행은 화면이 읽지 않으므로 둔다. portrait_paid·적립 기록은 건드리지 않는다.
-- 깨진 JSON·길이가 다른 행은 건너뛴다(서버 parseAx 도 그런 행을 0 으로 읽는다).

UPDATE mind_axes
   SET ax = json_array(
         max(0, json_extract(ax, '$[0]')), max(0, json_extract(ax, '$[1]')),
         max(0, json_extract(ax, '$[2]')), max(0, json_extract(ax, '$[3]')),
         max(0, json_extract(ax, '$[4]')), max(0, json_extract(ax, '$[5]')),
         max(0, json_extract(ax, '$[6]')), max(0, json_extract(ax, '$[7]')))
 WHERE month = strftime('%Y-%m', 'now', '+9 hours')
   AND CASE
         WHEN json_valid(ax) AND json_array_length(ax) = 8
           THEN EXISTS (SELECT 1 FROM json_each(mind_axes.ax) WHERE value < 0)
         ELSE 0
       END;
