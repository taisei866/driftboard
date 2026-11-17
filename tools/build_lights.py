#!/usr/bin/env python3
"""世界の灯台・航路標識の灯りを Overpass API から集め、5度四方の区画ファイル（data/lights/）にまとめる。

公開サーバーは混雑しやすいので、次の工夫で「途中で止まっても無駄にならない」ようにしている。
- 世界を10度四方のマスに分け、1マスずつ問い合わせる（失敗したらマスを4分割して取り直す）
- 終わったマスは作業用フォルダ（data/lights_work/）にすぐ保存し、進み具合を state.json に記録
- 実行時間の上限が近づいたら、そこまでの成果を保存して終了。次回の実行で続きから再開
- 全マスが終わったら、完成したデータを data/lights/ に入れ替える
GitHub Actions から毎日実行（月に1回だけ作り直し、それ以外の日は未完了分の続きか、何もせず終了）。
"""
import csv, io, json, os, shutil, sys, time, urllib.parse, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
OUT, WORK = os.path.join(ROOT, "lights"), os.path.join(ROOT, "lights_work")
STATE = os.path.join(WORK, "state.json")
STEP, CHUNK, MIN_CHUNK = 5, 10, 2.5          # 区画（度）・問い合わせマス（度）・分割の下限（度）
BUDGET = float(os.environ.get("BUDGET_MIN", "250")) * 60   # この時間を過ぎたら新しいマスに手を付けない
REBUILD_DAYS = 28
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
             "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
UA = "Driftboard lights builder (+https://github.com/taisei866/driftboard)"
COLS = ["::id", "::lat", "::lon", "seamark:type", "seamark:name", "name:ja", "name", "man_made"]
for pre in ["seamark:light:", "seamark:light:1:"]:
    COLS += [pre + k for k in ["character", "period", "colour", "sequence", "range", "height"]]
T0 = time.time()
ep_i = 0


def log(*a):
    print(*a, flush=True)


def fetch(s, w, n, e, tries=3):
    """1マス分を問い合わせ。成功すれば表（行のリスト）、失敗すれば None"""
    global ep_i
    cols = ",".join(c if c.startswith("::") else f'"{c}"' for c in COLS)
    q = (f'[out:csv({cols};true;"\\t")][timeout:180];'
         f'(node["seamark:light:character"]({s},{w},{n},{e});node["seamark:light:1:character"]({s},{w},{n},{e});'
         f'node["man_made"="lighthouse"]({s},{w},{n},{e}););out;')
    data = urllib.parse.urlencode({"data": q}).encode()
    for t in range(tries):
        ep = ENDPOINTS[ep_i % len(ENDPOINTS)]
        try:
            with urllib.request.urlopen(urllib.request.Request(ep, data=data, headers={"User-Agent": UA}), timeout=200) as r:
                txt = r.read().decode("utf-8")
            if "runtime error" in txt[:500] or "<html" in txt[:200].lower():
                raise RuntimeError("server error")
            return list(csv.reader(io.StringIO(txt), delimiter="\t"))
        except Exception as ex:
            ep_i += 1   # 次は別のサーバーへ
            log(f"    再試行 {t + 1}/{tries}（{ex}）")
            time.sleep(10 * (t + 1))
    return None


def collect(s, w, n, e, out):
    """マスを取得。失敗したら4分割して取り直す。境界の重複は「マスの中にある点だけ採用」で防ぐ"""
    rows = fetch(s, w, n, e)
    if rows is None:
        if (n - s) <= MIN_CHUNK:
            log(f"    {s},{w} は取得できませんでした（次回の実行で再挑戦）")
            return False
        h = (n - s) / 2
        log(f"    {s},{w} を4分割して取り直します")
        return all([collect(a, b, a + h, b + h, out) for a in (s, s + h) for b in (w, w + h)])
    if not rows:
        return True
    head = rows[0]
    for r in rows[1:]:
        d = dict(zip(head, r))
        try:
            lat, lon = float(d["@lat"]), float(d["@lon"])
        except (KeyError, ValueError):
            continue
        if not (s <= lat < n and w <= lon < e):
            continue
        pre = "seamark:light:" if d.get("seamark:light:character") else "seamark:light:1:"
        row = [round(lat, 4), round(lon, 4),
               d.get("seamark:name") or d.get("name:ja") or d.get("name") or "",
               d.get("seamark:type") or ("light_major" if d.get("man_made") == "lighthouse" else ""),
               d.get(pre + "character") or "", num(d.get(pre + "period")), d.get(pre + "colour") or "",
               d.get(pre + "sequence") or "", num(d.get(pre + "range")), num(d.get(pre + "height"))]
        while row and row[-1] in ("", None):
            row.pop()
        out.append(row)
    time.sleep(1)
    return True


def num(v):
    try:
        f = float(v)
        return round(f, 2) if f % 1 else int(f)
    except (TypeError, ValueError):
        return None


def tile_key(lat, lon):
    return f"{int((lat + 90) // STEP)}_{int((lon + 180) // STEP)}"


def save_rows(rows):
    by = {}
    for r in rows:
        by.setdefault(tile_key(r[0], r[1]), []).append(r)
    for k, rs in by.items():
        p = os.path.join(WORK, k + ".json")
        old = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []
        json.dump(old + rs, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


def main():
    os.makedirs(WORK, exist_ok=True)
    st = json.load(open(STATE)) if os.path.exists(STATE) else None
    built = None
    if os.path.exists(os.path.join(OUT, "index.json")):
        built = json.load(open(os.path.join(OUT, "index.json"))).get("built")
    if st is None:
        if built and (time.time() - time.mktime(time.strptime(built, "%Y-%m-%d"))) < REBUILD_DAYS * 86400:
            log(f"データは {built} 作成で新しいため、今回は何もしません")
            return
        shutil.rmtree(WORK); os.makedirs(WORK)
        st = {"started": time.strftime("%Y-%m-%d"), "done": []}
        log("新しく作り直しを始めます")
    else:
        log(f"前回の続きから再開します（完了 {len(st['done'])} マス）")

    cells = [(s, w) for s in range(-80, 90, CHUNK) for w in range(-180, 180, CHUNK)]
    todo = [c for c in cells if f"{c[0]},{c[1]}" not in st["done"]]
    for i, (s, w) in enumerate(todo):
        if time.time() - T0 > BUDGET:
            log(f"時間の上限に近づいたため中断します（残り {len(todo) - i} マスは次回）")
            break
        rows = []
        ok = collect(s, w, min(s + CHUNK, 90), w + CHUNK, rows)
        if ok:   # 一部でも失敗したマスは保存せず、次回まるごと取り直す（重複を防ぐ）
            save_rows(rows)
            st["done"].append(f"{s},{w}")
        json.dump(st, open(STATE, "w"))
        log(f"[{len(st['done'])}/{len(cells)}] {s:>4},{w:>5}：{len(rows)} 灯")

    if len(st["done"]) < len(cells):
        return
    # 全マス完了 → 完成データに入れ替え
    tiles = {}
    for f in os.listdir(WORK):
        if f.endswith(".json") and f != "state.json":
            tiles[f[:-5]] = len(json.load(open(os.path.join(WORK, f), encoding="utf-8")))
    os.remove(STATE)
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    shutil.move(WORK, OUT)
    json.dump({"step": STEP, "built": time.strftime("%Y-%m-%d"), "total": sum(tiles.values()), "tiles": tiles},
              open(os.path.join(OUT, "index.json"), "w"), separators=(",", ":"))
    log(f"完成：{sum(tiles.values())} 灯 / {len(tiles)} 区画")


if __name__ == "__main__":
    main()
