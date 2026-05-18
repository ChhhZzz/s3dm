#!/usr/bin/env python3
import argparse
import json
import os
import re
import requests
import datetime
from xml.etree import ElementTree as ET

def extract_track_uuid(url):
    """Extract the track_uuid or ski_uuid from the shared URL."""
    # Try to find track_uuid first
    track_match = re.search(r'track_uuid=([^&]+)', url)
    if track_match:
        return track_match.group(1)
    
    # If track_uuid not found, try to find ski_uuid
    ski_match = re.search(r'ski_uuid=([^&]+)', url)
    if ski_match:
        return ski_match.group(1)
    
    raise ValueError("Could not find track_uuid or ski_uuid in the provided URL")

def fetch_track_data(track_uuid):
    """Fetch track data from the Huabei API."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Mobile) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://h5.fenxuekeji.com/',
    }

    url = f"https://api.fenxuekeji.com/api/tracks/{track_uuid}"
    response = requests.get(url, headers=headers)

    if response.status_code == 200:
        return response.json()

    url = f"https://api.fenxuekeji.com/api/skis/{track_uuid}"
    response = requests.get(url, headers=headers)

    if response.status_code != 200:
        raise ValueError(f"Failed to fetch track data: {response.status_code}")

    return response.json()

def get_default_filename(track_data):
    """Generate a default filename base (without extension) based on date and resort name."""
    try:
        # Get date
        if 'data' in track_data and 'track' in track_data['data']:
            # Try to get formatted date string first
            date_str = track_data['data']['track'].get('start_at_str')
            if date_str:
                # Use date string directly in YYYY-MM-DD format
                date_formatted = date_str
            else:
                # Fall back to timestamp if string date not available
                start_timestamp = track_data['data']['track'].get('start_at')
                if start_timestamp:
                    date_obj = datetime.datetime.fromtimestamp(start_timestamp)
                    date_formatted = date_obj.strftime("%Y-%m-%d")
                else:
                    date_formatted = "unknown_date"
        else:
            date_formatted = "unknown_date"

        # Get resort name
        if 'data' in track_data and 'ski_ranch' in track_data['data']:
            resort_name = track_data['data']['ski_ranch'].get('name', 'unknown_resort')
            # Clean resort name to make it file-system friendly
            resort_name = resort_name.replace('/', '-').replace('\\', '-').replace(' ', '_')
        else:
            resort_name = "unknown_resort"

        # Combine date and resort name (without extension)
        return f"{date_formatted} - {resort_name}"
    except Exception as e:
        print(f"Warning: Could not generate default filename: {str(e)}")
        if 'data' in track_data and 'track' in track_data['data'] and 'uuid' in track_data['data']['track']:
            return track_data['data']['track']['uuid']
        return "ski_track"

def parse_timestamp(timestamp_str):
    """Parse timestamp string to datetime object."""
    try:
        # Format is likely "YYYY-MM-DD HH:MM:SS"
        return datetime.datetime.strptime(timestamp_str, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        # Try alternative formats if necessary
        try:
            return datetime.datetime.strptime(timestamp_str, "%Y-%m-%d %H:%M")
        except ValueError:
            return None

def create_gpx(track_data, timezone_offset=0):
    """Convert track data to GPX format."""
    # Create the root GPX element
    gpx = ET.Element('gpx')
    gpx.set('version', '1.1')
    gpx.set('creator', 'Huabei to Slopes Converter')
    gpx.set('xmlns', 'http://www.topografix.com/GPX/1/1')
    gpx.set('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance')
    gpx.set('xsi:schemaLocation', 'http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd')
    
    # Extract track information
    if 'data' in track_data and 'track' in track_data['data']:
        track_info = track_data['data']['track']
        # Use the formatted date-time if available
        if 'start_at_str_format' in track_info:
            track_name = f"Ski Track - {track_info['start_at_str_format']}"
        else:
            track_name = f"Ski Track - {track_info.get('start_at_str', 'Unknown')}"
        
        # Get resort name if available
        if 'ski_ranch' in track_data['data'] and 'name' in track_data['data']['ski_ranch']:
            resort_name = track_data['data']['ski_ranch']['name']
            track_name = f"{track_name} at {resort_name}"
    else:
        track_name = "Ski Track"
    
    # Add metadata
    metadata = ET.SubElement(gpx, 'metadata')
    name = ET.SubElement(metadata, 'name')
    name.text = track_name
    
    # Extract GPS coordinates (track_detail) and altitude/time data (altitude_arr)
    runs = []
    altitude_data = []
    total_points = 0
    
    if 'data' in track_data:
        if 'track_detail' in track_data['data']:
            # track_detail is a collection of runs, with each run being a list of coordinates
            runs = track_data['data']['track_detail']
            for run in runs:
                total_points += len(run)
            print(f"Found {len(runs)} ski runs with a total of {total_points} coordinate points")
        
        if 'altitude_arr' in track_data['data']:
            altitude_data = track_data['data']['altitude_arr']
            if altitude_data and isinstance(altitude_data[0], list) and len(altitude_data[0]) >= 2:
                # If altitude_arr exists and has the expected format
                print(f"Found altitude/time data")
    
    if not runs:
        raise ValueError("No coordinate data found in the track data")
    
    # Create track element
    trk = ET.SubElement(gpx, 'trk')
    trk_name = ET.SubElement(trk, 'name')
    trk_name.text = track_name
    
    # Get the max altitude for default elevation if needed
    default_elevation = None
    if 'data' in track_data and 'track' in track_data['data']:
        default_elevation = track_data['data']['track'].get('max_altitude_meter')
    
    # Process each run as a separate trkseg
    total_added_points = 0
    
    # Get time offset from track start time if available
    start_time = None
    if 'data' in track_data and 'track' in track_data['data']:
        start_time = track_data['data']['track'].get('start_at')
    
    # Process each run
    for run_idx, run in enumerate(runs):
        # Create a new track segment for this run
        trkseg = ET.SubElement(trk, 'trkseg')
        run_points = 0
        
        # Process each point in the run
        for point_idx, coord in enumerate(run):
            if len(coord) >= 2:  # Ensure we have at least lon, lat
                trkpt = ET.SubElement(trkseg, 'trkpt')
                # In GPX format, latitude comes first as an attribute
                trkpt.set('lat', str(coord[1]))  # Latitude is second in coordinate
                trkpt.set('lon', str(coord[0]))  # Longitude is first in coordinate
                
                # Add elevation if available from altitude_arr
                # Note: altitude_arr may not directly map to track points, so we need to be careful
                if altitude_data and run_idx < len(altitude_data) and point_idx < len(altitude_data[run_idx]):
                    alt_point = altitude_data[run_idx][point_idx]
                    if isinstance(alt_point, list) and len(alt_point) >= 1:
                        ele = ET.SubElement(trkpt, 'ele')
                        ele.text = str(alt_point[0])  # First element is elevation
                        
                        # Add time if available
                        if len(alt_point) >= 2 and isinstance(alt_point[1], str):
                            time_str = alt_point[1]  # Second element is timestamp string
                            timestamp = parse_timestamp(time_str)
                            if timestamp:
                                # Adjust for timezone offset
                                timestamp = timestamp + datetime.timedelta(hours=timezone_offset)
                                time_elem = ET.SubElement(trkpt, 'time')
                                time_elem.text = timestamp.strftime('%Y-%m-%dT%H:%M:%S') + f"{timezone_offset:+03d}:00"
                elif default_elevation is not None:
                    # Use default elevation if no specific elevation data
                    ele = ET.SubElement(trkpt, 'ele')
                    ele.text = str(default_elevation)
                
                # Add time based on start_time if we don't have specific time data but have start_time
                if start_time and trkpt.find('time') is None:
                    time_elem = ET.SubElement(trkpt, 'time')
                    point_time = datetime.datetime.fromtimestamp(start_time + total_added_points + point_idx)
                    # Adjust for timezone offset
                    point_time = point_time + datetime.timedelta(hours=timezone_offset)
                    time_elem.text = point_time.strftime('%Y-%m-%dT%H:%M:%S') + f"{timezone_offset:+03d}:00"
                
                run_points += 1
        
        total_added_points += run_points
        print(f"Added {run_points} points from RUN {run_idx+1}")
    
    print(f"Total points added to the GPX file: {total_added_points}")
    return ET.ElementTree(gpx)

def load_json_file(file_path):
    """Load JSON data from a file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_gpx(gpx_tree, output_file):
    """Save the GPX tree to a file."""
    gpx_tree.write(output_file, encoding='utf-8', xml_declaration=True)

