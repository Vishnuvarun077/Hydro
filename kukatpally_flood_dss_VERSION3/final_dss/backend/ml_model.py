"""
ML Rainfall Prediction Module
Assignment 3 — Random Forest Regressor
Integrated into the Flood DAS backend

Data: NASA POWER historical (fetched during training)
      NASA NEX-GDDP CMIP6 scenarios: SSP2-4.5, SSP3-7.0, SSP5-8.5 (2025-2050)
"""

import json
import logging
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error

logger = logging.getLogger(__name__)

BASE = Path(__file__).parent.parent
MODEL_PATH  = BASE / "data" / "models" / "rf_rainfall_model.joblib"
META_PATH   = BASE / "data" / "models" / "model_meta.json"
CLIMATE_DIR = BASE / "data" / "climate"

SCENARIO_FILES = {
    "SSP1-2.6": "ssp126_2025_2050.csv",   # Low emissions / sustainability
    "SSP2-4.5": "ssp245_2025_2050.csv",   # Middle of the road
    "SSP3-7.0": "ssp370_2025_2050.csv",   # Regional rivalry / high emissions
    "SSP5-8.5": "ssp585_2025_2050.csv",   # Fossil-fuelled development / extreme
}

FEATURES = [
    "temp_C", "humidity_pct", "wind_kmh", "solar_Wm2",
    "rainfall_lag1", "rainfall_lag2", "rainfall_lag3", "rainfall_3day_avg",
]


def train_model() -> dict:
    """
    Train a RandomForest model on historical climate data and save it to disk.
    Called automatically at startup if the model file is missing.
    Returns a dict with training metrics.
    """
    hist_path = CLIMATE_DIR / "historical_1990_2024.csv"
    if not hist_path.exists():
        raise FileNotFoundError(f"Training data not found: {hist_path}")

    logger.info("Training RF model on %s ...", hist_path)
    df = _prep_csv(hist_path)

    X, y = df[FEATURES], df["rainfall_mm"]
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42)

    model = RandomForestRegressor(
        n_estimators=200, max_depth=12, random_state=42, n_jobs=-1
    )
    model.fit(X_tr, y_tr)

    preds  = model.predict(X_te)
    r2     = round(r2_score(y_te, preds), 4)
    mae    = round(mean_absolute_error(y_te, preds), 4)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    logger.info("Model saved → %s  (R²=%.4f, MAE=%.4f mm/day)", MODEL_PATH, r2, mae)

    # Update metadata
    meta = json.loads(META_PATH.read_text()) if META_PATH.exists() else {}
    meta.update({
        "r2_score": r2,
        "mae_mm_day": mae,
        "n_estimators": 200,
        "features": FEATURES,
        "training_rows": len(X_tr),
        "trained_at": pd.Timestamp.utcnow().isoformat(),
    })
    META_PATH.write_text(json.dumps(meta, indent=2))

    return {"r2_score": r2, "mae_mm_day": mae, "training_rows": len(X_tr)}


def _load_model():
    if not MODEL_PATH.exists():
        logger.warning("Model not found — auto-training now. This takes ~30 seconds...")
        train_model()
    return joblib.load(MODEL_PATH)


def _prep_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["date"]).set_index("date")

    # Normalize column names from raw CSVs
    df = df.rename(columns={
        "rainfall":       "rainfall_mm",
        "temperature":    "temp_C",
        "humidity":       "humidity_pct",
        "wind_speed":     "wind_kmh",
        "solar_radiation":"solar_Wm2",
    })
    # Unit fix for raw NASA CSVs
    if "temp_C" in df and df["temp_C"].mean() > 100:
        df["temp_C"] -= 273.15
    if "rainfall_mm" in df and df["rainfall_mm"].max() < 1.0:
        df["rainfall_mm"] *= 86400
    if "wind_kmh" in df and df["wind_kmh"].max() < 20:
        df["wind_kmh"] *= 3.6

    # Lag features
    df["rainfall_lag1"]     = df["rainfall_mm"].shift(1)
    df["rainfall_lag2"]     = df["rainfall_mm"].shift(2)
    df["rainfall_lag3"]     = df["rainfall_mm"].shift(3)
    df["rainfall_3day_avg"] = df["rainfall_mm"].rolling(3, min_periods=1).mean()
    return df.dropna(subset=FEATURES)


def predict_scenario(
    scenario: str = "SSP2-4.5",
    year_start: int = 2025,
    year_end: int = 2035,
) -> pd.DataFrame:
    """
    Run RF prediction for a scenario and year range.
    Returns DataFrame with columns: date, scenario, actual_mm, predicted_mm
    """
    if scenario not in SCENARIO_FILES:
        raise ValueError(f"Unknown scenario '{scenario}'. Choose from {list(SCENARIO_FILES)}")

    csv_path = CLIMATE_DIR / SCENARIO_FILES[scenario]
    if not csv_path.exists():
        raise FileNotFoundError(f"Climate data not found: {csv_path}")

    model = _load_model()
    df = _prep_csv(csv_path)

    # Filter by year range
    df = df[(df.index.year >= year_start) & (df.index.year <= year_end)]
    if df.empty:
        raise ValueError(f"No data for {scenario} in {year_start}–{year_end}")

    df["predicted_mm"] = model.predict(df[FEATURES]).clip(min=0)
    df["scenario"] = scenario

    result = df[["scenario", "rainfall_mm", "predicted_mm",
                 "temp_C", "humidity_pct", "wind_kmh", "solar_Wm2"]].reset_index()
    result.columns = ["date", "scenario", "actual_mm", "predicted_mm",
                      "temp_C", "humidity_pct", "wind_kmh", "solar_Wm2"]
    result["date"] = result["date"].dt.strftime("%Y-%m-%d")
    return result


def get_model_metadata() -> dict:
    if META_PATH.exists():
        with open(META_PATH) as f:
            return json.load(f)
    return {"status": "model not trained"}


def get_available_scenarios() -> dict:
    out = {}
    for name, fname in SCENARIO_FILES.items():
        path = CLIMATE_DIR / fname
        if path.exists():
            df = pd.read_csv(path, nrows=2)
            full = pd.read_csv(path)
            out[name] = {
                "available": True,
                "rows": len(full),
                "year_range": f"2025–2050",
                "file": fname,
            }
        else:
            out[name] = {"available": False, "file": fname}
    return out


def daily_to_intensity(predicted_mm_day: float, tc_hours: float = 6.88) -> float:
    """
    Convert daily predicted rainfall (mm/day) to effective storm intensity (mm/hr).

    Tc = 6.88 hr is the Kirpich time of concentration for the Zone 12 whole catchment
    (Basin 6 main channel: L=18.6 km, S=0.0057 → Tc=4.6 hr; adding routing lag → ~6.88 hr).

    This Tc is chosen so that IMD Yellow threshold (64.5 mm/day) produces exactly
    Q = 200 m³/s (the flood threshold for Zone 12), providing consistent alert levels.

    No peak factor: daily rainfall distributed uniformly over Tc is conservative
    and appropriate for design-storm matching to IMD daily normals.
    """
    return round(predicted_mm_day / max(tc_hours, 0.5), 4)
