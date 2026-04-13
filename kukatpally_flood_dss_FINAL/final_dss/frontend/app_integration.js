/* ============================================================
   FLOOD DSS — INTEGRATION MODULE (Assignment 3 + Compare + Report)
   Appended to the A2 app.js via <script src="app_integration.js">
   ============================================================ */

const API = window.location.origin;

// ─── Inject integration tabs into the right panel ─────────────────────────
function injectIntegrationUI() {
    const footer = document.querySelector('.dashboard-footer');
    if (!footer) return;

    const panel = document.createElement('div');
    panel.id = 'integration-panel';
    panel.innerHTML = `
<div style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:2000;background:#0a0e1a;overflow-y:auto;display:none" id="int-overlay">
  <div style="max-width:1100px;margin:0 auto;padding:16px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;border-bottom:1px solid #1e2d3d;padding-bottom:12px">
      <span style="font-size:20px">🌊</span>
      <div>
        <div style="font-family:Orbitron,monospace;color:#00d4ff;font-size:16px;font-weight:700">KUKATPALLY NALA — CLIMATE SIMULATION DSS</div>
        <div style="font-size:11px;color:#4a90a4">GHMC Zone 12 · ML Prediction → Rational Method → Flood Risk</div>
      </div>
      <button onclick="closeInt()" style="margin-left:auto;background:#1e2d3d;border:1px solid #2a3f5a;color:#8ba5c0;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px">✕ Close</button>
    </div>

    <!-- Nav tabs -->
    <div style="display:flex;gap:4px;margin-bottom:14px">
      ${[['sim','⚡ Simulate','Run ML → Discharge'],['compare','↔ Compare','Two scenarios'],['history','📋 Run History','Past runs'],['mlinfo','🤖 Model Info','RF metrics'],['report','📄 Report','Download PDF']].map(([id,label,sub])=>`
      <button onclick="showIntTab('${id}')" id="itab-${id}" style="background:#111c2a;border:1px solid #1e2d3d;color:#8ba5c0;padding:8px 14px;border-radius:4px;cursor:pointer;font-size:12px;flex:1;text-align:center">
        <div style="font-weight:600">${label}</div><div style="font-size:10px;opacity:.7">${sub}</div>
      </button>`).join('')}
    </div>

    <!-- SIMULATE TAB -->
    <div id="itab-content-sim">
      <div style="display:grid;grid-template-columns:280px 1fr;gap:14px">
        <div>
          <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:14px">
            <div style="color:#00d4ff;font-size:12px;font-weight:600;margin-bottom:12px;text-transform:uppercase">Simulation Parameters</div>

            <label style="font-size:11px;color:#4a90a4">Climate Scenario</label>
            <select id="sim-scenario" style="width:100%;background:#111c2a;border:1px solid #2a3f5a;color:#c8d8e8;padding:6px 8px;border-radius:4px;margin:4px 0 10px;font-size:12px">
              <option value="SSP1-2.6">SSP1-2.6 — Low emissions</option>
              <option value="SSP2-4.5" selected>SSP2-4.5 — Middle of road</option>
              <option value="SSP3-7.0">SSP3-7.0 — High emissions</option>
              <option value="SSP5-8.5">SSP5-8.5 — Extreme fossil fuels</option>
            </select>

            <label style="font-size:11px;color:#4a90a4">Year Range</label>
            <div style="display:flex;gap:6px;margin:4px 0 10px">
              <select id="sim-yr-start" style="flex:1;background:#111c2a;border:1px solid #2a3f5a;color:#c8d8e8;padding:5px;border-radius:4px;font-size:11px">
                ${[2025,2026,2027,2028,2030,2035,2040].map(y=>`<option ${y===2025?'selected':''}>${y}</option>`).join('')}
              </select>
              <span style="color:#4a90a4;align-self:center">→</span>
              <select id="sim-yr-end" style="flex:1;background:#111c2a;border:1px solid #2a3f5a;color:#c8d8e8;padding:5px;border-radius:4px;font-size:11px">
                ${[2030,2035,2040,2045,2050].map(y=>`<option ${y===2035?'selected':''}>${y}</option>`).join('')}
              </select>
            </div>

            <label style="font-size:11px;color:#4a90a4">Sub-Basin (optional)</label>
            <select id="sim-basin" style="width:100%;background:#111c2a;border:1px solid #2a3f5a;color:#c8d8e8;padding:6px 8px;border-radius:4px;margin:4px 0 14px;font-size:12px">
              <option value="">All 17 basins</option>
              ${Array.from({length:17},(_,i)=>`<option value="${i+1}">Basin ${i+1}</option>`).join('')}
            </select>

            <button onclick="runSimulation()" style="width:100%;background:linear-gradient(135deg,#0070c0,#00d4ff);border:none;color:#fff;padding:10px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:700;letter-spacing:.5px">
              ▶ RUN SIMULATION
            </button>
            <div id="sim-spinner" style="display:none;text-align:center;margin-top:10px;color:#4a90a4;font-size:12px">⏳ Computing...</div>
          </div>

          <div id="sim-summary-card" style="display:none;background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:14px;margin-top:10px">
            <div style="color:#00d4ff;font-size:11px;font-weight:600;margin-bottom:8px;text-transform:uppercase">Results Summary</div>
            <div id="sim-summary-content"></div>
          </div>
        </div>

        <div>
          <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:14px;margin-bottom:10px">
            <div style="color:#00d4ff;font-size:12px;font-weight:600;margin-bottom:10px">Monthly Rainfall Forecast (mm/month)</div>
            <canvas id="sim-monthly-chart" height="80"></canvas>
          </div>
          <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:14px;margin-bottom:10px">
            <div style="color:#00d4ff;font-size:12px;font-weight:600;margin-bottom:10px">Peak Discharge per Sub-Basin (m³/s) — Rational Method</div>
            <canvas id="sim-basin-chart" height="70"></canvas>
          </div>
          <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:14px">
            <div style="color:#00d4ff;font-size:12px;font-weight:600;margin-bottom:8px">Sub-Basin Discharge Table</div>
            <div id="sim-basin-table" style="font-size:11px;max-height:200px;overflow-y:auto"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- COMPARE TAB -->
    <div id="itab-content-compare" style="display:none">
      <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:14px;margin-bottom:12px">
        <div style="color:#00d4ff;font-size:12px;font-weight:600;margin-bottom:10px;text-transform:uppercase">Compare Two Scenarios</div>
        <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
          <div>
            <label style="font-size:11px;color:#4a90a4;display:block;margin-bottom:4px">Scenario A</label>
            <select id="cmp-a" style="background:#111c2a;border:1px solid #2a3f5a;color:#c8d8e8;padding:6px 10px;border-radius:4px;font-size:12px">
              <option value="SSP1-2.6">SSP1-2.6</option>
              <option value="SSP2-4.5" selected>SSP2-4.5</option>
              <option value="SSP3-7.0">SSP3-7.0</option>
              <option value="SSP5-8.5">SSP5-8.5</option>
            </select>
          </div>
          <div>
            <label style="font-size:11px;color:#4a90a4;display:block;margin-bottom:4px">Scenario B</label>
            <select id="cmp-b" style="background:#111c2a;border:1px solid #2a3f5a;color:#c8d8e8;padding:6px 10px;border-radius:4px;font-size:12px">
              <option value="SSP1-2.6">SSP1-2.6</option>
              <option value="SSP2-4.5">SSP2-4.5</option>
              <option value="SSP3-7.0">SSP3-7.0</option>
              <option value="SSP5-8.5" selected>SSP5-8.5</option>
            </select>
          </div>
          <div>
            <label style="font-size:11px;color:#4a90a4;display:block;margin-bottom:4px">Year Range</label>
            <div style="display:flex;gap:6px">
              <select id="cmp-start" style="background:#111c2a;border:1px solid #2a3f5a;color:#c8d8e8;padding:5px 8px;border-radius:4px;font-size:12px">
                ${[2025,2030,2035].map(y=>`<option>${y}</option>`).join('')}
              </select>
              <span style="color:#4a90a4;align-self:center">→</span>
              <select id="cmp-end" style="background:#111c2a;border:1px solid #2a3f5a;color:#c8d8e8;padding:5px 8px;border-radius:4px;font-size:12px">
                ${[2035,2040,2045,2050].map(y=>`<option ${y===2050?'selected':''}>${y}</option>`).join('')}
              </select>
            </div>
          </div>
          <button onclick="runComparison()" style="background:linear-gradient(135deg,#7b2ff7,#00d4ff);border:none;color:#fff;padding:9px 20px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:700">
            ↔ COMPARE
          </button>
        </div>
      </div>
      <div id="cmp-results"></div>
    </div>

    <!-- HISTORY TAB -->
    <div id="itab-content-history" style="display:none">
      <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="color:#00d4ff;font-size:12px;font-weight:600;text-transform:uppercase">Simulation Run History</div>
          <button onclick="loadHistory()" style="background:#111c2a;border:1px solid #2a3f5a;color:#8ba5c0;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:11px">↻ Refresh</button>
        </div>
        <div id="history-table"></div>
      </div>
    </div>

    <!-- MODEL INFO TAB -->
    <div id="itab-content-mlinfo" style="display:none">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:14px">
          <div style="color:#00d4ff;font-size:12px;font-weight:600;margin-bottom:10px;text-transform:uppercase">Random Forest — Model Metrics</div>
          <div id="ml-meta-content"></div>
        </div>
        <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:14px">
          <div style="color:#00d4ff;font-size:12px;font-weight:600;margin-bottom:10px;text-transform:uppercase">Feature Importance</div>
          <canvas id="ml-fi-chart" height="160"></canvas>
        </div>
      </div>
      <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:14px;margin-top:12px">
        <div style="color:#00d4ff;font-size:12px;font-weight:600;margin-bottom:8px;text-transform:uppercase">Actual vs Predicted (Test Set Sample)</div>
        <canvas id="ml-avp-chart" height="60"></canvas>
      </div>
    </div>

    <!-- REPORT TAB -->
    <div id="itab-content-report" style="display:none">
      <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:14px;margin-bottom:12px">
        <div style="color:#00d4ff;font-size:12px;font-weight:600;margin-bottom:10px;text-transform:uppercase">Generate Report</div>
        <p style="font-size:13px;color:#8ba5c0;margin-bottom:10px">Run a simulation first, then click below to generate a printable PDF report.</p>
        <button onclick="generateReport()" style="background:linear-gradient(135deg,#1a7a3a,#00ff88);border:none;color:#000;padding:10px 24px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:700">
          📄 Generate & Print Report
        </button>
      </div>
      <div id="report-preview" style="background:#fff;color:#111;padding:24px;border-radius:6px;display:none;font-family:Arial,sans-serif"></div>
    </div>

  </div>
</div>
`;
    document.body.appendChild(panel);

    // Add launch button to header
    const headerRight = document.querySelector('.header-right');
    if (headerRight) {
        const btn = document.createElement('button');
        btn.innerHTML = '⚡ SIMULATION DSS';
        btn.style.cssText = 'background:linear-gradient(135deg,#0070c0,#00d4ff);border:none;color:#fff;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:700;margin-left:10px;letter-spacing:.5px';
        btn.onclick = openInt;
        headerRight.appendChild(btn);
    }

    // Load ML info on first open
    loadMLInfo();
}

