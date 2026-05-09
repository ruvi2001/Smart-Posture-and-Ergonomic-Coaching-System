import pandas as pd


def get_existing_numeric_features(df):
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
        "posture_score",
    ]

    return [col for col in possible_features if col in df.columns]


def get_correlation_analysis(df):
    df = df.copy()

    feature_cols = get_existing_numeric_features(df)

    if "posture_score" not in feature_cols:
        raise ValueError("posture_score column is required for correlation analysis.")

    numeric_df = df[feature_cols].apply(pd.to_numeric, errors="coerce").dropna()

    if numeric_df.empty:
        raise ValueError("No valid numeric data found for correlation analysis.")

    corr_matrix = numeric_df.corr().round(2)

    posture_corr = (
        corr_matrix["posture_score"]
        .drop("posture_score")
        .dropna()
        .sort_values(key=lambda x: x.abs(), ascending=False)
    )

    top_relationships = []

    for feature, value in posture_corr.head(5).items():
        strength = "Weak"

        if abs(value) >= 0.7:
            strength = "Strong"
        elif abs(value) >= 0.4:
            strength = "Moderate"

        direction = "positive" if value > 0 else "negative"

        top_relationships.append({
            "feature": feature,
            "correlation": float(value),
            "strength": strength,
            "direction": direction,
            "interpretation": build_interpretation(feature, value, strength, direction)
        })

    scatter_data = build_scatter_data(numeric_df)

    return {
        "features": feature_cols,
        "matrix": {
            "labels": corr_matrix.columns.tolist(),
            "values": corr_matrix.values.tolist()
        },
        "top_relationships": top_relationships,
        "scatter": scatter_data
    }


def build_scatter_data(df):
    scatter = {}

    if "distance_cm" in df.columns:
        scatter["distance_vs_score"] = {
            "x_label": "Screen Distance (cm)",
            "y_label": "Posture Score",
            "points": [
                {
                    "x": float(row["distance_cm"]),
                    "y": float(row["posture_score"])
                }
                for _, row in df[["distance_cm", "posture_score"]].head(500).iterrows()
            ]
        }

    if "seat_balance_fb" in df.columns:
        scatter["fb_balance_vs_score"] = {
            "x_label": "Front-Back Seat Balance",
            "y_label": "Posture Score",
            "points": [
                {
                    "x": float(row["seat_balance_fb"]),
                    "y": float(row["posture_score"])
                }
                for _, row in df[["seat_balance_fb", "posture_score"]].head(500).iterrows()
            ]
        }

    if "accel_y" in df.columns:
        scatter["accel_y_vs_score"] = {
            "x_label": "Accelerometer Y",
            "y_label": "Posture Score",
            "points": [
                {
                    "x": float(row["accel_y"]),
                    "y": float(row["posture_score"])
                }
                for _, row in df[["accel_y", "posture_score"]].head(500).iterrows()
            ]
        }

    return scatter


def build_interpretation(feature, value, strength, direction):
    readable = feature.replace("_", " ")

    if direction == "positive":
        return f"{readable} has a {strength.lower()} positive relationship with posture score. As this value increases, posture score tends to increase."
    else:
        return f"{readable} has a {strength.lower()} negative relationship with posture score. As this value increases, posture score tends to decrease."