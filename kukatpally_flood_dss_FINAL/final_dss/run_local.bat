@echo off
echo ==============================================
echo  FLOOD DSS - LOCAL QUICK START (Windows)
echo ==============================================
echo.

IF NOT EXIST venv (
    echo [1/3] Creating virtual environment...
    python -m venv venv
)

echo [2/3] Installing dependencies...
call venv\Scripts\activate.bat
pip install --quiet fastapi uvicorn sqlalchemy aiosqlite pandas numpy scikit-learn joblib requests aiohttp aiofiles rasterio matplotlib python-multipart

echo [3/3] Starting backend at http://localhost:8000
echo       Open frontend\index.html in your browser after starting
echo.

set DATABASE_URL=sqlite:///./flood_das.db
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
pause
