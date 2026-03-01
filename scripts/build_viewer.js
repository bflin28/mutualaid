/**
 * Reads slack_history_parsed.jsonl and generates a self-contained viewer.html
 * Usage: node scripts/build_viewer.js
 */
import { readFileSync, writeFileSync } from 'fs'

const lines = readFileSync('slack_history_parsed.jsonl', 'utf8').split('\n').filter(Boolean)
const records = lines.map(l => JSON.parse(l))

// Compute summary stats
const totalLbs = Math.round(records.reduce((s, r) => s + r.total_estimated_lbs, 0))
const locations = [...new Set(records.map(r => r.rescue_location_name))].sort()
const dropOffs = [...new Set(records.filter(r => r.drop_off_location_name).map(r => r.drop_off_location_name))].sort()
const classifications = [...new Set(records.map(r => r.classification))].sort()
const categories = [...new Set(records.flatMap(r => r.items.map(i => i.gcfd_category)).filter(Boolean))].sort()

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Slack History Viewer — ${records.length} Records</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; }

  .header { background: #16a34a; color: white; padding: 20px 24px; position: sticky; top: 0; z-index: 100; }
  .header h1 { font-size: 20px; font-weight: 600; }
  .header .stats { font-size: 13px; opacity: 0.9; margin-top: 4px; }

  .filters { background: white; border-bottom: 1px solid #e2e8f0; padding: 12px 24px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; position: sticky; top: 68px; z-index: 99; }
  .filters label { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
  .filters select, .filters input { font-size: 13px; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; }
  .filters select { min-width: 160px; }
  .filters input[type="text"] { min-width: 200px; }
  .filter-group { display: flex; flex-direction: column; gap: 2px; }
  .result-count { font-size: 13px; color: #64748b; margin-left: auto; white-space: nowrap; }

  .container { max-width: 1200px; margin: 0 auto; padding: 16px 24px; }

  .record { background: white; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
  .record-header { padding: 12px 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; cursor: pointer; }
  .record-header:hover { background: #f8fafc; }
  .record-header .date { font-size: 13px; color: #64748b; min-width: 90px; }
  .record-header .location { font-weight: 600; font-size: 14px; }
  .record-header .dropoff { font-size: 13px; color: #7c3aed; }
  .record-header .lbs { font-size: 13px; color: #16a34a; font-weight: 600; margin-left: auto; white-space: nowrap; }
  .record-header .classification { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: #f1f5f9; color: #64748b; }
  .record-header .item-count { font-size: 12px; color: #94a3b8; }

  .record-body { display: none; border-top: 1px solid #e2e8f0; }
  .record.open .record-body { display: block; }

  .items-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .items-table th { text-align: left; padding: 8px 16px; background: #f8fafc; color: #64748b; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  .items-table td { padding: 6px 16px; border-top: 1px solid #f1f5f9; }
  .items-table tr:hover td { background: #f8fafc; }

  .raw-text { padding: 12px 16px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
  .raw-text summary { font-size: 12px; color: #64748b; cursor: pointer; font-weight: 600; }
  .raw-text pre { margin-top: 8px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; color: #475569; background: white; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; max-height: 300px; overflow-y: auto; }

  .badge { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 4px; font-weight: 500; }
  .badge-green { background: #dcfce7; color: #166534; }
  .badge-blue { background: #dbeafe; color: #1e40af; }
  .badge-purple { background: #ede9fe; color: #5b21b6; }
  .badge-orange { background: #ffedd5; color: #9a3412; }
  .badge-red { background: #fee2e2; color: #991b1b; }
  .badge-gray { background: #f1f5f9; color: #475569; }

  .summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .summary-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
  .summary-card .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  .summary-card .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
  .summary-card.green .value { color: #16a34a; }
  .summary-card.blue .value { color: #2563eb; }
  .summary-card.purple .value { color: #7c3aed; }
  .summary-card.orange .value { color: #ea580c; }

  .pagination { display: flex; gap: 8px; justify-content: center; padding: 20px; }
  .pagination button { padding: 8px 16px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; cursor: pointer; font-size: 13px; }
  .pagination button:hover { background: #f1f5f9; }
  .pagination button.active { background: #16a34a; color: white; border-color: #16a34a; }
  .pagination button:disabled { opacity: 0.4; cursor: not-allowed; }

  .expand-all { font-size: 12px; color: #2563eb; cursor: pointer; background: none; border: none; text-decoration: underline; }
</style>
</head>
<body>

<div class="header">
  <h1>CFSC Slack History — Parsed Food Logs</h1>
  <div class="stats">${records.length.toLocaleString()} records · ${totalLbs.toLocaleString()} estimated lbs · ${locations.length} rescue locations · ${dropOffs.length} drop-off destinations</div>
</div>

<div class="filters">
  <div class="filter-group">
    <label>Rescue Location</label>
    <select id="filterLocation">
      <option value="">All locations</option>
      ${locations.map(l => `<option value="${l.replace(/"/g, '&quot;')}">${l}</option>`).join('\n      ')}
    </select>
  </div>
  <div class="filter-group">
    <label>Drop-off</label>
    <select id="filterDropOff">
      <option value="">All drop-offs</option>
      ${dropOffs.map(l => `<option value="${l.replace(/"/g, '&quot;')}">${l}</option>`).join('\n      ')}
    </select>
  </div>
  <div class="filter-group">
    <label>Classification</label>
    <select id="filterClassification">
      <option value="">All types</option>
      ${classifications.map(c => `<option value="${c}">${c}</option>`).join('\n      ')}
    </select>
  </div>
  <div class="filter-group">
    <label>Category</label>
    <select id="filterCategory">
      <option value="">All categories</option>
      ${categories.map(c => `<option value="${c}">${c}</option>`).join('\n      ')}
    </select>
  </div>
  <div class="filter-group">
    <label>Search raw text</label>
    <input type="text" id="filterText" placeholder="Search...">
  </div>
  <button class="expand-all" onclick="toggleAll()">Expand/Collapse All</button>
  <div class="result-count" id="resultCount"></div>
</div>

<div class="container">
  <div class="summary-cards" id="summaryCards"></div>
  <div id="recordList"></div>
  <div class="pagination" id="pagination"></div>
</div>

<script>
const DATA = ${JSON.stringify(records)};
const PAGE_SIZE = 50;
let filtered = DATA;
let page = 0;
let allExpanded = false;

function applyFilters() {
  const loc = document.getElementById('filterLocation').value;
  const drop = document.getElementById('filterDropOff').value;
  const cls = document.getElementById('filterClassification').value;
  const cat = document.getElementById('filterCategory').value;
  const text = document.getElementById('filterText').value.toLowerCase();

  filtered = DATA.filter(r => {
    if (loc && r.rescue_location_name !== loc) return false;
    if (drop && r.drop_off_location_name !== drop) return false;
    if (cls && r.classification !== cls) return false;
    if (cat && !r.items.some(i => i.gcfd_category === cat)) return false;
    if (text && !r.raw_text.toLowerCase().includes(text)) return false;
    return true;
  });

  page = 0;
  render();
}

function render() {
  const totalLbs = Math.round(filtered.reduce((s, r) => s + r.total_estimated_lbs, 0));
  const totalItems = filtered.reduce((s, r) => s + r.items.length, 0);

  // Summary cards
  const catBreakdown = {};
  filtered.forEach(r => r.items.forEach(i => {
    const c = i.gcfd_category || 'Uncategorized';
    catBreakdown[c] = (catBreakdown[c] || 0) + (i.estimated_lbs || 0);
  }));

  document.getElementById('summaryCards').innerHTML = \`
    <div class="summary-card green"><div class="label">Total Estimated Lbs</div><div class="value">\${totalLbs.toLocaleString()}</div></div>
    <div class="summary-card blue"><div class="label">Food Logs</div><div class="value">\${filtered.length.toLocaleString()}</div></div>
    <div class="summary-card purple"><div class="label">Total Items Parsed</div><div class="value">\${totalItems.toLocaleString()}</div></div>
    <div class="summary-card orange"><div class="label">Avg Lbs/Log</div><div class="value">\${filtered.length ? Math.round(totalLbs / filtered.length).toLocaleString() : 0}</div></div>
  \`;

  document.getElementById('resultCount').textContent = \`\${filtered.length} of \${DATA.length} records\`;

  // Records
  const start = page * PAGE_SIZE;
  const pageData = filtered.slice(start, start + PAGE_SIZE);

  document.getElementById('recordList').innerHTML = pageData.map((r, idx) => {
    const globalIdx = start + idx + 1;
    const date = (r.rescued_at || '').slice(0, 10);
    const items = r.items;
    const dropLabel = r.drop_off_location_name ? \` → \${r.drop_off_location_name}\` : '';

    const clsBadge = {
      'warehouse_distribution': 'badge-purple',
      'explicit_rescue': 'badge-green',
      'implicit_rescue': 'badge-blue',
      'taker_mentioned': 'badge-purple',
      'taker_listed_items': 'badge-purple',
      'warehouse_inventory': 'badge-orange',
      'warehouse_drop': 'badge-orange',
      'dropped_location': 'badge-green',
      'generic_aldi': 'badge-blue',
      'unknown': 'badge-red',
    }[r.classification] || 'badge-gray';

    return \`<div class="record\${allExpanded ? ' open' : ''}" id="rec-\${globalIdx}">
      <div class="record-header" onclick="this.parentElement.classList.toggle('open')">
        <span class="date">\${date}</span>
        <span class="location">\${r.rescue_location_name}</span>
        <span class="dropoff">\${dropLabel}</span>
        <span class="badge \${clsBadge}">\${r.classification}</span>
        <span class="item-count">\${items.length} items</span>
        <span class="lbs">\${Math.round(r.total_estimated_lbs).toLocaleString()} lbs</span>
      </div>
      <div class="record-body">
        <table class="items-table">
          <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Category</th><th>Est. Lbs</th></tr></thead>
          <tbody>
            \${items.map(i => \`<tr>
              <td>\${esc(i.name)}</td>
              <td>\${i.quantity}</td>
              <td>\${i.unit}</td>
              <td><span class="badge badge-gray">\${i.gcfd_category || '—'}</span></td>
              <td>\${i.estimated_lbs != null ? Math.round(i.estimated_lbs) : '—'}</td>
            </tr>\`).join('')}
          </tbody>
        </table>
        <div class="raw-text">
          <details>
            <summary>Raw Slack text</summary>
            <pre>\${esc(r.raw_text)}</pre>
          </details>
        </div>
      </div>
    </div>\`;
  }).join('');

  // Pagination
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  if (totalPages > 1) {
    let btns = '';
    btns += \`<button \${page === 0 ? 'disabled' : ''} onclick="goPage(\${page - 1})">← Prev</button>\`;

    const range = [];
    for (let i = 0; i < totalPages; i++) {
      if (i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 2) {
        range.push(i);
      } else if (range[range.length - 1] !== -1) {
        range.push(-1);
      }
    }
    for (const i of range) {
      if (i === -1) {
        btns += '<button disabled>…</button>';
      } else {
        btns += \`<button class="\${i === page ? 'active' : ''}" onclick="goPage(\${i})">\${i + 1}</button>\`;
      }
    }

    btns += \`<button \${page >= totalPages - 1 ? 'disabled' : ''} onclick="goPage(\${page + 1})">Next →</button>\`;
    document.getElementById('pagination').innerHTML = btns;
  } else {
    document.getElementById('pagination').innerHTML = '';
  }
}

function goPage(p) {
  page = p;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleAll() {
  allExpanded = !allExpanded;
  document.querySelectorAll('.record').forEach(el => {
    if (allExpanded) el.classList.add('open');
    else el.classList.remove('open');
  });
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Wire up filters
['filterLocation', 'filterDropOff', 'filterClassification', 'filterCategory'].forEach(id => {
  document.getElementById(id).addEventListener('change', applyFilters);
});
document.getElementById('filterText').addEventListener('input', debounce(applyFilters, 300));

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Initial render
render();
</script>
</body>
</html>`;

writeFileSync('viewer.html', html)
console.log(`Generated viewer.html (${(html.length / 1024).toFixed(0)} KB) with ${records.length} records`)
console.log('Open in browser: file://' + process.cwd().replace(/\\/g, '/') + '/viewer.html')
