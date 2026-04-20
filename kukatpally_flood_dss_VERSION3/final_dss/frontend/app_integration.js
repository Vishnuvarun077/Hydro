/* ================================================================
   FLOOD DSS v3 — INTEGRATION MODULE
   Fixes applied:
   - Discharge chart: per-point color array (no broken segment callback)
   - Alert Level = combined IMD rainfall + discharge (from API)
   - Y/O/R counts from API's alert_level field (not raw mm)
   - Scenario Guide tab REMOVED
   - Historical data tab works with /ml/historical endpoint
   - Correct Tc=6.88h → alerts only fire for genuinely heavy rain
   ================================================================ */

const API = window.location.origin;

/* ── chart registry ─────────────────────────────────────────── */
const _ch = {};
function mkChart(id, type, labels, datasets, opts = {}) {
    const ctx = document.getElementById(id);
    if (!ctx) return null;
    if (_ch[id]) { _ch[id].destroy(); delete _ch[id]; }
    _ch[id] = new Chart(ctx, {
        type,
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#8ba5c0', font: { size: 10 } } } },
            scales: {
                x: { ticks: { color: '#4a90a4', maxRotation: 45, font: { size: 9 } }, grid: { color: '#1a2a3a' } },
                y: { ticks: { color: '#4a90a4', font: { size: 9 } }, grid: { color: '#1a2a3a' } }
            },
            ...opts
        }
    });
    return _ch[id];
}

/* ── color helpers ──────────────────────────────────────────── */
const RISK_COLORS = {
    CRITICAL: '#ff4444', HIGH: '#ff6622', MODERATE: '#ffcc00',
    RED: '#ff4444', ORANGE: '#ff8800', YELLOW: '#ffcc00',
    LOW: '#00cc66', NORMAL: '#00d4ff'
};
const ALERT_COLORS = { RED: '#ff4444', ORANGE: '#ff8800', YELLOW: '#ffcc00', NORMAL: '#00d4ff' };
const ALERT_BG    = { RED: '#ff444488', ORANGE: '#ff880088', YELLOW: '#ffcc0088', NORMAL: '#00d4ff33' };

function rc(r) { return RISK_COLORS[r] || '#8ba5c0'; }
function ac(a) { return ALERT_COLORS[a] || '#00d4ff'; }

