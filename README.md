# RBAC_TPS Streamlit Demo

This repo contains a Streamlit dashboard for exploring TPS Major Crime Indicators near TTC stops, including:

- Interactive folium map of crimes linked to nearest stops
- Baseline risk scoring
- Rolling trend risk module
- **Spike detection** (TPS 2-hour surge rule)

## Run locally

```bash
python -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m streamlit run app_streamlit.py
```

## Deploy on Streamlit Community Cloud

1. Push this repo to GitHub.
2. In Streamlit Cloud, create a new app and point it at this repo.
3. Set the main file to `app_streamlit.py`.

This repo includes a small sample crime dataset at:

- `data/sample/Major_Crime_Indicators_sample.csv`

The full TPS export is intentionally **not** committed (it can be large). You can upload your own CSV from the UI.

## Data expectations

The app expects:
- `stops.txt` with `stop_id, stop_name, stop_lat, stop_lon`
- Crime CSV with columns that can be resolved to:
  - datetime (`report_date` / `occurrence_date` / `occurrence_datetime`)
  - latitude (`lat_wgs84` / `latitude`)
  - longitude (`long_wgs84` / `longitude`)
  - `division`
  - optional crime type (`MCI` / `crime_type`)
