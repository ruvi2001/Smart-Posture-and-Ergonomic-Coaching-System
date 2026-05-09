import os
import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
CSV_PATH = os.path.join(BASE_DIR, "data", "smart_posture_db.sensorreadings.csv")


def load_sensor_csv():
    df = pd.read_csv(CSV_PATH)

    if "recorded_at_utc" in df.columns:
        df["timestamp"] = pd.to_datetime(df["recorded_at_utc"], errors="coerce")
    elif "createdAt" in df.columns:
        df["timestamp"] = pd.to_datetime(df["createdAt"], errors="coerce")
    elif "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    else:
        raise ValueError("CSV needs recorded_at_utc, createdAt, or timestamp column.")
    
    df = df[df["timestamp"].notna()]
    df = df.sort_values("timestamp")

    if "is_occupied" in df.columns:
        df = df[df["is_occupied"] == True]

    if "posture_score" in df.columns:
        df = df[df["posture_score"].notna()]

    return df