#!/usr/bin/env python3
"""世界の灯台・航路標識の灯りを Overpass API から取得し、5度四方のタイルに分けて data/lights/ に保存する。
GitHub Actions から月1回実行。標準ライブラリのみ。"""
import csv, io, json, os, sys, time, urllib.parse, urllib.request

ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "lights")
STEP = 5          # タイルの大きさ（度）
CHUNK = 20        # 1回の問い合わせ範囲（度）
COLS = ["::id", "::lat", "::lon", "seamark:type", "seamark:name", "name:ja", "name", "man_made"]
for pre in ["seamark:light:", "seamark:light:1:"]:
    COLS += [pre + k for k in ["character", "period", "colour", "sequence", "range", "height"]]
UA = "Driftboard lights builder (+https://github.com/taisei866/driftboard)"


def query(s, w, n, e):
    q = (f'[out:csv({",".join(c if c.startswith("::") else chr(34) + c + chr(34) for c in COLS)};true;"\\t")][timeout:300];'
         f'(node["seamark:light:character"]({s},{w},{n},{e});node["seamark:light:1:character"]({s},{w},{n},{e});'
         f'node["man_made"="lighthouse"]({s},{w},{n},{e}););out qt;')
    data = urllib.parse.urlencode({"data": q}).encode()
    for attempt in range(6):
        ep = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            req = urllib.request.Request(ep, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=360) as r:
                return r.read().decode("utf-8")
        except Exception as ex:
            wait = 20 * (attempt + 1)
            print(f"  retry {attempt + 1} ({ex}); {wait}s待機", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"failed: {s},{w},{n},{e}")


def num(v):
    try:
        f = float(v)
        return round(f, 2) if f % 1 else int(f)
    except (TypeError, ValueError):
        return None


def main():
    os.makedirs(OUT, exist_ok=True)
    tiles, seen, total = {}, set(), 0
    for s in range(-80, 85, CHUNK):
        for w in range(-180, 180, CHUNK):
            n, e = min(s + CHUNK, 85), w + CHUNK
            txt = query(s, w, n, e)
            rows = list(csv.reader(io.StringIO(txt), delimiter="\t"))
            if not rows:
                continue
            head, body = rows[0], rows[1:]
            got = 0
            for r in body:
                d = dict(zip(head, r))
                if d.get("@id") in seen:
                    continue
                seen.add(d.get("@id"))
                try:
                    lat, lon = float(d["@lat"]), float(d["@lon"])
                except (KeyError, ValueError):
                    continue
                pre = "seamark:light:" if d.get("seamark:light:character") else "seamark:light:1:"
                row = [round(lat, 4), round(lon, 4),
                       d.get("seamark:name") or d.get("name:ja") or d.get("name") or "",
                       d.get("seamark:type") or ("light_major" if d.get("man_made") == "lighthouse" else ""),
                       d.get(pre + "character") or "", num(d.get(pre + "period")), d.get(pre + "colour") or "",
                       d.get(pre + "sequence") or "", num(d.get(pre + "range")), num(d.get(pre + "height"))]
                while row and row[-1] in ("", None):   # 末尾の空欄を省いてファイルを小さく
                    row.pop()
                key = f"{int((lat + 90) // STEP)}_{int((lon + 180) // STEP)}"
                tiles.setdefault(key, []).append(row)
                got += 1
            total += got
            print(f"{s:>4},{w:>5}: {got} 灯（累計 {total}）")
            time.sleep(3)   # 公開サーバーへの配慮

    for f in os.listdir(OUT):
        if f.endswith(".json"):
            os.remove(os.path.join(OUT, f))
    for key, rows in tiles.items():
        with open(os.path.join(OUT, key + ".json"), "w", encoding="utf-8") as fp:
            json.dump(rows, fp, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fp:
        json.dump({"step": STEP, "built": time.strftime("%Y-%m-%d"), "total": total,
                   "tiles": {k: len(v) for k, v in tiles.items()}}, fp, separators=(",", ":"))
    print(f"完了：{total} 灯 / {len(tiles)} タイル")


if __name__ == "__main__":
    main()
