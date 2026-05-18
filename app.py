#!/usr/bin/env python3
"""Ski Track 3D Visualization - Backend Server"""

import os
import re
import math
import xml.etree.ElementTree as ET
from flask import Flask, jsonify, render_template, abort
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # 启用跨域支持，允许前端访问

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GPX_DIR = os.path.join(BASE_DIR, 'tracks', 'gpx')
GPX_TERRAIN_DIR = os.path.join(BASE_DIR, 'tracks', 'gpx_terrain')
JSON_DIR = os.path.join(BASE_DIR, 'tracks', 'json')

GPX_NS = {'gpx': 'http://www.topografix.com/GPX/1/1'}


def parse_gpx_file(filepath):
    """Parse a GPX file and extract track data."""
    tree = ET.parse(filepath)
    root = tree.getroot()

    # Extract metadata name
    meta_name = ''
    meta_el = root.find('gpx:metadata/gpx:name', GPX_NS)
    if meta_el is not None:
        meta_name = meta_el.text or ''

    # Find the first <trk> element
    trk = root.find('gpx:trk', GPX_NS)
    if trk is None:
        return None

    # Track name
    trk_name = ''
    name_el = trk.find('gpx:name', GPX_NS)
    if name_el is not None:
        trk_name = name_el.text or ''
    if not trk_name:
        trk_name = meta_name

    # Parse resort name and date from track name
    resort_name, ski_date = parse_track_name(trk_name)

    # Extract all trkseg
    runs = []
    for seg_idx, trkseg in enumerate(trk.findall('gpx:trkseg', GPX_NS)):
        points = []
        for trkpt in trkseg.findall('gpx:trkpt', GPX_NS):
            lat = float(trkpt.get('lat'))
            lon = float(trkpt.get('lon'))
            ele_el = trkpt.find('gpx:ele', GPX_NS)
            ele = float(ele_el.text) if ele_el is not None else 0
            time_el = trkpt.find('gpx:time', GPX_NS)
            time_str = time_el.text if time_el is not None else ''
            points.append({
                'lat': lat,
                'lon': lon,
                'ele': ele,
                'time': time_str
            })
        if points:
            runs.append({
                'index': seg_idx,
                'points': points
            })

    if not runs:
        return None

    # Calculate statistics
    all_elevations = [p['ele'] for run in runs for p in run['points']]
    max_ele = max(all_elevations) if all_elevations else 0
    min_ele = min(all_elevations) if all_elevations else 0

    total_distance = 0
    for run in runs:
        for i in range(1, len(run['points'])):
            total_distance += haversine(
                run['points'][i - 1]['lat'], run['points'][i - 1]['lon'],
                run['points'][i]['lat'], run['points'][i]['lon']
            )

    # Parse filename for fallback info
    filename = os.path.basename(filepath)
    if not resort_name:
        resort_name = parse_resort_from_filename(filename)
    if not ski_date:
        ski_date = parse_date_from_filename(filename)

    return {
        'name': trk_name,
        'resort': resort_name,
        'date': ski_date,
        'filename': filename,
        'totalRuns': len(runs),
        'totalPoints': sum(len(run['points']) for run in runs),
        'totalDistance': round(total_distance, 1),
        'maxElevation': max_ele,
        'minElevation': min_ele,
        'verticalDrop': round(max_ele - min_ele, 1),
        'runs': runs
    }


def parse_track_name(track_name):
    """Parse resort name and date from track name like 'Ski Track - 2026-01-24 16:04 at 万科石京龙滑雪场'."""
    resort = ''
    date_str = ''

    # Extract date (YYYY-MM-DD)
    date_match = re.search(r'(\d{4}-\d{2}-\d{2})', track_name)
    if date_match:
        date_str = date_match.group(1)

    # Extract resort name (after 'at ')
    at_match = re.search(r'at\s+(.+)$', track_name)
    if at_match:
        resort = at_match.group(1).strip()

    return resort, date_str


def parse_resort_from_filename(filename):
    """Extract resort name from filename like '2026-01-24 - 万科石京龙滑雪场.gpx'."""
    match = re.match(r'\d{4}-\d{2}-\d{2}\s*-\s*(.+)\.gpx', filename)
    if match:
        return match.group(1).strip()
    return ''


def parse_date_from_filename(filename):
    """Extract date from filename."""
    match = re.match(r'(\d{4}-\d{2}-\d{2})', filename)
    if match:
        return match.group(1)
    return ''


def haversine(lat1, lon1, lat2, lon2):
    """Calculate distance in meters between two GPS coordinates."""
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


# Routes
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/files')
def list_files():
    """List all available GPX files."""
    try:
        files = sorted([f for f in os.listdir(GPX_DIR) if f.endswith('.gpx')])
        return jsonify(files)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/track/<filename>')
def get_track(filename):
    """Parse and return GPX track data as JSON."""
    # Basic security: prevent path traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        abort(400)

    filepath = os.path.join(GPX_DIR, filename)
    if not os.path.exists(filepath):
        abort(404)

    try:
        data = parse_gpx_file(filepath)
        if data is None:
            abort(500, description='Failed to parse GPX file')
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tracks')
def get_tracks():
    """Get list of all tracks with summary info."""
    try:
        files = sorted([f for f in os.listdir(GPX_DIR) if f.endswith('.gpx')])
        tracks = []
        for filename in files:
            filepath = os.path.join(GPX_DIR, filename)
            try:
                data = parse_gpx_file(filepath)
                if data:
                    tracks.append({
                        'filename': filename,
                        'name': data.get('name', ''),
                        'resort': data.get('resort', ''),
                        'date': data.get('date', ''),
                        'totalRuns': data.get('totalRuns', 0),
                        'totalDistance': data.get('totalDistance', 0)
                    })
            except Exception as e:
                print(f"Error parsing {filename}: {e}")
                continue
        return jsonify(tracks)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tracks/<filename>')
def get_track_detail(filename):
    """Get detailed track data by filename."""
    # Basic security: prevent path traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        abort(400)

    # Use gpx_terrain directory for _terrain.gpx files
    if '_terrain.gpx' in filename:
        filepath = os.path.join(GPX_TERRAIN_DIR, filename)
    else:
        filepath = os.path.join(GPX_DIR, filename)
    
    if not os.path.exists(filepath):
        abort(404)

    try:
        data = parse_gpx_file(filepath)
        if data is None:
            abort(500, description='Failed to parse GPX file')
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print(f"Starting Ski Track 3D Visualization Server on port 51092...")
    print(f"GPX files directory: {GPX_DIR}")
    app.run(debug=True, port=51092, host='0.0.0.0')
