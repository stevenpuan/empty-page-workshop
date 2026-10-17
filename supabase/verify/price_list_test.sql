-- 032 價目表與報價測試（全部在交易內，最後 ROLLBACK，不留資料）
-- 用 Steven（祥興老闆）登入身分執行；中途把他暫時改成「員工」測員工報價
do $$
declare
  v_co uuid; v_r jsonb; v_cat_card uuid; v_cat_banner uuid; v_cat_box uuid;
  v_add_film uuid; v_add_rush uuid; v_add_edge uuid; v_add_grommet uuid;
  v_q jsonb; v_qid uuid; v_cnt int; v_sub numeric; v_tax numeric; v_tot numeric; v_body text; v_title text;
  v_staff_role uuid; v_old_role uuid; v_ok boolean;
begin
  perform set_config('request.jwt.claims', '{"sub":"c443807f-82d8-41d8-a0c1-5d1e3cc66ab3","role":"authenticated"}', true);
  set local role authenticated;
  v_co := current_company_id();
  if v_co is null then raise exception 'FAIL 沒有目前公司'; end if;

  -- 1. 匯入
  v_r := import_price_list(v_co,
    '[{"row":2,"name":"名片","mode":"tier","unit":"盒","min_charge":300},
      {"row":3,"name":"布條帆布","mode":"area","unit":"才","min_charge":300},
      {"row":4,"name":"紙盒","mode":"manual","unit":"個"}]'::jsonb,
    '[{"row":2,"category":"名片","item":"名片","option":"一般紙・雙面","qty_from":1,"qty_to":4,"unit_price":380,"unit":"盒"},
      {"row":3,"category":"名片","item":"名片","option":"一般紙・雙面","qty_from":5,"qty_to":9,"unit_price":330,"unit":"盒"},
      {"row":4,"category":"名片","item":"名片","option":"一般紙・雙面","qty_from":10,"unit_price":280,"unit":"盒"},
      {"row":5,"category":"布條帆布","item":"帆布","option":"一般帆布","qty_from":1,"unit_price":45,"unit":"才"}]'::jsonb,
    '[{"row":2,"name":"上霧膜","category":"名片","mode":"per_unit","amount":60},
      {"row":3,"name":"急件","category":"","mode":"percent","amount":0.3},
      {"row":4,"name":"車邊","category":"布條帆布","mode":"per_cai","amount":5},
      {"row":5,"name":"銅釦","category":"布條帆布","mode":"per_piece","amount":5}]'::jsonb);
  if (v_r->>'categories')::int <> 3 or (v_r->>'items')::int <> 4 or (v_r->>'addons')::int <> 4 then
    raise exception 'FAIL 匯入筆數 %', v_r;
  end if;
  raise notice 'OK 1 匯入 %', v_r;

  select id into v_cat_card from price_categories where company_id = v_co and name = '名片';
  select id into v_cat_banner from price_categories where company_id = v_co and name = '布條帆布';
  select id into v_cat_box from price_categories where company_id = v_co and name = '紙盒';
  select id into v_add_film from price_addons where company_id = v_co and name = '上霧膜';
  select id into v_add_rush from price_addons where company_id = v_co and name = '急件';
  select id into v_add_edge from price_addons where company_id = v_co and name = '車邊';
  select id into v_add_grommet from price_addons where company_id = v_co and name = '銅釦';

  -- 2. 數量級距 + 每單位加工 + 總價加成：3 盒 ×380＝1140，上膜 180，急件 30% → 1716
  v_r := calc_price(v_cat_card, '名片', '一般紙・雙面', 3, null, null,
                    jsonb_build_array(jsonb_build_object('id', v_add_film), jsonb_build_object('id', v_add_rush)));
  if (v_r->>'suggested')::numeric <> 1716 then raise exception 'FAIL 2 名片 %', v_r; end if;
  -- 級距：6 盒 ×330＝1980；12 盒 ×280＝3360
  if (calc_price(v_cat_card, '名片', '一般紙・雙面', 6)->>'suggested')::numeric <> 1980 then raise exception 'FAIL 2b'; end if;
  if (calc_price(v_cat_card, '名片', '一般紙・雙面', 12)->>'suggested')::numeric <> 3360 then raise exception 'FAIL 2c'; end if;
  raise notice 'OK 2 數量級距';

  -- 3. 面積：90×180 兩張 → 每張 18 才、共 36 才 ×45＝1620，車邊 180，銅釦 8 個 40 → 1840
  v_r := calc_price(v_cat_banner, '帆布', '一般帆布', 2, 90, 180,
                    jsonb_build_array(jsonb_build_object('id', v_add_edge),
                                      jsonb_build_object('id', v_add_grommet, 'count', 8)));
  if (v_r->>'suggested')::numeric <> 1840 or (v_r->>'cai_each')::numeric <> 18 then raise exception 'FAIL 3 帆布 %', v_r; end if;
  -- 最低收費：30×30 → 1 才 45 < 300 → 300
  v_r := calc_price(v_cat_banner, '帆布', '一般帆布', 1, 30, 30);
  if (v_r->>'suggested')::numeric <> 300 or not (v_r->>'min_applied')::boolean then raise exception 'FAIL 3b %', v_r; end if;
  -- 別的大類的加工不能套用（上霧膜只限名片）
  v_r := calc_price(v_cat_banner, '帆布', '一般帆布', 1, 100, 100, jsonb_build_array(jsonb_build_object('id', v_add_film)));
  if jsonb_array_length(v_r->'addons') <> 0 then raise exception 'FAIL 3c 不該套用 %', v_r; end if;
  -- 需老闆報價：沒有建議價
  v_r := calc_price(v_cat_box, '紙盒', '', 100);
  if v_r->>'suggested' is not null then raise exception 'FAIL 3d %', v_r; end if;
  raise notice 'OK 3 面積、最低收費、需老闆報價';

  -- 4. 把 Steven 暫時改成「員工」：員工可報價、不能匯入價目
  reset role;
  select e.role_id into v_old_role from employees e where e.user_id = 'c443807f-82d8-41d8-a0c1-5d1e3cc66ab3' and e.company_id = v_co;
  select id into v_staff_role from roles where company_id = v_co and tier = 'staff';
  update employees set role_id = v_staff_role where user_id = 'c443807f-82d8-41d8-a0c1-5d1e3cc66ab3' and company_id = v_co;
  set local role authenticated;

  v_ok := false;
  begin
    perform import_price_list(v_co, '[]', '[]', '[]');
  exception when others then
    if sqlerrm like 'P0005%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'FAIL 4 員工不應能匯入價目'; end if;

  v_ok := false;
  begin
    insert into price_categories (company_id, name, pricing_mode) values (v_co, '偷改', 'fixed');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL 4b 員工不應能直接改價目'; end if;

  -- 員工開報價：名片改價 1500（建議 1716）、帆布照建議 1840、紙盒自填 3000、手動一筆 200；送出
  v_q := save_quotation(null,
    jsonb_build_object('tax_type', 'taxable', 'contact_name', '王先生', 'contact_phone', '0912-345-678'),
    jsonb_build_array(
      jsonb_build_object('item_name', '名片', 'spec', '一般紙・雙面', 'qty', 3, 'unit', '盒', 'line_total', 1500,
                         'price_category_id', v_cat_card, 'price_item', '名片', 'price_option', '一般紙・雙面',
                         'addons', jsonb_build_array(jsonb_build_object('id', v_add_film), jsonb_build_object('id', v_add_rush))),
      jsonb_build_object('item_name', '帆布', 'qty', 2, 'unit', '件', 'line_total', 1840,
                         'price_category_id', v_cat_banner, 'price_item', '帆布', 'price_option', '一般帆布',
                         'width_cm', 90, 'height_cm', 180,
                         'addons', jsonb_build_array(jsonb_build_object('id', v_add_edge), jsonb_build_object('id', v_add_grommet, 'count', 8))),
      jsonb_build_object('item_name', '紙盒', 'qty', 100, 'unit', '個', 'line_total', 3000,
                         'price_category_id', v_cat_box, 'price_item', '紙盒', 'price_option', ''),
      jsonb_build_object('item_name', '其他', 'qty', 2, 'unit', '式', 'unit_price', 100)),
    true);
  v_qid := (v_q->>'id')::uuid;
  if v_q->>'status' <> 'sent' then raise exception 'FAIL 5 狀態 %', v_q; end if;

  select subtotal, tax_amount, total into v_sub, v_tax, v_tot from quotations where id = v_qid;
  if v_sub <> 6540 or v_tax <> 327 or v_tot <> 6867 then raise exception 'FAIL 5b 金額 % % %', v_sub, v_tax, v_tot; end if;
  select count(*) into v_cnt from quotation_items where quotation_id = v_qid and suggested_amount is not null;
  if v_cnt <> 2 then raise exception 'FAIL 5c 建議價筆數 %', v_cnt; end if;
  if (select unit_price from quotation_items where quotation_id = v_qid and item_name = '帆布') <> 920 then
    raise exception 'FAIL 5d 單價倒算';
  end if;
  -- 員工看得到自己開的報價單（RLS）
  select count(*) into v_cnt from quotations where id = v_qid;
  if v_cnt <> 1 then raise exception 'FAIL 5e 員工看不到報價單'; end if;
  raise notice 'OK 5 員工報價 % 未稅 % 稅 % 合計 %', v_q->>'quote_no', v_sub, v_tax, v_tot;

  -- 6. 通知老闆：易志明收到，內容標出改價
  reset role;
  select count(*), max(title), max(body) into v_cnt, v_title, v_body
    from notifications where ref_type = 'quotation' and ref_id = v_qid;
  if v_cnt < 1 then raise exception 'FAIL 6 沒有通知'; end if;
  if v_title <> '報價單送出（3 項改價或自填）' then raise exception 'FAIL 6b 標題 %', v_title; end if;
  if v_body not like '%建議價 $1,716，改低 $216（-13%）%' then raise exception 'FAIL 6c 內容 %', v_body; end if;
  raise notice 'OK 6 通知 % 筆：%', v_cnt, v_title;
  raise notice '%', v_body;

  -- 7. 送出後不能再改
  set local role authenticated;
  v_ok := false;
  begin
    perform save_quotation(v_qid, '{}'::jsonb, '[{"item_name":"x","qty":1,"unit_price":1}]'::jsonb, false);
  exception when others then
    if sqlerrm like 'P0002%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'FAIL 7 已送出的報價單不應能修改'; end if;

  -- 8. 草稿修改：存草稿不通知，改完再送出才通知
  v_q := save_quotation(null, '{}'::jsonb, '[{"item_name":"影印","qty":10,"unit_price":2}]'::jsonb, false);
  v_qid := (v_q->>'id')::uuid;
  v_q := save_quotation(v_qid, '{}'::jsonb, '[{"item_name":"影印","qty":20,"unit_price":2}]'::jsonb, false);
  reset role;
  select count(*) into v_cnt from notifications where ref_id = v_qid;
  if v_cnt <> 0 then raise exception 'FAIL 8 草稿不該通知'; end if;
  if (select subtotal from quotations where id = v_qid) <> 40 then raise exception 'FAIL 8b 草稿修改'; end if;
  if (select contact_name from quotations where id = v_qid) is not null then raise exception 'FAIL 8c'; end if;
  raise notice 'OK 8 草稿修改';

  raise exception 'ROLLBACK 全部通過';
end $$;
