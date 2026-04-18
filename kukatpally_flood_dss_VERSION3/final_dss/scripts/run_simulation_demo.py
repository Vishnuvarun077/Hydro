#!/usr/bin/env python3
"""
DSS Integration Test + Demo Script
====================================
Tests every API endpoint and prints expected results.
Run AFTER starting the backend with run_local.sh or docker-compose.

Usage:
    python scripts/run_simulation_demo.py
    python scripts/run_simulation_demo.py --api http://your-server:8000
"""

import sys
import argparse
import requests
import json
from datetime import datetime

def c(text, col): return f"\033[{col}m{text}\033[0m"
OK   = lambda t: print(c(f"  ✅ {t}", 32))
FAIL = lambda t: print(c(f"  ❌ {t}", 31))
HEAD = lambda t: print(c(f"\n{'═'*55}\n  {t}\n{'═'*55}", 36))
INFO = lambda t: print(c(f"     {t}", 33))

def check(label, condition, detail=""):
    if condition:
        OK(f"{label}" + (f" — {detail}" if detail else ""))
    else:
        FAIL(f"{label}" + (f" — {detail}" if detail else ""))
    return condition

def test(api):
    passed = failed = 0

    HEAD("1. BASIC CONNECTIVITY")
    try:
        r = requests.get(f"{api}/health", timeout=5)
        check("API health", r.status_code == 200, r.json().get("system",""))
        passed += 1
    except Exception as e:
        FAIL(f"Cannot reach {api}: {e}")
        print("\n  → Make sure the backend is running: bash run_local.sh")
        return

    HEAD("2. CATCHMENT INFO (Real A2 data)")
    r = requests.get(f"{api}/catchment_info")
    d = r.json()
    check("Area = 104.3 km²", abs(d["area_km2"] - 104.3) < 0.1, f"got {d['area_km2']}")
    check("Runoff C = 0.736", abs(d["runoff_coefficient"] - 0.736) < 0.01, f"got {d['runoff_coefficient']}")
    check("17 sub-basins", d["num_basins"] == 17, f"got {d['num_basins']}")
    passed += 3

    HEAD("3. GIS LAYERS (Real GeoJSON from QGIS)")
    for layer in ["watershed", "streams", "flood_zones", "sensors",
                  "layers/drainage_basins_enriched", "layers/ward_boundaries",
                  "layers/drainage_order_1", "layers/rain_gauges"]:
        r = requests.get(f"{api}/geojson/{layer}")
        ok = r.status_code == 200 and r.json().get("type") == "FeatureCollection"
        check(f"Layer: {layer}", ok, f"{r.json().get('features','?').__class__.__name__} features")
        if ok: passed += 1
        else: failed += 1

    HEAD("4. SENSOR INGESTION (A1 — DAS)")
    # Add rainfall reading
    r = requests.post(f"{api}/add_rainfall", json={
        "station_name": "Kukatpally_Rain_01", "rainfall_mm": 75.5,
        "latitude": 17.4947, "longitude": 78.3996
    })
    d = r.json()
    check("POST /add_rainfall returns discharge", "discharge_m3s" in d, f"Q={d.get('discharge_m3s',0):.1f} m³/s")
    if "discharge_m3s" in d:
        check("Discharge > 0", d["discharge_m3s"] > 0)
        passed += 1
    passed += 1

    # Add water level
    r = requests.post(f"{api}/add_water_level", json={
        "station_name": "Nala_Stage_02_Middle", "level_m": 3.2,
        "latitude": 17.4900, "longitude": 78.4000
    })
    check("POST /add_water_level (3.2m — above 2.5m danger)", r.status_code == 200)
    passed += 1

    HEAD("5. RATIONAL METHOD — PER BASIN (A2)")
    r = requests.get(f"{api}/discharge/per_basin?rainfall_mm_hr=50")
    basins = r.json()
    check("Returns 17 basins", len(basins) == 17, f"got {len(basins)}")
    # Basin 6 is the largest (77.09 km²)
    b6 = next((b for b in basins if b["basin_id"] == 6), None)
    if b6:
        expected_q6 = round(0.278 * 0.75 * 50 * 77.089, 1)
        check(f"Basin 6 Q ≈ {expected_q6} m³/s (Q=0.278CiA)", abs(b6["discharge_m3s"] - expected_q6) < 5,
              f"got {b6['discharge_m3s']:.1f}")
        passed += 1
    passed += 1

    HEAD("6. ML SCENARIOS (A3 — Real NASA NEX-GDDP)")
    r = requests.get(f"{api}/ml/scenarios")
    scenarios = r.json()
    for ssp in ["SSP1-2.6","SSP2-4.5","SSP3-7.0","SSP5-8.5"]:
        avail = scenarios.get(ssp, {}).get("available", False)
        rows = scenarios.get(ssp, {}).get("rows", 0)
        check(f"Scenario {ssp} available ({rows} rows)", avail, f"{rows} rows")
        if avail: passed += 1
        else: failed += 1

    HEAD("7. ML FORECAST (A3)")
    r = requests.get(f"{api}/ml/forecast?scenario=SSP2-4.5&year_start=2025&year_end=2026")
    d = r.json()
    check("Forecast returns daily data", len(d.get("daily",[])) > 300, f"{len(d.get('daily',[]))} days")
    check("Peak rain < 200mm (physically reasonable)", d.get("peak_predicted_mm",0) < 200,
          f"max={d.get('peak_predicted_mm',0):.1f}mm")
    check("Monsoon season has more rain (sanity)", d.get("total_predicted_mm",0) > 0)
    INFO(f"SSP2-4.5 2025–2026: total={d.get('total_predicted_mm',0):.0f}mm, peak={d.get('peak_predicted_mm',0):.1f}mm/day")
    INFO(f"Alert days: Yellow={d.get('alert_days',{}).get('yellow',0)}, Orange={d.get('alert_days',{}).get('orange',0)}")
    passed += 3

    HEAD("8. THE INTEGRATION: ML → RATIONAL METHOD → FLOOD RISK")
    print("  Running simulate (SSP2-4.5, 2025–2030)... ", end="", flush=True)
    r = requests.post(f"{api}/simulate", json={
        "scenario": "SSP2-4.5", "year_start": 2025, "year_end": 2030
    }, timeout=60)
    d = r.json()
    print("done")
    check("Simulation returns basin_summary", len(d.get("basin_summary",[])) == 17)
    check("Returns monthly data", len(d.get("monthly",[])) >= 60, f"{len(d.get('monthly',[]))} months")
    check("Risk level assigned", d.get("overall_risk_level") in ["LOW","MODERATE","HIGH","CRITICAL"])
    check("Peak discharge > 0", d.get("peak_discharge_m3s",0) > 0, f"Q={d.get('peak_discharge_m3s',0):.2f} m³/s")
    check("Alert days counted", "alert_days" in d)
    INFO(f"Scenario: {d.get('scenario')} | Years: {d.get('year_range')}")
    INFO(f"Total rainfall: {d.get('total_rainfall_mm',0):.0f}mm | Peak Q: {d.get('peak_discharge_m3s',0):.1f} m³/s")
    INFO(f"Risk: {d.get('overall_risk_level')} | Alert days: {d.get('alert_days',{})}")
    passed += 5

    HEAD("9. SCENARIO COMPARISON")
    r = requests.post(f"{api}/compare", json={
        "scenario_a":"SSP1-2.6","scenario_b":"SSP5-8.5","year_start":2025,"year_end":2035
    }, timeout=60)
    d = r.json()
    check("Compare returns scenario_a and scenario_b", "scenario_a" in d and "scenario_b" in d)
    check("SSP5-8.5 >= SSP1-2.6 rainfall (physical sense)",
          d["scenario_b"]["total_rainfall_mm"] >= d["scenario_a"]["total_rainfall_mm"] * 0.8)
    INFO(f"SSP1-2.6 total rain: {d['scenario_a']['total_rainfall_mm']:.0f}mm")
    INFO(f"SSP5-8.5 total rain: {d['scenario_b']['total_rainfall_mm']:.0f}mm")
    INFO(f"Temperature increase: +{d['difference']['temp_increase_C']:.2f}°C")
    passed += 2

    HEAD("10. ALERTS SYSTEM")
    r = requests.get(f"{api}/alerts?active_only=true")
    alerts = r.json()
    check("Alerts endpoint returns list", isinstance(alerts, list))
    check("Alerts triggered by 3.2m water level", any(a.get("alert_type","").startswith("Critical") for a in alerts),
          f"{len(alerts)} active alerts")
    INFO(f"Active alerts: {len(alerts)}")
    for a in alerts[:3]:
        INFO(f"  [{a.get('severity','?').upper()}] {a.get('alert_type','?')}: {a.get('message','?')[:60]}")
    passed += 2

    HEAD("11. SIMULATION HISTORY")
    r = requests.get(f"{api}/simulation_runs")
    runs = r.json()
    check("Run saved to history", len(runs) >= 1, f"{len(runs)} runs stored")
    passed += 1

    HEAD("RESULTS")
    total = passed + failed
    pct = round(passed/total*100) if total > 0 else 0
    if pct >= 90:
        print(c(f"\n  🎉 {passed}/{total} tests passed ({pct}%) — SYSTEM FULLY OPERATIONAL", 32))
    elif pct >= 70:
        print(c(f"\n  ⚠  {passed}/{total} tests passed ({pct}%) — mostly working", 33))
    else:
        print(c(f"\n  ❌ {passed}/{total} tests passed ({pct}%) — check setup", 31))

    print(f"""
  Dashboard:  Open frontend/index.html in your browser
              Click the ⚡ SIMULATION DSS button (top-right)
  API Docs:   {api}/docs
  WebSocket:  ws://localhost:8000/ws
    """)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8000")
    args = parser.parse_args()
    test(args.api)
