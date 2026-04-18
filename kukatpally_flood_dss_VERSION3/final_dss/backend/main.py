"""
Kukatpally Nala Flood DSS — Integrated Backend
================================================
Assignment 1 (DAS) + Assignment 2 (GIS/Hydrology) + Assignment 3 (ML Prediction)

Endpoints:
  /                     → dashboard
  /catchment_info       → real parameters from QGIS
  /add_rainfall         → ingest sensor reading
  /add_water_level      → ingest sensor reading
  /current_status       → live KPIs
  /discharge            → history
  /alerts               → active alerts
  /geojson/{layer}      → real GeoJSON from A2
  /raster/{name}        → DEM/Strahler raster overlays
  /ml/scenarios         → available climate scenarios
  /ml/forecast          → ML prediction for scenario+year range
  /ml/model_info        → RF model metadata
  /simulate             → ML prediction → Rational Method (THE INTEGRATION)
  /compare              → compare two scenarios
  /history              → time-series history
  /simulation_runs      → saved runs
  /ws                   → WebSocket live updates
"""

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel, Field
import json, asyncio, os, io, math
import numpy as np
import pandas as pd

from .database import get_db, engine, Base, SessionLocal
from .models import Rainfall, WaterLevel, DischargeEstimate, Alert, SimulationRun
from . import hydrology
from .ml_model import (
    predict_scenario, get_model_metadata, get_available_scenarios, daily_to_intensity,
    SCENARIO_FILES
)

# ── App setup ─────────────────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Kukatpally Nala Flood DSS",
    description="Integrated DSS: DAS (A1) + GIS/Hydrology (A2) + ML Prediction (A3)",
    version="3.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


class ConnectionManager:
    def __init__(self): self.active_connections: List[WebSocket] = []
    async def connect(self, ws: WebSocket):
        await ws.accept(); self.active_connections.append(ws)
    def disconnect(self, ws: WebSocket):
        if ws in self.active_connections: self.active_connections.remove(ws)
    async def broadcast(self, msg: dict):
        for conn in list(self.active_connections):
            try: await conn.send_json(msg)
            except: pass

manager = ConnectionManager()
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── Schemas ───────────────────────────────────────────────────────────────────
class RainfallCreate(BaseModel):
    station_name: str = Field(..., example="Kukatpally_Rain_01")
    rainfall_mm: float = Field(..., ge=0, example=25.5)
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class WaterLevelCreate(BaseModel):
    station_name: str
    level_m: float = Field(..., ge=0)
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class SimulateRequest(BaseModel):
    scenario: str = Field(default="SSP2-4.5", example="SSP2-4.5")
    year_start: int = Field(default=2025, ge=2025, le=2050)
    year_end: int = Field(default=2030, ge=2025, le=2050)
    basin_id: Optional[int] = Field(default=None, description="Filter to specific basin (1-17). None = all basins.")

class CompareRequest(BaseModel):
    scenario_a: str = Field(default="SSP2-4.5")
    scenario_b: str = Field(default="SSP5-8.5")
    year_start: int = Field(default=2025)
    year_end: int = Field(default=2040)


