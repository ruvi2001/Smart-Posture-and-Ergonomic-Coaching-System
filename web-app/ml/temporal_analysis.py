def get_temporal_analysis(df):
    df = df.copy()
    df["date"] = df["timestamp"].dt.strftime("%Y-%m-%d")
    df["hour"] = df["timestamp"].dt.hour

    daily = df.groupby("date")["posture_score"].mean().round(1).reset_index()
    hourly = df.groupby("hour")["posture_score"].mean().round(1).reset_index()

    if "session_id" in df.columns:
        session = df.groupby("session_id")["posture_score"].mean().round(1).reset_index()
    else:
        session = None

    first_score = float(daily["posture_score"].iloc[0])
    last_score = float(daily["posture_score"].iloc[-1])
    change = round(last_score - first_score, 1)

    if change > 3:
        status = "Improving"
    elif change < -3:
        status = "Declining"
    else:
        status = "Stable"

    return {
        "summary": {
            "average_score": round(float(df["posture_score"].mean()), 1),
            "best_day": daily.loc[daily["posture_score"].idxmax(), "date"],
            "worst_day": daily.loc[daily["posture_score"].idxmin(), "date"],
            "best_hour": int(hourly.loc[hourly["posture_score"].idxmax(), "hour"]),
            "worst_hour": int(hourly.loc[hourly["posture_score"].idxmin(), "hour"]),
            "trend_change": change,
            "trend_status": status,
        },
        "daily": {
            "labels": daily["date"].tolist(),
            "values": daily["posture_score"].tolist(),
        },
        "hourly": {
            "labels": hourly["hour"].astype(str).tolist(),
            "values": hourly["posture_score"].tolist(),
        },
        "session": {
            "labels": session["session_id"].astype(str).tolist() if session is not None else [],
            "values": session["posture_score"].tolist() if session is not None else [],
        },
    }