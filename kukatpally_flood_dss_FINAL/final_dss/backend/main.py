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
from fastapi.middleware.cors import CORSMiddleware

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
    app.mount("/frontend", StaticFiles(directory=frontend_dir), name="frontend")
    # Also fallback mount to catch root-level JS/CSS requests if index.html asks for them
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
    """Raw ML predictions for a scenario and year range."""
    try:
        df = predict_scenario(scenario, year_start, year_end)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))

    # Monthly aggregates
    df["date_dt"] = pd.to_datetime(df["date"])
    monthly = (
        df.set_index("date_dt").resample("ME")
        .agg({"predicted_mm": "sum", "actual_mm": "sum", "temp_C": "mean"})
        .round(2).reset_index()
    )
    monthly["month"] = monthly["date_dt"].dt.strftime("%Y-%m")

    return {
        "scenario": scenario,
        "year_range": f"{year_start}–{year_end}",
        "total_days": len(df),
        "total_predicted_mm": round(float(df["predicted_mm"].sum()), 1),
        "peak_predicted_mm": round(float(df["predicted_mm"].max()), 1),
        "alert_days": {
            "yellow": int((df["predicted_mm"] >= 64.5).sum()),
            "orange": int((df["predicted_mm"] >= 115.6).sum()),
            "red":    int((df["predicted_mm"] >= 204.5).sum()),
        },
        "daily": df[["date", "predicted_mm", "actual_mm", "temp_C"]].to_dict(orient="records"),
        "monthly": monthly[["month", "predicted_mm", "actual_mm", "temp_C"]].to_dict(orient="records"),
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


# ── Scenario comparison ───────────────────────────────────────────────────────
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
