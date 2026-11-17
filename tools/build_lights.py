#!/usr/bin/env python3
"""世界の灯台・航路標識の灯りを OpenStreetMap の全データ（planet ファイル）から抜き出し、
5度四方の区画ファイル（data/lights/）にまとめる。

混雑しやすい Overpass API は使わない。週1回公開される planet ファイル（約80GB）をダウンロードしながら
osmium で灯りの付いた点だけを抜き出すので、ディスクはほとんど使わず、1回の実行で全世界分が揃う。
GitHub Actions から月1回実行。
"""
import json, os, shutil, subprocess, sys, time, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
OUT = os.path.join(ROOT, "lights")
TMP = os.environ.get("RUNNER_TEMP", "/tmp")
FILTERED = os.path.join(TMP, "lights.osm.pbf")
STEP = 5
MIRRORS = [
    "https://ftp.fau.de/osm-planet/pbf/planet-latest.osm.pbf",
    "https://ftp5.gwdg.de/pub/misc/openstreetmap/planet.openstreetmap.org/pbf/planet-latest.osm.pbf",
    "https://planet.maps.mail.ru/pbf/planet-latest.osm.pbf",
    "https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf",
]
FILTER = ["n/seamark:light:character", "n/seamark:light:1:character", "n/man_made=lighthouse"]
UA = "Driftboard lights builder (+https://github.com/taisei866/driftboard)"


def log(*a):
    print(*a, flush=True)


def extract(url):
    """planet を流し読みして osmium に渡し、灯りの点だけを FILTERED に書き出す"""
    log(f"ダウンロード開始：{url}")
    p = subprocess.Popen(["osmium", "tags-filter", "-F", "pbf", "-", *FILTER, "-o", FILTERED, "--overwrite"],
                         stdin=subprocess.PIPE)
    got, t0, last = 0, time.time(), 0
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120) as r:
            total = int(r.headers.get("Content-Length") or 0)
            while True:
                b = r.read(4 << 20)
                if not b:
                    break
                p.stdin.write(b)
                got += len(b)
                if got - last >= 4 << 30:   # 4GB ごとに進み具合を表示
                    last = got
                    sp = got / (time.time() - t0) / 1e6
                    pct = f"{got / total * 100:.0f}%" if total else ""
                    log(f"  {got / 1e9:.0f}GB {pct}（{sp:.0f}MB/秒）")
        p.stdin.close()
        ok = p.wait() == 0 and (not total or got == total)
    except Exception as ex:
        log(f"  失敗：{ex}")
        p.kill(); p.wait()
        ok = False
    log(f"  {'完了' if ok else '中断'}：{got / 1e9:.1f}GB / {(time.time() - t0) / 60:.0f}分")
    return ok


def num(v):
    try:
        f = float(v)
        return round(f, 2) if f % 1 else int(f)
    except (TypeError, ValueError):
        return None


def build_tiles():
    import osmium
    tiles = {}

    class H(osmium.SimpleHandler):
        def node(self, n):
            if not n.location.valid():
                return
            t = {k.k: k.v for k in n.tags}
            pre = "seamark:light:" if t.get("seamark:light:character") else "seamark:light:1:"
            lat, lon = n.location.lat, n.location.lon
            row = [round(lat, 4), round(lon, 4),
                   t.get("seamark:name") or t.get("name:ja") or t.get("name") or "",
                   t.get("seamark:type") or ("light_major" if t.get("man_made") == "lighthouse" else ""),
                   t.get(pre + "character") or "", num(t.get(pre + "period")), t.get(pre + "colour") or "",
                   t.get(pre + "sequence") or "", num(t.get(pre + "range")), num(t.get(pre + "height"))]
            while row and row[-1] in ("", None):
                row.pop()
            k = f"{int((lat + 90) // STEP)}_{int((lon + 180) // STEP)}"
            tiles.setdefault(k, []).append(row)

    H().apply_file(FILTERED)
    return tiles


def main():
    if not any(extract(u) for u in MIRRORS):
        log("どのミラーからも取得できませんでした。既存のデータはそのまま残します")
        sys.exit(1)
    tiles = build_tiles()
    total = sum(len(v) for v in tiles.values())
    if total < 10000:   # 明らかに少ないときは壊れたデータとみなして置き換えない
        log(f"件数が少なすぎます（{total}）。既存のデータはそのまま残します")
        sys.exit(1)
    new = OUT + "_new"
    shutil.rmtree(new, ignore_errors=True)
    os.makedirs(new)
    for k, rows in tiles.items():
        json.dump(rows, open(os.path.join(new, k + ".json"), "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))
    json.dump({"step": STEP, "built": time.strftime("%Y-%m-%d"), "total": total,
               "tiles": {k: len(v) for k, v in tiles.items()}},
              open(os.path.join(new, "index.json"), "w"), separators=(",", ":"))
    shutil.rmtree(OUT, ignore_errors=True)
    shutil.rmtree(os.path.join(ROOT, "lights_work"), ignore_errors=True)
    shutil.move(new, OUT)
    log(f"完成：{total} 灯 / {len(tiles)} 区画")


if __name__ == "__main__":
    main()
