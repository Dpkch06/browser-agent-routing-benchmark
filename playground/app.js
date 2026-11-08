const taskIds = ['todomvc-add-complete', 'the-internet-login'];
const taskLabels = {
  'todomvc-add-complete': 'TodoMVC add and complete',
  'the-internet-login': 'The Internet practice login',
};
const strategyIds = [
  'deterministic-playwright',
  'jev-guided-playwright',
  'reasoning-model-playwright',
  'rule-based-router',
  'jev-router',
  'reasoning-model-router',
];
const strategyLabels = {
  'deterministic-playwright': 'Deterministic',
  'jev-guided-playwright': 'Jev-guided',
  'reasoning-model-playwright': 'Reasoning',
  'rule-based-router': 'Rule router',
  'jev-router': 'Jev router',
  'reasoning-model-router': 'Reasoning router',
};

const elements = {
  serverState: document.querySelector('#server-state'),
  serverStateLabel: document.querySelector('#server-state-label'),
  runButton: document.querySelector('#run-button'),
  runNote: document.querySelector('#run-note'),
  runSubtitle: document.querySelector('#run-subtitle'),
  progressCount: document.querySelector('#progress-count'),
  progressBar: document.querySelector('#progress-bar'),
  progressFill: document.querySelector('#progress-fill'),
  matrixBody: document.querySelector('#matrix-body'),
  notice: document.querySelector('#notice'),
  reportsCount: document.querySelector('#reports-count'),
  reportsList: document.querySelector('#reports-list'),
  refreshReports: document.querySelector('#refresh-reports'),
  reportContext: document.querySelector('#report-context'),
  reportKind: document.querySelector('#report-kind'),
  reportDetail: document.querySelector('#report-detail'),
  confirmDialog: document.querySelector('#confirm-dialog'),
  cancelRun: document.querySelector('#cancel-run'),
  confirmRun: document.querySelector('#confirm-run'),
};

let stateKind = 'idle';
let pollTimer = null;
let selectedFileName = null;
let selectedReport = null;
let submissionPending = false;
let reportIndex = [];
let missingSettings = [];

function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function setNotice(message, tone = '') {
  elements.notice.replaceChildren();
  elements.notice.className = 'notice' + (tone ? ' ' + tone : '');
  if (typeof message === 'string') {
    elements.notice.textContent = message;
  } else if (message && message.title) {
    elements.notice.append(make('div', '', message.title));
    if (Array.isArray(message.items) && message.items.length > 0) {
      const list = make('ul');
      for (const item of message.items) list.append(make('li', '', item));
      elements.notice.append(list);
    }
  }
  elements.notice.hidden = !message;
}

function renderEmptyMatrix(status = 'Queued') {
  const fragment = document.createDocumentFragment();
  for (const taskId of taskIds) {
    const row = make('tr');
    const heading = make('th', '', taskLabels[taskId]);
    heading.scope = 'row';
    row.append(heading);
    for (const strategyId of strategyIds) {
      const cell = make('td');
      const content = make('div', 'matrix-cell');
      content.dataset.status = status.toLowerCase();
      content.append(make('span', 'cell-status', status));
      content.append(make('span', 'cell-meta', 'No result selected'));
      cell.append(content);
      row.append(cell);
    }
    fragment.append(row);
  }
  elements.matrixBody.replaceChildren(fragment);
}

function executionKey(execution) {
  return execution.kind === 'direct' ? execution.strategyId : execution.routerId;
}

function routeDescription(execution) {
  if (execution.kind === 'direct') return 'Direct execution';
  if (execution.route.status === 'failed') return 'No strategy selected';
  return strategyLabels[execution.route.strategyId] || 'Strategy selected';
}

function resultStatus(result) {
  if (result.outcome.status === 'succeeded') return 'Verified';
  return 'Failed · ' + result.outcome.phase;
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return '—';
  return durationMs < 1000 ? durationMs + ' ms' : (durationMs / 1000).toFixed(1) + ' s';
}

function formatCount(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat().format(value) : '—';
}

function formatCost(value) {
  return Number.isFinite(value) ? '$' + value.toFixed(4) : '—';
}

