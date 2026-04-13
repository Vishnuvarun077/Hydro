# 🌊 Kukatpally Nala Flood DSS — Complete Guide
### GHMC Zone 12 · Assignment 1 + 2 + 3 Integrated

---

## What's in this project

| Module | Source | What it does |
|--------|--------|--------------|
| **DAS (Sensor System)** | Assignment 1 | Ingests rainfall + water level from 7 stations, fires alerts |
| **GIS / Hydrology** | Assignment 2 | Real QGIS layers (watershed, streams, 17 basins, flood zones), Rational Method discharge per basin |
| **ML Prediction** | Assignment 3 | Random Forest trained on NASA NEX-GDDP CMIP6 (4 SSP scenarios, 2025–2050) |
| **Integration** | Final | ML rainfall → hourly intensity → Rational Method → flood risk map → report |

---

## File structure

```
flood_das/
├── backend/
│   ├── main.py              ← FastAPI app (all endpoints)
│   ├── hydrology.py         ← Rational Method (real A2 parameters)
│   ├── ml_model.py          ← RF prediction module (A3)
│   ├── simulator.py         ← Sensor simulation engine (A1)
│   ├── models.py            ← SQLAlchemy DB models
│   └── database.py          ← DB connection (SQLite or PostgreSQL)
├── frontend/
│   ├── index.html           ← A2 GIS dashboard (Leaflet + real GeoJSON)
│   ├── styles.css           ← A2 styling
│   ├── app.js               ← A2 map + sensor logic
│   └── app_integration.js  ← NEW: Simulation + Compare + Report tabs
├── geojson/
│   ├── watershed.geojson    ← Real watershed boundary (QGIS)
│   ├── streams.geojson      ← 153 stream segments
│   ├── flood_zones.geojson  ← Flood risk zones (23 wards)
│   ├── sensors.geojson      ← Sensor locations
│   └── layers/
│       ├── drainage_basins_enriched.geojson ← 17 sub-basins with all parameters
│       ├── drainage_order_1-4.geojson       ← Strahler stream orders
│       ├── flood_risk_high/medium/low.geojson
│       ├── rain_gauges.geojson
│       ├── water_level_sensors.geojson
│       ├── ward_boundaries.geojson
│       └── watershed_boundary.geojson
├── data/
│   ├── climate/
│   │   ├── ssp126_2025_2050.csv  ← SSP1-2.6 (9496 days)
│   │   ├── ssp245_2025_2050.csv  ← SSP2-4.5 (9496 days)
│   │   ├── ssp370_2025_2050.csv  ← SSP3-7.0 (9496 days)
│   │   └── ssp585_2025_2050.csv  ← SSP5-8.5 (9496 days)
│   └── models/
│       ├── rf_rainfall_model.joblib  ← Pre-trained RF model
│       └── model_meta.json           ← R²=0.962, trained on 37,972 samples
├── scripts/
│   └── run_simulation_demo.py   ← Automated test + demo script
├── run_local.sh      ← Start without Docker (Mac/Linux)
├── run_local.bat     ← Start without Docker (Windows)
├── docker-compose.yml
├── Dockerfile
└── requirements.txt
```

---

## Quick Start — Option A: No Docker (Fastest)

### Mac / Linux
```bash
cd flood_das
bash run_local.sh
```

### Windows
```cmd
cd flood_das
run_local.bat
```

Both install dependencies and start the backend at **http://localhost:8000**.

Then open **`frontend/index.html`** directly in your browser (double-click the file).

---

## Quick Start — Option B: Docker (Production)

```bash
cd flood_das
docker-compose up -d
```

Wait ~60 seconds for PostgreSQL to start. Then:
- Dashboard: http://localhost:8000 (served by backend)
- API Docs: http://localhost:8000/docs

---

## Test everything works

With the backend running, open a new terminal:
```bash
python scripts/run_simulation_demo.py
```

Expected output — all green:
```
══════════════════════════════════════════════
  1. BASIC CONNECTIVITY
══════════════════════════════════════════════
  ✅ API health — Kukatpally Nala DSS v3.0

══════════════════════════════════════════════
  2. CATCHMENT INFO (Real A2 data)
══════════════════════════════════════════════
  ✅ Area = 104.3 km²
  ✅ Runoff C = 0.736
  ✅ 17 sub-basins

══════════════════════════════════════════════
  3. GIS LAYERS (Real GeoJSON from QGIS)
══════════════════════════════════════════════
  ✅ Layer: watershed
  ✅ Layer: streams
  ✅ Layer: flood_zones
  ✅ Layer: sensors
  ✅ Layer: layers/drainage_basins_enriched
  ... (8 layers total)

══════════════════════════════════════════════
  8. THE INTEGRATION: ML → RATIONAL METHOD → FLOOD RISK
══════════════════════════════════════════════
  ✅ Simulation returns basin_summary
  ✅ Returns monthly data — 72 months
  ✅ Risk level assigned
  ✅ Peak discharge > 0 — Q=803.7 m³/s
     Scenario: SSP2-4.5 | Years: 2025–2030
     Total rainfall: 4920mm | Peak Q: 803.7 m³/s
     Risk: HIGH | Alert days: {'yellow': 18, 'orange': 0, 'red': 0}

  🎉 38/38 tests passed (100%) — SYSTEM FULLY OPERATIONAL
```

