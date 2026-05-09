import os
from datetime import datetime

import pandas as pd
import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, render_template, request, session, url_for, Response
from flask_cors import CORS
from openai import OpenAI
from ml.data_loader import load_sensor_csv
from ml.temporal_analysis import get_temporal_analysis
from ml.correlation_analysis import get_correlation_analysis
from ml.anomaly_detection import get_anomaly_detection_analysis
from ml.behavior_analysis import get_behavior_pattern_analysis

load_dotenv()

AI_PROVIDER = os.getenv("AI_PROVIDER", "ollama").strip().lower()
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
HF_TOKEN = os.getenv("HF_TOKEN", "").strip()
HF_MODEL = os.getenv("HF_MODEL", "meta-llama/Llama-3.1-8B-Instruct:cerebras")

IOT_BACKEND_URL = os.getenv("IOT_BACKEND_URL", "http://localhost:5000")

hf_client = OpenAI(base_url="https://router.huggingface.co/v1", api_key=HF_TOKEN) if HF_TOKEN else None

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-smart-posture-secret")
CORS(app)

DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "posture_data.csv")
conversation_history = []


def load_data() -> pd.DataFrame:
    return pd.read_csv(DATA_PATH, parse_dates=["timestamp"])


def pct(value, total):
    return round((value / total) * 100, 1) if total else 0


def apply_filters(df_input, range_filter="all", posture_class="all", session_id="all"):
    df_filtered = df_input.copy()

    if range_filter != "all":
        latest_time = df_filtered["timestamp"].max()

        if range_filter == "today":
            start_time = latest_time.normalize()
        elif range_filter == "7d":
            start_time = latest_time - pd.Timedelta(days=7)
        elif range_filter == "30d":
            start_time = latest_time - pd.Timedelta(days=30)
        else:
            start_time = None

        if start_time is not None:
            df_filtered = df_filtered[df_filtered["timestamp"] >= start_time]

    if posture_class != "all":
        if posture_class == "good":
            df_filtered = df_filtered[
                df_filtered["posture_class"].isin(["good", "good_posture"])
            ]
        elif posture_class == "bad":
            df_filtered = df_filtered[
                df_filtered["posture_class"].isin([
                    "bad",
                    "bad_posture",
                    "slouching_forward",
                    "forward_slouching",
                    "leaning_back",
                    "backward_slouching",
                    "left_leaning",
                    "right_leaning",
                ])
            ]
        else:
            df_filtered = df_filtered[df_filtered["posture_class"] == posture_class]

    if session_id != "all" and "session_id" in df_filtered.columns:
        df_filtered = df_filtered[df_filtered["session_id"] == session_id]

    return df_filtered


def get_balance_status(avg_lr, avg_fb):
    if abs(avg_lr) < 5 and abs(avg_fb) < 5:
        return "Centered"
    if avg_fb < -5:
        return "Forward Lean"
    if avg_fb > 5:
        return "Backward Lean"
    if avg_lr < -5:
        return "Right Lean"
    if avg_lr > 5:
        return "Left Lean"
    return "Slight Imbalance"

def normalize_posture_distribution(class_counts):
    good = int(class_counts.get("good", 0)) + int(class_counts.get("good_posture", 0))

    neutral = int(class_counts.get("neutral", 0))

    bad = (
        int(class_counts.get("bad", 0))
        + int(class_counts.get("bad_posture", 0))
        + int(class_counts.get("slouching_forward", 0))
        + int(class_counts.get("forward_slouching", 0))
        + int(class_counts.get("leaning_back", 0))
        + int(class_counts.get("backward_slouching", 0))
        + int(class_counts.get("left_leaning", 0))
        + int(class_counts.get("right_leaning", 0))
    )

    return {
        "good": good,
        "neutral": neutral,
        "bad": bad,
    }

