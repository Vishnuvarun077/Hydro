from sqlalchemy import Column, Integer, String, Float, DateTime, Text
from sqlalchemy.sql import func
from .database import Base, DATABASE_URL

IS_SQLITE = DATABASE_URL.startswith("sqlite")
if not IS_SQLITE:
    from geoalchemy2 import Geometry
    GCol = Geometry
else:
    GCol = Text


class Rainfall(Base):
    __tablename__ = "rainfall"
    id = Column(Integer, primary_key=True, index=True)
    station_name = Column(String(100), nullable=False, index=True)
    rainfall_mm = Column(Float, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    geom = Column(GCol)


class WaterLevel(Base):
    __tablename__ = "water_level"
    id = Column(Integer, primary_key=True, index=True)
    station_name = Column(String(100), nullable=False, index=True)
    level_m = Column(Float, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    geom = Column(GCol)


class DischargeEstimate(Base):
    __tablename__ = "discharge_estimates"
    id = Column(Integer, primary_key=True, index=True)
    computed_discharge_m3s = Column(Float, nullable=False)
    rainfall_intensity_mmhr = Column(Float)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class Alert(Base):
    __tablename__ = "alerts"
    id = Column(Integer, primary_key=True, index=True)
    alert_type = Column(String(50), nullable=False)
    message = Column(Text, nullable=False)
    severity = Column(String(20), default="medium")
    is_active = Column(Integer, default=1)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class SimulationRun(Base):
    """Stores each simulation run for history and comparison."""
    __tablename__ = "simulation_runs"
    id = Column(Integer, primary_key=True, index=True)
    scenario = Column(String(30), nullable=False)
    year_start = Column(Integer, nullable=False)
    year_end = Column(Integer, nullable=False)
    total_rainfall_mm = Column(Float)
    peak_discharge_m3s = Column(Float)
    peak_basin_id = Column(Integer)
    risk_level = Column(String(20))
    alert_days = Column(Integer)
    result_json = Column(Text)   # full result as JSON string
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