function openInt() {
    document.getElementById('int-overlay').style.display = 'block';
    showIntTab('sim');
}
function closeInt() {
    document.getElementById('int-overlay').style.display = 'none';
}
function showIntTab(id) {
    ['sim','compare','history','mlinfo','report'].forEach(t => {
        const c = document.getElementById(`itab-content-${t}`);
        const b = document.getElementById(`itab-${t}`);
        if (c) c.style.display = (t===id)?'block':'none';
        if (b) b.style.cssText = b.style.cssText.replace(/border:1px solid [^;]+/,'') + `;border:1px solid ${t===id?'#00d4ff':'#1e2d3d'};color:${t===id?'#00d4ff':'#8ba5c0'}`;
    });
    if (id === 'history') loadHistory();
    if (id === 'mlinfo') loadMLInfo();
}

// ─── Chart instances ────────────────────────────────────────────────────────
let monthlyChart, basinChart, fiChart, avpChart;

function mkChart(id, type, labels, datasets, opts={}) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (ctx._ch) ctx._ch.destroy();
    ctx._ch = new Chart(ctx, {
        type,
        data: { labels, datasets },
        options: {
            responsive: true,
            plugins: { legend: { labels: { color:'#8ba5c0', font:{size:10} } } },
            scales: {
                x: { ticks:{color:'#4a90a4',maxRotation:60,font:{size:9}}, grid:{color:'#1a2a3a'} },
                y: { ticks:{color:'#4a90a4',font:{size:9}}, grid:{color:'#1a2a3a'} }
            },
            ...opts
        }
    });
    return ctx._ch;
}