def build_metrics():
    df = load_data()
    total = len(df)
    latest = df.sort_values("timestamp").iloc[-1]

    class_counts = df["posture_class"].value_counts()
    good = int(class_counts.get("good", 0))
    neutral = int(class_counts.get("neutral", 0))
    distribution = normalize_posture_distribution(class_counts)
    good = distribution["good"]
    neutral = distribution["neutral"]
    poor = distribution["bad"]

    df2 = df.copy()
    df2["date"] = df2["timestamp"].dt.strftime("%a")
    df2["hour"] = df2["timestamp"].dt.hour

    daily = df2.groupby("date", sort=False)["posture_score"].mean().round(1)
    hourly = df2.groupby("hour")["posture_score"].mean().round(1)

    exercise_total = int((df["exercise_recommendation"] != "none").sum())
    exercise_done = int(df["exercise_completed"].sum())

    avg_lr = round(float(df["lr_balance"].mean()), 2)
    avg_fb = round(float(df["fb_balance"].mean()), 2)

    return {
        "total_records": total,
        "avg_posture_score": round(float(df["posture_score"].mean()), 1),
        "latest_score": int(latest["posture_score"]),
        "latest_class": str(latest["posture_class"]).replace("_", " ").title(),
        "total_alerts": int(df["alert_status"].sum()),
        "good_posture_pct": pct(good, total),
        "neutral_pct": pct(neutral, total),
        "poor_pct": pct(poor, total),
        "avg_head_distance": round(float(df["head_distance_cm"].mean()), 1),
        "latest_head_distance": round(float(latest["head_distance_cm"]), 1),
        "avg_lr_balance": avg_lr,
        "avg_fb_balance": avg_fb,
        "avg_tilt_x": round(float(df["tilt_x"].mean()), 1),
        "avg_tilt_y": round(float(df["tilt_y"].mean()), 1),
        "balance_status": get_balance_status(avg_lr, avg_fb),
        "exercise_compliance": pct(exercise_done, max(exercise_total, 1)),
        "exercise_done": exercise_done,
        "exercise_total": exercise_total,
        "best_hour": int(hourly.idxmax()),
        "worst_hour": int(hourly.idxmin()),
        "best_day": str(daily.idxmax()),
        "worst_day": str(daily.idxmin()),
        "sitting_hours": round(total * 10 / 3600, 1),
    }


def build_data_context() -> str:
    m = build_metrics()
    return f"""
Smart Posture dataset summary:
- Average posture score: {m['avg_posture_score']}/100
- Good posture percentage: {m['good_posture_pct']}%
- Neutral posture percentage: {m['neutral_pct']}%
- Poor posture percentage: {m['poor_pct']}%
- Total alerts: {m['total_alerts']}
- Average head-to-screen distance: {m['avg_head_distance']} cm
- Average left-right balance: {m['avg_lr_balance']}% where negative means leaning right
- Average front-back balance: {m['avg_fb_balance']}% where negative means leaning forward
- Best posture hour: {m['best_hour']}:00
- Worst posture hour: {m['worst_hour']}:00
- Best day: {m['best_day']}
- Worst day: {m['worst_day']}
- Exercise compliance: {m['exercise_compliance']}%
""".strip()


SYSTEM_PROMPT = f"""You are PostureAI, an ergonomic coaching assistant for a smart posture monitoring dashboard.
Use the data summary below to answer posture, ergonomics, sensor, exercise, alert, and sitting habit questions.
Be concise, practical, and friendly. Use numbers from the data when useful. Do not invent missing data.

{build_data_context()}"""


def simple_answer(message: str):
    text = message.lower()
    m = build_metrics()

    if "average posture" in text or "weekly score" in text or "avg score" in text:
        return f"Your average posture score is {m['avg_posture_score']}/100. Good posture makes up {m['good_posture_pct']}% of the readings."

    if "alert" in text:
        return f"You have {m['total_alerts']} posture alerts in the dataset. Most alerts are worth checking around your weaker time period: {m['worst_hour']}:00."

    if "worst" in text and "time" in text:
        return f"Your worst posture time is around {m['worst_hour']}:00. That is a good time to trigger stretch reminders or posture correction alerts."

    if "best day" in text:
        return f"Your best posture day is {m['best_day']}. Your weakest day is {m['worst_day']}."

    if "screen" in text or "distance" in text:
        return f"Your average head-to-screen distance is {m['avg_head_distance']} cm. Try to stay roughly 50–70 cm from the screen."

    if "leaning" in text or "balance" in text:
        return f"Your average left-right imbalance is {m['avg_lr_balance']}%, and your front-back imbalance is {m['avg_fb_balance']}%. Negative front-back values suggest a slight forward lean."

    return None


def chat_with_ollama(messages):
    res = requests.post(
        f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat",
        json={
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.4,
                "num_predict": 300,
            },
        },
        timeout=120,
    )
    res.raise_for_status()
    return res.json()["message"]["content"].strip()


def chat_with_hf(messages):
    if not hf_client:
        raise RuntimeError("HF_TOKEN is missing. Set AI_PROVIDER=ollama or add HF_TOKEN.")

    out = hf_client.chat.completions.create(
        model=HF_MODEL,
        messages=messages,
        temperature=0.4,
        max_tokens=300,
    )
    return out.choices[0].message.content.strip()


