let trendChart = null;
let breakdownChart = null;

async function loadDashboardData() {
  const range = document.getElementById("dateRangeFilter").value;
  const postureClass = document.getElementById("postureClassFilter").value;
  const session = document.getElementById("sessionFilter").value;

  const url = `/api/dashboard-data?range=${encodeURIComponent(range)}&posture_class=${encodeURIComponent(postureClass)}&session=${encodeURIComponent(session)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    updateMetricCards(data);
    populateSessions(data.sessions || []);
    renderBreakdownChart(data.posture_distribution || {});
    renderTrendChart(data.trend_labels || [], data.trend_values || []);
    renderHeatmap(data.heatmap || []);
    updateDecisionSupport(data);

  } catch (error) {
    console.error("Dashboard loading error:", error);
  }
}

async function loadLiveDashboard() {
  try {
    const latestRes = await fetch("/api/live/latest");
    const latestJson = await latestRes.json();

    console.log("Live latest:", latestJson);

    if (!latestJson.success || !latestJson.data) {
      console.warn("No latest live reading found");
      return;
    }

    const latest = latestJson.data;

    const liveScore = getScoreFromReading(latest);
    updateScoreRing(liveScore, "Live Data");

    const statusEl = document.getElementById("dominantPosture");
    if (statusEl) {
      statusEl.textContent = getPostureStatusText(latest);
    }

    const typeEl = document.getElementById("avgTilt");
    if (typeEl) {
      typeEl.textContent = getSlouchLeanTypeText(latest);
    }

    const distanceEl = document.getElementById("avgDistance");
    if (distanceEl && latest.distance_cm !== null && latest.distance_cm !== undefined) {
      distanceEl.textContent = `${Number(latest.distance_cm).toFixed(1)} cm`;
    }

    const balanceEl = document.getElementById("balanceStatus");
    if (balanceEl) {
      balanceEl.textContent = getBalanceText(latest.seat_balance_lr, latest.seat_balance_fb);
    }

    updateAlertBanner(latest);
    updateLiveDecisionSupport(latest);
    await loadLiveTrend();

  } catch (error) {
    console.error("Live dashboard error:", error);
  }
}

async function loadLiveTrend() {
  try {
    const res = await fetch("/api/live/history?limit=50");
    const json = await res.json();

    if (!json.success || !Array.isArray(json.data)) return;

    const rows = json.data
      .filter(row => row && row.posture_score !== null && row.posture_score !== undefined)
      .slice()
      .reverse();

    if (rows.length === 0) return;

    const labels = rows.map(row => {
      const d = new Date(row.timestamp);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    });

    const values = rows.map(row => row.posture_score);

    renderTrendChart(labels, values);

  } catch (error) {
    console.error("Live trend error:", error);
  }
}

function updateMetricCards(data) {
  updateScoreRing(data.avg_score, "Filtered Data");

  const totalAlertsEl = document.getElementById("totalAlerts");
  if (totalAlertsEl) totalAlertsEl.textContent = data.total_alerts ?? 0;

  const goodPctEl = document.getElementById("goodPosturePct");
  if (goodPctEl) goodPctEl.textContent = `${data.good_posture_pct ?? 0}%`;

  const distanceEl = document.getElementById("avgDistance");
  if (distanceEl) distanceEl.textContent = `${data.avg_distance ?? 0} cm`;

  const distribution = normalizeDistribution(data.posture_distribution || {});

  document.getElementById("goodCount").textContent = distribution.good;
  document.getElementById("neutralCount").textContent = distribution.neutral;
  document.getElementById("poorCount").textContent = distribution.poor;

  const dominant = getDominantPosture(distribution);
  document.getElementById("dominantPosture").textContent = formatPostureLabel(dominant);

  document.getElementById("avgTilt").textContent = getDominantBadType(data.posture_distribution || {});

  document.getElementById("balanceStatus").textContent = data.balance_status || "Centered";
}

function normalizeDistribution(distribution) {
  return {
    good:
      Number(distribution.good || 0) +
      Number(distribution.good_posture || 0),

    neutral:
      Number(distribution.neutral || 0),

    poor:
      Number(distribution.bad || 0) +
      Number(distribution.bad_posture || 0) +
      Number(distribution.slouching_forward || 0) +
      Number(distribution.forward_slouching || 0) +
      Number(distribution.leaning_back || 0) +
      Number(distribution.backward_slouching || 0) +
      Number(distribution.left_leaning || 0) +
      Number(distribution.right_leaning || 0)
  };
}

function populateSessions(sessions) {
  const sessionFilter = document.getElementById("sessionFilter");
  const currentValue = sessionFilter.value;

  sessionFilter.innerHTML = `<option value="all">All</option>`;

  sessions.forEach(session => {
    const option = document.createElement("option");
    option.value = session;
    option.textContent = session;
    sessionFilter.appendChild(option);
  });

  if ([...sessionFilter.options].some(option => option.value === currentValue)) {
    sessionFilter.value = currentValue;
  } else {
    sessionFilter.value = "all";
  }
}

function renderBreakdownChart(distribution) {
  const normalized = normalizeDistribution(distribution);

  const ctx = document.getElementById("breakdownChart");

  if (!ctx) return;

  if (breakdownChart) {
    breakdownChart.destroy();
  }

  breakdownChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Good", "Neutral", "Poor"],
      datasets: [{
        data: [normalized.good, normalized.neutral, normalized.poor],
        backgroundColor: ["#16a34a", "#e68a00", "#ef4444"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      cutout: "68%"
    }
  });
}

function renderTrendChart(labels, values) {
  const ctx = document.getElementById("trendChart");

  if (!ctx) return;

  if (trendChart) {
    trendChart.destroy();
  }

  ctx.style.height = "230px";
  ctx.style.maxHeight = "230px";

  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: "Posture Score",
        data: values,
        tension: 0.35,
        fill: true,
        borderColor: "#2563eb",
        backgroundColor: "rgba(37,99,235,.12)",
        pointRadius: 3,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100
        }
      },
      onClick: async function (event, elements) {
        if (elements.length > 0) {
          const index = elements[0].index;
          const selectedDate = labels[index];
          await loadDrilldown(selectedDate, null);
        }
      }
    }
  });
}

function renderHeatmap(heatmapData) {
  const heat = document.getElementById("heatmap");
  if (!heat) return;

  heat.innerHTML = "";

  if (!heatmapData || heatmapData.length === 0) {
    heat.innerHTML = "<p class='muted-text'>No heatmap data available.</p>";
    return;
  }

  heatmapData.slice(0, 40).forEach(item => {
    const cell = document.createElement("div");
    const score = Number(item.posture_score || item.score || 0);

    cell.className = "heat-cell " + (
      score >= 75 ? "good" :
      score >= 55 ? "mod" :
      "poor"
    );

    cell.title = `${item.day || item.date || "Day"} ${item.hour ?? ""}:00 score ${score}`;

    cell.onclick = async () => {
      const date = item.date || item.day;
      const hour = item.hour;
      await loadDrilldown(date, hour);
    };

    heat.appendChild(cell);
  });
}

async function loadDrilldown(date, hour) {
  let url = `/api/drilldown?date=${encodeURIComponent(date)}`;

  if (hour !== null && hour !== undefined) {
    url += `&hour=${encodeURIComponent(hour)}`;
  }

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) return;

    document.getElementById("alertTitle").textContent = `Selected: ${data.title}`;
    document.getElementById("alertMessage").textContent =
      `Average score: ${data.avg_score}/100 | Alerts: ${data.alerts} | Dominant posture: ${formatPostureLabel(data.dominant_class)} | Recommendation: ${data.recommendation}`;

  } catch (error) {
    console.error("Drilldown error:", error);
  }
}

function updateDecisionSupport(data) {
  const avgScore = Number(data.avg_score || 0);
  const alerts = Number(data.total_alerts || 0);
  const avgDistance = Number(data.avg_distance || 0);

  let risk = "Low Risk";
  let reason = "Your posture pattern looks stable. Continue monitoring and maintain regular breaks.";

  if (avgScore < 55 || alerts > 10) {
    risk = "High Risk";
    reason = "Your posture score or alert count indicates a high-risk pattern. Prioritize posture correction and short exercise breaks.";
  } else if (avgScore < 75 || alerts > 5) {
    risk = "Medium Risk";
    reason = "Your posture is acceptable but needs improvement. Focus on screen distance, back support, and regular movement.";
  }

  if (avgDistance > 0 && avgDistance < 45) {
    reason += " Your screen distance is also too close, which may increase neck strain.";
  }

  document.getElementById("riskLevel").textContent = risk;
  document.getElementById("riskReason").textContent = reason;
}

function updateAlertBanner(reading) {
  const banner = document.querySelector(".dashboard-top-alert");
  const title = document.getElementById("alertTitle");
  const msg = document.getElementById("alertMessage");

  if (!title || !msg) return;

  if (banner) {
    banner.classList.remove("is-good", "is-warning", "is-danger", "is-neutral");
  }

  if (reading.posture_status === "bad_posture") {
    title.textContent = `${formatPostureLabel(reading.bad_posture_type)} detected`;
    msg.textContent = reading.posture_reason || "Poor posture detected. Please correct your sitting position.";
    if (banner) banner.classList.add("is-danger");
  } else if (reading.posture_status === "good_posture") {
    title.textContent = "Good posture detected";
    msg.textContent = "Your current posture is stable. Keep maintaining this position.";
    if (banner) banner.classList.add("is-good");
  } else if (reading.posture_status === "not_occupied") {
    title.textContent = "Chair not occupied";
    msg.textContent = "No active sitting posture detected.";
    if (banner) banner.classList.add("is-neutral");
  } else {
    title.textContent = "Posture monitoring active";
    msg.textContent = "Waiting for live posture readings.";
    if (banner) banner.classList.add("is-neutral");
  }
}

function updateLiveDecisionSupport(reading) {
  const riskEl = document.getElementById("riskLevel");
  const reasonEl = document.getElementById("riskReason");

  if (!riskEl || !reasonEl || !reading) return;

  const score = getScoreFromReading(reading);
  const status = reading.posture_status || reading.device_posture_status;
  const severity = reading.posture_severity || reading.device_posture_severity;
  const distance = Number(reading.distance_cm || 0);
  const badType = reading.bad_posture_type || reading.device_bad_posture_type || "none";

  if (status === "not_occupied") {
    riskEl.textContent = "No Active Risk";
    reasonEl.textContent = "Chair is not occupied. Live posture risk is not being calculated.";
    return;
  }

  let risk = "Low Risk";
  let reason = "Your current posture is stable. Keep your screen at eye level and maintain regular breaks.";

  if (score !== null && score < 55) {
    risk = "High Risk";
    reason = `Current posture score is ${Math.round(score)}/100. ${formatPostureLabel(badType)} is detected. Correct your sitting position and take a short break.`;
  } else if (score !== null && score < 75) {
    risk = "Medium Risk";
    reason = `Current posture score is ${Math.round(score)}/100. Your posture needs improvement. Focus on back support, screen distance, and regular movement.`;
  }

  if (severity === "severe") {
    risk = "High Risk";
    reason = `${formatPostureLabel(badType)} is detected with severe posture severity. Correct posture immediately.`;
  }

  if (distance > 0 && distance < 45) {
    reason += " Your screen distance is too close, which may increase neck strain.";
  }

  if (distance > 90) {
    reason += " Your screen distance is too far, which may cause forward leaning or visual strain.";
  }

  riskEl.textContent = risk;
  reasonEl.textContent = reason;
}

function updateScoreRing(score, labelText = "Live Data") {
  const ring = document.querySelector(".score-ring");
  const scoreEl = document.getElementById("avgScore");
  const subLabel = document.getElementById("scoreSubLabel");

  if (!ring || !scoreEl) return;

  ring.classList.remove(
    "score-good",
    "score-moderate",
    "score-poor",
    "score-empty"
  );

  if (subLabel) {
    subLabel.textContent = labelText;
  }

  if (score === null || score === undefined || Number.isNaN(Number(score))) {
    scoreEl.textContent = "--";
    ring.classList.add("score-empty");
    return;
  }

  const numericScore = Math.round(Number(score));
  scoreEl.textContent = `${numericScore}/100`;

  if (numericScore >= 75) {
    ring.classList.add("score-good");
  } else if (numericScore >= 55) {
    ring.classList.add("score-moderate");
  } else {
    ring.classList.add("score-poor");
  }
}

function getPostureStatusText(reading) {
  const status = reading.posture_status || reading.device_posture_status;

  if (status === "good_posture") return "Good Posture";
  if (status === "bad_posture") return "Bad Posture";
  if (status === "not_occupied") return "Not Occupied";

  return formatPostureLabel(status || "--");
}

function getSlouchLeanTypeText(reading) {
  const status = reading.posture_status || reading.device_posture_status;
  const type = reading.bad_posture_type || reading.device_bad_posture_type;

  if (status === "not_occupied") return "Not Occupied";
  if (status === "good_posture") return "No Slouching";
  if (!type || type === "none" || type === "--") return "Bad Posture";

  return formatPostureLabel(type);
}

function getScoreFromReading(reading) {
  if (!reading) return null;

  if (
    reading.posture_score !== null &&
    reading.posture_score !== undefined &&
    !Number.isNaN(Number(reading.posture_score))
  ) {
    return Number(reading.posture_score);
  }

  const status = reading.posture_status || reading.device_posture_status;
  const severity = reading.posture_severity || reading.device_posture_severity;

  if (status === "good_posture") return 90;

  if (status === "bad_posture") {
    if (severity === "mild") return 65;
    if (severity === "moderate") return 50;
    if (severity === "severe") return 35;
    return 55;
  }

  return null;
}

function getBalanceText(lr, fb) {
  lr = Number(lr || 0);
  fb = Number(fb || 0);

  if (Math.abs(lr) < 0.08 && Math.abs(fb) < 0.08) return "Centered";
  if (fb < -0.08) return "Backward Lean";
  if (fb > 0.08) return "Forward Lean";
  if (lr < -0.08) return "Left Lean";
  if (lr > 0.08) return "Right Lean";

  return "Slight Imbalance";
}

function getDominantPosture(distribution) {
  const entries = Object.entries(distribution);

  if (entries.length === 0) return "--";

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function getDominantBadType(distribution) {
  const candidates = {
    slouching_forward: distribution.slouching_forward || 0,
    forward_slouching: distribution.forward_slouching || 0,
    leaning_back: distribution.leaning_back || 0,
    backward_slouching: distribution.backward_slouching || 0,
    left_leaning: distribution.left_leaning || 0,
    right_leaning: distribution.right_leaning || 0,
    bad: distribution.bad || 0,
    bad_posture: distribution.bad_posture || 0
  };

  const entries = Object.entries(candidates).filter(([, value]) => Number(value) > 0);

  if (entries.length === 0) return "--";

  entries.sort((a, b) => b[1] - a[1]);
  return formatPostureLabel(entries[0][0]);
}

function formatPostureLabel(value) {
  if (!value || value === "--") return "--";

  return String(value)
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function askChartAI(question) {
  if (typeof openFloatingChatbot === "function") {
    openFloatingChatbot();
  }

  const input =
    document.getElementById("floatingChatInput") ||
    document.getElementById("chatInput") ||
    document.querySelector("input[name='message']");

  if (!input) {
    alert("Chatbot input not found. Check floating chatbot input ID.");
    return;
  }

  input.value = question;

  if (typeof sendFloatingMessage === "function") {
    sendFloatingMessage();
  } else if (typeof sendMessage === "function") {
    sendMessage();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadDashboardData();
  await loadLiveDashboard();
  setInterval(loadLiveDashboard, 3000);
});