# ── Static files ──────────────────────────────────────────────────────────────
frontend_dir = os.path.join(BASE_DIR, "frontend")
if os.path.exists(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

@app.get("/", tags=["Root"])
async def root():
    index = os.path.join(BASE_DIR, "frontend", "index.html")
    if os.path.exists(index):
        return FileResponse(index)
    return {"message": "Flood DSS API running", "docs": "/docs"}


# ── Info ──────────────────────────────────────────────────────────────────────
@app.get("/catchment_info", tags=["Info"])
async def catchment_info():
    return hydrology.get_catchment_info()

@app.get("/health", tags=["Info"])
async def health():
    return {"status": "ok", "system": "Kukatpally Nala DSS v3.0", "timestamp": datetime.now().isoformat()}


# ── Rainfall ──────────────────────────────────────────────────────────────────
@app.post("/add_rainfall", tags=["Sensors"])
async def add_rainfall(data: RainfallCreate, db: Session = Depends(get_db)):
    geom = f"SRID=4326;POINT({data.longitude} {data.latitude})" if data.latitude and data.longitude else None
    rain = Rainfall(station_name=data.station_name, rainfall_mm=data.rainfall_mm, geom=geom)
    db.add(rain); db.commit(); db.refresh(rain)

    intensity = data.rainfall_mm
    discharge = hydrology.calculate_discharge_rational(intensity)
    db.add(DischargeEstimate(computed_discharge_m3s=discharge, rainfall_intensity_mmhr=intensity))

    alerts = hydrology.check_thresholds(rainfall_mm_hr=intensity, discharge_m3s=discharge)
    for a in alerts:
        db.add(Alert(alert_type=a.alert_type, message=a.message, severity=a.severity))
    db.commit()

    await manager.broadcast({
        "type": "rainfall_update", "station": data.station_name,
        "rainfall_mm": data.rainfall_mm, "discharge_m3s": discharge,
        "timestamp": datetime.now().isoformat(),
        "alerts": [{"type": a.alert_type, "severity": a.severity} for a in alerts],
    })
    return {"id": rain.id, "station_name": rain.station_name,
            "rainfall_mm": rain.rainfall_mm, "timestamp": rain.timestamp,
            "discharge_m3s": discharge, "alerts_triggered": len(alerts)}


@app.post("/add_water_level", tags=["Sensors"])
async def add_water_level(data: WaterLevelCreate, db: Session = Depends(get_db)):
    geom = f"SRID=4326;POINT({data.longitude} {data.latitude})" if data.latitude and data.longitude else None
    wl = WaterLevel(station_name=data.station_name, level_m=data.level_m, geom=geom)
    db.add(wl); db.commit(); db.refresh(wl)

    alerts = hydrology.check_thresholds(water_level_m=data.level_m)
    for a in alerts:
        db.add(Alert(alert_type=a.alert_type, message=a.message, severity=a.severity))
    db.commit()

    await manager.broadcast({
        "type": "water_level_update", "station": data.station_name,
        "level_m": data.level_m, "timestamp": datetime.now().isoformat(),
        "alerts": [{"type": a.alert_type, "severity": a.severity} for a in alerts],
    })
    return {"id": wl.id, "station_name": wl.station_name, "level_m": wl.level_m, "timestamp": wl.timestamp}


@app.get("/rainfall", tags=["Sensors"])
async def get_rainfall(limit: int = 100, station_name: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Rainfall).order_by(desc(Rainfall.timestamp))
    if station_name: q = q.filter(Rainfall.station_name == station_name)
    rows = q.limit(limit).all()
    return [{"id": r.id, "station_name": r.station_name, "rainfall_mm": r.rainfall_mm,
             "timestamp": r.timestamp.isoformat() if r.timestamp else None} for r in rows]

@app.get("/water_level", tags=["Sensors"])
async def get_water_level(limit: int = 100, db: Session = Depends(get_db)):
    rows = db.query(WaterLevel).order_by(desc(WaterLevel.timestamp)).limit(limit).all()
    return [{"id": r.id, "station_name": r.station_name, "level_m": r.level_m,
             "timestamp": r.timestamp.isoformat() if r.timestamp else None} for r in rows]

@app.get("/discharge", tags=["Sensors"])
async def get_discharge(limit: int = 100, db: Session = Depends(get_db)):
    rows = db.query(DischargeEstimate).order_by(desc(DischargeEstimate.timestamp)).limit(limit).all()
    return [{"id": r.id, "discharge_m3s": r.computed_discharge_m3s,
             "rainfall_mmhr": r.rainfall_intensity_mmhr,
             "timestamp": r.timestamp.isoformat() if r.timestamp else None} for r in rows]

@app.get("/discharge/per_basin", tags=["Sensors"])
async def discharge_per_basin(rainfall_mm_hr: float = Query(..., description="Rainfall intensity mm/hr")):
    return hydrology.calculate_discharge_per_basin(rainfall_mm_hr)


# ── Alerts ────────────────────────────────────────────────────────────────────
@app.get("/alerts", tags=["Alerts"])
async def get_alerts(limit: int = 50, active_only: bool = True,
                     severity: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Alert).order_by(desc(Alert.timestamp))
    if active_only: q = q.filter(Alert.is_active == 1)
    if severity: q = q.filter(Alert.severity == severity)
    rows = q.limit(limit).all()
    return [{"id": r.id, "alert_type": r.alert_type, "message": r.message,
             "severity": r.severity, "is_active": r.is_active,
             "timestamp": r.timestamp.isoformat() if r.timestamp else None} for r in rows]

@app.post("/alerts/{alert_id}/resolve", tags=["Alerts"])
async def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    a = db.query(Alert).filter(Alert.id == alert_id).first()
    if not a: raise HTTPException(404, "Alert not found")
    a.is_active = 0; db.commit()
    return {"message": f"Alert {alert_id} resolved"}


# ── Status ────────────────────────────────────────────────────────────────────
@app.get("/current_status", tags=["Status"])
async def current_status(db: Session = Depends(get_db)):
    lr = db.query(Rainfall).order_by(desc(Rainfall.timestamp)).first()
    lw = db.query(WaterLevel).order_by(desc(WaterLevel.timestamp)).first()
    ld = db.query(DischargeEstimate).order_by(desc(DischargeEstimate.timestamp)).first()
    active_alerts = db.query(Alert).filter(Alert.is_active == 1).count()

    rain_mm = lr.rainfall_mm if lr else 0.0
    water_m = lw.level_m if lw else 0.0
    discharge = ld.computed_discharge_m3s if ld else 0.0
    risk, status_msg, _ = hydrology.get_flood_risk_status(rain_mm, water_m)

    return {
        "latest_rainfall_mm": rain_mm, "latest_water_level_m": water_m,
        "latest_discharge_m3s": discharge, "risk_level": risk,
        "status_message": status_msg, "active_alerts_count": active_alerts,
        "timestamp": datetime.now().isoformat(),
    }


# ── History ───────────────────────────────────────────────────────────────────
@app.get("/history", tags=["History"])
async def get_history(hours: int = 24, db: Session = Depends(get_db)):
    cutoff = datetime.now() - timedelta(hours=hours)
    rainfall = db.query(Rainfall).filter(Rainfall.timestamp >= cutoff).order_by(Rainfall.timestamp).all()
    wl = db.query(WaterLevel).filter(WaterLevel.timestamp >= cutoff).order_by(WaterLevel.timestamp).all()
    discharge = db.query(DischargeEstimate).filter(DischargeEstimate.timestamp >= cutoff).order_by(DischargeEstimate.timestamp).all()
    return {
        "rainfall": [{"timestamp": r.timestamp.isoformat(), "value": r.rainfall_mm} for r in rainfall],
        "water_level": [{"timestamp": w.timestamp.isoformat(), "value": w.level_m} for w in wl],
        "discharge": [{"timestamp": d.timestamp.isoformat(), "value": d.computed_discharge_m3s} for d in discharge],
    }


# ── GeoJSON (real A2 data) ────────────────────────────────────────────────────
@app.get("/geojson/{layer_path:path}", tags=["GIS"])
async def get_geojson(layer_path: str):
    geojson_dir = os.path.join(BASE_DIR, "geojson")
    if not (layer_path.endswith(".geojson") or layer_path.endswith(".json")):
        layer_path += ".geojson"
    path = os.path.join(geojson_dir, layer_path)
    if not os.path.exists(path):
        raise HTTPException(404, f"Layer '{layer_path}' not found")
    with open(path) as f:
        return JSONResponse(json.load(f))

@app.get("/geojson_layers", tags=["GIS"])
async def list_layers():
    geojson_dir = os.path.join(BASE_DIR, "geojson")
    layers_dir = os.path.join(geojson_dir, "layers")
    root = [f.replace(".geojson", "") for f in os.listdir(geojson_dir) if f.endswith(".geojson")]
    sub = [f"layers/{f}" for f in os.listdir(layers_dir) if f.endswith(".geojson")] if os.path.exists(layers_dir) else []
    return {"root_layers": root, "layer_files": sub}

@app.get("/layer_config", tags=["GIS"])
async def layer_config():
    path = os.path.join(BASE_DIR, "geojson", "layer_config.json")
    if os.path.exists(path):
        with open(path) as f:
            return JSONResponse(json.load(f))
    raise HTTPException(404, "layer_config.json not found")


# ── Raster endpoints ─────────────────────────────────────────────────────────
@app.get("/raster/{name}", tags=["GIS"])
async def get_raster(name: str, colormap: str = "terrain"):
    raster_map = {
        "dem":         "geojson/P5_PAN_CD_N17_000_E078_000_DEM_30m.tif",
        "strahler":    "geojson/zone-12-strahler-order.tif",
        "basins":      "geojson/zone-12-drainage-basins.tif",
        "filled_dem":  "geojson/zone-12-filled-dem.tif",
    }
    if name not in raster_map:
        raise HTTPException(404, f"Raster '{name}' not found. Options: {list(raster_map)}")
    fpath = os.path.join(BASE_DIR, raster_map[name])
    if not os.path.exists(fpath):
        raise HTTPException(404, f"File not found on disk: {raster_map[name]}")
    try:
        import rasterio
        from rasterio.warp import transform_bounds
        import matplotlib.pyplot as plt
        with rasterio.open(fpath) as src:
            bounds = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
            data = src.read(1).astype(float)
            if src.nodata is not None:
                data[data == src.nodata] = np.nan
        fig, ax = plt.subplots(figsize=(8, 8))
        ax.imshow(data, cmap=colormap, aspect="auto")
        ax.axis("off")
        buf = io.BytesIO()
        plt.savefig(buf, format="png", transparent=True, bbox_inches="tight", pad_inches=0, dpi=100)
        plt.close()
        buf.seek(0)
        return Response(buf.read(), media_type="image/png",
                        headers={"X-Raster-Bounds": json.dumps(list(bounds))})
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/raster_metadata/{name}", tags=["GIS"])
async def raster_metadata(name: str):
    raster_map = {
        "dem": "geojson/P5_PAN_CD_N17_000_E078_000_DEM_30m.tif",
        "strahler": "geojson/zone-12-strahler-order.tif",
        "basins": "geojson/zone-12-drainage-basins.tif",
        "filled_dem": "geojson/zone-12-filled-dem.tif",
    }
    if name not in raster_map:
        raise HTTPException(404, "Not found")
    fpath = os.path.join(BASE_DIR, raster_map[name])
    try:
        import rasterio
        from rasterio.warp import transform_bounds
        with rasterio.open(fpath) as src:
            bounds = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
            return {"name": name, "crs": str(src.crs), "width": src.width, "height": src.height,
                    "bounds": {"west": bounds[0], "south": bounds[1], "east": bounds[2], "north": bounds[3]}}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── ML endpoints ──────────────────────────────────────────────────────────────
@app.get("/ml/scenarios", tags=["ML"])
async def ml_scenarios():
    return get_available_scenarios()

@app.get("/ml/model_info", tags=["ML"])
async def ml_model_info():
    return get_model_metadata()

@app.get("/ml/forecast", tags=["ML"])
async def ml_forecast(
    scenario: str = Query(default="SSP2-4.5"),
    year_start: int = Query(default=2025),
    year_end: int = Query(default=2030),
):
    """Raw ML predictions for a scenario and year range — includes all predictor variables."""
    try:
        df = predict_scenario(scenario, year_start, year_end)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))

    # Add lag features to daily output for predictor variable visualization
    # FIX: drop original string date col before reindexing to avoid duplicate cols
    df["date_dt"] = pd.to_datetime(df["date"])
    df_sorted = df.drop(columns=["date"]).set_index("date_dt").sort_index()
    df_sorted["rainfall_lag1"] = df_sorted["actual_mm"].shift(1).round(3)
    df_sorted["rainfall_lag2"] = df_sorted["actual_mm"].shift(2).round(3)
    df_sorted["rainfall_lag3"] = df_sorted["actual_mm"].shift(3).round(3)
    df_sorted["rainfall_3day_avg"] = df_sorted["actual_mm"].rolling(3, min_periods=1).mean().round(3)

    # Add discharge per day using Rational Method (Task 2 — day-wise precision)
    TC_HOURS = 1.2
    from .ml_model import daily_to_intensity
    from . import hydrology as _hyd
    df_sorted["intensity_mmhr"] = df_sorted["predicted_mm"].apply(
        lambda v: round(daily_to_intensity(float(v), TC_HOURS), 4)
    )
    # Whole-catchment discharge for the daily timeline
    df_sorted["discharge_m3s"] = df_sorted["intensity_mmhr"].apply(
        lambda i: _hyd.calculate_discharge_rational(i)
    )
    # Alert level per day
    def _alert(mm):
        if mm >= 204.5: return "RED"
        if mm >= 115.6: return "ORANGE"
        if mm >= 64.5:  return "YELLOW"
        return "NORMAL"
    df_sorted["alert_level"] = df_sorted["predicted_mm"].apply(_alert)
    df_sorted["exceeds_flood_threshold"] = (df_sorted["discharge_m3s"] > _hyd.DISCHARGE_THRESHOLD_M3S)

    # Monthly aggregates
    monthly = (
        df_sorted.resample("ME")
        .agg({"predicted_mm": "sum", "actual_mm": "sum", "temp_C": "mean",
              "humidity_pct": "mean", "wind_kmh": "mean", "solar_Wm2": "mean"})
        .round(2).reset_index()
    )
    monthly["month"] = pd.to_datetime(monthly["date_dt"]).dt.strftime("%Y-%m")

    daily_records = df_sorted.reset_index()
    daily_records["date"] = pd.to_datetime(daily_records["date_dt"]).dt.strftime("%Y-%m-%d")
    daily_records = daily_records.drop(columns=["date_dt"], errors="ignore")

    return {
        "scenario": scenario,
        "year_range": f"{year_start}–{year_end}",
        "total_days": len(df_sorted),
        "total_predicted_mm": round(float(df_sorted["predicted_mm"].sum()), 1),
        "peak_predicted_mm": round(float(df_sorted["predicted_mm"].max()), 1),
        "alert_days": {
            "yellow": int((df_sorted["predicted_mm"] >= 64.5).sum()),
            "orange": int((df_sorted["predicted_mm"] >= 115.6).sum()),
            "red":    int((df_sorted["predicted_mm"] >= 204.5).sum()),
        },
        "flood_exceedance_days": int(df_sorted["exceeds_flood_threshold"].sum()),
        "daily": daily_records[[
            "date", "predicted_mm", "actual_mm", "temp_C",
            "humidity_pct", "wind_kmh", "solar_Wm2",
            "rainfall_lag1", "rainfall_lag2", "rainfall_lag3", "rainfall_3day_avg",
            "intensity_mmhr", "discharge_m3s", "alert_level", "exceeds_flood_threshold"
        ]].fillna(0).to_dict(orient="records"),
        "monthly": monthly[["month", "predicted_mm", "actual_mm", "temp_C",
                             "humidity_pct", "wind_kmh", "solar_Wm2"]].to_dict(orient="records"),
    }


