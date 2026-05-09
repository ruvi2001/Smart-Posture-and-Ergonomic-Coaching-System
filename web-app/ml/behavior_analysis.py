import pandas as pd


DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def get_behavior_pattern_analysis(df):
    df = df.copy()

    if "timestamp" not in df.columns:
        raise ValueError("timestamp column is required for behavior pattern analysis.")

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df = df[df["timestamp"].notna()]

    if df.empty:
        raise ValueError("No valid timestamp data found.")

    if "posture_score" not in df.columns:
        raise ValueError("posture_score column is required.")

    df["posture_score"] = pd.to_numeric(df["posture_score"], errors="coerce")
    df = df[df["posture_score"].notna()]

    df["hour"] = df["timestamp"].dt.hour
    df["day_name"] = df["timestamp"].dt.day_name()

    df["is_bad_posture"] = detect_bad_posture(df)

    total_records = len(df)
    bad_records = int(df["is_bad_posture"].sum())
    good_records = total_records - bad_records
    bad_percentage = round((bad_records / total_records) * 100, 1) if total_records else 0

    hourly_patterns = build_hourly_patterns(df)
    day_hour_heatmap = build_day_hour_heatmap(df)
    bad_type_distribution = build_bad_type_distribution(df)
    session_patterns = build_session_patterns(df)
    summary = build_behavior_summary(
        df,
        hourly_patterns,
        session_patterns,
        bad_type_distribution,
        total_records,
        bad_records,
        good_records,
        bad_percentage
    )

    return {
        "summary": summary,
        "hourly_patterns": hourly_patterns,
        "day_hour_heatmap": day_hour_heatmap,
        "bad_type_distribution": bad_type_distribution,
        "session_patterns": session_patterns
    }


def detect_bad_posture(df):
    """
    Detects bad posture using posture_status when available.
    If posture_status is missing, it falls back to posture_score < 60.
    """

    if "posture_status" in df.columns:
        status = df["posture_status"].fillna("").astype(str).str.lower()

        return (
            status.eq("bad_posture")
            | status.eq("bad")
            | status.str.contains("bad", na=False)
            | status.str.contains("poor", na=False)
        )

    return df["posture_score"] < 60


def build_hourly_patterns(df):
    grouped = (
        df.groupby("hour")
        .agg(
            avg_score=("posture_score", "mean"),
            bad_count=("is_bad_posture", "sum"),
            total_count=("is_bad_posture", "count")
        )
        .reset_index()
        .sort_values("hour")
    )

    grouped["avg_score"] = grouped["avg_score"].round(1)
    grouped["bad_rate"] = ((grouped["bad_count"] / grouped["total_count"]) * 100).round(1)

    return {
        "labels": grouped["hour"].astype(str).tolist(),
        "avg_score": grouped["avg_score"].astype(float).tolist(),
        "bad_count": grouped["bad_count"].astype(int).tolist(),
        "bad_rate": grouped["bad_rate"].astype(float).tolist()
    }


def build_day_hour_heatmap(df):
    grouped = (
        df.groupby(["day_name", "hour"])
        .agg(
            avg_score=("posture_score", "mean"),
            bad_count=("is_bad_posture", "sum"),
            total_count=("is_bad_posture", "count")
        )
        .reset_index()
    )

    grouped["avg_score"] = grouped["avg_score"].round(1)
    grouped["bad_rate"] = ((grouped["bad_count"] / grouped["total_count"]) * 100).round(1)

    grouped["day_order"] = grouped["day_name"].apply(
        lambda day: DAY_ORDER.index(day) if day in DAY_ORDER else 99
    )

    grouped = grouped.sort_values(["day_order", "hour"])

    heatmap = []

    for _, row in grouped.iterrows():
        heatmap.append({
            "day": row["day_name"],
            "hour": int(row["hour"]),
            "avg_score": float(row["avg_score"]),
            "bad_count": int(row["bad_count"]),
            "bad_rate": float(row["bad_rate"])
        })

    return heatmap