def generate_reply(user_message):
    direct = simple_answer(user_message)
    if direct:
        return direct

    messages = (
        [{"role": "system", "content": SYSTEM_PROMPT}]
        + conversation_history[-10:]
        + [{"role": "user", "content": user_message}]
    )

    if AI_PROVIDER in ("hf", "huggingface"):
        return chat_with_hf(messages)

    return chat_with_ollama(messages)

def calculate_live_score(reading):
    if not reading:
        return None

    score = reading.get("posture_score")
    if score is not None:
        try:
            return round(float(score))
        except Exception:
            pass

    status = reading.get("posture_status") or reading.get("device_posture_status")
    severity = reading.get("posture_severity") or reading.get("device_posture_severity")

    if status == "good_posture":
        return 90

    if status == "bad_posture":
        if severity == "mild":
            return 65
        if severity == "moderate":
            return 50
        if severity == "severe":
            return 35
        return 55

    if status == "not_occupied":
        return None

    return None


def normalize_live_reading(raw):
    if not raw:
        return None

    reading = raw.get("data", raw) if isinstance(raw, dict) else raw

    if not isinstance(reading, dict):
        return None

    status = reading.get("posture_status") or reading.get("device_posture_status") or "--"
    bad_type = reading.get("bad_posture_type") or reading.get("device_bad_posture_type") or "none"

    return {
        "timestamp": (
            reading.get("recorded_at_utc")
            or reading.get("createdAt")
            or reading.get("device_time_sl")
            or reading.get("timestamp")
        ),
        "posture_score": calculate_live_score(reading),
        "posture_status": status,
        "bad_posture_type": bad_type,
        "posture_severity": (
            reading.get("posture_severity")
            or reading.get("device_posture_severity")
            or "--"
        ),
        "posture_reason": (
            reading.get("posture_reason")
            or reading.get("device_posture_reason")
            or "--"
        ),
        "distance_cm": reading.get("distance_cm"),
        "seat_balance_lr": (
            reading.get("seat_balance_lr")
            if reading.get("seat_balance_lr") is not None
            else reading.get("device_seat_balance_lr")
        ),
        "seat_balance_fb": (
            reading.get("seat_balance_fb")
            if reading.get("seat_balance_fb") is not None
            else reading.get("device_seat_balance_fb")
        ),
        "accel_x": reading.get("accel_x"),
        "accel_y": reading.get("accel_y"),
        "accel_z": reading.get("accel_z"),
        "accel_deviation": reading.get("accel_deviation"),
        "fsr1_adc": reading.get("fsr1_adc"),
        "fsr2_adc": reading.get("fsr2_adc"),
        "fsr3_adc": reading.get("fsr3_adc"),
        "fsr4_adc": reading.get("fsr4_adc"),
        "is_occupied": reading.get("is_occupied"),
    }



@app.context_processor
def inject_user():
    return {
        "current_user": session.get(
            "user",
            {"name": "Alex Rivera", "role": "Worker Persona"},
        )
    }


