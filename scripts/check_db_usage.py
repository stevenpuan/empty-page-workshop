"""用法：python3 scripts/check_db_usage.py → 產生 /tmp/check_db_usage.sql，貼到 Supabase SQL Editor 執行，列出前端用到但資料庫沒有的欄位或函式參數。
抽出前端所有 supabase 查詢用到的資料表欄位與 RPC 參數，產生比對用 SQL。"""
import re, json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "src"
files = [p for p in ROOT.rglob("*.ts*") if "integrations/supabase/types" not in str(p)]

# ---- 常數字串（跨檔）----
consts = {}
for p in files:
    t = p.read_text()
    for m in re.finditer(r'(?:export\s+)?const\s+([A-Z_][A-Z0-9_]*)\s*=\s*((?:"[^"]*"\s*\+?\s*)+);', t):
        consts[m.group(1)] = "".join(re.findall(r'"([^"]*)"', m.group(2)))
    for m in re.finditer(r'(?:export\s+)?const\s+([A-Z_][A-Z0-9_]*)\s*=\s*`([^`]*)`;', t):
        consts.setdefault(m.group(1), m.group(2))

for _ in range(3):
    for k, v in list(consts.items()):
        consts[k] = re.sub(r"\$\{([A-Z_][A-Z0-9_]*)\}", lambda m: consts.get(m.group(1), "__DYN__"), v)

# ---- 應收應付設定展開 ----
cfg_txt = (ROOT / "components/finance/ledger-config.ts").read_text()
def cfg_obj(name):
    body = cfg_txt[cfg_txt.index(f"export const {name}: LedgerConfig = {{"):]
    body = body[: body.index("\n};")]
    d = {}
    for m in re.finditer(r'^\s{2}(\w+): "([^"]*)"', body, re.M):
        d[m.group(1)] = m.group(2)
    for sub in ("rpc", "arg"):
        sb = body[body.index(f"  {sub}: {{"):]
        sb = sb[: sb.index("\n  },")]
        for m in re.finditer(r'(\w+): "([^"]*)"', sb):
            d[f"{sub}.{m.group(1)}"] = m.group(2)
    return d

def expand_ledger(text, d):
    def rep(m):
        k = m.group(1)
        return f'"{d[k]}"' if k in d else m.group(0)
    text = re.sub(r"cfg\.((?:rpc|arg)\.\w+|\w+)", lambda m: rep(m), text)
    text = re.sub(r"\[\"([^\"]+)\"\]:", r'\1:', text)  # { ["p_x"]: v } → { p_x: v }
    text = re.sub(r'\$\{"([^"]*)"\}', r"\1", text)      # `${"x"}` → x
    return text

sources = []
for p in files:
    t = p.read_text()
    if p.name == "LedgerPage.tsx":
        for n in ("AR", "AP"):
            sources.append((f"{p.relative_to(ROOT)}[{n}]", expand_ledger(t, cfg_obj(n))))
    else:
        sources.append((str(p.relative_to(ROOT)), t))

def str_arg(s):
    """解析 select(...) 的參數：字串、字串相加、模板字串、常數"""
    s = s.strip()
    out = ""
    for part in re.split(r"\s*\+\s*", s):
        part = part.strip()
        if not part:
            continue
        if part[0] in "\"'":
            out += part[1:-1]
        elif part[0] == "`":
            inner = part[1:-1]
            inner = re.sub(r"\$\{([A-Z_][A-Z0-9_]*)\}", lambda m: consts.get(m.group(1), "__DYN__"), inner)
            inner = re.sub(r"\$\{[^}]*\}", "__DYN__", inner)
            out += inner
        elif re.fullmatch(r"[A-Z_][A-Z0-9_]*", part) and part in consts:
            out += consts[part]
        else:
            return None
    return out

def split_top(s):
    items, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            items.append(cur); cur = ""
        else:
            cur += ch
    if cur.strip():
        items.append(cur)
    return [i.strip() for i in items if i.strip()]

usage = {}  # table -> set(cols)
where = {}
def add(table, col, src):
    usage.setdefault(table, set()).add(col)
    where.setdefault((table, col), set()).add(src)

def parse_select(table, sel, src):
    for it in split_top(sel):
        if "__DYN__" in it or it == "*":
            continue
        m = re.match(r"^(?:(\w+):)?([\w]+)(?:!([\w]+))?(?:\((.*)\))?$", it, re.S)
        if not m:
            m2 = re.match(r"^(?:(\w+):)?(\w+)::\w+$", it)
            if m2:
                add(table, m2.group(2), src)
            else:
                add(table, "?PARSE:" + it, src)
            continue
        alias, name, hint, inner = m.groups()
        if inner is not None:
            if name == "count":
                continue
            parse_select(name, inner, src)   # 關聯：name 是資料表
        else:
            add(table, name, src)

