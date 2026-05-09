let dailyChart = null;
let hourlyChart = null;
let anomalyTimelineChart = null;
let badPostureHourChart = null;
let badTypeChart = null;

async function loadTemporalAnalysis() {
  const res = await fetch("/api/ml/temporal");
  const data = await res.json();

  document.getElementById("mlAvgScore").textContent =
    `${data.summary.average_score}/100`;

  document.getElementById("mlTrendStatus").textContent =
    data.summary.trend_status;

  document.getElementById("mlBestHour").textContent =
    `${data.summary.best_hour}:00`;

  document.getElementById("mlWorstHour").textContent =
    `${data.summary.worst_hour}:00`;

  renderDailyChart(data.daily.labels, data.daily.values);
  renderHourlyChart(data.hourly.labels, data.hourly.values);
}

function renderDailyChart(labels, values) {
  const ctx = document.getElementById("dailyTrendChart");

  if (dailyChart) dailyChart.destroy();

  dailyChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Average Posture Score",
        data: values,
        tension: 0.35,
        fill: true,
        borderColor: "#2563eb",
        backgroundColor: "rgba(37,99,235,.12)"
      }]
    },
    options: {
      scales: {
        y: { min: 0, max: 100 }
      }
    }
  });
}

function renderHourlyChart(labels, values) {
  const ctx = document.getElementById("hourlyTrendChart");

  if (hourlyChart) hourlyChart.destroy();

  hourlyChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Average Score by Hour",
        data: values,
        backgroundColor: "#2563eb"
      }]
    },
    options: {
      scales: {
        y: { min: 0, max: 100 }
      }
    }
  });
}

let distanceScatterChart = null;

async function loadCorrelationAnalysis() {
  try {
    const res = await fetch("/api/ml/correlation");
    const data = await res.json();

    if (data.error) {
      console.error("Correlation API error:", data.error);
      return;
    }

    updateCorrelationKpis(data.top_relationships || []);
    renderCorrelationHeatmap(data.matrix.labels, data.matrix.values);
    renderCorrelationTable(data.top_relationships || []);

    if (data.scatter && data.scatter.distance_vs_score) {
      renderDistanceScatter(data.scatter.distance_vs_score);
    }

  } catch (error) {
    console.error("Correlation analysis loading error:", error);
  }
}

function updateCorrelationKpis(relationships) {
  if (!relationships.length) return;

  const top = relationships[0];

  document.getElementById("strongestFeature").textContent =
    formatFeatureName(top.feature);

  document.getElementById("strongestCorrelation").textContent =
    top.correlation;

  document.getElementById("relationshipType").textContent =
    top.direction;

  document.getElementById("relationshipStrength").textContent =
    top.strength;
}

function renderCorrelationHeatmap(labels, matrix) {
  const container = document.getElementById("correlationHeatmap");
  container.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "corr-grid";
  grid.style.gridTemplateColumns = `140px repeat(${labels.length}, 70px)`;

  const empty = document.createElement("div");
  empty.className = "corr-cell corr-header";
  grid.appendChild(empty);

  labels.forEach(label => {
    const header = document.createElement("div");
    header.className = "corr-cell corr-header";
    header.textContent = shortFeatureName(label);
    header.title = formatFeatureName(label);
    grid.appendChild(header);
  });

  matrix.forEach((row, rowIndex) => {
    const rowHeader = document.createElement("div");
    rowHeader.className = "corr-cell corr-row-header";
    rowHeader.textContent = shortFeatureName(labels[rowIndex]);
    rowHeader.title = formatFeatureName(labels[rowIndex]);
    grid.appendChild(rowHeader);

    row.forEach(value => {
      const cell = document.createElement("div");
      cell.className = "corr-cell";
      cell.textContent = value;

      if (value >= 0.7) {
        cell.classList.add("corr-pos-strong");
      } else if (value >= 0.4) {
        cell.classList.add("corr-pos-mid");
      } else if (value <= -0.7) {
        cell.classList.add("corr-neg-strong");
      } else if (value <= -0.4) {
        cell.classList.add("corr-neg-mid");
      } else {
        cell.classList.add("corr-weak");
      }

      grid.appendChild(cell);
    });
  });

  container.appendChild(grid);
}