@app.route("/")
def landing():
    return render_template("landing.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        session["user"] = {
            "name": request.form.get("email", "Demo User").split("@")[0].title(),
            "role": "Worker Persona",
        }
        return redirect(url_for("dashboard"))

    return render_template("login.html")


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        session["user"] = {
            "name": request.form.get("full_name", "Demo User"),
            "role": "Worker Persona",
        }
        return redirect(url_for("dashboard"))

    return render_template("signup.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("landing"))


@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html", active_page="dashboard", metrics=build_metrics())


@app.route("/insights")
def insights():
    return render_template("insights.html", active_page="insights", metrics=build_metrics())


@app.route("/exercises")
def exercises():
    exercises_data = [
        {
            "name": "Chin Tucks",
            "desc": "Strengthens deep neck flexors and helps correct forward head posture.",
            "meta": "3 sets · 5 min",
            "status": "Completed",
            "image": "🧘",
            "video_url": "https://youtu.be/xRndYV-iL1E?si=SiV71MF9mHqFDyY8",
        },
        {
            "name": "Shoulder Rolls",
            "desc": "Releases upper trapezius tension and improves shoulder mobility.",
            "meta": "Hourly · 2 min",
            "status": "Start Now",
            "image": "💪",
            "video_url": "https://www.youtube.com/watch?v=IKJZL4hvppw",
        },
        {
            "name": "Neck Stretches",
            "desc": "Improves cervical mobility and reduces stiffness after long sitting.",
            "meta": "Both sides · 1 min",
            "status": "Start Now",
            "image": "🙆",
            "video_url": "https://www.mayoclinic.org/healthy-lifestyle/adult-health/multimedia/neck-stretches/vid-20084697",
        },
        {
            "name": "Back Extensions",
            "desc": "Counteracts desk slouching by engaging thoracic extensors.",
            "meta": "5 reps · 30s hold",
            "status": "Start Now",
            "image": "🏋️",
            "video_url": "https://www.youtube.com/watch?v=eHbdjqkwvks",
        },
    ]

    return render_template(
        "exercises.html",
        active_page="exercises",
        metrics=build_metrics(),
        exercises=exercises_data,
    )


@app.route("/settings")
def settings():
    return render_template("settings.html", active_page="settings", metrics=build_metrics())


@app.route("/chatbot")
def chatbot_page():
    return render_template("chatbot.html", active_page="chatbot", metrics=build_metrics())


@app.route("/chat", methods=["POST"])
def chat():
    global conversation_history

    data = request.get_json(silent=True) or {}
    user_message = (data.get("message") or "").strip()

    if not user_message:
        return jsonify({"error": "Empty message"}), 400

    try:
        reply = generate_reply(user_message)

        conversation_history.append({"role": "user", "content": user_message})
        conversation_history.append({"role": "assistant", "content": reply})
        conversation_history = conversation_history[-20:]

        return jsonify(
            {
                "reply": reply,
                "timestamp": datetime.now().strftime("%H:%M"),
                "provider": AI_PROVIDER,
            }
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/reset", methods=["POST"])
def reset():
    global conversation_history
    conversation_history = []
    return jsonify({"status": "Conversation reset"})


@app.route("/data/summary")
def data_summary():
    return jsonify(build_metrics())


@app.route("/api/charts")
def charts():
    df = load_data().copy()

    df["day"] = df["timestamp"].dt.strftime("%a")
    df["date"] = df["timestamp"].dt.date.astype(str)
    df["hour"] = df["timestamp"].dt.hour

    trend = df.groupby("day", sort=False)["posture_score"].mean().round(1)

    raw_dist = df["posture_class"].value_counts()
    dist = normalize_posture_distribution(raw_dist)

    heat = (
        df.groupby(["day", "hour"], sort=False)["posture_score"]
        .mean()
        .round(1)
        .reset_index()
        .to_dict(orient="records")
    )

    monthly = df.groupby("date")["posture_score"].mean().round(1).to_dict()

    return jsonify(
        {
            "trend": {"labels": list(trend.index), "values": list(trend.values)},
            "distribution": dist,
            "heatmap": heat,
            "monthly": monthly,
        }
    )


@app.route("/api/dashboard-data")
def dashboard_data():
    df_fresh = load_data()

    range_filter = request.args.get("range", "all")
    posture_class = request.args.get("posture_class", "all")
    session_id = request.args.get("session", "all")

    df_filtered = apply_filters(df_fresh, range_filter, posture_class, session_id)

    sessions = (
        sorted(df_fresh["session_id"].dropna().unique().tolist())
        if "session_id" in df_fresh.columns
        else []
    )

    if df_filtered.empty:
        return jsonify(
            {
                "avg_score": None,
                "total_alerts": 0,
                "good_posture_pct": 0,
                "avg_distance": 0,
                "balance_status": "--",
                "trend_labels": [],
                "trend_values": [],
                "posture_distribution": {"good": 0, "neutral": 0, "bad": 0},
                "sessions": sessions,
                "heatmap": [],
            }
        )

    trend = (
        df_filtered.groupby(df_filtered["timestamp"].dt.strftime("%Y-%m-%d"))[
            "posture_score"
        ]
        .mean()
        .round(1)
    )

    raw_distribution = df_filtered["posture_class"].value_counts()
    distribution = normalize_posture_distribution(raw_distribution)

    heat_df = df_filtered.copy()
    heat_df["date"] = heat_df["timestamp"].dt.strftime("%Y-%m-%d")
    heat_df["day"] = heat_df["timestamp"].dt.strftime("%a")
    heat_df["hour"] = heat_df["timestamp"].dt.hour

    heatmap = (
        heat_df.groupby(["date", "day", "hour"], sort=False)["posture_score"]
        .mean()
        .round(1)
        .reset_index()
        .to_dict(orient="records")
    )

    avg_lr = round(float(df_filtered["lr_balance"].mean()), 2)
    avg_fb = round(float(df_filtered["fb_balance"].mean()), 2)

    return jsonify(
        {
            "avg_score": round(float(df_filtered["posture_score"].mean()), 1),
            "total_alerts": int(df_filtered["alert_status"].sum()),
            "good_posture_pct": round(
                distribution["good"] / len(df_filtered) * 100,
                1,
            ),
            "avg_distance": round(float(df_filtered["head_distance_cm"].mean()), 1),
            "balance_status": get_balance_status(avg_lr, avg_fb),
            "trend_labels": trend.index.tolist(),
            "trend_values": trend.values.tolist(),
            "posture_distribution": distribution,
            "sessions": sessions,
            "heatmap": heatmap,
        }
    )

@app.route("/api/drilldown")
def drilldown():
    df_fresh = load_data().copy()

    date = request.args.get("date")
    hour = request.args.get("hour")

    filtered = df_fresh.copy()

    if date:
        filtered = filtered[filtered["timestamp"].dt.strftime("%Y-%m-%d") == date]

    if hour not in (None, "", "null", "undefined"):
        filtered = filtered[filtered["timestamp"].dt.hour == int(hour)]

    if filtered.empty:
        return jsonify({"error": "No data found"}), 404

    dominant_class = filtered["posture_class"].mode()[0]

    recommendation = "Maintain current posture habits."
    if dominant_class == "slouching_forward":
        recommendation = "Adjust screen height and do neck stretches."
    elif dominant_class == "leaning_back":
        recommendation = "Move closer to the desk and keep your back supported."
    elif dominant_class == "neutral":
        recommendation = "Take regular breaks to avoid posture fatigue."

    title = date or "Selected Period"
    if hour not in (None, "", "null", "undefined"):
        title += f" {hour}:00"

    return jsonify(
        {
            "title": title,
            "avg_score": round(float(filtered["posture_score"].mean()), 1),
            "alerts": int(filtered["alert_status"].sum()),
            "dominant_class": dominant_class,
            "recommendation": recommendation,
        }
    )


@app.route("/api/recent-readings")
def recent_readings():
    df_fresh = load_data().sort_values("timestamp", ascending=False).head(20)

    rows = []

    for _, row in df_fresh.iterrows():
        rows.append(
            {
                "time": row["timestamp"].strftime("%Y-%m-%d %H:%M"),
                "score": int(row["posture_score"]),
                "class": row["posture_class"],
                "distance": round(float(row["head_distance_cm"]), 1),
                "balance": round(float(row["lr_balance"]), 1),
                "alert": bool(row["alert_status"]),
                "exercise": row["exercise_recommendation"],
            }
        )

    return jsonify(rows)


@app.route("/api/decision-support")
def decision_support():
    df_fresh = load_data()

    avg_score = round(float(df_fresh["posture_score"].mean()), 1)
    alerts = int(df_fresh["alert_status"].sum())
    close_screen_pct = round(
        (df_fresh["head_distance_cm"] < 45).sum() / len(df_fresh) * 100,
        1,
    )
    forward_lean = round(float(df_fresh["fb_balance"].mean()), 1)

    risk_level = "Low"
    if avg_score < 70 or alerts > 10:
        risk_level = "High"
    elif avg_score < 80 or alerts > 5:
        risk_level = "Medium"

    recommendations = []

    if close_screen_pct > 25:
        recommendations.append("Increase screen distance to reduce neck strain.")

    if forward_lean < -5:
        recommendations.append("Improve back support and avoid leaning forward.")

    if avg_score < 75:
        recommendations.append("Schedule short posture breaks every 30–45 minutes.")

    if not recommendations:
        recommendations.append("Maintain current habits and continue monitoring.")

    return jsonify(
        {
            "risk_level": risk_level,
            "avg_score": avg_score,
            "alerts": alerts,
            "close_screen_pct": close_screen_pct,
            "forward_lean": forward_lean,
            "recommendations": recommendations,
        }
    )


@app.route("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "provider": AI_PROVIDER,
            "ollama_model": OLLAMA_MODEL,
            "hf_model": HF_MODEL,
        }
    )

@app.route("/api/live/latest")
def live_latest():
    try:
        res = requests.get(f"{IOT_BACKEND_URL}/api/readings/latest", timeout=5)
        raw = res.json()
        normalized = normalize_live_reading(raw)

        return jsonify({
            "success": True,
            "data": normalized,
            "raw": raw
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": "Could not connect to IoT backend",
            "error": str(e)
        }), 500


@app.route("/api/live/history")
def live_history():
    try:
        limit = request.args.get("limit", "100")
        res = requests.get(
            f"{IOT_BACKEND_URL}/api/readings/history?limit={limit}",
            timeout=5
        )

        raw = res.json()
        rows = raw.get("data", raw) if isinstance(raw, dict) else raw

        if not isinstance(rows, list):
            rows = []

        normalized_rows = []
        for row in rows:
            item = normalize_live_reading(row)
            if item:
                normalized_rows.append(item)

        return jsonify({
            "success": True,
            "data": normalized_rows,
            "raw": raw
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": "Could not fetch live history",
            "error": str(e)
        }), 500
    
@app.route("/ml-analysis")
def ml_analysis():
    return render_template("ml_analysis.html", active_page="ml-analysis")


@app.route("/api/ml/temporal")
def api_ml_temporal():
    df = load_sensor_csv()
    result = get_temporal_analysis(df)
    return jsonify(result)

@app.route("/api/ml/correlation")
def api_ml_correlation():
    try:
        df = load_sensor_csv()
        result = get_correlation_analysis(df)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
@app.route("/api/ml/anomalies")
def api_ml_anomalies():
    try:
        df = load_sensor_csv()
        result = get_anomaly_detection_analysis(df)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/ml/behavior")
def api_ml_behavior():
    try:
        df = load_sensor_csv()
        result = get_behavior_pattern_analysis(df)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
@app.route("/download-report")
def download_report():
    try:
        metrics = build_metrics()
        df = load_data().copy()

        report_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        recent = df.sort_values("timestamp", ascending=False).head(10)

        lines = []
        lines.append("SMART POSTURE INSIGHTS REPORT")
        lines.append("=" * 40)
        lines.append(f"Generated at: {report_time}")
        lines.append("")
        lines.append("SUMMARY")
        lines.append("-" * 40)
        lines.append(f"Average posture score: {metrics['avg_posture_score']}/100")
        lines.append(f"Good posture percentage: {metrics['good_posture_pct']}%")
        lines.append(f"Neutral posture percentage: {metrics['neutral_pct']}%")
        lines.append(f"Poor posture percentage: {metrics['poor_pct']}%")
        lines.append(f"Total alerts: {metrics['total_alerts']}")
        lines.append(f"Average screen distance: {metrics['avg_head_distance']} cm")
        lines.append(f"Latest screen distance: {metrics['latest_head_distance']} cm")
        lines.append(f"Average left-right balance: {metrics['avg_lr_balance']}")
        lines.append(f"Average front-back balance: {metrics['avg_fb_balance']}")
        lines.append(f"Best posture hour: {metrics['best_hour']}:00")
        lines.append(f"Worst posture hour: {metrics['worst_hour']}:00")
        lines.append(f"Best day: {metrics['best_day']}")
        lines.append(f"Worst day: {metrics['worst_day']}")
        lines.append(f"Exercise compliance: {metrics['exercise_compliance']}%")
        lines.append("")
        lines.append("RECENT READINGS")
        lines.append("-" * 40)

        for _, row in recent.iterrows():
            lines.append(
                f"{row['timestamp']} | "
                f"Score: {row['posture_score']} | "
                f"Status: {row['posture_class']} | "
                f"Distance: {row['head_distance_cm']} cm | "
                f"Alert: {row['alert_status']}"
            )

        lines.append("")
        lines.append("RECOMMENDATION")
        lines.append("-" * 40)

        if metrics["avg_posture_score"] < 70:
            lines.append("High risk posture pattern detected. Improve sitting posture and take regular breaks.")
        elif metrics["avg_posture_score"] < 80:
            lines.append("Moderate posture risk. Focus on screen distance, back support, and short exercise breaks.")
        else:
            lines.append("Posture condition is acceptable. Continue monitoring and maintain current habits.")

        report_text = "\n".join(lines)

        filename = f"smart_posture_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"

        return Response(
            report_text,
            mimetype="text/plain",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )

    except Exception as e:
        return jsonify({
            "success": False,
            "message": "Report generation failed",
            "error": str(e)
        }), 500

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print(" Smart Posture Flask App")
    print(f" Provider: {AI_PROVIDER}")
    print(f" Model: {OLLAMA_MODEL if AI_PROVIDER == 'ollama' else HF_MODEL}")
    print(" Open: http://127.0.0.1:5001")
    print("=" * 60 + "\n")
    app.run(debug=True, port=5001)