def save_json(track_data, output_file):
    """Save the track data to a JSON file."""
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(track_data, f, ensure_ascii=False, indent=2)

def process_track(url, timezone_offset=0, output_dir='tracks'):
    """Process a single track URL and return the output filename."""
    try:
        # Extract UUID from URL
        track_uuid = extract_track_uuid(url)
        print(f"Extracted track UUID: {track_uuid}")

        print(f"Fetching track data...")
        track_data = fetch_track_data(track_uuid)

        # Generate default filename base (without extension) based on date and resort
        filename_base = get_default_filename(track_data)

        # Use 'tracks' folder as default output directory
        if output_dir:
            output_dir_path = output_dir
        else:
            output_dir_path = 'tracks'

        # Create subdirectories for JSON and GPX files
        json_dir = os.path.join(output_dir_path, 'json')
        gpx_dir = os.path.join(output_dir_path, 'gpx')

        # Create directories if they don't exist
        if not os.path.exists(json_dir):
            os.makedirs(json_dir)
        if not os.path.exists(gpx_dir):
            os.makedirs(gpx_dir)

        # Generate full paths for both files
        json_file = os.path.join(json_dir, f"{filename_base}.json")
        gpx_file = os.path.join(gpx_dir, f"{filename_base}.gpx")

        # Save JSON file
        print(f"Saving JSON to {json_file}...")
        save_json(track_data, json_file)

        print(f"Converting to GPX format with timezone offset: {timezone_offset} hours...")
        gpx_tree = create_gpx(track_data, timezone_offset)

        print(f"Saving GPX to {gpx_file}...")
        save_gpx(gpx_tree, gpx_file)

        print(f"Conversion completed successfully.")
        print(f"  JSON: {json_file}")
        print(f"  GPX:  {gpx_file}")
        return gpx_file

    except Exception as e:
        print(f"Error processing {url}: {str(e)}")
        return None

