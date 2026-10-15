"""Trims GeoNames cities15000 to what NivPay needs (app/src/data/cities.json).

Source: https://download.geonames.org/export/dump/cities15000.zip, GeoNames,
CC BY 4.0 (README, "Third-party code and licenses"). Keeps each city's name,
country code, position rounded to 0.01 degrees (a city's centre, never a
person's position) and thousands of people, biggest first.

Run with: python -I make_cities.py <cities15000.zip> <out.json>
"""
import io
import json
import sys
import zipfile

zip_path, out_path = sys.argv[1], sys.argv[2]
rows = []
with zipfile.ZipFile(zip_path) as z:
    with z.open("cities15000.txt") as f:
        for line in io.TextIOWrapper(f, encoding="utf-8"):
            c = line.rstrip("\n").split("\t")
            if len(c) < 15:
                continue
            name, ascii_name, lat, lon, cc, pop = c[1], c[2], float(c[4]), float(c[5]), c[8], int(c[14] or 0)
            if not name or len(cc) != 2:
                continue
            # No en or em dashes anywhere in the repo: a hyphen reads the same in a city name.
            name = name.replace(chr(0x2013), "-").replace(chr(0x2014), "-")
            rows.append([name, cc, round(lat * 100), round(lon * 100), pop // 1000])
rows.sort(key=lambda r: -r[4])
with open(out_path, "w", encoding="utf-8", newline="") as out:
    out.write("[\n" + ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows) + "\n]\n")
print(len(rows), "cities")