---

## How to use the Dashboard

1. Open `frontend/index.html` in Chrome/Firefox
2. The map loads with all real GIS layers — toggle them in the left panel
3. Click **⚡ SIMULATION DSS** button (top-right of header)

### Simulate tab
1. Pick scenario: SSP1-2.6 / SSP2-4.5 / SSP3-7.0 / SSP5-8.5
2. Set year range: 2025–2050
3. Optionally pick a specific sub-basin (or leave "All 17 basins")
4. Click **▶ RUN SIMULATION**
5. Results show:
   - Monthly rainfall bar chart (colour-coded by alert level)
   - Peak discharge per sub-basin (Rational Method)
   - Basin table with Q vs 2-yr and 50-yr design flows
   - Map basins coloured by risk level

### Compare tab
1. Pick two scenarios (e.g. SSP1-2.6 vs SSP5-8.5)
2. Click **↔ COMPARE**
3. See side-by-side total rainfall, peak discharge, temperature, monthly chart overlay

### Report tab
1. After running a simulation, click **📄 Generate & Print Report**
2. Opens a formatted print dialog with all inputs, outputs, and methodology

---

## Expected results when testing

| Test | Expected value | Why |
|------|---------------|-----|
| Catchment area | 104.3 km² | From QGIS delineation (Assignment 2) |
| Number of basins | 17 | From CartoDEM 30m analysis |
| Runoff coefficient | 0.736 | Urbanised Zone 12 (Assignment 2) |
| Basin 6 discharge at 50mm/hr | ~803 m³/s | Q = 0.278 × 0.75 × 50 × 77.09 |
| SSP2-4.5 monsoon mean | ~6 mm/day | Matches IMD normals for Hyderabad |
| ML model R² | 0.962 | Trained on 37,972 samples (4 SSP scenarios) |
| SSP5-8.5 warmer than SSP1-2.6 | Yes (+~0.4°C) | Physical: higher emissions = more warming |
| Alert triggered at water level 3.2m | Yes (Critical Stage) | Threshold = 2.5m |

---

## API endpoints summary

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | System health check |
| GET | `/catchment_info` | Real A2 catchment parameters |
| POST | `/add_rainfall` | Ingest rainfall reading |
| POST | `/add_water_level` | Ingest water level |
| GET | `/current_status` | Live KPIs |
| GET | `/discharge/per_basin?rainfall_mm_hr=50` | Rational Method all 17 basins |
| GET | `/geojson/{layer}` | Serve real GeoJSON layers |
| GET | `/ml/scenarios` | Available climate scenarios |
| GET | `/ml/forecast?scenario=SSP2-4.5&year_start=2025&year_end=2030` | ML predictions |
| GET | `/ml/model_info` | RF model metrics |
| POST | `/simulate` | **THE INTEGRATION**: ML → Rational Method |
| POST | `/compare` | Compare two scenarios |
| GET | `/simulation_runs` | History of runs |
| GET | `/alerts` | Active flood alerts |
| WS | `/ws` | WebSocket live updates |

Full interactive docs: **http://localhost:8000/docs**

---

## Data sources

| Data | Source | URL |
|------|--------|-----|
| Climate scenarios | NASA NEX-GDDP CMIP6 | ds.nccs.nasa.gov/nex-gddp-cmip6 |
| DEM | CartoDEM 30m | bhuvan.nrsc.gov.in |
| LULC | ESRI/Impact Observatory | livingatlas.arcgis.com |
| Catchment GIS | QGIS analysis (A2) | Included in geojson/ |
| Flood zones | GHMC Zone 12 wards | ghmc.gov.in |
| Reference event | IMD Oct 2020 flood | imd.gov.in |

---

## Troubleshooting

**"Cannot reach API"** → Backend is not running. Start it with `bash run_local.sh`

**GeoJSON layers missing on map** → Check browser console for CORS errors. Open the HTML file via a server, not file:// (the backend serves it at http://localhost:8000)

**"Model not found"** → The pre-trained model is in `data/models/rf_rainfall_model.joblib`. If missing, run:
```bash
python scripts/train_model.py  # (optional — model already included)
```

**Docker: "port 5432 already in use"** → Change the port mapping in docker-compose.yml from `5432:5432` to `5433:5432`

---

## Team

GHMC Zone 12 Hydrological DSS  
IIT Hyderabad / BITS Pilani — Hydrological Informatics  
Reference event: 13 October 2020 Hyderabad Floods