def process_json_file(json_file_path, timezone_offset=0, output_dir='tracks'):
    """Process a local JSON file and return the output filename."""
    try:
        print(f"Loading JSON data from {json_file_path}...")
        track_data = load_json_file(json_file_path)

        # Generate default filename base (without extension) based on date and resort
        filename_base = get_default_filename(track_data)

        # Use 'tracks' folder as default output directory
        if output_dir:
            output_dir_path = output_dir
        else:
            output_dir_path = 'tracks'

        # Create subdirectory for GPX files
        gpx_dir = os.path.join(output_dir_path, 'gpx')

        # Create directory if it doesn't exist
        if not os.path.exists(gpx_dir):
            os.makedirs(gpx_dir)

        # Generate full path for GPX file (JSON is already loaded from source)
        gpx_file = os.path.join(gpx_dir, f"{filename_base}.gpx")

        print(f"Converting to GPX format with timezone offset: {timezone_offset} hours...")
        gpx_tree = create_gpx(track_data, timezone_offset)

        print(f"Saving GPX to {gpx_file}...")
        save_gpx(gpx_tree, gpx_file)

        print(f"Conversion completed successfully. The GPX file is saved to {gpx_file}")
        return gpx_file

    except Exception as e:
        print(f"Error processing {json_file_path}: {str(e)}")
        return None