# ── CORE INTEGRATION: ML Prediction → Rational Method ────────────────────────
@app.post("/simulate", tags=["Simulation"])
async def simulate(req: SimulateRequest, db: Session = Depends(get_db)):
    """
    THE INTEGRATION ENDPOINT
    ─────────────────────────────────────────────────────────
    1. Load climate scenario (NASA NEX-GDDP)
    2. Run Random Forest → predicted daily rainfall (mm/day)
    3. Convert daily rainfall → hourly intensity (mm/hr) using Tc
    4. Run Rational Method Q = C × i × A for each sub-basin
    5. Classify risk level per basin per day
    6. Aggregate statistics + alert days
    7. Save run to database
    ─────────────────────────────────────────────────────────
    """
    try:
        df = predict_scenario(req.scenario, req.year_start, req.year_end)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))

    # Average annual Tc for Zone 12 (from Assignment 2 morphometry)
    TC_HOURS = 1.2  # hours — weighted average Tc from basin data

    # For each predicted day, compute peak discharge per basin
    all_basin_results = []
    alert_days = {"yellow": 0, "orange": 0, "red": 0}
    peak_q = 0.0
    peak_basin = None
    peak_date = None

    # Daily loop — compute discharge for every basin
    for _, row in df.iterrows():
        intensity = daily_to_intensity(float(row["predicted_mm"]), TC_HOURS)
        basins = hydrology.calculate_discharge_per_basin(intensity)

        # Filter basin if requested
        if req.basin_id:
            basins = [b for b in basins if b["basin_id"] == req.basin_id]

        max_q_day = max(b["discharge_m3s"] for b in basins) if basins else 0.0
        if max_q_day > peak_q:
            peak_q = max_q_day
            peak_basin = basins[0]["basin_id"] if req.basin_id else max((basins), key=lambda x: x["discharge_m3s"])["basin_id"]
            peak_date = row["date"]

        rain = float(row["predicted_mm"])
        if rain >= 204.5: alert_days["red"] += 1
        elif rain >= 115.6: alert_days["orange"] += 1
        elif rain >= 64.5:  alert_days["yellow"] += 1

        all_basin_results.append({
            "date": row["date"],
            "predicted_mm": round(rain, 3),
            "intensity_mmhr": round(intensity, 3),
            "total_discharge_m3s": round(max_q_day, 3),
            "temp_C": round(float(row["temp_C"]), 2),
        })

    # Summary discharge per basin using mean annual intensity
    mean_rain = float(df["predicted_mm"].mean())
    mean_intensity = daily_to_intensity(mean_rain, TC_HOURS)
    basin_summary = hydrology.calculate_discharge_per_basin(mean_intensity)
    if req.basin_id:
        basin_summary = [b for b in basin_summary if b["basin_id"] == req.basin_id]

    # Monthly aggregation
    df_res = pd.DataFrame(all_basin_results)
    df_res["month"] = pd.to_datetime(df_res["date"]).dt.strftime("%Y-%m")
    monthly = df_res.groupby("month").agg(
        total_rain_mm=("predicted_mm", "sum"),
        peak_discharge=("total_discharge_m3s", "max"),
        mean_discharge=("total_discharge_m3s", "mean"),
    ).round(3).reset_index().to_dict(orient="records")

    total_rain = round(float(df["predicted_mm"].sum()), 1)
    risk_level = (
        "CRITICAL" if alert_days["red"] > 0 else
        "HIGH"     if alert_days["orange"] > 0 else
        "MODERATE" if alert_days["yellow"] > 0 else
        "LOW"
    )

    # Day-wise flood exceedance list (Task 2 — actionable warnings)
    flood_days = []
    for item in all_basin_results:
        q = item["total_discharge_m3s"]
        rain = item["predicted_mm"]
        alert = (
            "RED"    if rain >= 204.5 else
            "ORANGE" if rain >= 115.6 else
            "YELLOW" if rain >= 64.5  else
            "NORMAL"
        )
        if q > hydrology.DISCHARGE_THRESHOLD_M3S or alert != "NORMAL":
            flood_days.append({
                "date": item["date"],
                "predicted_mm": rain,
                "intensity_mmhr": item["intensity_mmhr"],
                "discharge_m3s": q,
                "alert_level": alert,
                "exceeds_threshold": q > hydrology.DISCHARGE_THRESHOLD_M3S,
                "hours_warning": round(hydrology.kirpich_tc(25, 0.003) * 60, 0),  # advance warning minutes
            })

    result = {
        "scenario": req.scenario,
        "year_range": f"{req.year_start}–{req.year_end}",
        "total_days": len(df),
        "total_rainfall_mm": total_rain,
        "peak_discharge_m3s": round(peak_q, 2),
        "peak_basin_id": peak_basin,
        "peak_date": peak_date,
        "overall_risk_level": risk_level,
        "alert_days": alert_days,
        "basin_summary": basin_summary,
        "monthly": monthly,
        "flood_exceedance_days": flood_days,
        "daily_sample": all_basin_results[:365],  # first year for chart
    }

    # Save run to DB
    db.add(SimulationRun(
        scenario=req.scenario,
        year_start=req.year_start,
        year_end=req.year_end,
        total_rainfall_mm=total_rain,
        peak_discharge_m3s=peak_q,
        peak_basin_id=peak_basin,
        risk_level=risk_level,
        alert_days=sum(alert_days.values()),
        result_json=json.dumps(result, default=str),
    ))
    db.commit()

    return result


