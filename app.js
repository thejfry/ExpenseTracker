const MONTH_NAMES = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
};
const currency = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const preciseCurrency = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFormat = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 });
const elements = {
  file: document.querySelector('#csv-file'),
  chooseFile: document.querySelector('#choose-file'),
  upload: document.querySelector('#upload-card'),
  status: document.querySelector('#status-message'),
  report: document.querySelector('#report'),
  print: document.querySelector('#print-report'),
  reportPeriod: document.querySelector('#report-period'),
  metrics: document.querySelector('#metric-grid'),
  cashFlow: document.querySelector('#cash-flow-chart'),
  insights: document.querySelector('#insight-grid'),
  categories: document.querySelector('#category-list'),
  sensitivity: document.querySelector('#sensitivity')
};
let reportData = null;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('The CSV contains a quoted field that was not closed.');
  row.push(field.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

function parseMonth(label) {
  const match = label.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match || !(match[1].toLowerCase() in MONTH_NAMES)) return null;
  const year = Number(match[2]);
  const month = MONTH_NAMES[match[1].toLowerCase()];
  return { label: `${match[1].slice(0, 3)} ${year}`, year, month, key: year * 12 + month };
}

function parseAmount(value, category) {
  const cleaned = value.trim().replace(/[$,\s]/g, '');
  const parenthesized = /^\(.*\)$/.test(cleaned);
  const numeric = Number(parenthesized ? cleaned.slice(1, -1) : cleaned);
  if (cleaned === '' || !Number.isFinite(numeric)) {
    throw new Error(`Could not read the monthly amount for “${category}”: “${value}”.`);
  }
  return parenthesized ? -numeric : numeric;
}