// ─── SIMULATE ───────────────────────────────────────────────────────────────
let lastSimResult = null;

async function runSimulation() {
    const scenario = document.getElementById('sim-scenario').value;
    const ys = parseInt(document.getElementById('sim-yr-start').value);
    const ye = parseInt(document.getElementById('sim-yr-end').value);
    const basin = document.getElementById('sim-basin').value;

    if (ye <= ys) { alert('Year end must be after year start'); return; }

    document.getElementById('sim-spinner').style.display = 'block';

    const body = { scenario, year_start: ys, year_end: ye };
    if (basin) body.basin_id = parseInt(basin);

    try {
        const res = await fetch(`${API}/simulate`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify(body)
        });
        if (!res.ok) { const e = await res.json(); alert('Error: ' + (e.detail||'unknown')); return; }
        const data = await res.json();
        lastSimResult = data;
        renderSimResults(data);
    } catch(e) {
        alert('Could not reach API: ' + e.message);
    } finally {
        document.getElementById('sim-spinner').style.display = 'none';
    }
}

function riskColor(r) {
    return {CRITICAL:'#ff4444',HIGH:'#ff8800',MODERATE:'#ffcc00',LOW:'#00cc66',NORMAL:'#00ff88'}[r]||'#8ba5c0';
}