function renderMatrix(report, liveState) {
  const resultByKey = new Map();
  if (report && Array.isArray(report.results)) {
    for (const result of report.results) {
      resultByKey.set(result.taskId + ':' + executionKey(result.execution), result);
    }
  } else if (Array.isArray(liveState?.completedCells)) {
    for (const result of liveState.completedCells) {
      resultByKey.set(result.taskId + ':' + executionKey(result.execution), result);
    }
  }
  const progress = liveState?.progress;
  const fragment = document.createDocumentFragment();
  for (const taskId of taskIds) {
    const row = make('tr');
    const heading = make('th', '', taskLabels[taskId]);
    heading.scope = 'row';
    row.append(heading);
    for (const strategyId of strategyIds) {
      const cell = make('td');
      const result = resultByKey.get(taskId + ':' + strategyId);
      const isCurrent = !report && progress && liveState.kind === 'running'
        && progress.taskId === taskId
        && executionKey(progress.execution) === strategyId;
      const content = make('div', 'matrix-cell');
      if (result) {
        const status = result.outcome.status === 'succeeded' ? 'succeeded' : 'failed';
        content.dataset.status = status;
        content.append(make('span', 'cell-status', resultStatus(result)));
        content.append(make('span', 'cell-meta', formatDuration(result.durationMs)));
        if (result.execution.kind === 'router') {
          content.append(make('span', 'cell-meta', routeDescription(result.execution)));
        }
      } else if (isCurrent) {
        content.dataset.status = 'running';
        content.append(make('span', 'cell-status', 'Running'));
        content.append(make('span', 'cell-meta', 'Cell ' + progress.index + ' of ' + (progress.total || 12)));
      } else {
        content.dataset.status = 'queued';
        content.append(make('span', 'cell-status', liveState?.kind === 'running' ? 'Queued' : 'No result'));
        content.append(make('span', 'cell-meta', liveState?.kind === 'running' ? 'Waiting' : '—'));
      }
      cell.append(content);
      row.append(cell);
    }
    fragment.append(row);
  }
  elements.matrixBody.replaceChildren(fragment);
}

function setProgress(liveState) {
  const progress = liveState?.progress;
  const safeTotal = Number.isFinite(progress?.total) && progress.total > 0 ? progress.total : 12;
  const reportedCompleted = Array.isArray(liveState?.completedCells) ? liveState.completedCells.length : 0;
  const safeCompleted = liveState?.kind === 'completed' && reportedCompleted === 0
    ? safeTotal
    : Math.max(0, Math.min(reportedCompleted, safeTotal));
  elements.progressCount.textContent = safeCompleted + ' / ' + safeTotal;
  elements.progressBar.setAttribute('aria-valuemax', String(safeTotal));
  elements.progressBar.setAttribute('aria-valuenow', String(safeCompleted));
  elements.progressFill.style.width = (safeCompleted / safeTotal * 100) + '%';
  if (liveState?.kind === 'running') {
    elements.runSubtitle.textContent = progress
      ? 'Cell ' + progress.index + ' of ' + safeTotal + ' is running. ' + safeCompleted + ' cells finished.'
      : 'Preparing the browser for the first cell.';
  } else if (liveState?.kind === 'completed') {
    elements.runSubtitle.textContent = 'Matrix run complete. Select its saved report to inspect outcomes.';
  } else if (liveState?.kind === 'failed') {
    elements.runSubtitle.textContent = 'The matrix run stopped. Check the notice and saved reports.';
  } else {
    elements.runSubtitle.textContent = 'No benchmark is running.';
  }
}

function setServerState(online, label) {
  elements.serverStateLabel.textContent = label;
  const dot = elements.serverState.querySelector('.state-dot');
  dot.classList.toggle('online', online);
  dot.classList.toggle('offline', !online);
}

function updateRunButton(kind, canStart) {
  stateKind = kind;
  const running = kind === 'running';
  elements.runButton.disabled = !canStart || running || submissionPending;
  if (running) {
    elements.runButton.textContent = 'Run in progress';
    elements.runNote.textContent = 'Wait for all 12 cells to finish before starting another run.';
  } else {
    elements.runButton.textContent = kind === 'completed' ? 'Start another full matrix' : 'Start full matrix';
    elements.runNote.textContent = canStart ? 'One run executes 12 cells and may use paid model calls.' : 'Provider configuration is missing or the local server is unavailable.';
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Accept: 'application/json', ...options.headers } });
  let body;
  try { body = await response.json(); } catch { body = {}; }
  return { response, body };
}

async function refreshStatus() {
  const { response, body } = await fetchJson('/api/status');
  if (!response.ok || !body.state) throw new Error('status_request_failed');
  const liveState = body.state;
  stateKind = liveState.kind;
  missingSettings = Array.isArray(body.requiredSettings) ? body.requiredSettings : [];
  const canStart = response.ok && liveState.kind !== 'running' && missingSettings.length === 0;
  setServerState(true, 'Local server connected');
  updateRunButton(liveState.kind, canStart);
  setProgress(liveState);
  if (liveState.kind === 'running') {
    renderMatrix(null, liveState);
    startPolling();
  } else if (selectedReport) {
    renderMatrix(selectedReport, liveState);
  } else {
    renderMatrix(null, liveState);
  }
  if (missingSettings.length > 0) {
    setNotice({ title: 'Provider configuration is incomplete. Add these settings to the local server environment before running the matrix.', items: missingSettings }, 'warning');
    updateRunButton(liveState.kind, false);
  }
  if (liveState.kind === 'completed' && !selectedReport && Array.isArray(body.recentReport)) {
    await loadReports();
  }
  return liveState;
}