# ── Dashboard sync endpoint (Task 3) ─────────────────────────────────────────
@app.get("/dashboard_sync", tags=["Status"])
async def dashboard_sync(db: Session = Depends(get_db)):
    """
    Returns all KPIs needed to synchronise the main dashboard after a simulation run.
    Combines live sensor status with latest simulation result.
    """
    # Live sensor data
    lr = db.query(Rainfall).order_by(desc(Rainfall.timestamp)).first()
    lw = db.query(WaterLevel).order_by(desc(WaterLevel.timestamp)).first()
    ld = db.query(DischargeEstimate).order_by(desc(DischargeEstimate.timestamp)).first()
    active_alerts = db.query(Alert).filter(Alert.is_active == 1).count()

    rain_mm   = lr.rainfall_mm if lr else 0.0
    water_m   = lw.level_m if lw else 0.0
    discharge = ld.computed_discharge_m3s if ld else 0.0
    risk, msg, _ = hydrology.get_flood_risk_status(rain_mm, water_m)

    # Latest simulation run
    latest_run = db.query(SimulationRun).order_by(desc(SimulationRun.timestamp)).first()
    sim = None
    if latest_run:
        sim = {
            "scenario": latest_run.scenario,
            "year_range": f"{latest_run.year_start}–{latest_run.year_end}",
            "total_rainfall_mm": latest_run.total_rainfall_mm,
            "peak_discharge_m3s": latest_run.peak_discharge_m3s,
            "risk_level": latest_run.risk_level,
            "alert_days": latest_run.alert_days,
            "timestamp": latest_run.timestamp.isoformat() if latest_run.timestamp else None,
        }

    return {
        "live": {
            "rainfall_mm": rain_mm,
            "water_level_m": water_m,
            "discharge_m3s": discharge,
            "risk_level": risk,
            "risk_message": msg,
            "active_alerts": active_alerts,
            "timestamp": datetime.now().isoformat(),
        },
        "simulation": sim,
    }



