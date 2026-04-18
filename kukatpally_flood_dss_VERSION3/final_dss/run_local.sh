#!/usr/bin/env bash
# ============================================================
# Kukatpally Nala Flood DSS — Local Quick-Start (No Docker)
# Runs with SQLite (no PostgreSQL needed for testing)
# ============================================================
set -e

echo "=============================================="
echo " FLOOD DSS — LOCAL QUICK START"
echo "=============================================="
echo ""

# 1. Create virtualenv
if [ ! -d "venv" ]; then
    echo "[1/4] Creating Python virtual environment..."
    python3 -m venv venv
fi

# 2. Activate and install
echo "[2/4] Installing dependencies..."
source venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet "uvicorn[standard]" websockets fastapi sqlalchemy aiosqlite pandas numpy scikit-learn \
    joblib requests aiohttp aiofiles rasterio matplotlib python-multipart

# 3. Start backend (SQLite mode — no PostgreSQL needed)
echo "[3/4] Starting backend on http://localhost:8000 ..."
echo "      API docs: http://localhost:8000/docs"
echo "      Dashboard: open frontend/index.html in browser"
echo ""
echo "      Press Ctrl+C to stop"
echo ""

export DATABASE_URL="sqlite:///./flood_das.db"
cd "$(dirname "$0")"

uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
