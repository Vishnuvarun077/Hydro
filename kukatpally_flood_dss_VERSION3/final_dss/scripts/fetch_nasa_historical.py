#!/usr/bin/env python3
"""
Fetch real NASA POWER climate data for Kukatpally/Hyderabad (1990-2024).
No API key required. Free and open.

Usage:
    python scripts/fetch_nasa_historical.py

Output: data/climate/historical_1990_2024.csv
"""

import requests, pandas as pd, numpy as np, time
from pathlib import Path

LAT_MIN, LAT_MAX = 17.45, 17.55
LON_MIN, LON_MAX = 78.35, 78.50
OUTPUT = Path(__file__).parent.parent / "data" / "climate" / "historical_1990_2024.csv"

# Use a 3x3 grid (9 points) to keep the fetch fast but still spatially averaged
GRID_POINTS = [
    (17.45, 78.35), (17.45, 78.42), (17.45, 78.50),
    (17.50, 78.35), (17.50, 78.42), (17.50, 78.50),
    (17.55, 78.35), (17.55, 78.42), (17.55, 78.50),
]

PARAMS = "PRECTOTCORR,T2M,RH2M,WS2M,ALLSKY_SFC_SW_DWN"

def fetch_point(lat, lon):
    url = (
        f"https://power.larc.nasa.gov/api/temporal/daily/point"
        f"?parameters={PARAMS}&community=AG"
        f"&longitude={lon}&latitude={lat}"
        f"&start=19900101&end=20241231&format=JSON"
    )
    print(f"  Fetching ({lat:.2f}, {lon:.2f}) ...", end=" ", flush=True)
    try:
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        data = r.json()["properties"]["parameter"]
        df = pd.DataFrame(data)
        df.index = pd.to_datetime(df.index, format="%Y%m%d")
        df = df.replace(-999.0, float("nan"))
        df = df.rename(columns={
            "PRECTOTCORR": "rainfall_mm",
            "T2M":         "temp_C",
            "RH2M":        "humidity_pct",
            "WS2M":        "wind_ms",
            "ALLSKY_SFC_SW_DWN": "solar_Wm2",
        })
        df["rainfall_mm"]  = df["rainfall_mm"].clip(lower=0)
        df["wind_kmh"]     = df["wind_ms"] * 3.6
        df["source"]       = "NASA_POWER"
        print(f"OK ({len(df)} days)")
        return df[["rainfall_mm","temp_C","humidity_pct","wind_kmh","solar_Wm2","source"]]
    except Exception as e:
        print(f"FAILED: {e}")
        return pd.DataFrame()

def main():
    print("=" * 55)
    print("Fetching NASA POWER historical data (1990-2024)")
    print("Kukatpally Nala / GHMC Zone 12, Hyderabad")
    print("=" * 55)
    print(f"Grid: {len(GRID_POINTS)} points")
    print()

    dfs = []
    for i, (lat, lon) in enumerate(GRID_POINTS):
        df = fetch_point(lat, lon)
        if not df.empty:
            dfs.append(df)
        if i < len(GRID_POINTS) - 1:
            time.sleep(1)  # be polite to NASA API

    if not dfs:
        print("ERROR: No data fetched. Check internet connection.")
        return

    combined = pd.concat(dfs).groupby(level=0).mean(numeric_only=True)
    combined["source"] = "NASA_POWER"
    combined.index.name = "date"
    out = combined.reset_index()
    out["date"] = out["date"].dt.strftime("%Y-%m-%d")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUTPUT, index=False)

    print()
    print("=" * 55)
    print(f"Saved {len(out)} days to {OUTPUT}")
    print(f"Annual mean rainfall: {out.groupby(pd.to_datetime(out['date']).dt.year)['rainfall_mm'].sum().mean():.0f} mm/yr")
    print(f"Max daily rainfall: {out['rainfall_mm'].max():.1f} mm")
    print(f"Mean temperature: {out['temp_C'].mean():.1f} °C")
    print()
    print("Restart the server to use real NASA POWER data.")
    print("=" * 55)

if __name__ == "__main__":
    main()