@app.post("/compare", tags=["Simulation"])
async def compare_scenarios(req: CompareRequest):
    """Run two scenarios and return side-by-side comparison."""
    try:
        df_a = predict_scenario(req.scenario_a, req.year_start, req.year_end)
        df_b = predict_scenario(req.scenario_b, req.year_start, req.year_end)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))

    TC_HOURS = 1.2

    def summarise(df, scenario):
        mean_intensity = daily_to_intensity(float(df["predicted_mm"].mean()), TC_HOURS)
        basins = hydrology.calculate_discharge_per_basin(mean_intensity)
        # Monthly
        tmp = df.copy()
        tmp["month"] = pd.to_datetime(tmp["date"]).dt.strftime("%Y-%m")
        monthly = tmp.groupby("month")["predicted_mm"].sum().round(2)
        return {
            "scenario": scenario,
            "total_rainfall_mm": round(float(df["predicted_mm"].sum()), 1),
            "mean_daily_mm": round(float(df["predicted_mm"].mean()), 3),
            "peak_daily_mm": round(float(df["predicted_mm"].max()), 2),
            "mean_temp_C": round(float(df["temp_C"].mean()), 2),
            "peak_discharge_m3s": round(max(b["discharge_m3s"] for b in basins), 2),
            "alert_days": {
                "yellow": int((df["predicted_mm"] >= 64.5).sum()),
                "orange": int((df["predicted_mm"] >= 115.6).sum()),
                "red":    int((df["predicted_mm"] >= 204.5).sum()),
            },
            "monthly_rainfall": [{"month": m, "mm": v} for m, v in monthly.items()],
            "basin_discharge": basins,
        }

    return {
        "year_range": f"{req.year_start}–{req.year_end}",
        "scenario_a": summarise(df_a, req.scenario_a),
        "scenario_b": summarise(df_b, req.scenario_b),
        "difference": {
            "total_rainfall_pct": round(
                (df_b["predicted_mm"].sum() - df_a["predicted_mm"].sum())
                / df_a["predicted_mm"].sum() * 100, 1
            ) if df_a["predicted_mm"].sum() > 0 else 0,
            "temp_increase_C": round(
                float(df_b["temp_C"].mean()) - float(df_a["temp_C"].mean()), 2
            ),
        },
    }