function renderSimResults(data) {
    // Summary card
    const risk = data.overall_risk_level;
    const rc = riskColor(risk);
    document.getElementById('sim-summary-card').style.display = 'block';
    document.getElementById('sim-summary-content').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">
            <div style="background:#0a1520;padding:8px;border-radius:4px;border-left:3px solid #00d4ff">
                <div style="color:#4a90a4">Total Rainfall</div>
                <div style="font-size:18px;font-weight:700;color:#00d4ff">${data.total_rainfall_mm.toFixed(0)} mm</div>
                <div style="color:#4a90a4">${data.year_range}</div>
            </div>
            <div style="background:#0a1520;padding:8px;border-radius:4px;border-left:3px solid ${rc}">
                <div style="color:#4a90a4">Overall Risk</div>
                <div style="font-size:18px;font-weight:700;color:${rc}">${risk}</div>
                <div style="color:#4a90a4">Peak Q: ${data.peak_discharge_m3s.toFixed(1)} m³/s</div>
            </div>
            <div style="background:#0a1520;padding:8px;border-radius:4px;border-left:3px solid #ffcc00">
                <div style="color:#4a90a4">Yellow Alert Days</div>
                <div style="font-size:16px;font-weight:700;color:#ffcc00">${data.alert_days.yellow}</div>
            </div>
            <div style="background:#0a1520;padding:8px;border-radius:4px;border-left:3px solid #ff8800">
                <div style="color:#4a90a4">Orange/Red Days</div>
                <div style="font-size:16px;font-weight:700;color:#ff8800">${data.alert_days.orange + data.alert_days.red}</div>
            </div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#4a90a4">
            Peak date: <b style="color:#c8d8e8">${data.peak_date||'—'}</b> &nbsp;|&nbsp;
            Peak basin: <b style="color:#c8d8e8">Basin ${data.peak_basin_id||'—'}</b>
        </div>
    `;

    // Monthly chart
    const monthly = data.monthly || [];
    mkChart('sim-monthly-chart', 'bar',
        monthly.map(m => m.month),
        [{
            label: `${data.scenario} — Predicted Rain (mm/month)`,
            data: monthly.map(m => m.total_rain_mm),
            backgroundColor: monthly.map(m => m.total_rain_mm > 115 ? '#ff4444' : m.total_rain_mm > 64 ? '#ff8800' : '#00d4ff'),
            borderRadius: 3,
        }],
        { plugins: { legend: { display: false } } }
    );

    // Basin discharge chart
    const basins = (data.basin_summary||[]).slice(0,17);
    mkChart('sim-basin-chart', 'bar',
        basins.map(b=>`B${b.basin_id}`),
        [{
            label: 'Peak Discharge (m³/s)',
            data: basins.map(b=>b.discharge_m3s),
            backgroundColor: basins.map(b=>riskColor(b.risk_level)),
            borderRadius: 2,
        }],
        { plugins: { legend: { display: false } } }
    );

    // Basin table
    document.getElementById('sim-basin-table').innerHTML = `
        <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#111c2a">
                ${['Basin','Area km²','C','Rainfall mm/hr','Q (m³/s)','Q 2yr','Q 50yr','Risk'].map(h=>`<th style="padding:5px 8px;text-align:left;color:#4a90a4;border-bottom:1px solid #1e2d3d">${h}</th>`).join('')}
            </tr></thead>
            <tbody>
                ${basins.map(b=>`<tr style="border-bottom:1px solid #0d1b2a">
                    <td style="padding:5px 8px;color:#c8d8e8">${b.basin_id}</td>
                    <td style="padding:5px 8px;color:#8ba5c0">${b.area_km2.toFixed(2)}</td>
                    <td style="padding:5px 8px;color:#8ba5c0">${b.runoff_coeff}</td>
                    <td style="padding:5px 8px;color:#8ba5c0">${b.rain_intensity_mmhr.toFixed(2)}</td>
                    <td style="padding:5px 8px;font-weight:700;color:${riskColor(b.risk_level)}">${b.discharge_m3s.toFixed(3)}</td>
                    <td style="padding:5px 8px;color:#8ba5c0">${b.peak_2yr_m3s.toFixed(2)}</td>
                    <td style="padding:5px 8px;color:#8ba5c0">${b.peak_50yr_m3s.toFixed(2)}</td>
                    <td style="padding:5px 8px"><span style="background:${riskColor(b.risk_level)}22;color:${riskColor(b.risk_level)};padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700">${b.risk_level}</span></td>
                </tr>`).join('')}
            </tbody>
        </table>`;

    // Colour the map basins if map is loaded
    colorMapBasins(data.basin_summary || []);
}

function colorMapBasins(basins) {
    if (typeof window.drainageBasinsLayer === 'undefined') return;
    const riskMap = {};
    basins.forEach(b => riskMap[b.basin_id] = b.risk_level);
    try {
        if (window.drainageBasinsLayer) {
            window.drainageBasinsLayer.eachLayer(layer => {
                const bid = layer.feature && (layer.feature.properties.Basin_ID || layer.feature.properties.DN);
                const risk = riskMap[bid];
                if (risk) layer.setStyle({ fillColor: riskColor(risk), fillOpacity: 0.5, weight: 1 });
            });
        }
    } catch(e) {}
}

// ─── COMPARE ────────────────────────────────────────────────────────────────
async function runComparison() {
    const body = {
        scenario_a: document.getElementById('cmp-a').value,
        scenario_b: document.getElementById('cmp-b').value,
        year_start: parseInt(document.getElementById('cmp-start').value),
        year_end: parseInt(document.getElementById('cmp-end').value),
    };
    const el = document.getElementById('cmp-results');
    el.innerHTML = '<div style="color:#4a90a4;padding:20px;text-align:center">⏳ Computing comparison...</div>';

    try {
        const res = await fetch(`${API}/compare`, {
            method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
        });
        const data = await res.json();
        renderComparison(data);
    } catch(e) {
        el.innerHTML = `<div style="color:#ff4444;padding:10px">Error: ${e.message}</div>`;
    }
}

function renderComparison(data) {
    const a = data.scenario_a, b = data.scenario_b, diff = data.difference;
    const el = document.getElementById('cmp-results');

    el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">
        ${[
            ['Total Rainfall', `${a.total_rainfall_mm.toFixed(0)} mm`, `${b.total_rainfall_mm.toFixed(0)} mm`, diff.total_rainfall_pct > 0 ? `+${diff.total_rainfall_pct}%` : `${diff.total_rainfall_pct}%`],
            ['Peak Discharge', `${a.peak_discharge_m3s.toFixed(1)} m³/s`, `${b.peak_discharge_m3s.toFixed(1)} m³/s`, `${(b.peak_discharge_m3s-a.peak_discharge_m3s).toFixed(1)} m³/s`],
            ['Mean Temp', `${a.mean_temp_C.toFixed(1)}°C`, `${b.mean_temp_C.toFixed(1)}°C`, `+${diff.temp_increase_C.toFixed(2)}°C`],
        ].map(([label,va,vb,delta])=>`
        <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:12px">
            <div style="font-size:11px;color:#4a90a4;margin-bottom:6px">${label}</div>
            <div style="display:flex;gap:8px;align-items:center">
                <div style="flex:1;text-align:center">
                    <div style="font-size:10px;color:#00d4ff">${a.scenario}</div>
                    <div style="font-size:15px;font-weight:700;color:#c8d8e8">${va}</div>
                </div>
                <div style="color:#4a90a4">vs</div>
                <div style="flex:1;text-align:center">
                    <div style="font-size:10px;color:#ff8800">${b.scenario}</div>
                    <div style="font-size:15px;font-weight:700;color:#c8d8e8">${vb}</div>
                </div>
            </div>
            <div style="text-align:center;font-size:12px;color:${delta.includes('-')?'#00cc66':'#ff8800'};margin-top:4px">${delta}</div>
        </div>`).join('')}
    </div>
    <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:14px;margin-bottom:10px">
        <div style="color:#00d4ff;font-size:12px;font-weight:600;margin-bottom:8px">Monthly Rainfall Comparison</div>
        <canvas id="cmp-chart" height="70"></canvas>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${[a,b].map(s=>`
        <div style="background:#0d1b2a;border:1px solid #1e2d3d;border-radius:6px;padding:12px">
            <div style="color:#00d4ff;font-size:11px;font-weight:600;margin-bottom:8px">${s.scenario} — Alert Days</div>
            <div style="display:flex;gap:8px">
                ${[['Yellow',s.alert_days.yellow,'#ffcc00'],['Orange',s.alert_days.orange,'#ff8800'],['Red',s.alert_days.red,'#ff4444']].map(([l,v,c])=>`
                <div style="flex:1;text-align:center;background:${c}22;border:1px solid ${c}44;border-radius:4px;padding:6px">
                    <div style="font-size:10px;color:${c}">${l}</div>
                    <div style="font-size:18px;font-weight:700;color:${c}">${v}</div>
                </div>`).join('')}
            </div>
        </div>`).join('')}
    </div>`;

    // Render chart
    setTimeout(()=>{
        const labels = a.monthly_rainfall.map(m=>m.month.slice(0,7));
        mkChart('cmp-chart','line',labels,[
            {label:a.scenario,data:a.monthly_rainfall.map(m=>m.mm),borderColor:'#00d4ff',backgroundColor:'rgba(0,212,255,0.1)',fill:true,tension:0.3,pointRadius:0},
            {label:b.scenario,data:b.monthly_rainfall.map(m=>m.mm),borderColor:'#ff8800',backgroundColor:'rgba(255,136,0,0.1)',fill:true,tension:0.3,pointRadius:0},
        ]);
    }, 100);
}

