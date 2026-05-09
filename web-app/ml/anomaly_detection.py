import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler


def get_existing_anomaly_features(df):
    possible_features = [
        "fsr1_adc",
        "fsr2_adc",
        "fsr3_adc",
        "fsr4_adc",
        "distance_cm",
        "accel_x",
        "accel_y",
        "accel_z",
        "seat_balance_lr",
        "seat_balance_fb",
        "total_force_g",
        "total_pressure_kpa",
    ]

    return [col for col in possible_features if col in df.columns]


def get_anomaly_detection_analysis(df):
    df = df.copy()

    if "timestamp" not in df.columns:
        raise ValueError("timestamp column is required.")

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df = df[df["timestamp"].notna()]

    if df.empty:
        raise ValueError("No valid timestamp rows found.")

    feature_cols = get_existing_anomaly_features(df)

    if len(feature_cols) < 3:
        raise ValueError("Not enough numeric sensor features for anomaly detection.")

    model_df = df[feature_cols].apply(pd.to_numeric, errors="coerce").dropna()

    if model_df.empty:
        raise ValueError("No valid numeric rows found for anomaly detection.")

    original_index = model_df.index

    scaler = StandardScaler()
    x_scaled = scaler.fit_transform(model_df)

    model = IsolationForest(
        n_estimators=150,
        contamination=0.05,
        random_state=42
    )

    predictions = model.fit_predict(x_scaled)
    anomaly_scores = model.decision_function(x_scaled)

    result_df = df.loc[original_index].copy()
    result_df["is_anomaly"] = predictions == -1
    result_df["anomaly_score"] = anomaly_scores.round(4)

    total_records = len(result_df)
    anomaly_count = int(result_df["is_anomaly"].sum())
    normal_count = total_records - anomaly_count
    anomaly_percentage = round((anomaly_count / total_records) * 100, 1)

    timeline = build_compact_timeline(result_df)

    return {
        "summary": {
            "total_records": total_records,
            "normal_count": normal_count,
            "anomaly_count": anomaly_count,
            "anomaly_percentage": anomaly_percentage,
            "model": "Isolation Forest",
            "contamination": 0.05
        },
        "features_used": feature_cols,
        "timeline": timeline
    }


def build_compact_timeline(result_df):
    """
    Compresses many raw sensor readings into readable time buckets.
    This prevents the chart from becoming extremely long.
    """

    timeline_df = result_df.copy()
    timeline_df = timeline_df[timeline_df["timestamp"].notna()]

    if timeline_df.empty:
        return []

    # Change this if needed:
    # "1min" = more detailed
    # "5min" = cleaner
    # "10min" = very compact
    timeline_df["time_bucket"] = timeline_df["timestamp"].dt.floor("30min")

    grouped = (
        timeline_df
        .groupby("time_bucket")
        .agg(
            avg_score=("posture_score", "mean"),
            anomaly_count=("is_anomaly", "sum"),
            has_anomaly=("is_anomaly", "max"),
            min_anomaly_score=("anomaly_score", "min")
        )
        .reset_index()
        .sort_values("time_bucket")
    )

    # Keep only latest 40 buckets to avoid huge chart
    grouped = grouped.tail(10)

    timeline = []

    for _, row in grouped.iterrows():
        timeline.append({
            "time": row["time_bucket"].strftime("%m-%d %H:%M"),
            "score": round(float(row["avg_score"]), 1),
            "is_anomaly": bool(row["has_anomaly"]),
            "anomaly_count": int(row["anomaly_count"]),
            "anomaly_score": round(float(row["min_anomaly_score"]), 4)
        })

    return timeline