# ── Simulation history ────────────────────────────────────────────────────────
@app.get("/simulation_runs", tags=["Simulation"])
async def simulation_runs(limit: int = 20, db: Session = Depends(get_db)):
    rows = db.query(SimulationRun).order_by(desc(SimulationRun.timestamp)).limit(limit).all()
    return [{
        "id": r.id, "scenario": r.scenario,
        "year_start": r.year_start, "year_end": r.year_end,
        "total_rainfall_mm": r.total_rainfall_mm,
        "peak_discharge_m3s": r.peak_discharge_m3s,
        "risk_level": r.risk_level, "alert_days": r.alert_days,
        "timestamp": r.timestamp.isoformat() if r.timestamp else None,
    } for r in rows]

@app.get("/simulation_runs/{run_id}", tags=["Simulation"])
async def simulation_run_detail(run_id: int, db: Session = Depends(get_db)):
    run = db.query(SimulationRun).filter(SimulationRun.id == run_id).first()
    if not run: raise HTTPException(404, "Run not found")
    result = json.loads(run.result_json) if run.result_json else {}
    return {"id": run.id, "scenario": run.scenario, "year_start": run.year_start,
            "year_end": run.year_end, "timestamp": run.timestamp.isoformat(), **result}


# ── WebSocket ─────────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_json({"type": "pong", "received": data})
    except WebSocketDisconnect:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


