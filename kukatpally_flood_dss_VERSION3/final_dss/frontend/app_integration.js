/* ============================================================
   FLOOD DSS v3 — INTEGRATION MODULE
   Fixes: duplicate-date crash, websocket 404, predictor vars
   New  : historical IMD data tab, scenario info cards, v3 label
   ============================================================ */
const API = window.location.origin;

// ── chart registry ────────────────────────────────────────────────────────────
const _charts = {};
function mkChart(id, type, labels, datasets, opts = {}) {
    const ctx = document.getElementById(id);
    if (!ctx) return null;
    if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
    _charts[id] = new Chart(ctx, {
        type, data: { labels, datasets },
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
    return _charts[id];
}
function riskColor(r) {
    return {CRITICAL:'#ff4444',HIGH:'#ff6622',MODERATE:'#ffcc00',YELLOW:'#ffcc00',ORANGE:'#ff8800',RED:'#ff4444',LOW:'#00cc66',NORMAL:'#44cc88'}[r]||'#8ba5c0';
}
function alertColor(a) { return {RED:'#ff4444',ORANGE:'#ff8800',YELLOW:'#ffcc00',NORMAL:'#00d4ff'}[a]||'#00d4ff'; }

// ── SSP scenario info (fetched once) ─────────────────────────────────────────
let _scenarioInfo = null;
async function getScenarioInfo() {
    if (_scenarioInfo) return _scenarioInfo;
    try { const r = await fetch(`${API}/ml/scenario_info`); _scenarioInfo = await r.json(); } catch(e) {}
    return _scenarioInfo || {};
}

function scenarioBadge(key) {
    const s = (_scenarioInfo||{})[key];
    if (!s) return key;
    return `<span style="color:${s.color};font-weight:700;">${s.icon} ${key}</span>`;
}

// ── UI injection ─────────────────────────────────────────────────────────────
function injectIntegrationUI() {
    if (document.getElementById('int-overlay')) return;

    document.body.insertAdjacentHTML('beforeend', `
<div id="int-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:3000;background:#07111d;overflow-y:auto;display:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
 <div id="int-inner" style="max-width:1160px;margin:0 auto;padding:14px 16px;">

  <!-- header -->
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;border-bottom:1px solid #1a2d3f;padding-bottom:10px;flex-wrap:wrap;">
   <div>
    <div style="font-size:15px;font-weight:700;color:#00d4ff;letter-spacing:.5px;">KUKATPALLY NALA FLOOD DSS <span style="font-size:11px;background:#00d4ff22;color:#00d4ff;padding:2px 7px;border-radius:3px;margin-left:6px;">v3</span></div>
    <div style="font-size:11px;color:#4a90a4;">GHMC Zone 12 · ML Prediction → Rational Method · 4 SSP Scenarios 2025–2050</div>
   </div>
   <button onclick="closeInt()" style="margin-left:auto;background:#0d1b2a;border:1px solid #2a3f5a;color:#8ba5c0;padding:5px 14px;border-radius:4px;cursor:pointer;font-size:12px;">✕ Close</button>
  </div>

  <!-- tabs -->
  <div id="int-tabs" style="display:flex;gap:3px;margin-bottom:12px;flex-wrap:wrap;">
   <button class="itab active-itab" data-tab="sim"        onclick="showIntTab('sim')">⚡ Simulate</button>
   <button class="itab"             data-tab="daywise"    onclick="showIntTab('daywise')">📅 Day-wise Alerts</button>
   <button class="itab"             data-tab="predictors" onclick="showIntTab('predictors')">📊 Predictor Variables</button>
   <button class="itab"             data-tab="historical" onclick="showIntTab('historical')">📈 Historical Data</button>
   <button class="itab"             data-tab="scenarios"  onclick="showIntTab('scenarios')">🌍 Scenario Guide</button>
   <button class="itab"             data-tab="compare"    onclick="showIntTab('compare')">↔ Compare</button>
   <button class="itab"             data-tab="history"    onclick="showIntTab('history')">📋 Run History</button>
   <button class="itab"             data-tab="mlinfo"     onclick="showIntTab('mlinfo')">🤖 Model Info</button>
   <button class="itab"             data-tab="report"     onclick="showIntTab('report')">📄 Report</button>
  </div>

  <!-- SIMULATE -->
  <div id="itab-sim" class="itab-pane">
   <div class="int-grid-2col">
    <div class="int-card">
     <div class="int-card-title">Simulation Parameters</div>
     <label class="int-label">Climate Scenario</label>
     <select id="sim-scenario" class="int-select">
      <option value="SSP1-2.6">🌱 SSP1-2.6 — Low emissions (sustainability)</option>
      <option value="SSP2-4.5" selected>⚖️ SSP2-4.5 — Middle of road (current)</option>
      <option value="SSP3-7.0">⚠️ SSP3-7.0 — High emissions (regional rivalry)</option>
      <option value="SSP5-8.5">🔥 SSP5-8.5 — Worst case (fossil fuels)</option>
     </select>
     <div id="sim-scenario-info" style="margin:6px 0;font-size:11px;color:#4a90a4;padding:6px 8px;background:#0a1520;border-radius:4px;border-left:3px solid #00d4ff;display:none;"></div>
     <label class="int-label" style="margin-top:10px;">Year Range</label>
     <div style="display:flex;gap:8px;align-items:center;">
      <select id="sim-yr-start" class="int-select" style="flex:1;">${[2025,2026,2027,2028,2030,2035,2040].map(y=>`<option ${y===2025?'selected':''}>${y}</option>`).join('')}</select>
      <span style="color:#4a90a4;">→</span>
      <select id="sim-yr-end" class="int-select" style="flex:1;">${[2030,2035,2040,2045,2050].map(y=>`<option ${y===2035?'selected':''}>${y}</option>`).join('')}</select>
     </div>
     <label class="int-label" style="margin-top:10px;">Sub-Basin Filter</label>
     <select id="sim-basin" class="int-select">
      <option value="">All 17 basins (Zone 12)</option>
      ${Array.from({length:17},(_,i)=>`<option value="${i+1}">Basin ${i+1}</option>`).join('')}
     </select>
     <button id="sim-run-btn" onclick="runSimulation()" class="int-btn-primary" style="margin-top:14px;width:100%;">▶ RUN SIMULATION</button>
     <div id="sim-spinner" style="display:none;text-align:center;padding:8px;font-size:12px;color:#4a90a4;">⏳ Computing ML prediction + Rational Method…</div>
    </div>
    <div class="int-card">
     <div class="int-card-title">Results Summary</div>
     <div id="sim-summary-content" style="color:#4a90a4;font-size:12px;padding:20px 0;text-align:center;">Run a simulation to see results</div>
    </div>
   </div>
   <div class="int-grid-2col" style="margin-top:10px;">
    <div class="int-card"><div class="int-card-title">Monthly Rainfall Forecast (mm/month)</div><div style="height:180px;"><canvas id="sim-monthly-chart"></canvas></div></div>
    <div class="int-card"><div class="int-card-title">Peak Discharge per Sub-Basin — Rational Method (m³/s)</div><div style="height:180px;"><canvas id="sim-basin-chart"></canvas></div></div>
   </div>
   <div class="int-card" style="margin-top:10px;">
    <div class="int-card-title">Sub-Basin Discharge Table (Q = 0.278 × C × i × A)</div>
    <div id="sim-basin-table" style="overflow-x:auto;max-height:260px;overflow-y:auto;"></div>
   </div>
  </div>

  <!-- DAY-WISE -->
  <div id="itab-daywise" class="itab-pane" style="display:none;">
   <div class="int-card" style="margin-bottom:10px;">
    <div class="int-card-title">Day-wise Flood Prediction — Precise Threshold Exceedance</div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;">
     <div><label class="int-label">Scenario</label><select id="dw-scenario" class="int-select"><option value="SSP1-2.6">🌱 SSP1-2.6</option><option value="SSP2-4.5" selected>⚖️ SSP2-4.5</option><option value="SSP3-7.0">⚠️ SSP3-7.0</option><option value="SSP5-8.5">🔥 SSP5-8.5</option></select></div>
     <div><label class="int-label">Year</label><select id="dw-year" class="int-select">${Array.from({length:26},(_,i)=>`<option>${2025+i}</option>`).join('')}</select></div>
     <button onclick="loadDaywise()" class="int-btn-primary">Load Day-wise View</button>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#8ba5c0;margin-top:4px;">
     <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#ffcc00;margin-right:4px;"></span>Yellow ≥64.5 mm</span>
     <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#ff8800;margin-right:4px;"></span>Orange ≥115.6 mm</span>
     <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#ff4444;margin-right:4px;"></span>Red ≥204.5 mm</span>
     <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#00d4ff;margin-right:4px;"></span>Normal</span>
     <span style="margin-left:auto;color:#ff444466;">— Flood threshold (Q > 200 m³/s)</span>
    </div>
   </div>
   <div class="int-grid-2col" style="margin-bottom:10px;">
    <div class="int-card"><div class="int-card-title">Daily Discharge (m³/s) — red = exceeds flood threshold</div><div style="height:200px;"><canvas id="dw-discharge-chart"></canvas></div></div>
    <div class="int-card"><div class="int-card-title">Daily Rainfall (mm) — coloured by IMD alert level</div><div style="height:200px;"><canvas id="dw-rainfall-chart"></canvas></div></div>
   </div>
   <div class="int-card">
    <div class="int-card-title" id="dw-flood-title">Alert Days Table — select scenario and year above</div>
    <div id="dw-flood-table" style="overflow-x:auto;max-height:300px;overflow-y:auto;"><div style="color:#4a90a4;padding:16px;text-align:center;">Select scenario and year to see day-wise predictions</div></div>
   </div>
  </div>

  <!-- PREDICTOR VARIABLES -->
  <div id="itab-predictors" class="itab-pane" style="display:none;">
   <div class="int-card" style="margin-bottom:10px;">
    <div class="int-card-title">Predictor Variable Visualization</div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;">
     <div><label class="int-label">Scenario</label><select id="pv-scenario" class="int-select"><option value="SSP1-2.6">🌱 SSP1-2.6</option><option value="SSP2-4.5" selected>⚖️ SSP2-4.5</option><option value="SSP3-7.0">⚠️ SSP3-7.0</option><option value="SSP5-8.5">🔥 SSP5-8.5</option></select></div>
     <div><label class="int-label">Year Range</label><div style="display:flex;gap:6px;">
      <select id="pv-start" class="int-select">${[2025,2030,2035,2040,2045].map(y=>`<option>${y}</option>`).join('')}</select>
      <span style="color:#4a90a4;align-self:center;">–</span>
      <select id="pv-end" class="int-select">${[2030,2035,2040,2045,2050].map(y=>`<option ${y===2030?'selected':''}>${y}</option>`).join('')}</select>
     </div></div>
     <div><label class="int-label">Aggregation</label><select id="pv-agg" class="int-select"><option value="daily">Daily (sampled)</option><option value="monthly" selected>Monthly avg</option><option value="annual">Annual</option></select></div>
     <button onclick="loadPredictorVars()" class="int-btn-primary">Load Variables</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;" id="pv-toggles">
     ${[['predicted_mm','Predicted Rain','#00d4ff'],['actual_mm','Scenario Rain','#4a90a4'],
        ['temp_C','Temperature','#ff8800'],['humidity_pct','Humidity','#00cc66'],
        ['wind_kmh','Wind Speed','#cc88ff'],['solar_Wm2','Solar Radiation','#ffcc00'],
        ['rainfall_lag1','Rain Lag-1','#ff6680'],['rainfall_lag2','Rain Lag-2','#ff9944'],
        ['rainfall_3day_avg','3-Day Avg','#44ddaa']].map(([k,l,c])=>`
     <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:#8ba5c0;background:#0d1b2a;padding:4px 8px;border-radius:3px;border:1px solid #1e2d3d;">
      <input type="checkbox" data-key="${k}" data-color="${c}" class="pv-check" ${['predicted_mm','temp_C','humidity_pct'].includes(k)?'checked':''}>
      <span style="display:inline-block;width:9px;height:9px;background:${c};border-radius:2px;"></span>${l}</label>`).join('')}
    </div>
   </div>
   <div class="int-card" style="margin-bottom:10px;">
    <div class="int-card-title" id="pv-chart-title">Select variables and click Load</div>
    <div style="height:260px;"><canvas id="pv-main-chart"></canvas></div>
   </div>
   <div class="int-grid-2col">
    <div class="int-card"><div class="int-card-title">Variable Statistics</div><div id="pv-stats-table" style="font-size:11px;max-height:220px;overflow-y:auto;"></div></div>
    <div class="int-card"><div class="int-card-title">Pearson r — Correlation with Predicted Rainfall</div><div style="height:190px;"><canvas id="pv-corr-chart"></canvas></div></div>
   </div>
  </div>

  <!-- HISTORICAL DATA -->
  <div id="itab-historical" class="itab-pane" style="display:none;">
   <div class="int-card" style="margin-bottom:10px;">
    <div class="int-card-title">Historical Hyderabad Climate Data (1990–2024) — IMD Monthly Normals</div>
    <div style="background:#0a1520;border:1px solid #1a2d3f;border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:11px;color:#4a90a4;line-height:1.7;">
     <b style="color:#00d4ff;">Data source:</b> Based on India Meteorological Department (IMD) published 1991–2020 normals for Hyderabad.
     Monthly rainfall normals, temperature, humidity from IMD Climatological Normals (CLE-01/2021).
     <b style="color:#ffcc00;">Note:</b> IMD live station API requires institutional registration at dsp.imdpune.gov.in.
     This uses synthetic daily data calibrated to published IMD monthly norms (±25%). Annual mean: ~756 mm (IMD normal: 794 mm).
    </div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
     <div><label class="int-label">Variable</label>
      <select id="hist-var" class="int-select">
       <option value="rainfall_mm">Rainfall (mm)</option>
       <option value="temp_C">Temperature (°C)</option>
       <option value="humidity_pct">Humidity (%)</option>
       <option value="wind_kmh">Wind Speed (km/h)</option>
       <option value="solar_Wm2">Solar Radiation (W/m²)</option>
      </select></div>
     <div><label class="int-label">Aggregation</label>
      <select id="hist-agg" class="int-select">
       <option value="monthly" selected>Monthly</option>
       <option value="annual">Annual</option>
       <option value="daily">Daily (sampled)</option>
      </select></div>
     <div><label class="int-label">Year Range</label>
      <div style="display:flex;gap:6px;">
       <select id="hist-yr-start" class="int-select">${Array.from({length:35},(_,i)=>`<option>${1990+i}</option>`).join('')}</select>
       <span style="color:#4a90a4;align-self:center;">→</span>
       <select id="hist-yr-end" class="int-select">${Array.from({length:35},(_,i)=>`<option ${i===34?'selected':''}>${1990+i}</option>`).join('')}</select>
      </div></div>
     <button onclick="loadHistorical()" class="int-btn-primary">Load Historical</button>
    </div>
   </div>
   <div class="int-card" style="margin-bottom:10px;">
    <div class="int-card-title" id="hist-chart-title">Select variable and click Load</div>
    <div style="height:240px;"><canvas id="hist-main-chart"></canvas></div>
   </div>
   <div class="int-grid-2col">
    <div class="int-card"><div class="int-card-title">IMD Monthly Normals (Reference)</div><div style="height:160px;"><canvas id="hist-normals-chart"></canvas></div></div>
    <div class="int-card"><div class="int-card-title">Historical Statistics</div><div id="hist-stats" style="font-size:11px;padding-top:4px;"></div></div>
   </div>
  </div>

  <!-- SCENARIO GUIDE -->
  <div id="itab-scenarios" class="itab-pane" style="display:none;">
   <div style="font-size:12px;color:#4a90a4;margin-bottom:12px;padding:8px 12px;background:#0a1520;border-radius:4px;border-left:3px solid #00d4ff;">
    SSP = Shared Socioeconomic Pathway. Defined by IPCC AR6 (2021). Each scenario describes a possible future based on different levels of greenhouse gas emissions and societal development.
   </div>
   <div id="scenario-cards" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;"></div>
  </div>

  <!-- COMPARE -->
  <div id="itab-compare" class="itab-pane" style="display:none;">
   <div class="int-card" style="margin-bottom:10px;">
    <div class="int-card-title">Compare Two Scenarios</div>
    <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
     <div><label class="int-label">Scenario A</label><select id="cmp-a" class="int-select"><option value="SSP1-2.6">🌱 SSP1-2.6</option><option value="SSP2-4.5" selected>⚖️ SSP2-4.5</option><option value="SSP3-7.0">⚠️ SSP3-7.0</option><option value="SSP5-8.5">🔥 SSP5-8.5</option></select></div>
     <div><label class="int-label">Scenario B</label><select id="cmp-b" class="int-select"><option value="SSP1-2.6">🌱 SSP1-2.6</option><option value="SSP2-4.5">⚖️ SSP2-4.5</option><option value="SSP3-7.0">⚠️ SSP3-7.0</option><option value="SSP5-8.5" selected>🔥 SSP5-8.5</option></select></div>
     <div><label class="int-label">Years</label><div style="display:flex;gap:6px;">
      <select id="cmp-start" class="int-select">${[2025,2030,2035].map(y=>`<option>${y}</option>`).join('')}</select>
      <span style="color:#4a90a4;align-self:center;">→</span>
      <select id="cmp-end" class="int-select">${[2035,2040,2045,2050].map(y=>`<option ${y===2050?'selected':''}>${y}</option>`).join('')}</select>
     </div></div>
     <button onclick="runComparison()" class="int-btn-primary">↔ Compare</button>
    </div>
   </div>
   <div id="cmp-results"></div>
  </div>

  <!-- RUN HISTORY -->
  <div id="itab-history" class="itab-pane" style="display:none;">
   <div class="int-card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
     <div class="int-card-title" style="margin:0;">Simulation Run History</div>
     <button onclick="loadHistory()" class="int-btn-secondary">↻ Refresh</button>
    </div>
    <div id="history-table"></div>
   </div>
  </div>

  <!-- ML INFO -->
  <div id="itab-mlinfo" class="itab-pane" style="display:none;">
   <div class="int-grid-2col">
    <div class="int-card"><div class="int-card-title">Random Forest — Performance Metrics</div><div id="ml-meta-content"></div></div>
    <div class="int-card"><div class="int-card-title">Feature Importance</div><div style="height:220px;"><canvas id="ml-fi-chart"></canvas></div></div>
   </div>
   <div class="int-card" style="margin-top:10px;">
    <div class="int-card-title">Actual vs Predicted — SSP2-4.5 monsoon season 2025</div>
    <div style="height:200px;"><canvas id="ml-avp-chart"></canvas></div>
   </div>
  </div>

  <!-- REPORT -->
  <div id="itab-report" class="itab-pane" style="display:none;">
   <div class="int-card" style="margin-bottom:12px;">
    <div class="int-card-title">Generate Simulation Report</div>
    <p style="font-size:13px;color:#8ba5c0;margin-bottom:12px;">Run a simulation first, then generate a printable PDF report with all inputs, outputs and methodology.</p>
    <button onclick="generateReport()" class="int-btn-primary">📄 Generate Report (Print / Save PDF)</button>
   </div>
   <div id="report-preview"></div>
  </div>

 </div>
</div>`);

    // ── Shared CSS ────────────────────────────────────────────────────────────
    document.head.insertAdjacentHTML('beforeend', `<style>
.itab{background:#0d1b2a;border:1px solid #1e2d3d;color:#8ba5c0;padding:7px 13px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;transition:all .15s;white-space:nowrap;}
.itab:hover{border-color:#3a6a9a;color:#c8d8e8;}
.active-itab{border-color:#00d4ff!important;color:#00d4ff!important;}
.itab-pane{animation:fadeIn .15s ease;}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.int-card{background:#0d1b2a;border:1px solid #1a2d3f;border-radius:6px;padding:14px;}
.int-card-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#00d4ff;margin-bottom:10px;}
.int-grid-2col{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.int-label{display:block;font-size:11px;color:#4a90a4;margin-bottom:3px;}
.int-select{width:100%;background:#111c2a;border:1px solid #2a3f5a;color:#c8d8e8;padding:6px 8px;border-radius:4px;font-size:12px;}
.int-btn-primary{background:linear-gradient(135deg,#0070c0,#00d4ff);border:none;color:#fff;padding:8px 18px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.3px;}
.int-btn-primary:hover{opacity:.88;} .int-btn-primary:active{transform:scale(.98);}
.int-btn-secondary{background:#111c2a;border:1px solid #2a3f5a;color:#8ba5c0;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;}
.kpi-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
.kpi-box{background:#0a1520;padding:10px;border-radius:4px;border-left:3px solid var(--kpi-color,#00d4ff);}
.kpi-box .kpi-label{font-size:10px;color:#4a90a4;} .kpi-box .kpi-val{font-size:18px;font-weight:700;color:var(--kpi-color,#00d4ff);} .kpi-box .kpi-sub{font-size:10px;color:#4a90a4;margin-top:1px;}
.int-table{width:100%;border-collapse:collapse;font-size:11px;}
.int-table th{background:#111c2a;color:#4a90a4;padding:6px 8px;text-align:left;border-bottom:1px solid #1a2d3f;position:sticky;top:0;}
.int-table td{padding:5px 8px;border-bottom:1px solid #0a1520;color:#c8d8e8;}
.int-table tr:hover td{background:#0f1e2d;}
.alert-pill{display:inline-block;padding:2px 7px;border-radius:3px;font-size:10px;font-weight:700;}
/* Responsive */
@media(max-width:1200px){.int-grid-2col{grid-template-columns:1fr;}.kpi-grid-4{grid-template-columns:1fr 1fr;}}
@media(max-width:900px){#int-inner{padding:8px 10px;}.itab{padding:5px 8px;font-size:11px;}.int-card{padding:10px;}}
@media(max-width:600px){.kpi-grid-4{grid-template-columns:1fr;}}
/* Main dashboard responsive */
@media(max-width:1280px){.dashboard-container{grid-template-columns:240px 1fr 280px!important;}}
@media(max-width:1100px){.dashboard-container{grid-template-columns:220px 1fr!important;}.right-panel{display:none!important;}}
@media(max-width:768px){.dashboard-container{grid-template-columns:1fr!important;}.left-panel{display:none!important;}#map{min-height:280px;}.header-center{display:none;}.metrics-grid{grid-template-columns:1fr 1fr!important;}.dashboard-header{flex-wrap:wrap;gap:6px;}}
/* Print */
@media print{#int-overlay{position:static!important;background:#fff!important;}#int-tabs,.int-btn-primary,.int-btn-secondary,#sim-run-btn{display:none!important;}#int-inner{max-width:100%;padding:0;}.int-card{border:1px solid #ddd!important;background:#fff!important;color:#111!important;}.int-card-title{color:#0070c0!important;}#report-preview{display:block!important;}}
</style>`);

    // ⚡ header button
    const hr = document.querySelector('.header-right');
    if (hr) {
        const b = document.createElement('button');
        b.innerHTML = '⚡ DSS v3';
        b.style.cssText = `background:linear-gradient(135deg,#003a70,#00d4ff);border:none;color:#fff;
            padding:6px 12px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:700;
            letter-spacing:.3px;margin-left:8px;`;
        b.onclick = openInt;
        hr.appendChild(b);
    }

    // Bind scenario info preview on select change
    document.getElementById('sim-scenario').addEventListener('change', updateScenarioPreview);

    loadMLInfo();
    getScenarioInfo().then(renderScenarioCards);
}

function openInt()  { document.getElementById('int-overlay').style.display = 'block'; showIntTab('sim'); updateScenarioPreview(); }
function closeInt() { document.getElementById('int-overlay').style.display = 'none'; }

function showIntTab(id) {
    document.querySelectorAll('.itab').forEach(b => b.classList.toggle('active-itab', b.dataset.tab === id));
    document.querySelectorAll('.itab-pane').forEach(p => p.style.display = 'none');
    const el = document.getElementById(`itab-${id}`);
    if (el) el.style.display = 'block';
    if (id === 'history')   loadHistory();
    if (id === 'mlinfo')    loadMLInfo();
    if (id === 'scenarios') renderScenarioCards(_scenarioInfo);
}

async function updateScenarioPreview() {
    const key = document.getElementById('sim-scenario')?.value;
    const info = await getScenarioInfo();
    const el = document.getElementById('sim-scenario-info');
    if (!el || !info || !info[key]) return;
    const s = info[key];
    el.style.display = 'block';
    el.style.borderLeftColor = s.color;
    el.innerHTML = `<b style="color:${s.color}">${s.icon} ${s.name}</b><br>${s.short} · <span style="color:#c8d8e8">${s.warming_by_2100} warming by 2100</span><br><span style="font-size:10px">${s.rainfall_trend}</span>`;
}

let lastSimResult = null;

// ═══════════════════════════════════════════════════════════════
// SIMULATE
// ═══════════════════════════════════════════════════════════════
async function runSimulation() {
    const scenario = document.getElementById('sim-scenario').value;
    const ys = parseInt(document.getElementById('sim-yr-start').value);
    const ye = parseInt(document.getElementById('sim-yr-end').value);
    const br = document.getElementById('sim-basin').value;
    if (ye <= ys) { alert('Year end must be after year start'); return; }
    document.getElementById('sim-spinner').style.display = 'block';
    document.getElementById('sim-run-btn').disabled = true;
    const body = { scenario, year_start: ys, year_end: ye };
    if (br) body.basin_id = parseInt(br);
    try {
        const res = await fetch(`${API}/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) { const e = await res.json(); alert('Error: ' + (e.detail || 'unknown')); return; }
        const data = await res.json();
        lastSimResult = data;
        renderSimResults(data);
        await syncMainDashboard(data);
    } catch(e) { alert('Cannot reach API: ' + e.message); }
    finally { document.getElementById('sim-spinner').style.display = 'none'; document.getElementById('sim-run-btn').disabled = false; }
}

function renderSimResults(data) {
    const risk = data.overall_risk_level, rc = riskColor(risk), ad = data.alert_days || {};
    document.getElementById('sim-summary-content').innerHTML = `
        <div class="kpi-grid-4" style="margin-bottom:10px;">
            <div class="kpi-box" style="--kpi-color:#00d4ff;"><div class="kpi-label">Total Rainfall</div><div class="kpi-val">${(data.total_rainfall_mm||0).toFixed(0)}</div><div class="kpi-sub">mm · ${data.year_range}</div></div>
            <div class="kpi-box" style="--kpi-color:${rc};"><div class="kpi-label">Overall Risk</div><div class="kpi-val">${risk}</div><div class="kpi-sub">Peak Q: ${(data.peak_discharge_m3s||0).toFixed(1)} m³/s</div></div>
            <div class="kpi-box" style="--kpi-color:#ffcc00;"><div class="kpi-label">Yellow Days</div><div class="kpi-val">${ad.yellow||0}</div><div class="kpi-sub">≥64.5 mm/day</div></div>
            <div class="kpi-box" style="--kpi-color:#ff8800;"><div class="kpi-label">Orange+Red Days</div><div class="kpi-val">${(ad.orange||0)+(ad.red||0)}</div><div class="kpi-sub">≥115.6 mm/day</div></div>
        </div>
        <div style="font-size:11px;color:#4a90a4;display:flex;gap:16px;flex-wrap:wrap;">
            <span>Peak date: <b style="color:#c8d8e8;">${data.peak_date||'—'}</b></span>
            <span>Peak basin: <b style="color:#c8d8e8;">Basin ${data.peak_basin_id||'—'}</b></span>
            <span>Flood days: <b style="color:#ff4444;">${(data.flood_exceedance_days||[]).length||0}</b></span>
            <span style="margin-left:auto;color:#00cc66;">✓ Dashboard synced</span>
        </div>`;
    const monthly = data.monthly || [];
    mkChart('sim-monthly-chart', 'bar', monthly.map(m => m.month), [{
        label: `${data.scenario} Rainfall (mm/month)`, data: monthly.map(m => m.total_rain_mm),
        backgroundColor: monthly.map(m => m.total_rain_mm > 115 ? '#ff444488' : m.total_rain_mm > 64 ? '#ff880088' : '#00d4ff55'),
        borderColor: monthly.map(m => m.total_rain_mm > 115 ? '#ff4444' : m.total_rain_mm > 64 ? '#ff8800' : '#00d4ff'),
        borderWidth: 1, borderRadius: 3,
    }], { plugins: { legend: { display: false } } });
    const basins = data.basin_summary || [];
    mkChart('sim-basin-chart', 'bar', basins.map(b => `B${b.basin_id}`), [{
        label: 'Q m³/s', data: basins.map(b => b.discharge_m3s),
        backgroundColor: basins.map(b => riskColor(b.risk_level) + '99'),
        borderColor: basins.map(b => riskColor(b.risk_level)), borderWidth: 1, borderRadius: 2,
    }], { plugins: { legend: { display: false } } });
    document.getElementById('sim-basin-table').innerHTML = `
        <table class="int-table"><thead><tr><th>Basin</th><th>Area km²</th><th>C</th><th>i mm/hr</th><th>Q m³/s</th><th>Q₂yr</th><th>Q₅₀yr</th><th>Risk</th></tr></thead>
        <tbody>${basins.map(b => { const c = riskColor(b.risk_level); return `<tr>
            <td>${b.basin_id}</td><td>${b.area_km2.toFixed(2)}</td><td>${b.runoff_coeff}</td>
            <td>${(b.rain_intensity_mmhr||0).toFixed(3)}</td>
            <td style="color:${c};font-weight:700;">${b.discharge_m3s.toFixed(3)}</td>
            <td>${b.peak_2yr_m3s.toFixed(2)}</td><td>${b.peak_50yr_m3s.toFixed(2)}</td>
            <td><span class="alert-pill" style="background:${c}22;color:${c};">${b.risk_level}</span></td>
        </tr>`; }).join('')}</tbody></table>`;
    colorMapBasins(basins);
}
function colorMapBasins(basins) {
    const rmap = {}; basins.forEach(b => rmap[b.basin_id] = b.risk_level);
    try { if (window.drainageBasinsLayer) window.drainageBasinsLayer.eachLayer(l => { const bid = l.feature?.properties?.Basin_ID || l.feature?.properties?.DN; if (rmap[bid]) l.setStyle({ fillColor: riskColor(rmap[bid]), fillOpacity: .55, weight: 1.5 }); }); } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
// TASK 2: DAY-WISE ALERTS
// ═══════════════════════════════════════════════════════════════
async function loadDaywise() {
    const scenario = document.getElementById('dw-scenario').value;
    const year = parseInt(document.getElementById('dw-year').value);
    document.getElementById('dw-flood-title').textContent = `Loading ${scenario} ${year}…`;
    try {
        const r = await fetch(`${API}/ml/forecast?scenario=${encodeURIComponent(scenario)}&year_start=${year}&year_end=${year}`);
        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();
        renderDaywise(data, year);
    } catch(e) {
        document.getElementById('dw-flood-title').textContent = `Error: ${e.message}`;
        console.error('Day-wise load error:', e);
    }
}
function renderDaywise(data, year) {
    const daily = (data.daily || []).filter(d => d.date && d.date.startsWith(String(year)));
    if (!daily.length) { document.getElementById('dw-flood-title').textContent = `No data for ${year}`; return; }
    const labels = daily.map(d => d.date.slice(5));
    const THRESHOLD = 200;

    // Discharge chart with segment colouring
    mkChart('dw-discharge-chart', 'line', labels, [
        { label: 'Discharge (m³/s)', data: daily.map(d => +(d.discharge_m3s||0).toFixed(2)),
          borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,.05)', fill: true, tension: 0.2,
          pointRadius: 0, borderWidth: 1.5,
          segment: { borderColor: ctx => ctx.p1.parsed.y > THRESHOLD ? '#ff4444' : '#00d4ff' } },
        { label: `Flood threshold (${THRESHOLD} m³/s)`, data: Array(daily.length).fill(THRESHOLD),
          borderColor: '#ff444466', borderWidth: 1.5, borderDash: [6,4], pointRadius: 0, fill: false },
    ], { plugins: { legend: { labels: { color: '#8ba5c0', font: { size: 10 } } } } });

    // Rainfall bar coloured by alert level
    mkChart('dw-rainfall-chart', 'bar', labels, [{
        label: 'Predicted Rainfall (mm/day)',
        data: daily.map(d => +(d.predicted_mm||0).toFixed(2)),
        backgroundColor: daily.map(d => alertColor(d.alert_level) + 'cc'),
        borderColor: daily.map(d => alertColor(d.alert_level)),
        borderWidth: 1, borderRadius: 2,
    }], { plugins: { legend: { display: false } } });

    const alertDays = daily.filter(d => d.alert_level !== 'NORMAL' || d.exceeds_flood_threshold);
    const ad = data.alert_days || {};
    document.getElementById('dw-flood-title').textContent =
        `${year} — ${alertDays.length} alert days / ${daily.length} total (Y:${ad.yellow||0} O:${ad.orange||0} R:${ad.red||0} | Flood threshold exceeded: ${daily.filter(d=>d.exceeds_flood_threshold).length} days)`;

    if (!alertDays.length) {
        document.getElementById('dw-flood-table').innerHTML =
            `<div style="color:#00cc66;padding:16px;text-align:center;">✅ No alert days in ${year} for ${data.scenario}. All ${daily.length} days within safe rainfall limits.</div>`;
        return;
    }
    document.getElementById('dw-flood-table').innerHTML = `
        <table class="int-table"><thead><tr>
            <th>Date</th><th>Predicted mm</th><th>Intensity mm/hr</th>
            <th>Discharge m³/s</th><th>Alert Level</th><th>Exceeds Flood Threshold?</th>
        </tr></thead>
        <tbody>${alertDays.map(d => {
            const c = alertColor(d.alert_level), exc = d.exceeds_flood_threshold;
            return `<tr>
                <td style="font-weight:600;">${d.date}</td>
                <td style="color:${c};font-weight:700;">${(d.predicted_mm||0).toFixed(1)}</td>
                <td>${(d.intensity_mmhr||0).toFixed(3)}</td>
                <td style="color:${exc?'#ff4444':'#c8d8e8'};font-weight:${exc?700:400};">${(d.discharge_m3s||0).toFixed(1)}</td>
                <td><span class="alert-pill" style="background:${c}22;color:${c};">${d.alert_level}</span></td>
                <td>${exc ? '<span style="color:#ff4444;font-weight:700;">⚠ YES</span>' : '<span style="color:#00cc66;">No</span>'}</td>
            </tr>`;
        }).join('')}</tbody></table>
        <div style="padding:8px;font-size:11px;color:#4a90a4;">${daily.length-alertDays.length} normal days not shown. Flood threshold = 200 m³/s (Rational Method, whole catchment).</div>`;
}

// ═══════════════════════════════════════════════════════════════
// TASK 1: PREDICTOR VARIABLES
// ═══════════════════════════════════════════════════════════════
function pearsonCorr(x, y) {
    const n = x.length, mx = x.reduce((a,b)=>a+b,0)/n, my = y.reduce((a,b)=>a+b,0)/n;
    let num=0, dx2=0, dy2=0;
    for (let i=0;i<n;i++){const dx=x[i]-mx,dy=y[i]-my;num+=dx*dy;dx2+=dx*dx;dy2+=dy*dy;}
    return (dx2&&dy2)?num/Math.sqrt(dx2*dy2):0;
}
async function loadPredictorVars() {
    const scenario = document.getElementById('pv-scenario').value;
    const ys = parseInt(document.getElementById('pv-start').value);
    const ye = parseInt(document.getElementById('pv-end').value);
    const agg = document.getElementById('pv-agg').value;
    document.getElementById('pv-chart-title').textContent = `Loading ${scenario} ${ys}–${ye}…`;
    try {
        const r = await fetch(`${API}/ml/forecast?scenario=${encodeURIComponent(scenario)}&year_start=${ys}&year_end=${ye}`);
        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();
        renderPredictorVars(data, agg);
    } catch(e) {
        document.getElementById('pv-chart-title').textContent = `Error: ${e.message}`;
        console.error('Predictor vars error:', e);
    }
}
function renderPredictorVars(data, agg) {
    const daily = data.daily || [];
    if (!daily.length) return;
    const checked = [...document.querySelectorAll('.pv-check:checked')];
    const vars = checked.map(c => ({ key: c.dataset.key, color: c.dataset.color }));
    const AVG_KEYS = new Set(['temp_C','humidity_pct','wind_kmh','solar_Wm2']);
    let labels, series;
    if (agg === 'monthly') {
        const monthly = {};
        daily.forEach(d => {
            const m = d.date.slice(0,7);
            if (!monthly[m]) monthly[m] = { count: 0 };
            vars.forEach(v => { monthly[m][v.key] = (monthly[m][v.key]||0) + (d[v.key]||0); });
            monthly[m].count++;
        });
        labels = Object.keys(monthly).sort();
        series = vars.map(v => ({
            label: v.key.replace(/_/g,' '),
            data: labels.map(m => +((monthly[m][v.key]||0) / (AVG_KEYS.has(v.key) ? monthly[m].count : 1)).toFixed(2)),
            borderColor: v.color, backgroundColor: v.color+'18', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2,
        }));
    } else if (agg === 'annual') {
        const annual = {};
        daily.forEach(d => { const y = d.date.slice(0,4); if (!annual[y]) annual[y]={count:0}; vars.forEach(v=>{annual[y][v.key]=(annual[y][v.key]||0)+(d[v.key]||0);}); annual[y].count++; });
        labels = Object.keys(annual).sort();
        series = vars.map(v => ({ label:v.key.replace(/_/g,' '), data:labels.map(y=>+((annual[y][v.key]||0)/(AVG_KEYS.has(v.key)?annual[y].count:1)).toFixed(2)), borderColor:v.color,backgroundColor:v.color+'20',fill:false,tension:0.3,pointRadius:4,borderWidth:2 }));
    } else {
        const sample = daily.filter((_,i) => i % 3 === 0);
        labels = sample.map(d => d.date.slice(5));
        series = vars.map(v => ({ label:v.key.replace(/_/g,' '), data:sample.map(d=>+(d[v.key]||0)), borderColor:v.color,backgroundColor:v.color+'15',fill:false,tension:0.2,pointRadius:0,borderWidth:1.5 }));
    }
    document.getElementById('pv-chart-title').textContent = `Predictor Variables — ${data.scenario} (${agg}) · ${data.year_range}`;
    mkChart('pv-main-chart','line',labels,series,{ interaction:{mode:'index',intersect:false} });

    const statKeys = ['predicted_mm','actual_mm','temp_C','humidity_pct','wind_kmh','solar_Wm2','rainfall_lag1','rainfall_3day_avg'];
    document.getElementById('pv-stats-table').innerHTML = `
        <table class="int-table"><thead><tr><th>Variable</th><th>Mean</th><th>Min</th><th>Max</th><th>Std</th></tr></thead>
        <tbody>${statKeys.map(key => {
            const vals = daily.map(d => d[key]||0);
            const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
            const max = Math.max(...vals), min = Math.min(...vals);
            const std = Math.sqrt(vals.reduce((a,b)=>a+(b-mean)**2,0)/vals.length);
            return `<tr><td>${key.replace(/_/g,' ')}</td><td>${mean.toFixed(2)}</td><td>${min.toFixed(2)}</td><td>${max.toFixed(2)}</td><td>${std.toFixed(2)}</td></tr>`;
        }).join('')}</tbody></table>`;

    const predVals = daily.map(d => d.predicted_mm||0);
    const corrKeys = ['temp_C','humidity_pct','wind_kmh','solar_Wm2','rainfall_lag1','rainfall_lag2','rainfall_3day_avg'];
    const corrVals = corrKeys.map(key => ({ key, corr: pearsonCorr(predVals, daily.map(d=>d[key]||0)) }));
    mkChart('pv-corr-chart','bar',corrVals.map(c=>c.key.replace(/_/g,' ')),
        [{ label:'Pearson r', data:corrVals.map(c=>+c.corr.toFixed(3)),
           backgroundColor:corrVals.map(c=>c.corr>=0?'#00d4ff88':'#ff444488'),
           borderColor:corrVals.map(c=>c.corr>=0?'#00d4ff':'#ff4444'), borderWidth:1, borderRadius:3 }],
        { indexAxis:'y', plugins:{legend:{display:false}}, scales:{ x:{min:-1,max:1,ticks:{color:'#4a90a4',font:{size:9}},grid:{color:'#1a2a3a'}}, y:{ticks:{color:'#4a90a4',font:{size:9}},grid:{color:'#1a2a3a'}} } });
}

// ═══════════════════════════════════════════════════════════════
// HISTORICAL DATA TAB
// ═══════════════════════════════════════════════════════════════
async function loadHistorical() {
    const variable = document.getElementById('hist-var').value;
    const agg = document.getElementById('hist-agg').value;
    const ys = parseInt(document.getElementById('hist-yr-start').value);
    const ye = parseInt(document.getElementById('hist-yr-end').value);
    document.getElementById('hist-chart-title').textContent = `Loading ${variable} ${ys}–${ye}…`;

    try {
        const r = await fetch(`${API}/ml/historical?variable=${variable}&aggregation=${agg}&year_start=${ys}&year_end=${ye}`);
        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();
        renderHistorical(data, variable, agg, ys, ye);
    } catch(e) {
        document.getElementById('hist-chart-title').textContent = `Error: ${e.message}`;
        console.error('Historical load error:', e);
    }
}

function renderHistorical(data, variable, agg, ys, ye) {
    const rows = data.data || [];
    const isRain = variable === 'rainfall_mm';
    const varLabel = { rainfall_mm:'Rainfall (mm)', temp_C:'Temperature (°C)', humidity_pct:'Humidity (%)', wind_kmh:'Wind (km/h)', solar_Wm2:'Solar (W/m²)' }[variable] || variable;
    const color = { rainfall_mm:'#00d4ff', temp_C:'#ff8800', humidity_pct:'#00cc66', wind_kmh:'#cc88ff', solar_Wm2:'#ffcc00' }[variable] || '#00d4ff';

    document.getElementById('hist-chart-title').textContent = `${varLabel} — Historical ${ys}–${ye} (${agg})`;

    mkChart('hist-main-chart', isRain && agg !== 'daily' ? 'bar' : 'line',
        rows.map(r => r.date),
        [{
            label: `${varLabel} (${agg})`,
            data: rows.map(r => r.value),
            borderColor: color, backgroundColor: color + (agg==='daily'?'40':'88'),
            fill: agg !== 'annual', tension: 0.3, pointRadius: 0, borderWidth: 2,
            borderRadius: isRain ? 3 : 0,
        }],
        { plugins: { legend: { display: false } } }
    );

    // IMD normals chart (always show for context)
    const IMD_NORMALS = [7.2,11.0,14.0,24.2,30.1,105.5,165.7,147.5,163.1,90.2,27.6,8.3];
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    mkChart('hist-normals-chart', 'bar', MONTHS, [{
        label: 'IMD Monthly Normal Rainfall (mm)',
        data: IMD_NORMALS,
        backgroundColor: IMD_NORMALS.map(v => v > 115 ? '#ff444488' : v > 64 ? '#ff880088' : '#00d4ff55'),
        borderColor: IMD_NORMALS.map(v => v > 115 ? '#ff4444' : v > 64 ? '#ff8800' : '#00d4ff'),
        borderWidth: 1, borderRadius: 3,
    }], { plugins: { legend: { display: false } } });

    // Statistics
    const vals = rows.map(r => r.value);
    const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
    const max = Math.max(...vals), min = Math.min(...vals);
    const annTotal = isRain && agg==='monthly' ? (vals.reduce((a,b)=>a+b,0)/((ye-ys+1)||1)).toFixed(0) : null;

    document.getElementById('hist-stats').innerHTML = `
        <table class="int-table">
            <tbody>
                <tr><td style="color:#4a90a4">Period</td><td>${ys}–${ye} (${rows.length} ${agg} records)</td></tr>
                <tr><td style="color:#4a90a4">Mean (${agg})</td><td>${mean.toFixed(2)}</td></tr>
                <tr><td style="color:#4a90a4">Min</td><td>${min.toFixed(2)}</td></tr>
                <tr><td style="color:#4a90a4">Max</td><td>${max.toFixed(2)}</td></tr>
                ${annTotal ? `<tr><td style="color:#4a90a4">Annual avg</td><td>${annTotal} mm/yr <span style="color:#4a90a4">(IMD normal: 794 mm)</span></td></tr>` : ''}
                <tr><td style="color:#4a90a4">Source</td><td style="color:#4a90a4;font-size:10px;">IMD 1991–2020 normals (CLE-01/2021) · synthetic daily realisation</td></tr>
            </tbody>
        </table>`;
}

// ═══════════════════════════════════════════════════════════════
// SCENARIO GUIDE
// ═══════════════════════════════════════════════════════════════
async function renderScenarioCards(info) {
    if (!info) info = await getScenarioInfo();
    const el = document.getElementById('scenario-cards');
    if (!el || !info) return;
    el.innerHTML = Object.entries(info).map(([key, s]) => `
        <div style="background:#0d1b2a;border:1px solid ${s.color}44;border-top:3px solid ${s.color};border-radius:6px;padding:16px;">
            <div style="font-size:20px;margin-bottom:6px;">${s.icon}</div>
            <div style="font-size:14px;font-weight:700;color:${s.color};margin-bottom:4px;">${s.name}</div>
            <div style="font-size:12px;color:#c8d8e8;margin-bottom:8px;font-weight:500;">${s.short}</div>
            <div style="font-size:11px;color:#8ba5c0;line-height:1.7;margin-bottom:8px;">${s.description}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;">
                <div style="background:#0a1520;padding:6px 8px;border-radius:4px;">
                    <div style="color:#4a90a4;">Warming by 2100</div>
                    <div style="color:${s.color};font-weight:700;">${s.warming_by_2100}</div>
                </div>
                <div style="background:#0a1520;padding:6px 8px;border-radius:4px;">
                    <div style="color:#4a90a4;">Probability</div>
                    <div style="color:#c8d8e8;font-size:10px;">${s.probability}</div>
                </div>
            </div>
            <div style="margin-top:8px;font-size:11px;color:#4a90a4;padding:6px 8px;background:#0a1520;border-radius:4px;">
                <b style="color:#c8d8e8;">Rainfall impact:</b> ${s.rainfall_trend}
            </div>
        </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// TASK 3: DASHBOARD SYNC
// ═══════════════════════════════════════════════════════════════
async function syncMainDashboard(simData) {
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
        const rc = document.getElementById('risk-card');
        if (rc) rc.className = `status-card risk-card ${live.risk_level.toLowerCase()}`;
        if (simData) {
            if (el('est-discharge-value')) el('est-discharge-value').textContent = `${(simData.peak_discharge_m3s||0).toFixed(2)} m³/s (${simData.scenario})`;
            if (el('selected-basin-id'))   el('selected-basin-id').textContent   = `Peak Basin ${simData.peak_basin_id||'—'}`;
            if (el('simulation-results'))  el('simulation-results').style.display = 'block';
            const ns = el('no-selection-msg'); if (ns) ns.style.display = 'none';
        }
        ['rainfall-value','water-level-value','discharge-value'].forEach(id => {
            const e = document.getElementById(id); if (!e) return;
            e.style.transition = 'color .4s'; e.style.color = '#00d4ff';
            setTimeout(() => e.style.color = '', 900);
        });
    } catch(e) { console.warn('Dashboard sync error:', e); }
}

// ═══════════════════════════════════════════════════════════════
// COMPARE
// ═══════════════════════════════════════════════════════════════
async function runComparison() {
    const body = { scenario_a: document.getElementById('cmp-a').value, scenario_b: document.getElementById('cmp-b').value,
                   year_start: parseInt(document.getElementById('cmp-start').value), year_end: parseInt(document.getElementById('cmp-end').value) };
    const el = document.getElementById('cmp-results');
    el.innerHTML = '<div style="color:#4a90a4;padding:20px;text-align:center;">⏳ Computing…</div>';
    try {
        const r = await fetch(`${API}/compare`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
        const d = await r.json(); const a = d.scenario_a, b = d.scenario_b, diff = d.difference;
        const sia = (_scenarioInfo||{})[a.scenario] || {}, sib = (_scenarioInfo||{})[b.scenario] || {};
        el.innerHTML = `
        <div class="kpi-grid-4" style="margin-bottom:10px;">
            ${[['Total Rain',`${(a.total_rainfall_mm||0).toFixed(0)} mm`,`${(b.total_rainfall_mm||0).toFixed(0)} mm`,diff.total_rainfall_pct>0?`B +${diff.total_rainfall_pct}%`:`B ${diff.total_rainfall_pct}%`],
               ['Peak Q',`${(a.peak_discharge_m3s||0).toFixed(1)} m³/s`,`${(b.peak_discharge_m3s||0).toFixed(1)} m³/s`,`Δ ${((b.peak_discharge_m3s||0)-(a.peak_discharge_m3s||0)).toFixed(1)}`],
               ['Mean Temp',`${(a.mean_temp_C||0).toFixed(1)}°C`,`${(b.mean_temp_C||0).toFixed(1)}°C`,`+${diff.temp_increase_C}°C`],
               ['Yellow Days',String((a.alert_days||{}).yellow||0),String((b.alert_days||{}).yellow||0),'']
            ].map(([label,va,vb,delta])=>`<div class="int-card">
                <div class="kpi-label" style="font-size:10px;color:#4a90a4;">${label}</div>
                <div style="display:flex;gap:6px;align-items:baseline;margin-top:4px;">
                    <span style="color:${sia.color||'#00d4ff'};font-size:13px;font-weight:700;">${va}</span>
                    <span style="color:#4a90a4;font-size:10px;">${a.scenario}</span>
                </div>
                <div style="display:flex;gap:6px;align-items:baseline;margin-top:2px;">
                    <span style="color:${sib.color||'#ff8800'};font-size:13px;font-weight:700;">${vb}</span>
                    <span style="color:#4a90a4;font-size:10px;">${b.scenario}</span>
                </div>
                ${delta?`<div style="font-size:10px;color:#ffcc00;margin-top:3px;">${delta}</div>`:''}
            </div>`).join('')}
        </div>
        <div class="int-card"><div class="int-card-title">Monthly Rainfall — ${a.scenario} vs ${b.scenario}</div><div style="height:200px;"><canvas id="cmp-chart"></canvas></div></div>`;
        setTimeout(() => mkChart('cmp-chart','line',
            a.monthly_rainfall.map(m=>m.month.slice(0,7)),
            [{label:a.scenario,data:a.monthly_rainfall.map(m=>m.mm),borderColor:sia.color||'#00d4ff',backgroundColor:(sia.color||'#00d4ff')+'18',fill:true,tension:0.3,pointRadius:0},
             {label:b.scenario,data:b.monthly_rainfall.map(m=>m.mm),borderColor:sib.color||'#ff8800',backgroundColor:(sib.color||'#ff8800')+'18',fill:true,tension:0.3,pointRadius:0}]), 80);
    } catch(e) { el.innerHTML = `<div style="color:#ff4444;padding:10px;">Error: ${e.message}</div>`; }
}

// ═══════════════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════════════
async function loadHistory() {
    const el = document.getElementById('history-table');
    el.innerHTML = '<div style="color:#4a90a4;padding:16px;text-align:center;">⏳ Loading…</div>';
    try {
        const r = await fetch(`${API}/simulation_runs`); const rows = await r.json();
        if (!rows.length) { el.innerHTML = '<div style="color:#4a90a4;padding:16px;text-align:center;">No runs yet.</div>'; return; }
        el.innerHTML = `<table class="int-table"><thead><tr><th>ID</th><th>Scenario</th><th>Years</th><th>Total Rain</th><th>Peak Q</th><th>Risk</th><th>Alert Days</th><th>Time</th></tr></thead>
        <tbody>${rows.map(r=>`<tr onclick="loadRunDetail(${r.id})" style="cursor:pointer;" title="Click to reload">
            <td style="color:#4a90a4">${r.id}</td><td style="color:#00d4ff">${r.scenario}</td>
            <td>${r.year_start}–${r.year_end}</td><td>${(r.total_rainfall_mm||0).toFixed(0)} mm</td>
            <td>${(r.peak_discharge_m3s||0).toFixed(1)} m³/s</td>
            <td><span style="color:${riskColor(r.risk_level||'')};">${r.risk_level||'—'}</span></td>
            <td style="color:#ffcc00">${r.alert_days||0}</td><td style="color:#4a90a4">${(r.timestamp||'').slice(0,16)}</td>
        </tr>`).join('')}</tbody></table>`;
    } catch(e) { el.innerHTML = `<div style="color:#ff4444;padding:10px;">Error: ${e.message}</div>`; }
}
async function loadRunDetail(id) {
    const r = await fetch(`${API}/simulation_runs/${id}`); const data = await r.json();
    lastSimResult = data; showIntTab('sim'); renderSimResults(data); await syncMainDashboard(data);
}

// ═══════════════════════════════════════════════════════════════
// ML MODEL INFO
// ═══════════════════════════════════════════════════════════════
async function loadMLInfo() {
    try {
        const r = await fetch(`${API}/ml/model_info`); const meta = await r.json();
        const el = document.getElementById('ml-meta-content'); if (!el) return;
        el.innerHTML = `
            <div class="kpi-grid-4" style="margin-bottom:10px;">
                ${[['R²',meta.r2,'#00d4ff'],['RMSE',meta.rmse+' mm','#ff8800'],['MAE',meta.mae+' mm','#00cc66'],['CV R²',meta.cv_r2_mean,'#cc88ff']]
                  .map(([l,v,c])=>`<div class="kpi-box" style="--kpi-color:${c};"><div class="kpi-label">${l}</div><div class="kpi-val">${v}</div></div>`).join('')}
            </div>
            <div style="font-size:11px;color:#4a90a4;line-height:1.9;">
                <div>Train/Test: <span style="color:#c8d8e8;">${(meta.n_train||0).toLocaleString()} / ${(meta.n_test||0).toLocaleString()} samples</span></div>
                <div>Max predict: <span style="color:#c8d8e8;">${meta.max_predictable_mm||'—'} mm/day</span></div>
                <div>Algorithm: <span style="color:#c8d8e8;">Random Forest (300 trees, depth 14)</span></div>
                <div>Training: <span style="color:#c8d8e8;">${meta.training_data||'—'}</span></div>
                <div>Trained: <span style="color:#c8d8e8;">${(meta.trained_at||'').slice(0,10)}</span></div>
            </div>`;
        const fi = meta.feature_importances || {};
        mkChart('ml-fi-chart','bar',Object.keys(fi).map(k=>k.replace('rainfall_','').replace('_avg','avg')),
            [{label:'Importance',data:Object.values(fi),backgroundColor:Object.values(fi).map((_,i)=>`hsl(${190+i*22},70%,50%)`),borderRadius:3}],
            { indexAxis:'y', plugins:{legend:{display:false}} });
        const fc = await fetch(`${API}/ml/forecast?scenario=SSP2-4.5&year_start=2025&year_end=2025`);
        if (fc.ok) {
            const fcData = await fc.json();
            if (fcData.daily) {
                const sample = fcData.daily.slice(150, 275);
                mkChart('ml-avp-chart','line',sample.map(d=>d.date.slice(5)),[
                    {label:'Actual (NASA NEX-GDDP)',data:sample.map(d=>d.actual_mm||0),borderColor:'#4a90a4',pointRadius:0,tension:0.3,borderWidth:1.5},
                    {label:'RF Predicted',data:sample.map(d=>d.predicted_mm),borderColor:'#00d4ff',pointRadius:0,tension:0.3,borderWidth:2}]);
            }
        }
    } catch(e) { console.warn('ML info error:', e); }
}

// ═══════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════
function generateReport() {
    const el = document.getElementById('report-preview');
    if (!lastSimResult) { alert('Run a simulation first.'); return; }
    const d = lastSimResult, now = new Date().toLocaleString('en-IN'), rc = riskColor(d.overall_risk_level);
    const ad = d.alert_days || {};
    const scenLabel = (_scenarioInfo||{})[d.scenario]?.name || d.scenario;
    el.style.display = 'block';
    el.innerHTML = `<div style="background:#fff;color:#111;padding:24px;border-radius:6px;font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
    <div style="border-bottom:3px solid #0070c0;padding-bottom:10px;margin-bottom:18px;">
        <h1 style="font-size:20px;color:#0070c0;margin:0;">Kukatpally Nala — Flood DSS Simulation Report <span style="font-size:12px;color:#555;">v3</span></h1>
        <p style="margin:4px 0 0;color:#555;font-size:12px;">GHMC Zone 12 · Hyderabad · Generated: ${now}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;">
        <tr style="background:#e8f4fb;"><th colspan="4" style="padding:7px;text-align:left;color:#0070c0;">Simulation Parameters</th></tr>
        <tr><td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Scenario</td><td style="padding:5px 8px;border:1px solid #ddd;" colspan="3">${scenLabel}</td></tr>
        <tr><td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Year Range</td><td style="padding:5px 8px;border:1px solid #ddd;">${d.year_range}</td>
            <td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Total Days</td><td style="padding:5px 8px;border:1px solid #ddd;">${d.total_days||'—'}</td></tr>
        <tr><td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Catchment</td><td style="padding:5px 8px;border:1px solid #ddd;" colspan="3">104.3 km² · 17 sub-basins · GHMC Zone 12</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;">
        <tr style="background:#e8f4fb;"><th colspan="4" style="padding:7px;text-align:left;color:#0070c0;">Key Results</th></tr>
        <tr><td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Total Rainfall</td><td style="padding:5px 8px;border:1px solid #ddd;">${(d.total_rainfall_mm||0).toFixed(1)} mm</td>
            <td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Peak Discharge</td><td style="padding:5px 8px;border:1px solid #ddd;">${(d.peak_discharge_m3s||0).toFixed(2)} m³/s</td></tr>
        <tr><td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Overall Risk</td>
            <td style="padding:5px 8px;border:1px solid #ddd;font-weight:700;color:${rc};">${d.overall_risk_level}</td>
            <td style="padding:5px 8px;border:1px solid #ddd;font-weight:600;">Alert Days</td>
            <td style="padding:5px 8px;border:1px solid #ddd;">Yellow:${ad.yellow||0} Orange:${ad.orange||0} Red:${ad.red||0}</td></tr>
    </table>
    <h3 style="color:#0070c0;font-size:13px;border-bottom:1px solid #ddd;padding-bottom:4px;">Sub-Basin Discharge (Q = 0.278 × C × i × A)</h3>
    <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px;">
        <thead><tr style="background:#0070c0;color:#fff;"><th style="padding:5px 8px;">Basin</th><th>Area km²</th><th>C</th><th>i mm/hr</th><th>Q m³/s</th><th>Q₂yr</th><th>Q₅₀yr</th><th>Risk</th></tr></thead>
        <tbody>${(d.basin_summary||[]).map((b,i)=>`<tr style="background:${i%2?'#f5f9ff':'#fff'};">
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
    <p style="font-size:11px;color:#333;line-height:1.7;">
        <b>ML:</b> Random Forest Regressor (300 trees, depth 14), trained on NASA NEX-GDDP CMIP6 data — SSP1-2.6 + SSP2-4.5 + SSP3-7.0 + SSP5-8.5 (2025–2050, ~30,377 samples). R² = ${(window._mlR2||0.962).toFixed(3)}.<br>
        <b>Discharge:</b> Rational Method Q = 0.278 × C × i × A. Runoff coefficient C = 0.736 (GHMC Zone 12 urbanised). Tc = 1.2 hr (Kirpich formula). Sub-basins from QGIS CartoDEM 30m analysis (17 basins, 104.3 km²).<br>
        <b>Alert thresholds:</b> Yellow ≥64.5, Orange ≥115.6, Red ≥204.5 mm/day (IMD standard). Flood threshold Q > 200 m³/s.<br>
        <b>Historical reference:</b> IMD 1991–2020 normals, annual mean ~794 mm (Hyderabad). Reference event: 13 October 2020 (192 mm in 6 hours).
    </p>
    <div style="margin-top:14px;font-size:10px;color:#777;text-align:center;border-top:1px solid #ddd;padding-top:8px;">
        Kukatpally Nala Flood DSS v3 · GHMC Zone 12 · ${now}
    </div></div>`;
    window.print();
}

// ── boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => setTimeout(injectIntegrationUI, 700));