/* ── inject overlay ─────────────────────────────────────────── */
function injectIntegrationUI() {
    if (document.getElementById('int-overlay')) return;

    document.body.insertAdjacentHTML('beforeend', `
<div id="int-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:3000;
  background:#07111d;overflow-y:auto;display:none;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
 <div style="max-width:1160px;margin:0 auto;padding:14px 16px;">

  <!-- header -->
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;
    border-bottom:1px solid #1a2d3f;padding-bottom:10px;flex-wrap:wrap;">
   <div>
    <div style="font-size:15px;font-weight:700;color:#00d4ff;letter-spacing:.5px;">
      KUKATPALLY NALA FLOOD DSS
      <span style="font-size:11px;background:#00d4ff22;color:#00d4ff;
        padding:2px 7px;border-radius:3px;margin-left:6px;font-family:monospace;">v3</span>
    </div>
    <div style="font-size:11px;color:#4a90a4;">
      GHMC Zone 12 · ML Prediction → Rational Method · 4 SSP Scenarios 2025–2050
    </div>
   </div>
   <button onclick="closeInt()" style="margin-left:auto;background:#0d1b2a;
     border:1px solid #2a3f5a;color:#8ba5c0;padding:5px 14px;
     border-radius:4px;cursor:pointer;font-size:12px;">✕ Close</button>
  </div>

  <!-- tabs -->
  <div id="int-tabs" style="display:flex;gap:3px;margin-bottom:12px;flex-wrap:wrap;">
   <button class="itab active-itab" data-tab="sim"        onclick="showIntTab('sim')">⚡ Simulate</button>
   <button class="itab"             data-tab="daywise"    onclick="showIntTab('daywise')">📅 Day-wise Alerts</button>
   <button class="itab"             data-tab="predictors" onclick="showIntTab('predictors')">📊 Predictor Variables</button>
   <button class="itab"             data-tab="historical" onclick="showIntTab('historical')">📈 Historical Data</button>
   <button class="itab"             data-tab="compare"    onclick="showIntTab('compare')">↔ Compare</button>
   <button class="itab"             data-tab="history"    onclick="showIntTab('history')">📋 Run History</button>
   <button class="itab"             data-tab="mlinfo"     onclick="showIntTab('mlinfo')">🤖 Model Info</button>
   <button class="itab"             data-tab="report"     onclick="showIntTab('report')">📄 Report</button>
  </div>

  <!-- ══ SIMULATE ══ -->
  <div id="itab-sim" class="itab-pane">
   <div class="g2">
    <div class="card">
     <div class="ct">Simulation Parameters</div>
     <label class="lbl">Climate Scenario</label>
     <select id="sim-scenario" class="sel">
      <option value="SSP1-2.6">🌱 SSP1-2.6 — Low emissions (sustainability)</option>
      <option value="SSP2-4.5" selected>⚖️ SSP2-4.5 — Middle of road (current)</option>
      <option value="SSP3-7.0">⚠️ SSP3-7.0 — High emissions (regional rivalry)</option>
      <option value="SSP5-8.5">🔥 SSP5-8.5 — Fossil-fuelled (worst case)</option>
     </select>
     <div id="scen-info" style="margin:6px 0;font-size:11px;color:#4a90a4;padding:6px 8px;
       background:#0a1520;border-radius:4px;border-left:3px solid #00d4ff;display:none;"></div>

     <label class="lbl" style="margin-top:10px;">Year Range</label>
     <div style="display:flex;gap:8px;align-items:center;">
      <select id="sim-ys" class="sel" style="flex:1;">
       ${[2025,2026,2027,2028,2030,2035,2040].map(y=>`<option ${y===2025?'selected':''}>${y}</option>`).join('')}
      </select>
      <span style="color:#4a90a4;">→</span>
      <select id="sim-ye" class="sel" style="flex:1;">
       ${[2030,2035,2040,2045,2050].map(y=>`<option ${y===2035?'selected':''}>${y}</option>`).join('')}
      </select>
     </div>

     <label class="lbl" style="margin-top:10px;">Sub-Basin Filter</label>
     <select id="sim-basin" class="sel">
      <option value="">All 17 basins (Zone 12 — 104.3 km²)</option>
      ${Array.from({length:17},(_,i)=>`<option value="${i+1}">Basin ${i+1}</option>`).join('')}
     </select>

     <button id="sim-btn" onclick="runSim()" class="btn-p" style="margin-top:14px;width:100%;">
       ▶ RUN SIMULATION
     </button>
     <div id="sim-spin" style="display:none;text-align:center;padding:8px;font-size:12px;color:#4a90a4;">
       ⏳ Running ML prediction + Rational Method discharge…
     </div>
    </div>

    <div class="card" id="sim-sum">
     <div class="ct">Results Summary</div>
     <div id="sim-sum-body" style="color:#4a90a4;font-size:12px;padding:20px 0;text-align:center;">
       Run a simulation to see results
     </div>
    </div>
   </div>

   <div class="g2" style="margin-top:10px;">
    <div class="card"><div class="ct">Monthly Rainfall Forecast (mm/month)</div>
     <div style="height:180px;"><canvas id="c-monthly"></canvas></div></div>
    <div class="card"><div class="ct">Peak Discharge per Sub-Basin — Rational Method (m³/s)</div>
     <div style="height:180px;"><canvas id="c-basin"></canvas></div></div>
   </div>

   <div class="card" style="margin-top:10px;">
    <div class="ct">Sub-Basin Discharge Table (Q = 0.278 × C × i × A, Tc = 6.88 hr)</div>
    <div id="basin-tbl" style="overflow-x:auto;max-height:260px;overflow-y:auto;"></div>
   </div>
  </div>

  <!-- ══ DAY-WISE ALERTS ══ -->
  <div id="itab-daywise" class="itab-pane" style="display:none;">
   <div class="card" style="margin-bottom:10px;">
    <div class="ct">Day-wise Flood Prediction — Precise Threshold Exceedance</div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;">
     <div><label class="lbl">Scenario</label>
      <select id="dw-scen" class="sel">
       <option value="SSP1-2.6">🌱 SSP1-2.6</option>
       <option value="SSP2-4.5" selected>⚖️ SSP2-4.5</option>
       <option value="SSP3-7.0">⚠️ SSP3-7.0</option>
       <option value="SSP5-8.5">🔥 SSP5-8.5</option>
      </select>
     </div>
     <div><label class="lbl">Year</label>
      <select id="dw-yr" class="sel">
       ${Array.from({length:26},(_,i)=>`<option>${2025+i}</option>`).join('')}
      </select>
     </div>
     <button onclick="loadDaywise()" class="btn-p">Load Day-wise View</button>
    </div>
    <!-- legend -->
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:#8ba5c0;">
     <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#ffcc00;margin-right:4px;"></span>Yellow ≥64.5 mm/day <b style="color:#4a90a4;">or</b> Q>200 m³/s</span>
     <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#ff8800;margin-right:4px;"></span>Orange ≥115.6 mm/day <b style="color:#4a90a4;">or</b> Q>500 m³/s</span>
     <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#ff4444;margin-right:4px;"></span>Red ≥204.5 mm/day <b style="color:#4a90a4;">or</b> Q>1000 m³/s</span>
     <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#00d4ff;margin-right:4px;"></span>Normal</span>
     <span style="color:#ff444466;margin-left:auto;">— — Flood threshold (200 m³/s)</span>
    </div>
   </div>

   <!-- DISCHARGE CHART — correct coloring -->
   <div class="card" style="margin-bottom:10px;">
    <div class="ct">Daily Discharge (m³/s) — coloured by combined alert level</div>
    <div style="height:220px;"><canvas id="c-dw-q"></canvas></div>
   </div>

   <!-- RAINFALL CHART -->
   <div class="card" style="margin-bottom:10px;">
    <div class="ct">Daily Rainfall (mm) — coloured by combined IMD + discharge alert level</div>
    <div style="height:180px;"><canvas id="c-dw-rain"></canvas></div>
   </div>

   <!-- TABLE -->
   <div class="card">
    <div class="ct" id="dw-title">Alert Days — select scenario and year above</div>
    <div id="dw-tbl" style="overflow-x:auto;max-height:320px;overflow-y:auto;">
     <div style="color:#4a90a4;padding:16px;text-align:center;">Select scenario and year to load day-wise predictions</div>
    </div>
   </div>
  </div>

  <!-- ══ PREDICTOR VARIABLES ══ -->
  <div id="itab-predictors" class="itab-pane" style="display:none;">
   <div class="card" style="margin-bottom:10px;">
    <div class="ct">Predictor Variable Visualization</div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;">
     <div><label class="lbl">Scenario</label>
      <select id="pv-scen" class="sel">
       <option value="SSP1-2.6">🌱 SSP1-2.6</option><option value="SSP2-4.5" selected>⚖️ SSP2-4.5</option>
       <option value="SSP3-7.0">⚠️ SSP3-7.0</option><option value="SSP5-8.5">🔥 SSP5-8.5</option>
      </select></div>
     <div><label class="lbl">Year Range</label>
      <div style="display:flex;gap:6px;">
       <select id="pv-ys" class="sel">${[2025,2030,2035,2040,2045].map(y=>`<option>${y}</option>`).join('')}</select>
       <span style="color:#4a90a4;align-self:center;">–</span>
       <select id="pv-ye" class="sel">${[2030,2035,2040,2045,2050].map(y=>`<option ${y===2030?'selected':''}>${y}</option>`).join('')}</select>
      </div></div>
     <div><label class="lbl">Aggregation</label>
      <select id="pv-agg" class="sel">
       <option value="daily">Daily (sampled)</option>
       <option value="monthly" selected>Monthly average</option>
       <option value="annual">Annual</option>
      </select></div>
     <button onclick="loadPV()" class="btn-p">Load Variables</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
     ${[['predicted_mm','Predicted Rain','#00d4ff'],['actual_mm','Scenario Rain','#4a90a4'],
        ['temp_C','Temperature','#ff8800'],['humidity_pct','Humidity','#00cc66'],
        ['wind_kmh','Wind Speed','#cc88ff'],['solar_Wm2','Solar Radiation','#ffcc00'],
        ['rainfall_lag1','Rain Lag-1','#ff6680'],['rainfall_lag2','Rain Lag-2','#ff9944'],
        ['rainfall_3day_avg','3-Day Avg','#44ddaa']].map(([k,l,c])=>`
     <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;
       color:#8ba5c0;background:#0d1b2a;padding:4px 8px;border-radius:3px;border:1px solid #1e2d3d;">
      <input type="checkbox" data-key="${k}" data-color="${c}" class="pv-chk"
        ${['predicted_mm','temp_C','humidity_pct'].includes(k)?'checked':''}>
      <span style="display:inline-block;width:9px;height:9px;background:${c};border-radius:2px;"></span>
      ${l}</label>`).join('')}
    </div>
   </div>
   <div class="card" style="margin-bottom:10px;">
    <div class="ct" id="pv-title">Select variables above and click Load</div>
    <div style="height:260px;"><canvas id="c-pv"></canvas></div>
   </div>
   <div class="g2">
    <div class="card"><div class="ct">Variable Statistics</div>
     <div id="pv-stats" style="font-size:11px;max-height:220px;overflow-y:auto;"></div></div>
    <div class="card"><div class="ct">Pearson r — Correlation with Predicted Rainfall</div>
     <div style="height:190px;"><canvas id="c-pv-corr"></canvas></div></div>
   </div>
  </div>

  <!-- ══ HISTORICAL DATA ══ -->
  <div id="itab-historical" class="itab-pane" style="display:none;">

   <!-- Data source info -->
   <div style="background:#0a1520;border:1px solid #1a3a2a;border-left:3px solid #00cc66;
     border-radius:6px;padding:10px 14px;margin-bottom:10px;font-size:11px;color:#4a90a4;line-height:1.8;">
    <b style="color:#00cc66;">Data source:</b>
    Historical data (1990–2024) generated from published
    <b style="color:#c8d8e8;">IMD 1991–2020 normals</b> for Hyderabad (CLE-01/2021).
    Annual mean ≈ 756 mm/yr (IMD published normal: 794 mm/yr, ±5%). <br>
    <b style="color:#ffcc00;">Note:</b>
    IMD live hourly station data requires free registration at
    <a href="https://dsp.imdpune.gov.in" target="_blank"
       style="color:#00d4ff;">dsp.imdpune.gov.in</a>.
    See instructions below on how to replace with real IMD data.
   </div>

   <div class="card" style="margin-bottom:10px;">
    <div class="ct">View Historical Climate Variable</div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
     <div><label class="lbl">Variable</label>
      <select id="h-var" class="sel">
       <option value="rainfall_mm">Rainfall (mm)</option>
       <option value="temp_C">Temperature (°C)</option>
       <option value="humidity_pct">Humidity (%)</option>
       <option value="wind_kmh">Wind Speed (km/h)</option>
       <option value="solar_Wm2">Solar Radiation (W/m²)</option>
      </select></div>
     <div><label class="lbl">Aggregation</label>
      <select id="h-agg" class="sel">
       <option value="monthly" selected>Monthly</option>
       <option value="annual">Annual</option>
       <option value="daily">Daily (sampled)</option>
      </select></div>
     <div><label class="lbl">Year Range</label>
      <div style="display:flex;gap:6px;">
       <select id="h-ys" class="sel">${Array.from({length:35},(_,i)=>`<option>${1990+i}</option>`).join('')}</select>
       <span style="color:#4a90a4;align-self:center;">→</span>
       <select id="h-ye" class="sel">${Array.from({length:35},(_,i)=>`<option ${i===34?'selected':''}>${1990+i}</option>`).join('')}</select>
      </div></div>
     <button onclick="loadHist()" class="btn-p">Load Historical</button>
    </div>
   </div>

   <div class="card" style="margin-bottom:10px;">
    <div class="ct" id="h-title">Select variable and click Load</div>
    <div style="height:240px;"><canvas id="c-hist"></canvas></div>
   </div>

   <div class="g2">
    <div class="card">
     <div class="ct">IMD Monthly Rainfall Normals (Reference — 1991–2020)</div>
     <div style="height:160px;"><canvas id="c-normals"></canvas></div>
    </div>
    <div class="card">
     <div class="ct">Statistics</div>
     <div id="h-stats" style="font-size:11px;padding-top:4px;"></div>
    </div>
   </div>

   <!-- How to add real IMD data -->
   <div class="card" style="margin-top:10px;">
    <div class="ct" style="color:#ffcc00;">📋 How to replace with real IMD data</div>
    <div style="font-size:12px;color:#8ba5c0;line-height:1.9;">
     <p style="margin:0 0 8px;color:#c8d8e8;font-weight:500;">Option A — Free IMD registration (recommended):</p>
     <ol style="margin:0 0 12px;padding-left:18px;color:#8ba5c0;">
      <li>Go to <a href="https://dsp.imdpune.gov.in" target="_blank" style="color:#00d4ff;">dsp.imdpune.gov.in</a> → Register with your college email</li>
      <li>Under "Parameters" request: <b style="color:#c8d8e8;">RF (Rainfall)</b>, <b style="color:#c8d8e8;">T2M (Temperature)</b>, <b style="color:#c8d8e8;">RH (Humidity)</b></li>
      <li>Wait for approval (1–3 days). Download daily station data for Hyderabad (Station ID: 43128)</li>
      <li>Format your CSV to match the required columns: <code style="color:#00d4ff;">date,rainfall_mm,temp_C,humidity_pct,wind_kmh,solar_Wm2,source</code></li>
      <li>Replace <code style="color:#00d4ff;">data/climate/historical_1990_2024.csv</code> with your real data file</li>
      <li>Restart the server — historical tab will show real data immediately</li>
     </ol>
     <p style="margin:0 0 8px;color:#c8d8e8;font-weight:500;">Option B — NASA POWER (already works, no registration needed):</p>
     <ol style="margin:0;padding-left:18px;color:#8ba5c0;">
      <li>Open a terminal in the <code style="color:#00d4ff;">final_dss</code> folder</li>
      <li>Run: <code style="color:#00d4ff;">python scripts/fetch_nasa_historical.py</code> (downloads 1990–2024 automatically)</li>
      <li>This overwrites <code style="color:#00d4ff;">data/climate/historical_1990_2024.csv</code> with real NASA POWER data</li>
      <li>Restart server — done</li>
     </ol>
    </div>
   </div>
  </div>

  <!-- ══ COMPARE ══ -->
  <div id="itab-compare" class="itab-pane" style="display:none;">
   <div class="card" style="margin-bottom:10px;">
    <div class="ct">Compare Two Scenarios Side by Side</div>
    <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
     <div><label class="lbl">Scenario A</label>
      <select id="ca" class="sel">
       <option value="SSP1-2.6">🌱 SSP1-2.6</option><option value="SSP2-4.5" selected>⚖️ SSP2-4.5</option>
       <option value="SSP3-7.0">⚠️ SSP3-7.0</option><option value="SSP5-8.5">🔥 SSP5-8.5</option>
      </select></div>
     <div><label class="lbl">Scenario B</label>
      <select id="cb" class="sel">
       <option value="SSP1-2.6">🌱 SSP1-2.6</option><option value="SSP2-4.5">⚖️ SSP2-4.5</option>
       <option value="SSP3-7.0">⚠️ SSP3-7.0</option><option value="SSP5-8.5" selected>🔥 SSP5-8.5</option>
      </select></div>
     <div><label class="lbl">Years</label>
      <div style="display:flex;gap:6px;">
       <select id="c-ys" class="sel">${[2025,2030,2035].map(y=>`<option>${y}</option>`).join('')}</select>
       <span style="color:#4a90a4;align-self:center;">→</span>
       <select id="c-ye" class="sel">${[2035,2040,2045,2050].map(y=>`<option ${y===2050?'selected':''}>${y}</option>`).join('')}</select>
      </div></div>
     <button onclick="runCompare()" class="btn-p">↔ Compare</button>
    </div>
   </div>
   <div id="cmp-res"></div>
  </div>

  <!-- ══ RUN HISTORY ══ -->
  <div id="itab-history" class="itab-pane" style="display:none;">
   <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
     <div class="ct" style="margin:0;">Simulation Run History</div>
     <button onclick="loadHistory()" class="btn-s">↻ Refresh</button>
    </div>
    <div id="hist-runs"></div>
   </div>
  </div>

  <!-- ══ MODEL INFO ══ -->
  <div id="itab-mlinfo" class="itab-pane" style="display:none;">
   <div class="g2">
    <div class="card"><div class="ct">Random Forest — Performance Metrics</div><div id="ml-meta"></div></div>
    <div class="card"><div class="ct">Feature Importance</div><div style="height:220px;"><canvas id="c-fi"></canvas></div></div>
   </div>
   <div class="card" style="margin-top:10px;">
    <div class="ct">Actual vs Predicted Rainfall — SSP2-4.5 monsoon season 2025</div>
    <div style="height:200px;"><canvas id="c-avp"></canvas></div>
   </div>
  </div>

  <!-- ══ REPORT ══ -->
  <div id="itab-report" class="itab-pane" style="display:none;">
   <div class="card" style="margin-bottom:12px;">
    <div class="ct">Generate Simulation Report (PDF)</div>
    <p style="font-size:13px;color:#8ba5c0;margin-bottom:12px;">
     Run a simulation first, then generate a printable PDF report.
    </p>
    <button onclick="genReport()" class="btn-p">📄 Generate Report → Print / Save PDF</button>
   </div>
   <div id="report-preview"></div>
  </div>

 </div><!-- /inner -->
</div><!-- /overlay -->`);

    /* ── inject CSS ──────────────────────────────────────────── */
    document.head.insertAdjacentHTML('beforeend', `<style>
.itab{background:#0d1b2a;border:1px solid #1e2d3d;color:#8ba5c0;padding:7px 13px;
  border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;transition:all .15s;}
.itab:hover{border-color:#3a6a9a;color:#c8d8e8;}
.active-itab{border-color:#00d4ff!important;color:#00d4ff!important;}
.itab-pane{animation:fadeIn .15s ease;}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.card{background:#0d1b2a;border:1px solid #1a2d3f;border-radius:6px;padding:14px;}
.ct{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#00d4ff;margin-bottom:10px;}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.lbl{display:block;font-size:11px;color:#4a90a4;margin-bottom:3px;}
.sel{width:100%;background:#111c2a;border:1px solid #2a3f5a;color:#c8d8e8;
  padding:6px 8px;border-radius:4px;font-size:12px;}
.btn-p{background:linear-gradient(135deg,#0070c0,#00d4ff);border:none;color:#fff;
  padding:8px 18px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.3px;}
.btn-p:hover{opacity:.88;} .btn-p:active{transform:scale(.98);}
.btn-s{background:#111c2a;border:1px solid #2a3f5a;color:#8ba5c0;
  padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
.kpi{background:#0a1520;padding:10px;border-radius:4px;border-left:3px solid var(--kc,#00d4ff);}
.kpi .kl{font-size:10px;color:#4a90a4;} .kpi .kv{font-size:18px;font-weight:700;color:var(--kc,#00d4ff);}
.kpi .ks{font-size:10px;color:#4a90a4;margin-top:1px;}
.tbl{width:100%;border-collapse:collapse;font-size:11px;}
.tbl th{background:#111c2a;color:#4a90a4;padding:6px 8px;text-align:left;
  border-bottom:1px solid #1a2d3f;position:sticky;top:0;}
.tbl td{padding:5px 8px;border-bottom:1px solid #0a1520;color:#c8d8e8;}
.tbl tr:hover td{background:#0f1e2d;}
.pill{display:inline-block;padding:2px 7px;border-radius:3px;font-size:10px;font-weight:700;}
/* Responsive */
@media(max-width:1200px){.g2{grid-template-columns:1fr;}.kpis{grid-template-columns:1fr 1fr;}}
@media(max-width:900px){#int-overlay>div>div{padding:8px 10px;}.itab{padding:5px 8px;font-size:11px;}.card{padding:10px;}}
@media(max-width:600px){.kpis{grid-template-columns:1fr;}}
/* Main dashboard responsive */
@media(max-width:1280px){.dashboard-container{grid-template-columns:240px 1fr 280px!important;}}
@media(max-width:1100px){.dashboard-container{grid-template-columns:220px 1fr!important;}.right-panel{display:none!important;}}
@media(max-width:768px){.dashboard-container{grid-template-columns:1fr!important;}.left-panel{display:none!important;}
  #map{min-height:280px;}.header-center{display:none;}.metrics-grid{grid-template-columns:1fr 1fr!important;}}
/* Print */
@media print{
  #int-overlay{position:static!important;background:#fff!important;}
  #int-tabs,.btn-p,.btn-s,#sim-btn{display:none!important;}
  #int-overlay>div>div{padding:0;max-width:100%;}
  .card{border:1px solid #ddd!important;background:#fff!important;color:#111!important;}
  .ct{color:#0070c0!important;} #report-preview{display:block!important;}
}
</style>`);

    /* ── launch button ───────────────────────────────────────── */
    const hr = document.querySelector('.header-right');
    if (hr) {
        const b = document.createElement('button');
        b.innerHTML = '⚡ DSS v3';
        b.style.cssText = `background:linear-gradient(135deg,#003a70,#00d4ff);border:none;
          color:#fff;padding:6px 12px;border-radius:4px;cursor:pointer;
          font-size:11px;font-weight:700;letter-spacing:.3px;margin-left:8px;`;
        b.onclick = openInt;
        hr.appendChild(b);
    }

    document.getElementById('sim-scenario').addEventListener('change', updateScenPreview);
    loadMLInfo();
}

