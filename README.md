# Smart Posture and Ergonomic Coaching System

The Smart Posture and Ergonomic Coaching System is an IoT-based real-time posture monitoring solution designed to help users improve their sitting habits during long study or work sessions. The system uses sensors attached to a chair to collect posture-related data, process it through a backend server, store it in MongoDB, and display meaningful insights through an interactive dashboard.

The system uses an ESP32 microcontroller with FSR402 pressure sensors, an ADXL345 accelerometer, and an ultrasonic distance sensor. The pressure sensors measure seat pressure distribution, the accelerometer detects chair/backrest tilt, and the ultrasonic sensor measures the approximate distance between the user and the screen. These readings are transmitted using MQTT and processed by a Node.js backend.

The backend validates incoming sensor data, calculates derived features such as seat balance, total force, total pressure, posture score, posture status, and bad posture type. The processed data is stored in MongoDB Atlas for real-time monitoring and historical analysis.

A Flask-based dashboard presents live posture status, posture score, alerts, posture trends, heatmaps, correlation analysis, anomaly detection, and behaviour patterns. The system also includes a PostureAI chatbot that provides simple posture-related explanations and ergonomic recommendations.

## Main Features

- Real-time posture monitoring using IoT sensors
- Chair-integrated sensing without cameras or wearable devices
- ESP32-based sensor data collection
- MQTT-based lightweight IoT communication
- MongoDB Atlas storage for sensor readings
- Live dashboard with posture score and posture status
- Bad posture type detection such as forward slouching, backward slouching, left leaning, and right leaning
- Temporal trend analysis for daily, hourly, and session-based posture patterns
- Correlation analysis to identify important posture-related features
- Isolation Forest anomaly detection for unusual sensor patterns
- Behaviour analysis to identify repeated ergonomic risks
- PostureAI chatbot for user guidance and recommendations

## System Flow

1. Sensors collect posture-related data from the chair.
2. ESP32 reads sensor values and creates a JSON payload.
3. Sensor data is sent to the backend using MQTT over Wi-Fi.
4. The Node.js backend validates and processes the data.
5. Processed readings are stored in MongoDB Atlas.
6. The Flask dashboard displays real-time and historical insights.
7. ML and statistical analysis modules generate posture trends, anomalies, and recommendations.
8. The PostureAI chatbot helps users understand their posture results.

## Technologies Used

- ESP32
- FSR402 Pressure Sensors
- ADXL345 Accelerometer
- HC-SR05 Ultrasonic Sensor
- MQTT
- Node.js
- Express.js
- MongoDB Atlas
- Flask
- Python
- Pandas
- Scikit-learn
- Chart.js
- Ollama / Qwen2.5:3b