// ─── HISTORY ────────────────────────────────────────────────────────────────
async function loadHistory() {
    const el = document.getElementById('history-table');
    el.innerHTML = '<div style="color:#4a90a4;padding:16px;text-align:center">⏳ Loading...</div>';
    try {
        const res = await fetch(`${API}/simulation_runs`);
        const rows = await res.json();
        if (!rows.length) { el.innerHTML = '<div style="color:#4a90a4;padding:16px;text-align:center">No runs yet. Run a simulation first.</div>'; return; }
        el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:#111c2a">${['ID','Scenario','Years','Total Rain','Peak Q','Risk','Alert Days','Time'].map(h=>`<th style="padding:6px 10px;text-align:left;color:#4a90a4;border-bottom:1px solid #1e2d3d">${h}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(r=>`<tr style="border-bottom:1px solid #0d1b2a;cursor:pointer" onclick="loadRunDetail(${r.id})">
                <td style="padding:6px 10px;color:#4a90a4">${r.id}</td>
                <td style="padding:6px 10px;color:#00d4ff">${r.scenario}</td>
                <td style="padding:6px 10px;color:#c8d8e8">${r.year_start}–${r.year_end}</td>
                <td style="padding:6px 10px;color:#c8d8e8">${(r.total_rainfall_mm||0).toFixed(0)} mm</td>
                <td style="padding:6px 10px;color:#c8d8e8">${(r.peak_discharge_m3s||0).toFixed(1)} m³/s</td>
                <td style="padding:6px 10px"><span style="color:${riskColor(r.risk_level||'')};font-weight:700">${r.risk_level||'—'}</span></td>
                <td style="padding:6px 10px;color:#ffcc00">${r.alert_days||0}</td>
                <td style="padding:6px 10px;color:#4a90a4">${r.timestamp?r.timestamp.slice(0,16):'—'}</td>
            </tr>`).join('')}</tbody>
        </table>`;
    } catch(e) { el.innerHTML = `<div style="color:#ff4444;padding:10px">Error: ${e.message}</div>`; }
}