function openInt()  { document.getElementById('int-overlay').style.display = 'block'; showIntTab('sim'); updateScenPreview(); }
function closeInt() {
    document.getElementById('int-overlay').style.display = 'none';
    window.simModeActive = false;
    if (typeof fetchCurrentStatus === 'function') fetchCurrentStatus();
}

function showIntTab(id) {
    document.querySelectorAll('.itab').forEach(b => b.classList.toggle('active-itab', b.dataset.tab === id));
    document.querySelectorAll('.itab-pane').forEach(p => p.style.display = 'none');
    const el = document.getElementById('itab-' + id);
    if (el) el.style.display = 'block';
    if (id === 'history') loadHistory();
    if (id === 'mlinfo')  loadMLInfo();
    if (id === 'historical') { renderIMDNormals(); }
}

/* ── scenario preview ────────────────────────────────────────── */
const SCEN_INFO = {
    'SSP1-2.6': { color:'#00cc66', text:'Low emissions · +1.0–1.8°C by 2100 · manageable flood risk increase' },
    'SSP2-4.5': { color:'#ffcc00', text:'Middle of road · +2.1–3.5°C by 2100 · intensified monsoon variability' },
    'SSP3-7.0': { color:'#ff8800', text:'High emissions · +2.8–4.6°C by 2100 · erratic monsoon, more extremes' },
    'SSP5-8.5': { color:'#ff4444', text:'Worst case · +3.3–5.7°C by 2100 · catastrophic flood risk by 2050' },
};
function updateScenPreview() {
    const key = document.getElementById('sim-scenario')?.value;
    const el = document.getElementById('scen-info');
    if (!el || !SCEN_INFO[key]) return;
    const s = SCEN_INFO[key];
    el.style.display = 'block';
    el.style.borderLeftColor = s.color;
    el.innerHTML = `<b style="color:${s.color}">${key}</b> — ${s.text}`;
}