function parseReport(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('This file does not contain a category summary.');
  const header = rows[0];
  if (header[0]?.toLowerCase() !== 'category') throw new Error('The first CSV column must be named “Category”.');
  const months = header.slice(1).map((label, index) => ({ month: parseMonth(label), index: index + 1 })).filter(item => item.month);
  if (months.length < 2) throw new Error('Could not find at least two monthly columns. Expected headings such as “Jan 2026”.');
  for (let index = 1; index < months.length; index += 1) {
    if (months[index].month.key <= months[index - 1].month.key) throw new Error('Monthly columns must be in chronological order without duplicates.');
  }
  const categories = [];
  for (const row of rows.slice(1)) {
    const name = row[0]?.trim();
    if (!name || /^(total|average|count)$/i.test(name)) continue;
    const monthValues = months.map(({ index }) => parseAmount(row[index] ?? '', name));
    const total = monthValues.reduce((sum, amount) => sum + amount, 0);
    if (name.toLowerCase() === 'total' || name.toLowerCase() === 'average') continue;
    categories.push({
      name,
      values: monthValues,
      total,
      depth: name.split(':').length - 1,
      type: name.toLowerCase() === 'income' || name.toLowerCase().startsWith('income:') || total > 0 ? 'income' : 'expense'
    });
  }
  if (!categories.length) throw new Error('No category rows were found in this CSV.');
  const topLevel = categories.filter(item => item.depth === 0);
  const roots = topLevel.length ? topLevel : categories.filter(item => !item.name.includes(':'));
  return {
    months: months.map(item => item.month),
    categories,
    roots
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function periodAverage(category, start, end) {
  const range = category.values.slice(start, end).map(value => spendingAmount(category, value));
  return range.length ? sum(range) / range.length : 0;
}

function recentChange(category, data) {
  const end = data.months.length;
  if (end < 6) return null;
  const previous = periodAverage(category, end - 6, end - 3);
  const recent = periodAverage(category, end - 3, end);
  return { previous, recent, difference: recent - previous, percent: previous ? (recent - previous) / Math.abs(previous) * 100 : null };
}

function isPartialMonth(data) {
  const currentDate = new Date();
  const latest = data.months.at(-1);
  return latest.year === currentDate.getFullYear() && latest.month === currentDate.getMonth();
}

function spendingAmount(category, value) {
  return category.type === 'expense' ? Math.abs(value) : value;
}

function money(value, detailed = false) {
  return (detailed ? preciseCurrency : currency).format(value);
}

function percentage(value) {
  const rounded = Math.round(Math.abs(value));
  return `${value >= 0 ? '+' : '−'}${rounded}%`;
}

function createSvg(tag, attributes = {}, content = '') {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (content) node.textContent = content;
  return node;
}

function chartSvg(values, labels, options = {}) {
  const width = 720;
  const height = options.height ?? 170;
  const padding = { top: 10, right: 15, bottom: 27, left: 60 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 0);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const x = index => padding.left + (values.length === 1 ? plotWidth / 2 : index * plotWidth / (values.length - 1));
  const y = value => padding.top + (max - value) / span * plotHeight;
  const svg = createSvg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': options.ariaLabel || 'Monthly amounts chart' });
  const ticks = 4;
  for (let index = 0; index <= ticks; index += 1) {
    const value = max - span * index / ticks;
    const yPos = y(value);
    svg.append(createSvg('line', { x1: padding.left, x2: width - padding.right, y1: yPos, y2: yPos, class: Math.abs(value) < span / ticks / 2 ? 'chart-zero' : 'chart-gridline' }));
    const tick = options.moneyAxis ? money(value) : numberFormat.format(value);
    svg.append(createSvg('text', { x: padding.left - 9, y: yPos + 3, 'text-anchor': 'end', class: 'chart-label' }, tick));
  }
  labels.forEach((label, index) => {
    if (labels.length > 8 && index % 2 === 1) return;
    svg.append(createSvg('text', { x: x(index), y: height - 6, 'text-anchor': 'middle', class: 'chart-label' }, label));
  });
  const path = values.map((value, index) => `${index ? 'L' : 'M'}${x(index)},${y(value)}`).join(' ');
  if (options.area && values.length > 1) {
    const baseline = y(0);
    svg.append(createSvg('path', { d: `${path} L${x(values.length - 1)},${baseline} L${x(0)},${baseline} Z`, class: 'chart-area' }));
  }
  svg.append(createSvg('path', { d: path, class: 'chart-line' }));
  values.forEach((value, index) => {
    svg.append(createSvg('circle', { cx: x(index), cy: y(value), r: 3.5, class: 'chart-point' }));
  });
  return svg;
}

function renderCashFlow(data) {
  const income = data.months.map((_, index) => sum(data.categories.filter(item => item.type === 'income' && !item.name.includes(':')).map(item => item.values[index])));
  const expenses = data.months.map((_, index) => sum(data.categories.filter(item => item.type === 'expense' && !item.name.includes(':')).map(item => item.values[index])));
  const net = income.map((amount, index) => amount + expenses[index]);
  const chart = chartSvg(net, data.months.map(item => item.label), { moneyAxis: true, area: true, ariaLabel: 'Monthly net cash flow in Canadian dollars' });
  elements.cashFlow.replaceChildren(chart);
}

function getMetrics(data) {
  const count = data.months.length;
  const lastMonth = count - 1;
  const incomeCategories = data.categories.filter(item => item.type === 'income' && !item.name.includes(':'));
  const expenseCategories = data.categories.filter(item => item.type === 'expense' && !item.name.includes(':'));
  const income = incomeCategories.reduce((total, category) => total + category.values[lastMonth], 0);
  const expenses = expenseCategories.reduce((total, category) => total + Math.abs(category.values[lastMonth]), 0);
  const netLast = income - expenses;
  const allIncome = incomeCategories.reduce((total, category) => total + sum(category.values), 0);
  const allExpenses = expenseCategories.reduce((total, category) => total + Math.abs(sum(category.values)), 0);
  const outflow = data.categories.filter(item => item.type === 'expense' && item.depth === 0).map(item => ({ name: item.name, amount: Math.abs(item.values[lastMonth]) })).filter(item => item.amount > 0).sort((a, b) => b.amount - a.amount);
  return { income, expenses, netLast, allIncome, allExpenses, outflow };
}

function renderMetrics(data) {
  const metrics = getMetrics(data);
  const cards = [
    { label: 'Income · latest month', value: money(metrics.income), sub: 'Across income categories' },
    { label: 'Spending · latest month', value: money(metrics.expenses), sub: 'Across expense categories' },
    { label: 'Net cash flow · latest month', value: money(metrics.netLast), sub: metrics.netLast >= 0 ? 'More came in than went out' : 'More went out than came in', className: metrics.netLast < 0 ? 'positive-change' : '' },
    { label: 'Average monthly spending', value: money(metrics.allExpenses / data.months.length), sub: `Across ${data.months.length} months` }
  ];
  elements.metrics.replaceChildren(...cards.map(card => {
    const element = document.createElement('div');
    element.className = 'metric-card';
    const label = document.createElement('div');
    label.className = 'metric-label';
    label.textContent = card.label;
    const value = document.createElement('div');
    value.className = `metric-value ${card.className || ''}`;
    value.textContent = card.value;
    const sub = document.createElement('div');
    sub.className = 'metric-sub';
    sub.textContent = card.sub;
    element.append(label, value, sub);
    return element;
  }));
}

function renderInsights(data) {
  const candidates = data.roots.filter(category => category.name.toLowerCase() !== 'total');
  const changes = candidates.map(category => ({ category, change: recentChange(category, data) })).filter(item => item.change);
  const spendingChanges = changes.filter(item => item.category.type === 'expense');
  const highest = spendingChanges.filter(item => item.change.difference > 0).sort((a, b) => b.change.difference - a.change.difference)[0];
  const declining = spendingChanges.filter(item => item.change.difference < 0).sort((a, b) => a.change.difference - b.change.difference)[0];
  const income = changes.filter(item => item.category.type === 'income').sort((a, b) => b.change.difference - a.change.difference)[0];
  const selected = [
    highest && { title: 'Largest spending increase', ...highest, kind: 'spending' },
    declining && { title: 'Spending easing', ...declining, kind: 'spending' },
    income && { title: 'Income movement', ...income, kind: 'income' }
  ].filter(Boolean);
  elements.insights.replaceChildren();
  if (!selected.length) {
    const empty = document.createElement('div');
    empty.className = 'insight-empty';
    empty.textContent = data.months.length < 6 ? 'Add at least six months of history to compare recent and previous three-month periods.' : 'There are no category changes to highlight across these periods.';
    elements.insights.append(empty);
    return;
  }
  for (const insight of selected) {
    const card = document.createElement('div');
    card.className = 'insight-card';
    const title = document.createElement('div');
    title.className = 'insight-title';
    title.textContent = insight.title;
    const name = document.createElement('div');
    name.className = 'insight-category';
    name.textContent = insight.category.name;
    const detail = document.createElement('div');
    const favorable = insight.kind === 'spending' ? insight.change.difference < 0 : insight.change.difference > 0;
    detail.className = `insight-detail ${favorable ? 'negative-change' : 'positive-change'}`;
    const diff = Math.abs(insight.change.difference);
    const percent = insight.change.percent === null ? '' : ` (${percentage(insight.change.percent)})`;
    detail.textContent = `${money(insight.change.recent)} monthly avg. · ${insight.change.difference >= 0 ? '+' : '−'}${money(diff)} vs previous${percent}`;
    card.append(title, name, detail);
    elements.insights.append(card);
  }
}

function categoryAlert(category, data, threshold) {
  if (category.type !== 'expense') return null;
  const index = data.months.length - 1;
  const baselineStart = Math.max(0, index - 3);
  const baseline = periodAverage(category, baselineStart, index);
  const current = Math.abs(category.values[index]);
  if (index === 0 || baselineStart === index || baseline <= 0) return null;
  const increase = current - baseline;
  if (increase >= Math.max(50, baseline * threshold / 100)) return { current, baseline, increase, partial: isPartialMonth(data) };
  return null;
}

function sustainedChange(category, data, threshold) {
  const change = recentChange(category, data);
  if (!change || change.recent <= 0 || change.previous <= 0 || category.type !== 'expense') return false;
  return change.difference >= Math.max(100, change.previous * threshold / 100);
}

function sparkline(values) {
  const width = 150;
  const height = 27;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values.map((value, index) => `${values.length === 1 ? width / 2 : index / (values.length - 1) * width},${height - 2 - (value - min) / range * (height - 4)}`).join(' ');
  const svg = createSvg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'category-sparkline', 'aria-hidden': 'true' });
  svg.append(createSvg('polyline', { points, fill: 'none', stroke: values.at(-1) > values[0] ? '#ba7466' : '#6d9b7b', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return svg;
}

function createCategoryRow(category, children, data, sensitivity) {
  const summary = recentChange(category, data);
  const latestAmount = spendingAmount(category, category.values.at(-1));
  const favorableIncrease = category.type === 'income';
  const changeClass = summary && summary.difference > 0 ? (favorableIncrease ? 'down' : 'up') : summary && summary.difference < 0 ? (favorableIncrease ? 'up' : 'down') : '';
  const row = document.createElement('details');
  row.className = 'category-row';
  const summaryElement = document.createElement('summary');
  summaryElement.className = 'category-summary';
  const name = document.createElement('span');
  name.className = `category-name ${category.depth ? 'indented' : ''}`;
  const chevron = document.createElement('span');
  chevron.className = 'category-chevron';
  chevron.textContent = children.length ? '›' : '';
  const text = document.createElement('span');
  text.textContent = category.depth ? category.name.split(':').at(-1).trim() : category.name;
  name.append(chevron, text);
  const values = category.type === 'expense' ? category.values.map(value => Math.abs(value)) : category.values;
  const value = document.createElement('span');
  value.className = 'category-value';
  value.textContent = `${money(latestAmount)} latest`;
  const delta = document.createElement('span');
  delta.className = `category-change ${changeClass}`;
  delta.textContent = summary ? `${summary.difference >= 0 ? '+' : '−'}${money(Math.abs(summary.difference))} avg.` : '—';
  summaryElement.append(name, sparkline(values), value, delta);
  row.append(summaryElement);

  const alert = categoryAlert(category, data, sensitivity);
  const sustained = sustainedChange(category, data, sensitivity);
  if (alert || sustained) {
    const badges = document.createElement('span');
    badges.className = `${alert ? 'alert-badge' : ''}${alert && sustained ? ' ' : ''}${sustained ? 'sustained-badge' : ''}`;
    badges.textContent = [alert ? 'HIGH MONTH' : '', sustained ? 'SUSTAINED INCREASE' : ''].filter(Boolean).join(' · ');
    name.append(badges);
  }

  const detail = document.createElement('div');
  detail.className = 'detail-chart';
  const detailTitle = document.createElement('div');
  detailTitle.className = 'detail-chart-title';
  const recentAverage = summary ? ` · recent avg. ${money(summary.recent)}` : '';
  const alertNote = alert ? ` · ${money(alert.current)} this month vs ${money(alert.baseline)} recent avg.${alert.partial ? ' · current month may be incomplete' : ''}` : '';
  detailTitle.textContent = `${category.type === 'expense' ? 'Spending' : 'Income'} by month${recentAverage}${alertNote}`;
  detail.append(detailTitle, chartSvg(values, data.months.map(item => item.label), { height: 125, moneyAxis: true, ariaLabel: `${category.name} monthly ${category.type}` }));
  if (children.length) {
    const childList = document.createElement('div');
    childList.className = 'category-children';
    for (const child of children) childList.append(createCategoryRow(child.category, child.children, data, sensitivity));
    detail.append(childList);
  }
  row.append(detail);
  return row;
}

function renderCategories(data) {
  const sensitivity = Number(elements.sensitivity.value);
  const categoryByName = new Map(data.categories.map(category => [category.name, category]));
  const childrenByName = new Map();
  const roots = [];
  for (const category of data.categories) {
    let parentName = category.name.includes(':') ? category.name.slice(0, category.name.lastIndexOf(':')).trim() : '';
    while (parentName && !categoryByName.has(parentName) && parentName.includes(':')) {
      parentName = parentName.slice(0, parentName.lastIndexOf(':')).trim();
    }
    if (parentName && categoryByName.has(parentName)) {
      const children = childrenByName.get(parentName) || [];
      children.push(category);
      childrenByName.set(parentName, children);
    } else {
      roots.push(category);
    }
  }
  const buildTree = category => ({
    category,
    children: (childrenByName.get(category.name) || [])
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(buildTree)
  });
  elements.categories.replaceChildren(...roots
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(category => {
      const tree = buildTree(category);
      return createCategoryRow(tree.category, tree.children, data, sensitivity);
    }));
}

function render() {
  const data = reportData;
  if (!data) return;
  elements.report.hidden = false;
  elements.print.disabled = false;
  elements.reportPeriod.textContent = `${data.months[0].label} — ${data.months.at(-1).label}${isPartialMonth(data) ? ' · latest month may be incomplete' : ''}`;
  renderMetrics(data);
  renderCashFlow(data);
  renderInsights(data);
  renderCategories(data);
}

async function loadFile(file) {
  elements.status.hidden = true;
  if (!file) return;
  reportData = null;
  elements.report.hidden = true;
  elements.print.disabled = true;
  if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
    elements.status.textContent = 'Please choose a CSV file exported from your budgeting app.';
    elements.status.hidden = false;
    return;
  }
  try {
    const parsed = parseReport(await file.text());
    reportData = parsed;
    render();
    elements.report.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : 'The CSV could not be read. Check the file and try again.';
    elements.status.hidden = false;
  }
}

elements.chooseFile.addEventListener('click', () => elements.file.click());
elements.file.addEventListener('change', event => {
  const file = event.target.files?.[0];
  elements.file.value = '';
  loadFile(file);
});
elements.print.addEventListener('click', () => window.print());
document.querySelector('#upload-another').addEventListener('click', () => {
  elements.file.click();
});
elements.sensitivity.addEventListener('change', () => renderCategories(reportData));

for (const eventName of ['dragenter', 'dragover']) {
  elements.upload.addEventListener(eventName, event => {
    event.preventDefault();
    elements.upload.classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  elements.upload.addEventListener(eventName, event => {
    event.preventDefault();
    elements.upload.classList.remove('dragging');
  });
}
elements.upload.addEventListener('drop', event => {
  const file = event.dataTransfer.files[0];
  if (file) loadFile(file);
});
