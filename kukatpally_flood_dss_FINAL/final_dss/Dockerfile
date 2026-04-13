FROM python:3.11-slim

WORKDIR /app

# System deps for rasterio, geopandas, psycopg2
RUN apt-get update && apt-get install -y \
    gcc g++ libpq-dev \
    gdal-bin libgdal-dev \
    libgeos-dev libproj-dev \
    && rm -rf /var/lib/apt/lists/*

ENV GDAL_VERSION=3.6.2
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