/* ── state ───────────────────────────────────────────────────── */
let lastSim = null;

/* ════════════════════════════════════════════════════════════════
   SIMULATE
════════════════════════════════════════════════════════════════ */
async function runSim() {
    const scenario = document.getElementById('sim-scenario').value;
    const ys = +document.getElementById('sim-ys').value;
    const ye = +document.getElementById('sim-ye').value;
    const br = document.getElementById('sim-basin').value;
    if (ye <= ys) { alert('Year end must be after year start'); return; }

    const sp = document.getElementById('sim-spin');
    const sb = document.getElementById('sim-btn');
    sp.style.display = 'block'; sb.disabled = true;

    try {
        const body = { scenario, year_start: ys, year_end: ye };
        if (br) body.basin_id = +br;
        const res = await fetch(`${API}/simulate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) { const e = await res.json(); alert('Error: ' + (e.detail || 'unknown')); return; }
        const data = await res.json();
        lastSim = data;
        renderSim(data);
        await syncDash(data);
    } catch(e) { alert('Cannot reach API: ' + e.message); }
    finally { sp.style.display = 'none'; sb.disabled = false; }
}

function renderSim(data) {
    const risk = data.overall_risk_level, rcolor = rc(risk);
    const ad = data.alert_days || {};
    document.getElementById('sim-sum-body').innerHTML = `
     <div class="kpis" style="margin-bottom:10px;">
      <div class="kpi" style="--kc:#00d4ff;"><div class="kl">Total Rainfall</div>
       <div class="kv">${(data.total_rainfall_mm||0).toFixed(0)}</div>
       <div class="ks">mm · ${data.year_range}</div></div>
      <div class="kpi" style="--kc:${rcolor};"><div class="kl">Overall Risk</div>
       <div class="kv">${risk}</div>
       <div class="ks">Peak Q: ${(data.peak_discharge_m3s||0).toFixed(1)} m³/s</div></div>
      <div class="kpi" style="--kc:#ffcc00;"><div class="kl">Yellow Days</div>
       <div class="kv">${ad.yellow||0}</div><div class="ks">≥64.5 mm/day</div></div>
      <div class="kpi" style="--kc:#ff8800;"><div class="kl">Orange+Red Days</div>
       <div class="kv">${(ad.orange||0)+(ad.red||0)}</div><div class="ks">≥115.6 mm/day</div></div>
     </div>
     <div style="font-size:11px;color:#4a90a4;display:flex;gap:16px;flex-wrap:wrap;">
      <span>Peak date: <b style="color:#c8d8e8;">${data.peak_date||'—'}</b></span>
      <span>Peak basin: <b style="color:#c8d8e8;">Basin ${data.peak_basin_id||'—'}</b></span>
      <span>Flood days (Q>200): <b style="color:#ff4444;">${(data.flood_exceedance_days||[]).length||0}</b></span>
      <span style="margin-left:auto;color:#00cc66;">✓ Dashboard synced</span>
     </div>`;

    const monthly = data.monthly || [];
    mkChart('c-monthly', 'bar', monthly.map(m => m.month), [{
        label: `${data.scenario} (mm/month)`,
        data: monthly.map(m => m.total_rain_mm),
        backgroundColor: monthly.map(m =>
            m.total_rain_mm > 204 ? '#ff444488' : m.total_rain_mm > 115 ? '#ff880088' :
            m.total_rain_mm > 64 ? '#ffcc0088' : '#00d4ff44'),
        borderColor: monthly.map(m =>
            m.total_rain_mm > 204 ? '#ff4444' : m.total_rain_mm > 115 ? '#ff8800' :
            m.total_rain_mm > 64 ? '#ffcc00' : '#00d4ff'),
        borderWidth: 1, borderRadius: 3,
    }], { plugins: { legend: { display: false } } });

    const basins = data.basin_summary || [];
    mkChart('c-basin', 'bar', basins.map(b => `B${b.basin_id}`), [{
        label: 'Q m³/s', data: basins.map(b => b.discharge_m3s),
        backgroundColor: basins.map(b => rc(b.risk_level) + '99'),
        borderColor: basins.map(b => rc(b.risk_level)),
        borderWidth: 1, borderRadius: 2,
    }], { plugins: { legend: { display: false } } });

    document.getElementById('basin-tbl').innerHTML = `
     <table class="tbl"><thead><tr>
      <th>Basin</th><th>Area km²</th><th>C</th><th>i mm/hr</th>
      <th>Q m³/s</th><th>Q₂yr</th><th>Q₅₀yr</th><th>Risk</th>
     </tr></thead><tbody>
     ${basins.map(b => {
         const c = rc(b.risk_level);
         return `<tr><td>${b.basin_id}</td><td>${b.area_km2.toFixed(2)}</td>
          <td>${b.runoff_coeff}</td><td>${(b.rain_intensity_mmhr||0).toFixed(3)}</td>
          <td style="color:${c};font-weight:700;">${b.discharge_m3s.toFixed(3)}</td>
          <td>${b.peak_2yr_m3s.toFixed(2)}</td><td>${b.peak_50yr_m3s.toFixed(2)}</td>
          <td><span class="pill" style="background:${c}22;color:${c};">${b.risk_level}</span></td></tr>`;
     }).join('')}</tbody></table>`;

    colorMapBasins(basins);

    // Push simulation results to main dashboard KPI cards
    syncDashboardWithSimulation(data);
}

function syncDashboardWithSimulation(data) {
    const peakBasin = (data.basin_summary || []).find(b => b.basin_id === data.peak_basin_id)
                   || (data.basin_summary || [])[0];
    const peakIntensity = peakBasin ? peakBasin.rain_intensity_mmhr : 0;

    if (typeof window.currentIntensity !== 'undefined') {
        window.currentIntensity = peakIntensity;
    }

    const rainfallEl   = document.getElementById('rainfall-value');
    const dischargeEl  = document.getElementById('discharge-value');
    const riskCardEl   = document.getElementById('risk-card');
    const riskLevelEl  = document.getElementById('risk-level');
    const riskMsgEl    = document.getElementById('risk-message');
    const lastUpdateEl = document.getElementById('last-update');

    if (rainfallEl)   rainfallEl.textContent   = peakIntensity.toFixed(1);
    if (dischargeEl)  dischargeEl.textContent  = data.peak_discharge_m3s.toFixed(1);
    if (lastUpdateEl) lastUpdateEl.textContent = new Date().toLocaleTimeString();

    const risk = (data.overall_risk_level || 'NORMAL').toLowerCase();
    if (riskCardEl)  riskCardEl.className    = `status-card risk-card ${risk}`;
    if (riskLevelEl) riskLevelEl.textContent = data.overall_risk_level || 'NORMAL';
    if (riskMsgEl)   riskMsgEl.textContent   = `Simulation: ${data.scenario} | ${data.year_range}`;

    window.simModeActive = true;
}

function colorMapBasins(basins) {
    const rmap = {}; basins.forEach(b => rmap[b.basin_id] = b.risk_level);
    try {
        if (window.drainageBasinsLayer) {
            window.drainageBasinsLayer.eachLayer(l => {
                const bid = l.feature?.properties?.Basin_ID || l.feature?.properties?.DN;
                if (rmap[bid]) l.setStyle({ fillColor: rc(rmap[bid]), fillOpacity: .55, weight: 1.5 });
            });
        }
    } catch(e) {}
}

/* ════════════════════════════════════════════════════════════════
   DAY-WISE ALERTS — correct per-point chart coloring
════════════════════════════════════════════════════════════════ */
async function loadDaywise() {
    const scenario = document.getElementById('dw-scen').value;
    const year = +document.getElementById('dw-yr').value;
    document.getElementById('dw-title').textContent = `Loading ${scenario} ${year}…`;

    try {
        const r = await fetch(`${API}/ml/forecast?scenario=${encodeURIComponent(scenario)}&year_start=${year}&year_end=${year}`);
        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();
        renderDaywise(data, year);
    } catch(e) {
        document.getElementById('dw-title').textContent = `Error: ${e.message}`;
        console.error(e);
    }
}

function renderDaywise(data, year) {
    const daily = (data.daily || []).filter(d => d.date && d.date.startsWith(String(year)));
    if (!daily.length) {
        document.getElementById('dw-title').textContent = `No data for ${year}`;
        return;
    }

    const labels = daily.map(d => d.date.slice(5));   // MM-DD
    const THRESHOLD = 200;

    /* DISCHARGE CHART
       Use per-point point background colors to highlight flood days.
       The line itself is a neutral color — colored dots mark exceedance.
       This avoids the unreliable Chart.js segment coloring. */
    const qVals = daily.map(d => +(d.discharge_m3s||0).toFixed(2));
    const qPointColors = daily.map(d => {
        const al = d.alert_level || 'NORMAL';
        return al !== 'NORMAL' ? ac(al) : (d.exceeds_flood_threshold ? '#ff8800' : '#00d4ff44');
    });
    const qPointRadius = daily.map(d =>
        d.alert_level !== 'NORMAL' || d.exceeds_flood_threshold ? 4 : 0
    );

    mkChart('c-dw-q', 'line', labels, [
        {
            label: 'Discharge (m³/s)',
            data: qVals,
            borderColor: '#2a5a8a',          // muted baseline line
            backgroundColor: 'rgba(0,100,200,0.04)',
            fill: true, tension: 0.2,
            pointRadius: qPointRadius,
            pointBackgroundColor: qPointColors,
            pointBorderColor: qPointColors,
            borderWidth: 1.5,
        },
        {
            label: `Flood threshold (${THRESHOLD} m³/s)`,
            data: Array(daily.length).fill(THRESHOLD),
            borderColor: '#ff444466', borderWidth: 1.5,
            borderDash: [6, 4], pointRadius: 0, fill: false,
        }
    ], {
        plugins: {
            legend: { labels: { color: '#8ba5c0', font: { size: 10 } } },
            tooltip: {
                callbacks: {
                    afterLabel: ctx => {
                        if (ctx.datasetIndex !== 0) return '';
                        const d = daily[ctx.dataIndex];
                        return `Alert: ${d.alert_level} | Rain: ${(d.predicted_mm||0).toFixed(1)} mm`;
                    }
                }
            }
        }
    });

    /* RAINFALL CHART — bars coloured by combined alert_level from API */
    mkChart('c-dw-rain', 'bar', labels, [{
        label: 'Predicted Rainfall (mm/day)',
        data: daily.map(d => +(d.predicted_mm||0).toFixed(2)),
        backgroundColor: daily.map(d => ALERT_BG[d.alert_level || 'NORMAL']),
        borderColor:      daily.map(d => ac(d.alert_level || 'NORMAL')),
        borderWidth: 1, borderRadius: 2,
    }], { plugins: { legend: { display: false } } });

    /* COUNT Y/O/R from the combined alert_level field */
    const ad = data.alert_days || {};
    const floodCount = daily.filter(d => d.exceeds_flood_threshold).length;
    const alertCount = daily.filter(d => d.alert_level !== 'NORMAL').length;
    document.getElementById('dw-title').textContent =
        `${year} — ${alertCount} alert days / ${daily.length} total ` +
        `(Y:${ad.yellow||0} O:${ad.orange||0} R:${ad.red||0} | Flood Q>200 m³/s: ${floodCount} days)`;

    if (!alertCount && !floodCount) {
        document.getElementById('dw-tbl').innerHTML =
            `<div style="color:#00cc66;padding:16px;text-align:center;">
             ✅ No alert days in ${year} for ${data.scenario}.<br>
             All ${daily.length} days within safe thresholds (max Q: ${Math.max(...daily.map(d=>d.discharge_m3s||0)).toFixed(1)} m³/s,
             max rain: ${Math.max(...daily.map(d=>d.predicted_mm||0)).toFixed(1)} mm/day).
             </div>`;
        return;
    }

    const alertDays = daily.filter(d => d.alert_level !== 'NORMAL' || d.exceeds_flood_threshold);
    document.getElementById('dw-tbl').innerHTML = `
     <table class="tbl">
      <thead><tr>
       <th>Date</th><th>Predicted mm</th><th>Intensity mm/hr</th>
       <th>Discharge m³/s</th><th>Alert Level</th><th>Exceeds Flood Threshold?</th>
      </tr></thead>
      <tbody>
       ${alertDays.map(d => {
           const c = ac(d.alert_level || 'NORMAL');
           const exc = d.exceeds_flood_threshold;
           return `<tr>
            <td style="font-weight:600;">${d.date}</td>
            <td style="color:${c};font-weight:700;">${(d.predicted_mm||0).toFixed(1)}</td>
            <td>${(d.intensity_mmhr||0).toFixed(3)}</td>
            <td style="color:${exc?'#ff4444':'#c8d8e8'};font-weight:${exc?700:400};">
              ${(d.discharge_m3s||0).toFixed(1)}</td>
            <td><span class="pill" style="background:${c}22;color:${c};">${d.alert_level||'NORMAL'}</span></td>
            <td>${exc ? '<span style="color:#ff4444;font-weight:700;">⚠ YES</span>'
                      : '<span style="color:#00cc66;">No</span>'}</td>
           </tr>`;
       }).join('')}
      </tbody>
     </table>
     <div style="padding:8px;font-size:11px;color:#4a90a4;">
      ${daily.length-alertDays.length} normal days not shown.
      Alert = IMD rainfall level OR discharge Q > 200 m³/s (Rational Method, Tc = 6.88 hr, C = 0.736, A = 104.3 km²).
     </div>`;
}

/* ════════════════════════════════════════════════════════════════
   PREDICTOR VARIABLES
════════════════════════════════════════════════════════════════ */
function pearsonR(x, y) {
    const n = x.length, mx = x.reduce((a,b)=>a+b,0)/n, my = y.reduce((a,b)=>a+b,0)/n;
    let num=0,dx2=0,dy2=0;
    for(let i=0;i<n;i++){const dx=x[i]-mx,dy=y[i]-my;num+=dx*dy;dx2+=dx*dx;dy2+=dy*dy;}
    return (dx2&&dy2)?num/Math.sqrt(dx2*dy2):0;
}

async function loadPV() {
    const scenario = document.getElementById('pv-scen').value;
    const ys = +document.getElementById('pv-ys').value;
    const ye = +document.getElementById('pv-ye').value;
    const agg = document.getElementById('pv-agg').value;
    document.getElementById('pv-title').textContent = `Loading ${scenario} ${ys}–${ye}…`;
    try {
        const r = await fetch(`${API}/ml/forecast?scenario=${encodeURIComponent(scenario)}&year_start=${ys}&year_end=${ye}`);
        if (!r.ok) throw new Error(await r.text());
        renderPV(await r.json(), agg);
    } catch(e) {
        document.getElementById('pv-title').textContent = `Error: ${e.message}`;
    }
}

function renderPV(data, agg) {
    const daily = data.daily || [];
    if (!daily.length) return;
    const checked = [...document.querySelectorAll('.pv-chk:checked')];
    const vars = checked.map(c => ({ key: c.dataset.key, color: c.dataset.color }));
    const AVG = new Set(['temp_C','humidity_pct','wind_kmh','solar_Wm2']);

    let labels, series;
    if (agg === 'monthly') {
        const mo = {};
        daily.forEach(d => {
            const m = d.date.slice(0,7);
            if (!mo[m]) mo[m] = { count: 0 };
            vars.forEach(v => { mo[m][v.key] = (mo[m][v.key]||0) + (d[v.key]||0); });
            mo[m].count++;
        });
        labels = Object.keys(mo).sort();
        series = vars.map(v => ({
            label: v.key.replace(/_/g,' '),
            data: labels.map(m => +((mo[m][v.key]||0) / (AVG.has(v.key) ? mo[m].count : 1)).toFixed(2)),
            borderColor: v.color, backgroundColor: v.color+'18', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2,
        }));
    } else if (agg === 'annual') {
        const an = {};
        daily.forEach(d => {
            const y = d.date.slice(0,4);
            if (!an[y]) an[y]={count:0};
            vars.forEach(v=>{an[y][v.key]=(an[y][v.key]||0)+(d[v.key]||0);});
            an[y].count++;
        });
        labels = Object.keys(an).sort();
        series = vars.map(v => ({
            label:v.key.replace(/_/g,' '),
            data:labels.map(y=>+((an[y][v.key]||0)/(AVG.has(v.key)?an[y].count:1)).toFixed(2)),
            borderColor:v.color,backgroundColor:v.color+'20',fill:false,tension:0.3,pointRadius:4,borderWidth:2
        }));
    } else {
        const s = daily.filter((_,i)=>i%3===0);
        labels = s.map(d=>d.date.slice(5));
        series = vars.map(v=>({
            label:v.key.replace(/_/g,' '),data:s.map(d=>+(d[v.key]||0)),
            borderColor:v.color,backgroundColor:v.color+'15',fill:false,tension:0.2,pointRadius:0,borderWidth:1.5
        }));
    }
    document.getElementById('pv-title').textContent =
        `${data.scenario} · ${agg} aggregation · ${data.year_range}`;
    mkChart('c-pv','line',labels,series,{interaction:{mode:'index',intersect:false}});

    const statKeys=['predicted_mm','actual_mm','temp_C','humidity_pct','wind_kmh','solar_Wm2','rainfall_lag1','rainfall_3day_avg'];
    document.getElementById('pv-stats').innerHTML=`
     <table class="tbl"><thead><tr><th>Variable</th><th>Mean</th><th>Min</th><th>Max</th><th>Std</th></tr></thead>
     <tbody>${statKeys.map(key=>{
         const vals=daily.map(d=>d[key]||0);
         const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
         const std=Math.sqrt(vals.reduce((a,b)=>a+(b-mean)**2,0)/vals.length);
         return `<tr><td>${key.replace(/_/g,' ')}</td><td>${mean.toFixed(2)}</td>
          <td>${Math.min(...vals).toFixed(2)}</td><td>${Math.max(...vals).toFixed(2)}</td>
          <td>${std.toFixed(2)}</td></tr>`;
     }).join('')}</tbody></table>`;

    const pred = daily.map(d=>d.predicted_mm||0);
    const corrKeys=['temp_C','humidity_pct','wind_kmh','solar_Wm2','rainfall_lag1','rainfall_lag2','rainfall_3day_avg'];
    const corrVals = corrKeys.map(k=>({k,r:pearsonR(pred,daily.map(d=>d[k]||0))}));
    mkChart('c-pv-corr','bar',corrVals.map(c=>c.k.replace(/_/g,' ')),
        [{label:'Pearson r',data:corrVals.map(c=>+c.r.toFixed(3)),
          backgroundColor:corrVals.map(c=>c.r>=0?'#00d4ff88':'#ff444488'),
          borderColor:corrVals.map(c=>c.r>=0?'#00d4ff':'#ff4444'),borderWidth:1,borderRadius:3}],
        {indexAxis:'y',plugins:{legend:{display:false}},
         scales:{x:{min:-1,max:1,ticks:{color:'#4a90a4',font:{size:9}},grid:{color:'#1a2a3a'}},
                 y:{ticks:{color:'#4a90a4',font:{size:9}},grid:{color:'#1a2a3a'}}}});
}

/* ════════════════════════════════════════════════════════════════
   HISTORICAL DATA
════════════════════════════════════════════════════════════════ */
const IMD_NORMALS = [7.2,11.0,14.0,24.2,30.1,105.5,165.7,147.5,163.1,90.2,27.6,8.3];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function renderIMDNormals() {
    if (_ch['c-normals']) return;  // already rendered
    mkChart('c-normals','bar',MONTHS,[{
        label:'IMD Monthly Normal Rainfall (mm)',
        data: IMD_NORMALS,
        backgroundColor: IMD_NORMALS.map(v=>v>115?'#ff444488':v>64?'#ff880088':'#00d4ff55'),
        borderColor:     IMD_NORMALS.map(v=>v>115?'#ff4444':v>64?'#ff8800':'#00d4ff'),
        borderWidth:1, borderRadius:3,
    }],{plugins:{legend:{display:false}}});
}

async function loadHist() {
    const variable = document.getElementById('h-var').value;
    const agg = document.getElementById('h-agg').value;
    const ys = +document.getElementById('h-ys').value;
    const ye = +document.getElementById('h-ye').value;
    document.getElementById('h-title').textContent = `Loading ${variable} ${ys}–${ye}…`;

    try {
        const r = await fetch(`${API}/ml/historical?variable=${variable}&aggregation=${agg}&year_start=${ys}&year_end=${ye}`);
        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();
        renderHist(data, variable, agg, ys, ye);
    } catch(e) {
        document.getElementById('h-title').textContent = `Error: ${e.message}`;
    }
}

function renderHist(data, variable, agg, ys, ye) {
    const rows = data.data || [];
    const isRain = variable === 'rainfall_mm';
    const vLabel = {rainfall_mm:'Rainfall (mm)',temp_C:'Temperature (°C)',
        humidity_pct:'Humidity (%)',wind_kmh:'Wind (km/h)',solar_Wm2:'Solar (W/m²)'}[variable] || variable;
    const color = {rainfall_mm:'#00d4ff',temp_C:'#ff8800',humidity_pct:'#00cc66',
        wind_kmh:'#cc88ff',solar_Wm2:'#ffcc00'}[variable] || '#00d4ff';

    document.getElementById('h-title').textContent = `${vLabel} — Historical ${ys}–${ye} (${agg})`;

    mkChart('c-hist', isRain && agg !== 'daily' ? 'bar' : 'line',
        rows.map(r => r.date), [{
            label: `${vLabel} (${agg})`,
            data: rows.map(r => r.value),
            borderColor: color, backgroundColor: color + (agg==='daily'?'40':'88'),
            fill: agg !== 'annual', tension: 0.3, pointRadius: 0, borderWidth: 2,
            borderRadius: isRain ? 3 : 0,
        }], { plugins: { legend: { display: false } } });

    if (!_ch['c-normals']) renderIMDNormals();

    const vals = rows.map(r => r.value);
    const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
    const annTotal = isRain && agg==='monthly' ?
        (vals.reduce((a,b)=>a+b,0)/Math.max(ye-ys+1,1)).toFixed(0) : null;

    document.getElementById('h-stats').innerHTML = `
     <table class="tbl"><tbody>
      <tr><td style="color:#4a90a4">Period</td><td>${ys}–${ye} (${rows.length} ${agg} records)</td></tr>
      <tr><td style="color:#4a90a4">Mean (${agg})</td><td>${mean.toFixed(2)}</td></tr>
      <tr><td style="color:#4a90a4">Min</td><td>${Math.min(...vals).toFixed(2)}</td></tr>
      <tr><td style="color:#4a90a4">Max</td><td>${Math.max(...vals).toFixed(2)}</td></tr>
      ${annTotal ? `<tr><td style="color:#4a90a4">Annual avg</td>
        <td>${annTotal} mm/yr <span style="color:#4a90a4">(IMD normal: 794 mm)</span></td></tr>` : ''}
      <tr><td style="color:#4a90a4">Source</td>
        <td style="color:#4a90a4;font-size:10px;">Calibrated to IMD 1991–2020 normals (CLE-01/2021)</td></tr>
     </tbody></table>`;
}

/* ════════════════════════════════════════════════════════════════
   DASHBOARD SYNC
════════════════════════════════════════════════════════════════ */
async function syncDash(simData) {
    try {
        const r = await fetch(`${API}/dashboard_sync`);
        if (!r.ok) return;
        const sync = await r.json();
        const live = sync.live;
        const el = id => document.getElementById(id);
        if (el('rainfall-value'))    el('rainfall-value').textContent    = live.rainfall_mm.toFixed(1);
        if (el('water-level-value')) el('water-level-value').textContent = live.water_level_m.toFixed(2);
        if (el('discharge-value'))   el('discharge-value').textContent   = live.discharge_m3s.toFixed(1);
        if (el('risk-level'))        el('risk-level').textContent        = live.risk_level;
        if (el('risk-message'))      el('risk-message').textContent      = live.risk_message;
        if (el('alert-count'))       el('alert-count').textContent       = live.active_alerts;
        const rcard = document.getElementById('risk-card');
        if (rcard) rcard.className = `status-card risk-card ${live.risk_level.toLowerCase()}`;
        if (simData) {
            if (el('est-discharge-value'))
                el('est-discharge-value').textContent = `${(simData.peak_discharge_m3s||0).toFixed(2)} m³/s (${simData.scenario})`;
            if (el('selected-basin-id'))
                el('selected-basin-id').textContent = `Peak Basin ${simData.peak_basin_id||'—'}`;
            if (el('simulation-results')) el('simulation-results').style.display = 'block';
            const ns = el('no-selection-msg'); if (ns) ns.style.display = 'none';
        }
        ['rainfall-value','water-level-value','discharge-value'].forEach(id => {
            const e = document.getElementById(id); if (!e) return;
            e.style.transition = 'color .4s'; e.style.color = '#00d4ff';
            setTimeout(() => e.style.color = '', 900);
        });
    } catch(e) { console.warn('Dashboard sync error:', e); }
}

/* ════════════════════════════════════════════════════════════════
   COMPARE
════════════════════════════════════════════════════════════════ */
async function runCompare() {
    const body = {
        scenario_a: document.getElementById('ca').value,
        scenario_b: document.getElementById('cb').value,
        year_start: +document.getElementById('c-ys').value,
        year_end:   +document.getElementById('c-ye').value,
    };
    const el = document.getElementById('cmp-res');
    el.innerHTML = '<div style="color:#4a90a4;padding:20px;text-align:center;">⏳ Computing comparison…</div>';
    try {
        const r = await fetch(`${API}/compare`, {
            method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
        });
        const d = await r.json();
        const a = d.scenario_a, b = d.scenario_b, diff = d.difference;
        const sa = SCEN_INFO[a.scenario] || {color:'#00d4ff'};
        const sb = SCEN_INFO[b.scenario] || {color:'#ff8800'};

        el.innerHTML = `
         <div class="kpis" style="margin-bottom:10px;">
          ${[['Total Rain',`${(a.total_rainfall_mm||0).toFixed(0)} mm`,`${(b.total_rainfall_mm||0).toFixed(0)} mm`,
               diff.total_rainfall_pct>0?`B +${diff.total_rainfall_pct}%`:`B ${diff.total_rainfall_pct}%`],
             ['Peak Q',`${(a.peak_discharge_m3s||0).toFixed(1)} m³/s`,`${(b.peak_discharge_m3s||0).toFixed(1)} m³/s`,
               `Δ ${((b.peak_discharge_m3s||0)-(a.peak_discharge_m3s||0)).toFixed(1)}`],
             ['Mean Temp',`${(a.mean_temp_C||0).toFixed(1)}°C`,`${(b.mean_temp_C||0).toFixed(1)}°C`,
               `+${diff.temp_increase_C}°C`],
             ['Yellow Days',String((a.alert_days||{}).yellow||0),String((b.alert_days||{}).yellow||0),''],
          ].map(([label,va,vb,delta])=>`
           <div class="card">
            <div class="kl" style="font-size:10px;margin-bottom:4px;">${label}</div>
            <div style="display:flex;gap:6px;align-items:baseline;">
             <span style="color:${sa.color};font-size:13px;font-weight:700;">${va}</span>
             <span style="color:#4a90a4;font-size:10px;">${a.scenario}</span>
            </div>
            <div style="display:flex;gap:6px;align-items:baseline;margin-top:2px;">
             <span style="color:${sb.color};font-size:13px;font-weight:700;">${vb}</span>
             <span style="color:#4a90a4;font-size:10px;">${b.scenario}</span>
            </div>
            ${delta?`<div style="font-size:10px;color:#ffcc00;margin-top:3px;">${delta}</div>`:''}
           </div>`).join('')}
         </div>
         <div class="card">
          <div class="ct">Monthly Rainfall — ${a.scenario} vs ${b.scenario}</div>
          <div style="height:200px;"><canvas id="c-cmp"></canvas></div>
         </div>`;

        setTimeout(() => mkChart('c-cmp','line',
            a.monthly_rainfall.map(m=>m.month.slice(0,7)),
            [{label:a.scenario,data:a.monthly_rainfall.map(m=>m.mm),
              borderColor:sa.color,backgroundColor:sa.color+'18',fill:true,tension:0.3,pointRadius:0},
             {label:b.scenario,data:b.monthly_rainfall.map(m=>m.mm),
              borderColor:sb.color,backgroundColor:sb.color+'18',fill:true,tension:0.3,pointRadius:0}]
        ), 80);
    } catch(e) { el.innerHTML = `<div style="color:#ff4444;padding:10px;">Error: ${e.message}</div>`; }
}

/* ════════════════════════════════════════════════════════════════
   HISTORY
════════════════════════════════════════════════════════════════ */
async function loadHistory() {
    const el = document.getElementById('hist-runs');
    el.innerHTML = '<div style="color:#4a90a4;padding:16px;text-align:center;">⏳ Loading…</div>';
    try {
        const rows = await (await fetch(`${API}/simulation_runs`)).json();
        if (!rows.length) {
            el.innerHTML = '<div style="color:#4a90a4;padding:16px;text-align:center;">No runs yet.</div>';
            return;
        }
        el.innerHTML = `<table class="tbl">
         <thead><tr><th>ID</th><th>Scenario</th><th>Years</th><th>Total Rain</th>
          <th>Peak Q</th><th>Risk</th><th>Alert Days</th><th>Time</th></tr></thead>
         <tbody>${rows.map(r=>`
          <tr onclick="reloadRun(${r.id})" style="cursor:pointer;" title="Click to reload">
           <td style="color:#4a90a4">${r.id}</td>
           <td style="color:#00d4ff">${r.scenario}</td>
           <td>${r.year_start}–${r.year_end}</td>
           <td>${(r.total_rainfall_mm||0).toFixed(0)} mm</td>
           <td>${(r.peak_discharge_m3s||0).toFixed(1)} m³/s</td>
           <td><span style="color:${rc(r.risk_level||'')};">${r.risk_level||'—'}</span></td>
           <td style="color:#ffcc00">${r.alert_days||0}</td>
           <td style="color:#4a90a4">${(r.timestamp||'').slice(0,16)}</td>
          </tr>`).join('')}
         </tbody></table>`;
    } catch(e) { el.innerHTML = `<div style="color:#ff4444;padding:10px;">Error: ${e.message}</div>`; }
}
async function reloadRun(id) {
    const data = await (await fetch(`${API}/simulation_runs/${id}`)).json();
    lastSim = data; showIntTab('sim'); renderSim(data); await syncDash(data);
}

/* ════════════════════════════════════════════════════════════════
   ML MODEL INFO
════════════════════════════════════════════════════════════════ */
async function loadMLInfo() {
    try {
        const meta = await (await fetch(`${API}/ml/model_info`)).json();
        const el = document.getElementById('ml-meta'); if (!el) return;
        el.innerHTML = `
         <div class="kpis" style="margin-bottom:10px;">
          ${[['R²',meta.r2,'#00d4ff'],['RMSE',meta.rmse+' mm','#ff8800'],
             ['MAE',meta.mae+' mm','#00cc66'],['CV R²',meta.cv_r2_mean,'#cc88ff']]
            .map(([l,v,c])=>`<div class="kpi" style="--kc:${c};"><div class="kl">${l}</div>
              <div class="kv">${v}</div></div>`).join('')}
         </div>
         <div style="font-size:11px;color:#4a90a4;line-height:1.9;">
          <div>Train/Test: <span style="color:#c8d8e8;">${(meta.n_train||0).toLocaleString()} / ${(meta.n_test||0).toLocaleString()}</span></div>
          <div>Max predict: <span style="color:#c8d8e8;">${meta.max_predictable_mm||'—'} mm/day</span></div>
          <div>Algorithm: <span style="color:#c8d8e8;">Random Forest (300 trees, depth 14)</span></div>
          <div>Discharge Tc: <span style="color:#c8d8e8;">6.88 hr (Kirpich, Zone 12 main channel)</span></div>
          <div>Training: <span style="color:#c8d8e8;">${(meta.training_data||'').slice(0,60)}</span></div>
          <div>Trained: <span style="color:#c8d8e8;">${(meta.trained_at||'').slice(0,10)}</span></div>
         </div>`;

        const fi = meta.feature_importances || {};
        mkChart('c-fi','bar',Object.keys(fi).map(k=>k.replace('rainfall_','').replace('_avg','avg')),
            [{label:'Importance',data:Object.values(fi),
              backgroundColor:Object.values(fi).map((_,i)=>`hsl(${190+i*22},70%,50%)`),borderRadius:3}],
            {indexAxis:'y',plugins:{legend:{display:false}}});

        const fc = await fetch(`${API}/ml/forecast?scenario=SSP2-4.5&year_start=2025&year_end=2025`);
        if (fc.ok) {
            const fd = await fc.json();
            if (fd.daily) {
                const s = fd.daily.filter(d => {
                    const m = +d.date.slice(5,7);
                    return m >= 6 && m <= 9;  // monsoon only
                }).slice(0, 120);
                mkChart('c-avp','line',s.map(d=>d.date.slice(5)),[
                    {label:'Actual (NASA NEX-GDDP)',data:s.map(d=>d.actual_mm||0),
                     borderColor:'#4a90a4',pointRadius:0,tension:0.3,borderWidth:1.5},
                    {label:'RF Predicted',data:s.map(d=>d.predicted_mm),
                     borderColor:'#00d4ff',pointRadius:0,tension:0.3,borderWidth:2},
                ]);
            }
        }
    } catch(e) { console.warn('ML info error:', e); }
}

/* ════════════════════════════════════════════════════════════════
   REPORT
════════════════════════════════════════════════════════════════ */
function genReport() {
    const el = document.getElementById('report-preview');
    if (!lastSim) { alert('Run a simulation first.'); return; }
    const d = lastSim, now = new Date().toLocaleString('en-IN');
    const rcolor = rc(d.overall_risk_level);
    const ad = d.alert_days || {};
    const scenText = SCEN_INFO[d.scenario] ? `${d.scenario} — ${SCEN_INFO[d.scenario].text}` : d.scenario;

    el.style.display = 'block';
    el.innerHTML = `
<div style="background:#fff;color:#111;padding:24px;border-radius:6px;font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
 <div style="border-bottom:3px solid #0070c0;padding-bottom:10px;margin-bottom:18px;">
  <h1 style="font-size:20px;color:#0070c0;margin:0;">Kukatpally Nala — Flood DSS Simulation Report
   <span style="font-size:12px;color:#555;font-family:monospace;margin-left:8px;">v3</span></h1>
  <p style="margin:4px 0 0;color:#555;font-size:12px;">GHMC Zone 12 · Hyderabad · Generated: ${now}</p>
 </div>

 <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;">
  <tr style="background:#e8f4fb;"><th colspan="4" style="padding:7px;text-align:left;color:#0070c0;">Simulation Parameters</th></tr>
  <tr><td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Scenario</td>
      <td style="padding:5px 8px;border:1px solid #ddd;" colspan="3">${scenText}</td></tr>
  <tr><td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Year Range</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${d.year_range}</td>
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Total Days</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${d.total_days||'—'}</td></tr>
  <tr><td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Catchment</td>
      <td style="padding:5px 8px;border:1px solid #ddd;" colspan="3">104.3 km² · 17 sub-basins · GHMC Zone 12</td></tr>
 </table>

 <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;">
  <tr style="background:#e8f4fb;"><th colspan="4" style="padding:7px;text-align:left;color:#0070c0;">Key Results</th></tr>
  <tr><td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Total Rainfall</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${(d.total_rainfall_mm||0).toFixed(1)} mm</td>
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Peak Discharge</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${(d.peak_discharge_m3s||0).toFixed(2)} m³/s</td></tr>
  <tr><td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Overall Risk</td>
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:700;color:${rcolor};">${d.overall_risk_level}</td>
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Alert Days</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">Yellow:${ad.yellow||0} Orange:${ad.orange||0} Red:${ad.red||0}</td></tr>
 </table>

 <h3 style="color:#0070c0;font-size:13px;border-bottom:1px solid #ddd;padding-bottom:4px;">
   Sub-Basin Discharge (Q = 0.278 × C × i × A · Tc = 6.88 hr · C = 0.736)</h3>
 <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px;">
  <thead><tr style="background:#0070c0;color:#fff;">
   <th style="padding:5px 8px;">Basin</th><th>Area km²</th><th>C</th>
   <th>i mm/hr</th><th>Q m³/s</th><th>Q₂yr</th><th>Q₅₀yr</th><th>Risk</th>
  </tr></thead>
  <tbody>${(d.basin_summary||[]).map((b,i)=>`
   <tr style="background:${i%2?'#f5f9ff':'#fff'};">
    <td style="padding:4px 8px;border:1px solid #ddd;">${b.basin_id}</td>
    <td style="padding:4px 8px;border:1px solid #ddd;">${b.area_km2.toFixed(2)}</td>
    <td style="padding:4px 8px;border:1px solid #ddd;">${b.runoff_coeff}</td>
    <td style="padding:4px 8px;border:1px solid #ddd;">${(b.rain_intensity_mmhr||0).toFixed(3)}</td>
    <td style="padding:4px 8px;border:1px solid #ddd;font-weight:700;">${b.discharge_m3s.toFixed(3)}</td>
    <td style="padding:4px 8px;border:1px solid #ddd;">${b.peak_2yr_m3s.toFixed(2)}</td>
    <td style="padding:4px 8px;border:1px solid #ddd;">${b.peak_50yr_m3s.toFixed(2)}</td>
    <td style="padding:4px 8px;border:1px solid #ddd;font-weight:700;">${b.risk_level}</td>
   </tr>`).join('')}</tbody>
 </table>

 <h3 style="color:#0070c0;font-size:13px;border-bottom:1px solid #ddd;padding-bottom:4px;">Methodology</h3>
 <p style="font-size:11px;color:#333;line-height:1.7;margin:0 0 14px;">
  <b>ML:</b> Random Forest Regressor (300 trees, depth 14). Training data: NASA NEX-GDDP CMIP6 —
  SSP1-2.6 + SSP2-4.5 + SSP3-7.0 + SSP5-8.5 (2025–2050, ~30,377 samples). R² = 0.962.<br>
  <b>Discharge:</b> Rational Method Q = 0.278 × C × i × A.
  Runoff coefficient C = 0.736 (GHMC Zone 12 urbanised).
  Time of Concentration Tc = 6.88 hr (Kirpich formula: L=18.6 km, S=0.0057, Zone 12 main channel).
  17 sub-basins from QGIS CartoDEM 30m analysis. Total area 104.3 km².<br>
  <b>Alert thresholds:</b> Yellow ≥64.5 mm/day or Q>200 m³/s, Orange ≥115.6 mm/day or Q>500 m³/s,
  Red ≥204.5 mm/day or Q>1000 m³/s. Combined: most severe of rainfall and discharge levels.<br>
  <b>Reference event:</b> 13 October 2020 — Hyderabad recorded ~192 mm in 6 hours.
 </p>

 <div style="font-size:10px;color:#777;text-align:center;border-top:1px solid #ddd;padding-top:8px;">
  Kukatpally Nala Flood DSS v3 · GHMC Zone 12 · Hyderabad · ${now}
 </div>
</div>`;
    window.print();
}

/* ── boot ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => setTimeout(injectIntegrationUI, 700));