def handle_duplicate_filenames(files, output_dir='tracks'):
    """Handle duplicate filenames by adding sequential numbers for both JSON and GPX files."""
    # Group files by base filename (without extension and without directory)
    filename_groups = {}
    for file in files:
        if file:  # Skip None values
            # Get just the filename without directory and extension
            base_name = os.path.splitext(os.path.basename(file))[0]
            if base_name not in filename_groups:
                filename_groups[base_name] = []
            filename_groups[base_name].append(file)

    # Rename files in groups with more than one file
    for base_name, group in filename_groups.items():
        if len(group) > 1:
            for i, file in enumerate(group, 1):
                # Get the file extension
                ext = os.path.splitext(file)[1]
                # Get the directory of the file
                file_dir = os.path.dirname(file)
                new_name = os.path.join(file_dir, f"{base_name}_{i}{ext}")
                if file != new_name:  # Only rename if the name is different
                    os.rename(file, new_name)
                    print(f"Renamed {file} to {new_name}")

    # Handle corresponding files in the other directory
    # Check for duplicates in gpx dir and rename corresponding json files
    gpx_dir = os.path.join(output_dir, 'gpx')
    json_dir = os.path.join(output_dir, 'json')

    if os.path.exists(gpx_dir) and os.path.exists(json_dir):
        for filename in os.listdir(gpx_dir):
            if '_' in filename and filename.endswith('.gpx'):
                # Extract base name and number
                name_parts = filename.rsplit('_', 1)
                if len(name_parts) == 2:
                    base_name, num_ext = name_parts
                    num = num_ext.replace('.gpx', '')
                    if num.isdigit():
                        # Check if corresponding numbered json exists
                        json_file = os.path.join(json_dir, f"{base_name}.json")
                        new_json_name = os.path.join(json_dir, f"{base_name}_{num}.json")
                        if os.path.exists(json_file) and not os.path.exists(new_json_name):
                            os.rename(json_file, new_json_name)
                            print(f"Renamed {json_file} to {new_json_name}")

def is_url(string):
    """Check if a string is a URL."""
    return string.startswith('http://') or string.startswith('https://')

def is_json_file(string):
    """Check if a string is a JSON file path."""
    return string.endswith('.json') and os.path.isfile(string)

def load_urls_from_tracks_md(tracks_md_path):
    """Extract URLs from a tracks.md file."""
    urls = []
    with open(tracks_md_path, 'r', encoding='utf-8') as f:
        content = f.read()
    for line in content.splitlines():
        line = line.strip()
        if line.startswith('http://') or line.startswith('https://'):
            urls.append(line)
    return urls

def main():
    parser = argparse.ArgumentParser(description='Convert Huabei ski tracks to GPX format')
    parser.add_argument('inputs', nargs='*', help='Huabei shared URLs or local JSON file paths (default: read from tracks.md)')
    parser.add_argument('-o', '--output-dir', help='Output directory for files (default: tracks)')
    parser.add_argument('-t', '--timezone', type=int, default=0,
                      help='Timezone offset in hours (e.g., -7 for Mountain Time, 8 for China Standard Time)')

    args = parser.parse_args()

    if not args.inputs:
        default_tracks = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tracks.md')
        if os.path.isfile(default_tracks):
            print(f"No inputs specified, reading URLs from {default_tracks}")
            args.inputs = load_urls_from_tracks_md(default_tracks)
            print(f"Found {len(args.inputs)} track(s) to process")
        else:
            parser.error("No inputs specified and tracks.md not found")

    # Use 'tracks' as default output directory if not specified
    output_dir = args.output_dir if args.output_dir else 'tracks'

    output_files = []
    for input_path in args.inputs:
        if is_url(input_path):
            # Process as URL
            output_file = process_track(input_path, args.timezone, output_dir)
            if output_file:
                output_files.append(output_file)
        elif is_json_file(input_path):
            # Process as local JSON file
            output_file = process_json_file(input_path, args.timezone, output_dir)
            if output_file:
                output_files.append(output_file)
        else:
            print(f"Error: '{input_path}' is neither a valid URL nor a JSON file")

    # Handle duplicate filenames
    handle_duplicate_filenames(output_files, output_dir)

    return 0

if __name__ == "__main__":
    exit(main())