def build_bad_type_distribution(df):
    if "bad_posture_type" not in df.columns:
        return {
            "labels": ["Bad Posture"],
            "values": [int(df["is_bad_posture"].sum())]
        }

    bad_df = df[df["is_bad_posture"]].copy()

    if bad_df.empty:
        return {
            "labels": [],
            "values": []
        }

    bad_df["bad_posture_type"] = (
        bad_df["bad_posture_type"]
        .fillna("unknown")
        .astype(str)
        .replace({
            "none": "unknown",
            "nan": "unknown",
            "": "unknown"
        })
    )

    counts = bad_df["bad_posture_type"].value_counts()

    return {
        "labels": counts.index.astype(str).tolist(),
        "values": counts.astype(int).tolist()
    }


def build_session_patterns(df):
    if "session_id" not in df.columns:
        return {
            "labels": [],
            "avg_score": [],
            "bad_count": [],
            "bad_rate": []
        }

    grouped = (
        df.groupby("session_id")
        .agg(
            avg_score=("posture_score", "mean"),
            bad_count=("is_bad_posture", "sum"),
            total_count=("is_bad_posture", "count")
        )
        .reset_index()
    )

    grouped["avg_score"] = grouped["avg_score"].round(1)
    grouped["bad_rate"] = ((grouped["bad_count"] / grouped["total_count"]) * 100).round(1)

    # Sort by worst sessions first
    grouped = grouped.sort_values(["bad_rate", "avg_score"], ascending=[False, True])

    return {
        "labels": grouped["session_id"].astype(str).tolist(),
        "avg_score": grouped["avg_score"].astype(float).tolist(),
        "bad_count": grouped["bad_count"].astype(int).tolist(),
        "bad_rate": grouped["bad_rate"].astype(float).tolist()
    }


def build_behavior_summary(
    df,
    hourly_patterns,
    session_patterns,
    bad_type_distribution,
    total_records,
    bad_records,
    good_records,
    bad_percentage
):
    if hourly_patterns["bad_count"]:
        worst_hour_index = hourly_patterns["bad_count"].index(max(hourly_patterns["bad_count"]))
        worst_hour = int(hourly_patterns["labels"][worst_hour_index])
        worst_hour_bad_count = int(hourly_patterns["bad_count"][worst_hour_index])
    else:
        worst_hour = None
        worst_hour_bad_count = 0

    if hourly_patterns["avg_score"]:
        best_hour_index = hourly_patterns["avg_score"].index(max(hourly_patterns["avg_score"]))
        best_hour = int(hourly_patterns["labels"][best_hour_index])
    else:
        best_hour = None

    if bad_type_distribution["labels"]:
        most_common_bad_type = bad_type_distribution["labels"][0]
        most_common_bad_type_count = int(bad_type_distribution["values"][0])
    else:
        most_common_bad_type = "None"
        most_common_bad_type_count = 0

    if session_patterns["labels"]:
        worst_session = session_patterns["labels"][0]
        worst_session_bad_rate = float(session_patterns["bad_rate"][0])
    else:
        worst_session = "N/A"
        worst_session_bad_rate = 0

    insight = build_behavior_insight(
        bad_percentage,
        worst_hour,
        most_common_bad_type,
        worst_session
    )

    return {
        "total_records": total_records,
        "good_records": good_records,
        "bad_records": bad_records,
        "bad_percentage": bad_percentage,
        "worst_hour": worst_hour,
        "worst_hour_bad_count": worst_hour_bad_count,
        "best_hour": best_hour,
        "most_common_bad_type": most_common_bad_type,
        "most_common_bad_type_count": most_common_bad_type_count,
        "worst_session": worst_session,
        "worst_session_bad_rate": worst_session_bad_rate,
        "insight": insight
    }


def build_behavior_insight(bad_percentage, worst_hour, most_common_bad_type, worst_session):
    hour_text = f"{worst_hour}:00" if worst_hour is not None else "unknown time"

    readable_type = (
        str(most_common_bad_type)
        .replace("_", " ")
        .replace("-", " ")
        .title()
    )

    if bad_percentage >= 50:
        risk_text = "A high portion of readings show bad posture."
    elif bad_percentage >= 25:
        risk_text = "Bad posture appears regularly but is not dominant."
    else:
        risk_text = "Bad posture appears occasionally."

    return (
        f"{risk_text} The most repeated poor-posture period is around {hour_text}. "
        f"The most common bad posture type is {readable_type}. "
        f"The weakest session is {worst_session}."
    )