async function loadRunDetail(id) {
    const res = await fetch(`${API}/simulation_runs/${id}`);
    const data = await res.json();
    lastSimResult = data;
    showIntTab('sim');
    renderSimResults(data);
}

// ─── ML INFO ────────────────────────────────────────────────────────────────
async function loadMLInfo() {
    try {
        const res = await fetch(`${API}/ml/model_info`);
        const meta = await res.json();
        const el = document.getElementById('ml-meta-content');
        if (!el) return;

        el.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:10px">
                ${[['R²',meta.r2],['RMSE',meta.rmse+' mm'],['MAE',meta.mae+' mm'],['CV R²',meta.cv_r2_mean]].map(([l,v])=>`
                <div style="background:#0a1520;padding:8px;border-radius:4px">
                    <div style="color:#4a90a4;font-size:10px">${l}</div>
                    <div style="font-size:16px;font-weight:700;color:#00d4ff">${v}</div>
                </div>`).join('')}
            </div>
            <div style="font-size:11px;color:#4a90a4;line-height:1.8">
                <div>Samples: <span style="color:#c8d8e8">${(meta.n_train||0).toLocaleString()} train / ${(meta.n_test||0).toLocaleString()} test</span></div>
                <div>Max predict: <span style="color:#c8d8e8">${meta.max_predictable_mm||'—'} mm/day</span></div>
                <div>Training data: <span style="color:#c8d8e8">${meta.training_data||'—'}</span></div>
                <div>Algorithm: <span style="color:#c8d8e8">Random Forest (300 trees, depth 14)</span></div>
                <div>Trained: <span style="color:#c8d8e8">${(meta.trained_at||'').slice(0,10)}</span></div>
            </div>`;

        // Feature importance chart
        const fi = meta.feature_importances || {};
        const labels = Object.keys(fi).map(k=>k.replace('rainfall_','rain_').replace('_avg','_avg').replace('solar_Wm2','solar'));
        const values = Object.values(fi);
        mkChart('ml-fi-chart','bar',labels,[{
            label:'Importance',
            data:values,
            backgroundColor:values.map((v,i)=>`hsl(${200+i*20},70%,50%)`),
            borderRadius:3,
        }],{ indexAxis:'y', plugins:{legend:{display:false}} });

        // Actual vs predicted — fetch some forecast data for a small sample
        const fcRes = await fetch(`${API}/ml/forecast?scenario=SSP2-4.5&year_start=2025&year_end=2025`);
        const fcData = await fcRes.json();
        if (fcData.daily) {
            const sample = fcData.daily.slice(150, 250);
            mkChart('ml-avp-chart','line',
                sample.map(r=>r.date.slice(5)),
                [
                    {label:'Actual (NASA NEX-GDDP)',data:sample.map(r=>r.actual_mm||0),borderColor:'#4a90a4',pointRadius:0,tension:0.3,borderWidth:1.5},
                    {label:'RF Predicted',data:sample.map(r=>r.predicted_mm),borderColor:'#00d4ff',pointRadius:0,tension:0.3,borderWidth:2},
                ]
            );
        }
    } catch(e) { console.warn('ML info load error:', e); }
}

// ─── REPORT ─────────────────────────────────────────────────────────────────
function generateReport() {
    const el = document.getElementById('report-preview');
    if (!lastSimResult) { alert('Run a simulation first to generate a report.'); return; }
    const d = lastSimResult;
    const now = new Date().toLocaleString();
    const rc = riskColor(d.overall_risk_level);

    el.style.display = 'block';
    el.innerHTML = `
        <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;color:#111">
            <div style="border-bottom:3px solid #0070c0;padding-bottom:12px;margin-bottom:20px">
                <h1 style="font-size:22px;color:#0070c0;margin:0">Kukatpally Nala Flood DSS — Simulation Report</h1>
                <p style="margin:4px 0 0;color:#555;font-size:13px">GHMC Zone 12 | Hyderabad | Generated: ${now}</p>
            </div>

            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px">
                <tr style="background:#e8f4fb"><th colspan="4" style="padding:8px;text-align:left;color:#0070c0">Simulation Parameters</th></tr>
                <tr><td style="padding:6px 10px;border:1px solid #ddd;font-weight:600">Scenario</td><td style="padding:6px 10px;border:1px solid #ddd">${d.scenario}</td>
                    <td style="padding:6px 10px;border:1px solid #ddd;font-weight:600">Year Range</td><td style="padding:6px 10px;border:1px solid #ddd">${d.year_range}</td></tr>
                <tr><td style="padding:6px 10px;border:1px solid #ddd;font-weight:600">Total Days</td><td style="padding:6px 10px;border:1px solid #ddd">${d.total_days}</td>
                    <td style="padding:6px 10px;border:1px solid #ddd;font-weight:600">Catchment Area</td><td style="padding:6px 10px;border:1px solid #ddd">104.3 km² (GHMC Zone 12)</td></tr>
            </table>

            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px">
                <tr style="background:#e8f4fb"><th colspan="4" style="padding:8px;text-align:left;color:#0070c0">Key Results</th></tr>
                <tr><td style="padding:6px 10px;border:1px solid #ddd;font-weight:600">Total Rainfall</td><td style="padding:6px 10px;border:1px solid #ddd">${d.total_rainfall_mm.toFixed(1)} mm</td>
                    <td style="padding:6px 10px;border:1px solid #ddd;font-weight:600">Peak Discharge</td><td style="padding:6px 10px;border:1px solid #ddd">${d.peak_discharge_m3s.toFixed(2)} m³/s</td></tr>
                <tr><td style="padding:6px 10px;border:1px solid #ddd;font-weight:600">Overall Risk</td>
                    <td style="padding:6px 10px;border:1px solid #ddd;font-weight:700;color:${rc}">${d.overall_risk_level}</td>
                    <td style="padding:6px 10px;border:1px solid #ddd;font-weight:600">Peak Date</td><td style="padding:6px 10px;border:1px solid #ddd">${d.peak_date||'—'}</td></tr>
                <tr><td style="padding:6px 10px;border:1px solid #ddd;font-weight:600">Yellow Alert Days</td><td style="padding:6px 10px;border:1px solid #ddd">${d.alert_days.yellow}</td>
                    <td style="padding:6px 10px;border:1px solid #ddd;font-weight:600">Orange+Red Days</td><td style="padding:6px 10px;border:1px solid #ddd">${d.alert_days.orange+d.alert_days.red}</td></tr>
            </table>

            <h3 style="color:#0070c0;font-size:14px;border-bottom:1px solid #ddd;padding-bottom:4px">Sub-Basin Peak Discharge (Rational Method)</h3>
            <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px">
                <thead><tr style="background:#0070c0;color:#fff">
                    ${['Basin ID','Area (km²)','Runoff C','Intensity (mm/hr)','Peak Q (m³/s)','Q₂ yr','Q₅₀ yr','Risk'].map(h=>`<th style="padding:6px 8px;text-align:left">${h}</th>`).join('')}
                </tr></thead>
                <tbody>
                    ${(d.basin_summary||[]).map((b,i)=>`<tr style="background:${i%2?'#f5f9ff':'#fff'}">
                        <td style="padding:5px 8px;border:1px solid #ddd">${b.basin_id}</td>
                        <td style="padding:5px 8px;border:1px solid #ddd">${b.area_km2.toFixed(2)}</td>
                        <td style="padding:5px 8px;border:1px solid #ddd">${b.runoff_coeff}</td>
                        <td style="padding:5px 8px;border:1px solid #ddd">${b.rain_intensity_mmhr.toFixed(3)}</td>
                        <td style="padding:5px 8px;border:1px solid #ddd;font-weight:700">${b.discharge_m3s.toFixed(3)}</td>
                        <td style="padding:5px 8px;border:1px solid #ddd">${b.peak_2yr_m3s.toFixed(2)}</td>
                        <td style="padding:5px 8px;border:1px solid #ddd">${b.peak_50yr_m3s.toFixed(2)}</td>
                        <td style="padding:5px 8px;border:1px solid #ddd;font-weight:700;color:${riskColor(b.risk_level)}">${b.risk_level}</td>
                    </tr>`).join('')}
                </tbody>
            </table>

            <h3 style="color:#0070c0;font-size:14px;border-bottom:1px solid #ddd;padding-bottom:4px">Methodology</h3>
            <p style="font-size:12px;color:#333;line-height:1.7">
                <b>ML Prediction:</b> Random Forest Regressor (300 trees) trained on NASA NEX-GDDP CMIP6 data for all 4 SSP scenarios (2025–2050).
                Features: temperature, humidity, wind speed, solar radiation, rainfall lag-1/2/3, 3-day rolling average.
                Model R² = ${(window._mlMeta&&window._mlMeta.r2)||'0.962'}.<br>
                <b>Discharge:</b> Rational Method Q = 0.278 × C × i × A. Runoff coefficient C = 0.736 (urbanised Zone 12).
                Rainfall intensity converted from daily prediction using Kirpich Tc = 1.2 hr.
                Sub-basin areas from QGIS CartoDEM 30m analysis (17 basins, 104.3 km² total).<br>
                <b>Data sources:</b> NASA NEX-GDDP CMIP6, GHMC Zone 12 GIS, CartoDEM 30m DEM.
            </p>

            <div style="margin-top:20px;padding-top:10px;border-top:1px solid #ddd;font-size:11px;color:#777;text-align:center">
                Kukatpally Nala Flood DSS v3.0 — GHMC Zone 12 — Generated ${now}
            </div>
        </div>`;

    window.print();
}

// ─── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(injectIntegrationUI, 800);
});
