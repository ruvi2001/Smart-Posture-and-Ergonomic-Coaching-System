# Smart Posture Final

## Project Overview

Smart Posture Final is a posture-monitoring system that combines an ESP32 firmware, a backend API, and a web application with machine learning analysis. The system collects sensor data from wearable devices, evaluates posture quality, alerts users to poor posture, and provides insights through a dashboard.

## Repository Structure

- `iot-system/`
  - `backend/`: Node.js backend service
    - `src/app.js`
    - `src/server.js`
    - `src/config/`: configuration for database and MQTT
    - `src/controllers/readingController.js`
    - `src/models/AlertLog.js`
    - `src/models/SensorReading.js`
    - `src/models/Session.js`
    - `src/routes/readingRoutes.js`
    - `src/services/`: posture analysis and session management
    - `src/utils/time.js`
  - `esp32-firmware/`: firmware for the ESP32 device
    - `platformio.ini`
    - `src/main.cpp`
- `web-app/`
  - `app.py`: Flask web application
  - `requirements.txt`
  - `static/`: CSS and JavaScript assets
  - `templates/`: HTML views and partials
  - `data/`: sample CSV data files for analysis
  - `ml/`: machine learning analysis modules

## Key Features

- Real-time posture tracking via ESP32
- Backend logging of sensor readings and posture alerts
- Web dashboard and chatbot UI for user interaction
- ML analysis for anomaly detection, behavior insights, and temporal patterns
- Data-driven insights and posture improvement guidance

## Backend Details

### `iot-system/backend`
- `src/app.js`: application setup and middleware configuration
- `src/server.js`: server startup and route registration
- `src/config/db.js`: database connection configuration
- `src/config/mqtt.js`: MQTT broker connection setup
- `src/controllers/readingController.js`: API endpoints for sensor readings
- `src/models/`: Mongoose schema models
  - `AlertLog.js`: stores posture alert events
  - `SensorReading.js`: stores raw posture sensor data
  - `Session.js`: stores session data and metadata
- `src/services/postureService.js`: posture score calculation and alert logic
- `src/services/sessionService.js`: session lifecycle logic
- `src/utils/time.js`: shared time utilities

## Firmware Details

### `iot-system/esp32-firmware`
- `platformio.ini`: PlatformIO configuration for ESP32 board
- `src/main.cpp`: main firmware code for collecting sensor data, sending to backend, and managing posture alerts

## Web Application

### `web-app/app.py`
- Flask-based application serving the frontend
- Integrates charts, dashboards, ML insights, chatbot, and user authentication views

### Frontend files
- `static/css/app.css`: website styling
- `static/js/dashboard.js`: dashboard interactions and visualizations
- `static/js/chat-page.js`: chatbot page behavior
- `static/js/floating-chat.js`: floating chat UI
- `static/js/insights.js`: insights page logic
- `static/js/ml-analysis.js`: ML analysis visualization

### Templates
- `templates/landing.html`: landing page
- `templates/login.html` / `signup.html`: authentication pages
- `templates/dashboard.html`: dashboard view
- `templates/insights.html`: posture insights
- `templates/ml_analysis.html`: machine learning results page
- `templates/settings.html`: settings page
- `templates/exercises.html`: exercise recommendations
- `templates/chatbot.html`: chat interface
- `templates/partials/floating_chat.html`: reusable chat partial

## Machine Learning Modules

### `web-app/ml/`
- `anomaly_detection.py`: identify unusual posture or activity patterns
- `behavior_analysis.py`: analyze posture behavior over time
- `correlation_analysis.py`: find relationships between sensor signals
- `data_loader.py`: load and prepare posture data
- `temporal_analysis.py`: analyze temporal trends

## Data Files

- `web-app/data/posture_data.csv`
- `web-app/data/smart_posture_db.sensorreadings.csv`

> Note: Data files are included for analysis and should be handled carefully if they contain sensitive or personal information.

## Setup and Usage

### Backend
1. Navigate to `iot-system/backend`
2. Install dependencies: `npm install`
3. Create a `.env` file with any required environment variables (do not commit it)
4. Start the server: `npm start` or `node src/server.js`

### Firmware
1. Open `iot-system/esp32-firmware` in PlatformIO
2. Configure board and upload firmware from `src/main.cpp`

### Web App
1. Navigate to `web-app`
2. Install Python dependencies: `pip install -r requirements.txt`
3. Run the web app: `python app.py`

## Git Best Practices

- Keep secrets out of source control by adding them to `.gitignore`
- Use `git rm --cached <file>` for files already tracked that should be ignored
- Commit a clean repository with documentation before pushing to GitHub

## Removing Sensitive Files from Git Tracking
If a file like `.env` has already been added to Git accidentally, run:

```bash
cd d:\smart-posture-final
git rm --cached iot-system/backend/.env
git commit -m "Remove .env from repository and add .gitignore"
```

Then push after authenticating:

```bash
git push -u origin master
```

## Future Improvements
- Add secure authentication and user management
- Expand posture alert personalization
- Improve ML model accuracy with more training data
- Add deployment scripts for production hosting
