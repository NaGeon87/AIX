-- 지표 정확도 피드백
--
-- 화면의 "이 정보가 실제와 다른가요?"가 받은 답이 여기 쌓인다.
-- 맵기·국물·날것·주재료는 메뉴명에서 룰과 LLM으로 추정한 값이 섞여 있어서,
-- 어느 것이 틀렸는지는 그 음식을 아는 사람만 안다. 그 한 마디를 받는 표다.
--
-- 실행: Supabase 대시보드 → SQL Editor에 붙여넣고 Run.
--       (또는 supabase CLI를 쓴다면 `supabase db push`)

create table if not exists public.accuracy_feedback (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),

  -- src/taste/manual_labels.py의 menu_key와 같은 모양("전복찜|전복")이다.
  -- 반영할 때 그 표에서 바로 찾을 수 있게 일부러 맞춰 두었다.
  food_id    text not null,
  food_name  text not null default '',

  verdict    text not null check (verdict in ('same', 'different')),

  -- 사용자가 짚은 지표. 'spicy' | 'soup' | 'raw' | 'ingredient'.
  -- verdict가 'same'이면 비어 있다.
  axes       text[] not null default '{}'
             check (axes <@ array['spicy', 'soup', 'raw', 'ingredient']::text[]),

  -- 맞는 값을 적어 준 자유 입력. 화면과 API가 200자에서 자른다.
  note       text not null default '' check (char_length(note) <= 200),

  -- 답할 당시 화면이 보여 주던 지표 값. 그 뒤 데이터를 고쳐도 이 사람이
  -- 무엇을 보고 "다르다"고 했는지가 남는다.
  shown      jsonb not null default '{}'::jsonb
);

create index if not exists accuracy_feedback_food_id_idx
  on public.accuracy_feedback (food_id);

create index if not exists accuracy_feedback_created_at_idx
  on public.accuracy_feedback (created_at desc);

-- --------------------------------------------------------------------------
-- 접근 권한
--
-- 넣기만 열고 읽기는 닫는다. 웹에서 쓰는 anon 키로 할 수 있는 일이
-- "피드백 한 줄 넣기"뿐이어야, 키가 새어 나가도 잃을 것이 없다.
-- 쌓인 답은 대시보드나 service_role 키로 읽는다(둘 다 RLS를 지나간다).
--
-- 같은 사람이 같은 말을 여러 번 넣는 것을 막지 않는다. 세 사람이 "국물이
-- 틀렸다"고 하는 것은 중복이 아니라 신호다.
-- --------------------------------------------------------------------------

alter table public.accuracy_feedback enable row level security;

drop policy if exists "anyone can insert accuracy feedback" on public.accuracy_feedback;
create policy "anyone can insert accuracy feedback"
  on public.accuracy_feedback
  for insert
  to anon, authenticated
  with check (true);

-- --------------------------------------------------------------------------
-- 반영할 때 쓰는 질의
--
-- 어느 메뉴의 어느 지표가 많이 걸리는지 본 다음, src/taste/manual_labels.py의
-- MANUAL_LABELS에 근거와 함께 옮긴다. 옮긴 뒤 파이프라인을 다시 돌려야
-- web/public/data까지 내려온다.
--
--   select food_id, food_name, axis, count(*) as n,
--          array_agg(note) filter (where note <> '') as notes
--     from public.accuracy_feedback, unnest(axes) as axis
--    where verdict = 'different'
--    group by food_id, food_name, axis
--    order by n desc;
--
-- 맞다는 답까지 함께 보려면:
--
--   select food_id, food_name,
--          count(*) filter (where verdict = 'same')      as 맞음,
--          count(*) filter (where verdict = 'different') as 다름
--     from public.accuracy_feedback
--    group by food_id, food_name
--    order by 다름 desc;
-- --------------------------------------------------------------------------
