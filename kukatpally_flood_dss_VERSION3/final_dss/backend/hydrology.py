"""
Hydrological Computation Module
GHMC Zone 12 — Kukatpally Nala
Real parameters from QGIS analysis (Assignment 2)
"""

from dataclasses import dataclass
from typing import Optional, Tuple, List
from datetime import datetime

# ── Real catchment parameters from Assignment 2 QGIS analysis ────────────────
CATCHMENT_AREA_KM2     = 104.3    # km² — actual area from QGIS
CATCHMENT_AREA_M2      = CATCHMENT_AREA_KM2 * 1e6
RUNOFF_COEFFICIENT     = 0.736    # High urbanization (from Assignment 2)
RAINFALL_THRESHOLD_MM_HR  = 50    # mm/hr heavy rainfall
DISCHARGE_THRESHOLD_M3S   = 200   # m³/s flood risk threshold
WATER_LEVEL_THRESHOLD_M   = 2.5   # m critical stage

# ── Per-basin data from flow_quantification.csv ──────────────────────────────
# Basin_ID → (Area_km2, runoff_coeff, Peak_2yr, Peak_50yr)
BASIN_DATA = {
    1:  (0.4296, 0.75,  4.48,   7.52),
    2:  (0.4915, 0.75,  5.12,   8.61),
    3:  (0.7081, 0.75,  7.38,  12.40),
    4:  (0.1875, 0.75,  1.95,   3.28),
    5:  (9.0116, 0.75, 93.95, 157.83),
    6: (77.089,  0.75, 803.66, 1350.15),
    7:  (2.1234, 0.75, 22.14,  37.19),
    8:  (1.0913, 0.75, 11.38,  19.11),
    9:  (0.6653, 0.75,  6.94,  11.65),
    10: (0.2157, 0.75,  2.25,   3.78),
    11: (0.7782, 0.75,  8.11,  13.63),
    12: (0.2858, 0.75,  2.98,   5.01),
    13: (1.4089, 0.75, 14.69,  24.68),
    14: (0.4869, 0.75,  5.08,   8.53),
    15: (0.4806, 0.75,  5.01,   8.42),
    16: (1.2569, 0.75, 13.10,  22.01),
    17: (0.9466, 0.75,  9.87,  16.58),
}


@dataclass
class DischargeResult:
    discharge_m3s: float
    rainfall_intensity_mmhr: float
    runoff_coefficient: float
    catchment_area_km2: float
    timestamp: datetime
    is_flood_risk: bool


@dataclass
class AlertInfo:
    alert_type: str
    message: str
    severity: str
    triggered_value: float
    threshold_value: float


def mm_hr_to_m_s(r: float) -> float:
    return r * (0.001 / 3600)


def calculate_discharge_rational(
    rainfall_mm_hr: float,
    runoff_coeff: float = RUNOFF_COEFFICIENT,
    area_m2: float = CATCHMENT_AREA_M2,
) -> float:
    """Q = C × i × A  (m³/s)"""
    return round(runoff_coeff * mm_hr_to_m_s(rainfall_mm_hr) * area_m2, 2)


def calculate_discharge_per_basin(rainfall_mm_hr: float) -> List[dict]:
    """Rational Method discharge for every sub-basin using real Assignment-2 data."""
    results = []
    for basin_id, (area_km2, C, peak_2yr, peak_50yr) in BASIN_DATA.items():
        # Q = 0.278 × C × i × A  (where A in km², i in mm/hr)
        Q = round(0.278 * C * rainfall_mm_hr * area_km2, 4)
        risk = (
            "CRITICAL" if Q > peak_50yr * 1.2 else
            "HIGH"     if Q > peak_50yr else
            "MODERATE" if Q > peak_2yr else
            "LOW"
        )
        results.append({
            "basin_id": basin_id,
            "area_km2": area_km2,
            "runoff_coeff": C,
            "rain_intensity_mmhr": rainfall_mm_hr,
            "discharge_m3s": Q,
            "peak_2yr_m3s": peak_2yr,
            "peak_50yr_m3s": peak_50yr,
            "risk_level": risk,
            "exceedance_pct": round(Q / peak_2yr * 100, 1) if peak_2yr > 0 else 0,
        })
    return results