function startPolling() {
  if (pollTimer !== null) return;
  pollTimer = window.setInterval(async () => {
    try {
      const status = await refreshStatus();
      if (status.kind !== 'running') {
        window.clearInterval(pollTimer);
        pollTimer = null;
        await loadReports();
        if (status.kind === 'completed' && reportIndex[0]) {
          await selectReport(reportIndex[0].fileName);
        }
      }
    } catch {
      window.clearInterval(pollTimer);
      pollTimer = null;
      setServerState(false, 'Local server connection lost');
      setNotice('Could not refresh run progress. Check that the local server is still running.', 'error');
    }
  }, 1000);
}

async function loadReports() {
  elements.reportsCount.textContent = 'Loading reports…';
  const { response, body } = await fetchJson('/api/reports');
  if (!response.ok || !Array.isArray(body.reports)) throw new Error('report_list_failed');
  reportIndex = body.reports;
  elements.reportsCount.textContent = reportIndex.length + (reportIndex.length === 1 ? ' report' : ' reports');
  renderReports();
}

function renderReports() {
  if (reportIndex.length === 0) {
    elements.reportsList.replaceChildren(make('p', 'empty-reports', 'No reports yet. Run the full matrix to save the first experiment.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const report of reportIndex) {
    const button = make('button', 'report-entry');
    button.type = 'button';
    button.setAttribute('aria-current', String(report.fileName === selectedFileName));
    button.dataset.fileName = report.fileName;
    const top = make('span', 'report-entry-top');
    top.append(make('span', 'report-entry-name', report.runId ? 'Run ' + report.runId.slice(0, 8) : report.fileName));
    const tag = make('span', 'report-tag' + (report.kind === 'measured' ? ' measured' : ''), report.kind === 'sample' ? 'Sample data' : 'Measured');
    top.append(tag);
    const bottom = make('span', 'report-entry-bottom');
    bottom.append(make('span', '', formatDate(report.startedAt)));
    bottom.append(make('span', '', formatCount(report.succeededCells) + ' / ' + formatCount(report.totalCells) + ' verified'));
    button.append(top, bottom);
    button.addEventListener('click', () => void selectReport(report.fileName));
    fragment.append(button);
  }
  elements.reportsList.replaceChildren(fragment);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

async function selectReport(fileName) {
  selectedFileName = fileName;
  renderReports();
  elements.reportContext.textContent = 'Loading saved report…';
  elements.reportDetail.replaceChildren(make('p', 'empty-detail', 'Reading the selected report.'));
  const { response, body } = await fetchJson('/api/reports/' + encodeURIComponent(fileName));
  if (!response.ok || !body.report) {
    elements.reportContext.textContent = 'Could not load this report.';
    elements.reportDetail.replaceChildren(make('p', 'empty-detail', 'The report file is missing or invalid. Refresh the report list and try again.'));
    return;
  }
  selectedReport = body.report;
  elements.reportKind.hidden = false;
  elements.reportKind.textContent = body.kind === 'sample' ? 'Synthetic sample' : 'Measured run';
  elements.reportContext.textContent = 'Run ' + selectedReport.runId + ' · ' + formatDate(selectedReport.startedAt);
  renderMatrix(selectedReport, { kind: 'completed' });
  renderReportDetails(selectedReport);
  renderReports();
}

function renderReportDetails(report) {
  const succeeded = report.results.filter((result) => result.outcome.status === 'succeeded').length;
  const modelCalls = report.results.reduce((sum, result) => sum + result.usage.modelCalls, 0);
  const totalDuration = report.results.reduce((sum, result) => sum + result.durationMs, 0);
  const tokens = report.results.reduce((sum, result) => sum + (result.usage.inputTokens || 0) + (result.usage.outputTokens || 0), 0);
  const summary = make('div', 'summary-grid');
  for (const [label, value] of [
    ['Verified cells', succeeded + ' / ' + report.results.length],
    ['Model calls', formatCount(modelCalls)],
    ['Total duration', formatDuration(totalDuration)],
    ['Reported tokens', formatCount(tokens)],
  ]) {
    const item = make('div', 'summary-item');
    item.append(make('span', '', label), make('strong', '', value));
    summary.append(item);
  }
  const wrapper = make('div', 'result-table-wrap');
  const table = make('table', 'result-table');
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  for (const label of ['Task', 'Approach', 'Selected route', 'Outcome', 'Duration', 'Calls', 'Usage']) header.append(make('th', '', label));
  head.append(header);
  const body = document.createElement('tbody');
  for (const result of report.results) {
    const row = document.createElement('tr');
    const executionLabel = strategyLabels[executionKey(result.execution)] || 'Router';
    const status = make('span', 'result-status ' + result.outcome.status, resultStatus(result));
    const usage = [
      result.usage.inputTokens === undefined ? null : formatCount(result.usage.inputTokens) + ' in',
      result.usage.outputTokens === undefined ? null : formatCount(result.usage.outputTokens) + ' out',
      result.usage.costUsd === undefined ? null : formatCost(result.usage.costUsd),
      result.usage.usagePartial ? 'partial' : null,
    ].filter(Boolean).join(' · ') || 'Not reported';
    const values = [taskLabels[result.taskId] || result.taskId, executionLabel, routeDescription(result.execution), status, formatDuration(result.durationMs), formatCount(result.usage.modelCalls), usage];
    for (const value of values) {
      const cell = document.createElement('td');
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  wrapper.append(table);
  const models = report.results.flatMap((result) => result.models || []);
  const modelBlock = make('p', 'model-list', models.length
    ? 'Models: ' + [...new Set(models.map((model) => model.provider + ' / ' + model.modelId + (model.version ? ' (' + model.version + ')' : '')))].join(', ')
    : 'No model metadata was reported for this run.');
  elements.reportDetail.className = 'report-detail';
  elements.reportDetail.replaceChildren(summary, wrapper, modelBlock);
}

function clearSelection() {
  selectedFileName = null;
  selectedReport = null;
  elements.reportKind.hidden = true;
  elements.reportContext.textContent = 'Choose a saved report to inspect its results.';
  elements.reportDetail.className = 'report-detail empty-detail';
  elements.reportDetail.replaceChildren(make('p', '', 'Report details will appear here after you select a run.'));
  renderReports();
}

async function startRun() {
  if (submissionPending || stateKind === 'running') return;
  submissionPending = true;
  updateRunButton(stateKind, false);
  elements.confirmRun.disabled = true;
  elements.confirmRun.textContent = 'Starting…';
  setNotice('Submitting the full matrix run to the local server…');
  try {
    const key = crypto.randomUUID();
    const { response, body } = await fetchJson('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ confirmPaidRun: true }),
    });
    if (response.status === 202) {
      setNotice('Benchmark run started. Progress will update as each cell finishes.', 'success');
      clearSelection();
      elements.confirmDialog.close();
      const startingState = { kind: 'running', completedCells: [], progress: null };
      renderMatrix(null, startingState);
      setProgress(startingState);
      await refreshStatus();
      startPolling();
      return;
    }
    if (response.status === 503 && body.error === 'provider_configuration_missing') {
      setNotice({ title: 'Provider configuration is incomplete. Add these settings to the local server environment, then try again.', items: body.requiredSettings || [] }, 'warning');
    } else if (response.status === 409) {
      setNotice(body.error === 'run_in_progress' ? 'A matrix run is already in progress.' : 'This submission was already received. Check the current run status before trying again.', 'warning');
    } else {
      setNotice('The local server rejected the run request. Refresh the page and try again.', 'error');
    }
    await refreshStatus().catch(() => undefined);
  } catch {
    setNotice('Could not reach the local server. Check that it is running, then try again.', 'error');
  } finally {
    submissionPending = false;
    elements.confirmRun.disabled = false;
    elements.confirmRun.textContent = 'Confirm and start';
    if (elements.confirmDialog.open && stateKind !== 'running') {
      updateRunButton(stateKind, missingSettings.length === 0);
    }
  }
}

elements.runButton.addEventListener('click', () => {
  if (stateKind === 'running') return;
  elements.confirmDialog.showModal();
});
elements.cancelRun.addEventListener('click', () => elements.confirmDialog.close());
elements.confirmRun.addEventListener('click', () => void startRun());
elements.refreshReports.addEventListener('click', () => {
  void loadReports().then(() => setNotice('Saved report list refreshed.', 'success')).catch(() => setNotice('Could not read saved reports. Check the local server and try again.', 'error'));
});

renderEmptyMatrix();
void Promise.all([refreshStatus(), loadReports()]).then(() => {
  if (stateKind !== 'running' && reportIndex[0]) return selectReport(reportIndex[0].fileName);
  if (missingSettings.length === 0) setNotice('Local benchmark server is ready. Start a run when you are ready to use provider calls.', '');
}).catch(() => {
  setServerState(false, 'Local server unavailable');
  updateRunButton('idle', false);
  elements.runSubtitle.textContent = 'Start the local playground server to load benchmark status.';
  elements.reportsCount.textContent = 'Could not load reports';
  elements.reportsList.replaceChildren(make('p', 'empty-reports', 'The local server is not available. Start it and refresh this page.'));
  setNotice('Could not connect to the local benchmark server. Start it with the project playground command, then refresh this page.', 'error');
});