# ── Historical data endpoint ─────────────────────────────────────────────────
@app.get("/ml/historical", tags=["ML"])
async def ml_historical(
    year_start: int = Query(default=1990),
    year_end:   int = Query(default=2024),
    variable:   str = Query(default="rainfall_mm",
                            description="rainfall_mm | temp_C | humidity_pct | wind_kmh | solar_Wm2"),
    aggregation: str = Query(default="monthly", description="daily | monthly | annual"),
):
    """
    Historical climate data for Hyderabad / Kukatpally Nala area.
    Based on IMD 1991-2020 normals (published monthly rainfall + temperature normals).
    """
    import os
    hist_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                             "data", "climate", "historical_1990_2024.csv")
    if not os.path.exists(hist_path):
        raise HTTPException(404, "Historical data file not found. Run scripts/generate_historical.py")

    df = pd.read_csv(hist_path, parse_dates=["date"])
    df = df[(df["date"].dt.year >= year_start) & (df["date"].dt.year <= year_end)]

    if variable not in ["rainfall_mm","temp_C","humidity_pct","wind_kmh","solar_Wm2"]:
        raise HTTPException(400, f"Unknown variable '{variable}'")

    if aggregation == "daily":
        sample = df.iloc[::3]  # every 3rd day to keep response size manageable
        return {
            "variable": variable, "aggregation": "daily",
            "year_range": f"{year_start}–{year_end}",
            "data": [{"date": r["date"].strftime("%Y-%m-%d"), "value": round(float(r[variable]),3)}
                     for _, r in sample.iterrows()],
        }
    elif aggregation == "monthly":
        agg_fn = "sum" if variable == "rainfall_mm" else "mean"
        monthly = df.set_index("date").resample("ME")[variable].agg(agg_fn).round(2)
        return {
            "variable": variable, "aggregation": "monthly",
            "year_range": f"{year_start}–{year_end}",
            "data": [{"date": str(d)[:7], "value": float(v)} for d,v in monthly.items()],
        }
    else:  # annual
        agg_fn = "sum" if variable == "rainfall_mm" else "mean"
        annual = df.set_index("date").resample("YE")[variable].agg(agg_fn).round(2)
        return {
            "variable": variable, "aggregation": "annual",
            "year_range": f"{year_start}–{year_end}",
            "data": [{"date": str(d)[:4], "value": float(v)} for d,v in annual.items()],
        }