def compute_discharge_with_metadata(rainfall_mm_hr: float) -> DischargeResult:
    discharge = calculate_discharge_rational(rainfall_mm_hr)
    return DischargeResult(
        discharge_m3s=discharge,
        rainfall_intensity_mmhr=rainfall_mm_hr,
        runoff_coefficient=RUNOFF_COEFFICIENT,
        catchment_area_km2=CATCHMENT_AREA_KM2,
        timestamp=datetime.now(),
        is_flood_risk=discharge > DISCHARGE_THRESHOLD_M3S,
    )


def check_thresholds(
    rainfall_mm_hr: Optional[float] = None,
    discharge_m3s: Optional[float] = None,
    water_level_m: Optional[float] = None,
) -> List[AlertInfo]:
    alerts = []
    if rainfall_mm_hr and rainfall_mm_hr > RAINFALL_THRESHOLD_MM_HR:
        sev = "critical" if rainfall_mm_hr > 150 else "high" if rainfall_mm_hr > 100 else "medium"
        alerts.append(AlertInfo(
            "Heavy Rainfall Alert",
            f"Rainfall {rainfall_mm_hr:.1f} mm/hr exceeds {RAINFALL_THRESHOLD_MM_HR} mm/hr threshold",
            sev, rainfall_mm_hr, RAINFALL_THRESHOLD_MM_HR,
        ))
    if discharge_m3s and discharge_m3s > DISCHARGE_THRESHOLD_M3S:
        sev = "critical" if discharge_m3s > 1000 else "high" if discharge_m3s > 500 else "medium"
        alerts.append(AlertInfo(
            "Flood Risk Alert",
            f"Discharge {discharge_m3s:.1f} m³/s exceeds flood threshold {DISCHARGE_THRESHOLD_M3S} m³/s",
            sev, discharge_m3s, DISCHARGE_THRESHOLD_M3S,
        ))
    if water_level_m and water_level_m > WATER_LEVEL_THRESHOLD_M:
        sev = "critical" if water_level_m > 4.0 else "high" if water_level_m > 3.0 else "medium"
        alerts.append(AlertInfo(
            "Critical Stage Alert",
            f"Water level {water_level_m:.2f} m exceeds danger mark {WATER_LEVEL_THRESHOLD_M} m",
            sev, water_level_m, WATER_LEVEL_THRESHOLD_M,
        ))
    return alerts


def get_flood_risk_status(rainfall_mm_hr: float, water_level_m: float) -> Tuple[str, str, float]:
    discharge = calculate_discharge_rational(rainfall_mm_hr)
    if discharge > 1000 or water_level_m > 4.0:
        return "CRITICAL", "IMMEDIATE FLOOD RISK — EVACUATE NOW", discharge
    elif discharge > 500 or water_level_m > 3.0:
        return "HIGH", "HIGH FLOOD RISK — STAY ALERT", discharge
    elif discharge > 200 or water_level_m > 2.5:
        return "MEDIUM", "MODERATE FLOOD RISK — MONITOR CLOSELY", discharge
    elif discharge > 100 or water_level_m > 1.5:
        return "LOW", "LOW FLOOD RISK — NORMAL MONITORING", discharge
    return "NORMAL", "NO FLOOD RISK — SYSTEM NORMAL", discharge


def get_catchment_info() -> dict:
    return {
        "name": "Kukatpally Nala Sub-Catchment",
        "city": "Hyderabad, GHMC Zone 12",
        "area_km2": CATCHMENT_AREA_KM2,
        "runoff_coefficient": RUNOFF_COEFFICIENT,
        "num_basins": len(BASIN_DATA),
        "rainfall_threshold_mm_hr": RAINFALL_THRESHOLD_MM_HR,
        "discharge_threshold_m3s": DISCHARGE_THRESHOLD_M3S,
        "water_level_threshold_m": WATER_LEVEL_THRESHOLD_M,
        "reference_event": "13 October 2020 Hyderabad Flood",
        "data_source": "QGIS analysis — CartoDEM 30m + GHMC data",
    }


def kirpich_tc(length_km: float, slope_m_per_m: float) -> float:
    """Kirpich Tc formula → hours"""
    L = length_km * 1000
    tc_min = 0.0195 * (L ** 0.77) * (slope_m_per_m ** -0.385)
    return round(tc_min / 60, 3)