function renderCorrelationTable(relationships) {
  const tbody = document.getElementById("correlationTableBody");
  tbody.innerHTML = "";

  if (!relationships.length) {
    tbody.innerHTML = `<tr><td colspan="5">No correlation results available.</td></tr>`;
    return;
  }

  relationships.forEach(item => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${formatFeatureName(item.feature)}</td>
      <td>${item.correlation}</td>
      <td>${item.direction}</td>
      <td>${item.strength}</td>
      <td>${item.interpretation}</td>
    `;

    tbody.appendChild(tr);
  });
}

function renderDistanceScatter(scatterData) {
  const ctx = document.getElementById("distanceScatterChart");
  ctx.style.height = "320px";
  ctx.style.maxHeight = "320px";

  if (distanceScatterChart) {
    distanceScatterChart.destroy();
  }

  distanceScatterChart = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [{
        label: "Distance vs Posture Score",
        data: scatterData.points,
        backgroundColor: "#2563eb"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: {
            display: true,
            text: scatterData.x_label
          }
        },
        y: {
          min: 0,
          max: 100,
          title: {
            display: true,
            text: scatterData.y_label
          }
        }
      }
    }
  });
}

function formatFeatureName(value) {
  if (!value) return "--";

  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function shortFeatureName(value) {
  const names = {
    fsr1_adc: "FSR1",
    fsr2_adc: "FSR2",
    fsr3_adc: "FSR3",
    fsr4_adc: "FSR4",
    distance_cm: "Dist",
    accel_x: "Acc X",
    accel_y: "Acc Y",
    accel_z: "Acc Z",
    seat_balance_lr: "LR",
    seat_balance_fb: "FB",
    total_force_g: "Force",
    total_pressure_kpa: "Pressure",
    posture_score: "Score"
  };

  return names[value] || value;
}

async function loadAnomalyAnalysis() {
  try {
    const res = await fetch("/api/ml/anomalies");
    const data = await res.json();

    console.log("Anomaly data:", data);

    if (data.error) {
      console.error("Anomaly API error:", data.error);

      document.getElementById("anomalyModel").textContent = "Error";
      document.getElementById("anomalyTotal").textContent = "--";
      document.getElementById("anomalyCount").textContent = "--";
      document.getElementById("anomalyRate").textContent = "--";

      return;
    }

    updateAnomalyKpis(data.summary);
    renderCompactAnomalyTimeline(data.timeline || []);

  } catch (error) {
    console.error("Anomaly analysis loading error:", error);
  }
}

function updateAnomalyKpis(summary) {
  document.getElementById("anomalyModel").textContent = summary.model;
  document.getElementById("anomalyTotal").textContent = summary.total_records;
  document.getElementById("anomalyCount").textContent = summary.anomaly_count;
  document.getElementById("anomalyRate").textContent = `${summary.anomaly_percentage}%`;
}

function renderCompactAnomalyTimeline(timeline) {
  const canvas = document.getElementById("anomalyTimelineChart");

  if (!canvas) {
    console.error("anomalyTimelineChart canvas not found");
    return;
  }

  if (anomalyTimelineChart) {
    anomalyTimelineChart.destroy();
  }

  if (!timeline || timeline.length === 0) {
    console.warn("No anomaly timeline data found.");
    return;
  }

  // Hard reset canvas size before Chart.js renders
  canvas.removeAttribute("width");
  canvas.removeAttribute("height");
  canvas.style.width = "100%";
  canvas.style.height = "280px";
  canvas.style.maxHeight = "280px";

  const labels = timeline.map(item => item.time);
  const scores = timeline.map(item => item.score);
  const anomalyPoints = timeline.map(item => item.is_anomaly ? item.score : null);

  anomalyTimelineChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Average Posture Score",
          data: scores,
          tension: 0.3,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.10)",
          fill: false,
          pointRadius: 3,
          borderWidth: 2
        },
        {
          label: "Anomaly Detected",
          data: anomalyPoints,
          borderColor: "#ef4444",
          backgroundColor: "#ef4444",
          pointRadius: 6,
          pointHoverRadius: 8,
          showLine: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: 3,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: "top"
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100
        },
        x: {
          ticks: {
            maxTicksLimit: 6,
            autoSkip: true
          }
        }
      }
    }
  });

  // Hard clamp again after Chart.js renders
  canvas.style.height = "280px";
  canvas.style.maxHeight = "280px";
}

async function loadBehaviorAnalysis() {
  try {
    const res = await fetch("/api/ml/behavior");
    const data = await res.json();

    console.log("Behavior data:", data);

    if (data.error) {
      console.error("Behavior API error:", data.error);
      document.getElementById("behaviorInsight").textContent =
        "Could not load behaviour pattern insight.";
      return;
    }

    updateBehaviorKpis(data.summary);
    renderBadPostureHourChart(data.hourly_patterns);
    renderBadTypeChart(data.bad_type_distribution);

    // Only call this if the heatmap exists.
    const heatmapEl = document.getElementById("behaviorHeatmap");
    if (heatmapEl && data.day_hour_heatmap) {
      renderBehaviorHeatmap(data.day_hour_heatmap);
    }

    renderBehaviorInsight(data.summary);

  } catch (error) {
    console.error("Behavior analysis loading error:", error);
    document.getElementById("behaviorInsight").textContent =
      "Behaviour insight could not be loaded.";
  }
}

function updateBehaviorKpis(summary) {
  document.getElementById("behaviorBadRate").textContent =
    `${summary.bad_percentage}%`;

  document.getElementById("behaviorWorstHour").textContent =
    summary.worst_hour !== null && summary.worst_hour !== undefined
      ? `${summary.worst_hour}:00`
      : "--";

  document.getElementById("behaviorCommonType").textContent =
    formatReadableText(summary.most_common_bad_type);

  document.getElementById("behaviorWorstSession").textContent =
    summary.worst_session || "--";
}

function renderBadPostureHourChart(hourly) {
  const canvas = document.getElementById("badPostureHourChart");

  if (!canvas) {
    console.error("badPostureHourChart canvas not found");
    return;
  }

  if (badPostureHourChart) {
    badPostureHourChart.destroy();
  }

  canvas.removeAttribute("width");
  canvas.removeAttribute("height");
  canvas.style.width = "100%";
  canvas.style.height = "290px";
  canvas.style.maxHeight = "290px";

  badPostureHourChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: hourly.labels,
      datasets: [{
        label: "Bad Posture Count",
        data: hourly.bad_count,
        backgroundColor: "#ef4444",
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: "top"
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Bad Posture Count"
          }
        },
        x: {
          title: {
            display: true,
            text: "Hour of Day"
          }
        }
      }
    }
  });

  canvas.style.height = "290px";
  canvas.style.maxHeight = "290px";
}

function renderBadTypeChart(distribution) {
  const canvas = document.getElementById("badTypeChart");

  if (!canvas) {
    console.error("badTypeChart canvas not found");
    return;
  }

  if (badTypeChart) {
    badTypeChart.destroy();
  }

  canvas.removeAttribute("width");
  canvas.removeAttribute("height");
  canvas.style.width = "100%";
  canvas.style.height = "290px";
  canvas.style.maxHeight = "290px";

  const labels = distribution.labels || [];
  const values = distribution.values || [];

  if (labels.length === 0 || values.length === 0) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  badTypeChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: labels.map(formatReadableText),
      datasets: [{
        data: values,
        backgroundColor: [
          "#ef4444",
          "#f97316",
          "#eab308",
          "#8b5cf6",
          "#06b6d4",
          "#64748b"
        ],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: "65%",
      plugins: {
        legend: {
          position: "bottom"
        }
      }
    }
  });

  canvas.style.height = "290px";
  canvas.style.maxHeight = "290px";
}


function createBehaviorCell(text, className) {
  const cell = document.createElement("div");
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function renderBehaviorInsight(summary) {
  const insightEl = document.getElementById("behaviorInsight");

  if (!insightEl) {
    console.error("behaviorInsight element not found");
    return;
  }

  if (summary && summary.insight) {
    insightEl.textContent = summary.insight;
  } else {
    insightEl.textContent =
      "Behaviour analysis completed, but no written insight was returned by the backend.";
  }
}

function formatReadableText(value) {
  if (!value || value === "None" || value === "unknown") return "--";

  return String(value)
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

document.addEventListener("DOMContentLoaded", () => {
  loadTemporalAnalysis();
  loadCorrelationAnalysis();
  loadAnomalyAnalysis();
  loadBehaviorAnalysis();
});