# ── Scenario descriptions ─────────────────────────────────────────────────────
@app.get("/ml/scenario_info", tags=["ML"])
async def scenario_info():
    """
    IPCC AR6 SSP scenario descriptions and climate implications.
    Source: IPCC Sixth Assessment Report (2021), NASA NEX-GDDP-CMIP6.
    """
    return {
        "SSP1-2.6": {
            "name": "SSP1-2.6 — Sustainability",
            "short": "Low emissions, green future",
            "warming_by_2100": "+1.0°C to +1.8°C",
            "rainfall_trend": "Slight increase in monsoon intensity, manageable flood risk",
            "description": (
                "Sustainable development pathway. Global CO₂ emissions decline sharply after 2025, "
                "reaching net zero around 2050. Strong international climate policy. "
                "Hyderabad region: modest warming (~+1.5°C by 2050), minimal change in monsoon seasonality. "
                "Flood frequency increases slightly."
            ),
            "color": "#00cc66",
            "icon": "🌱",
            "probability": "Optimistic — requires rapid global decarbonisation",
        },
        "SSP2-4.5": {
            "name": "SSP2-4.5 — Middle of Road",
            "short": "Moderate emissions, current trajectory",
            "warming_by_2100": "+2.1°C to +3.5°C",
            "rainfall_trend": "Intensified monsoon, more frequent heavy-rain events",
            "description": (
                "Business-as-usual with some mitigation. Emissions peak around 2040–2050 then decline. "
                "Moderate socio-economic development. Most likely current trajectory. "
                "Hyderabad: ~+1.8°C by 2050, increased monsoon variability. "
                "Yellow-alert days +15%, Orange-alert days +30% vs. baseline."
            ),
            "color": "#ffcc00",
            "icon": "⚖️",
            "probability": "Most likely — moderate policy action",
        },
        "SSP3-7.0": {
            "name": "SSP3-7.0 — Regional Rivalry",
            "short": "High emissions, fragmented world",
            "warming_by_2100": "+2.8°C to +4.6°C",
            "rainfall_trend": "Erratic monsoon, prolonged droughts and extreme floods",
            "description": (
                "Fragmented world with high emissions and regional conflicts limiting cooperation. "
                "CO₂ emissions double by 2100. High food and water insecurity. "
                "Hyderabad: ~+2.3°C by 2050, highly variable rainfall, more intense but shorter monsoon. "
                "Extreme events (>115mm/day) become 2× more frequent."
            ),
            "color": "#ff8800",
            "icon": "⚠️",
            "probability": "Pessimistic — minimal international cooperation",
        },
        "SSP5-8.5": {
            "name": "SSP5-8.5 — Fossil-Fuelled Development",
            "short": "Very high emissions, worst case",
            "warming_by_2100": "+3.3°C to +5.7°C",
            "rainfall_trend": "Extreme intensification, catastrophic flood risk by 2050",
            "description": (
                "Energy-intensive development with rapid global growth powered by fossil fuels. "
                "CO₂ emissions triple by 2075. Highest warming scenario. "
                "Hyderabad: ~+3.0°C by 2050, dramatic increase in extreme rainfall events. "
                "Zone 12 flood frequency doubles. 100-year flood events occur every 20–30 years."
            ),
            "color": "#ff4444",
            "icon": "🔥",
            "probability": "Worst case — no climate policy",
        },
    }