rpcs = []  # (name, [params], src)
FILTERS = r"eq|neq|gt|gte|lt|lte|in|is|like|ilike|order|contains|not|match"
for src, t in sources:
    # from(...) 鏈
    for m in re.finditer(r'\.from\(\s*"(\w+)"\s*\)', t):
        table = m.group(1)
        seg = t[m.end(): m.end() + 2500]
        # 到下一個 ; 或下一個 .from( 為止
        cut = len(seg)
        for stop in (";", ".from("):
            i = seg.find(stop)
            if i != -1:
                cut = min(cut, i)
        seg = seg[:cut]
        sm = re.search(r"\.select\(\s*((?:\"[^\"]*\"|`[^`]*`|'[^']*'|[A-Z_][A-Z0-9_]*)(?:\s*\+\s*(?:\"[^\"]*\"|`[^`]*`|[A-Z_][A-Z0-9_]*))*)", seg)
        if sm:
            sel = str_arg(sm.group(1))
            if sel is not None:
                parse_select(table, sel, src)
        for fm in re.finditer(r'\.(%s)\(\s*"([\w.]+)"' % FILTERS, seg):
            col = fm.group(2).split(".")[0]
            add(table, col, src)
        # insert/update/upsert 的物件鍵（只抓字面物件）
        for wm in re.finditer(r"\.(insert|update|upsert)\(\s*\{", seg):
            start = wm.end() - 1
            depth, j = 0, start
            while j < len(seg):
                if seg[j] == "{": depth += 1
                elif seg[j] == "}":
                    depth -= 1
                    if depth == 0: break
                j += 1
            body = seg[start + 1: j]
            # 只取第一層鍵
            d = 0; buf = ""
            for ch in body:
                if ch in "{[(": d += 1
                elif ch in "}])": d -= 1
                if d == 0: buf += ch
            for km in re.finditer(r"(?:^|,|\n)\s*(\w+)\s*(?::|,|\n|$)", buf):
                k = km.group(1)
                if k not in ("true", "false", "null"):
                    add(table, k, src + "(write)")
    # rpc 呼叫
    for m in re.finditer(r'\.rpc\(\s*"(\w+)"\s*(?:,\s*\{)?', t):
        name = m.group(1)
        params = []
        if m.group(0).rstrip().endswith("{"):
            start = m.end() - 1
            depth, j = 0, start
            while j < len(t):
                if t[j] == "{": depth += 1
                elif t[j] == "}":
                    depth -= 1
                    if depth == 0: break
                j += 1
            body = t[start + 1: j]
            d = 0; buf = ""
            for ch in body:
                if ch in "{[(": d += 1
                elif ch in "}])": d -= 1
                if d == 0: buf += ch
            params = sorted(set(re.findall(r"(?:^|,|\n)\s*(p_\w+)", buf)))
        rpcs.append((name, params, src))
    for m in re.finditer(r'\.rpc\(\s*kind === "in" \? "clock_in" : "clock_out"', t):
        rpcs.append(("clock_in", [], src)); rpcs.append(("clock_out", [], src))

json.dump({"usage": {k: sorted(v) for k, v in usage.items()},
           "rpcs": rpcs, "where": {f"{k[0]}.{k[1]}": sorted(v) for k, v in where.items()}},
          open("/tmp/db_usage.json", "w"), ensure_ascii=False, indent=1)

# 產生 SQL
tv = ",\n".join(f"('{t}', array[{', '.join(repr(c) for c in sorted(cs))}]::text[])" for t, cs in sorted(usage.items()))
rv = {}
for n, ps, s in rpcs:
    rv.setdefault(n, set()).update(ps)
rvals = ",\n".join(f"('{n}', array[{', '.join(repr(p) for p in sorted(ps))}]::text[])" for n, ps in sorted(rv.items()))
sql = f"""with u(tbl, cols) as (values
{tv}
), missing_tbl as (
  select u.tbl from u where not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=u.tbl)
), missing_col as (
  select u.tbl, x.col from u, unnest(u.cols) x(col)
   where exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=u.tbl)
     and not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=u.tbl and c.column_name=x.col)
), r(fn, params) as (values
{rvals}
), missing_fn as (
  select r.fn from r where not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=r.fn)
), bad_params as (
  select r.fn, x.p from r, unnest(r.params) x(p)
   where exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=r.fn)
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                      where n.nspname='public' and p.proname=r.fn and x.p = any(p.proargnames))
), required_missing as (
  -- 函式沒有預設值的參數，前端沒傳
  select r.fn, a.arg from r
  join pg_proc p on p.proname = r.fn join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
  cross join lateral (select unnest(p.proargnames[1:p.pronargs - p.pronargdefaults]) as arg) a
  where cardinality(r.params) > 0 and a.arg is not null and not (a.arg = any(r.params))
    and (select count(*) from pg_proc p2 where p2.proname = r.fn) = 1
)
select 'missing_table' kind, tbl as obj, null as detail from missing_tbl
union all select 'missing_column', tbl, col from missing_col
union all select 'missing_function', fn, null from missing_fn
union all select 'bad_param', fn, p from bad_params
union all select 'required_param_not_sent', fn, arg from required_missing
order by 1,2,3;"""
open("/tmp/check_db_usage.sql", "w").write(sql)
print(len(usage), "tables;", len(rv), "rpcs;", len(sql), "chars")
odd = [(t, c) for t, cs in usage.items() for c in cs if c.startswith("?PARSE")]
print("parse issues:", odd[:20])
