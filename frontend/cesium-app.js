/**
 * Ski Track 3D Visualization - Cesium Application
 * 滑雪轨迹 3D 地形可视化应用 (Performance Optimized & Bug Fixed)
 */

// ==================== Constants ====================
const RUN_COLORS = [
  '#e94560', '#0ea5e9', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#06b6d4', '#d946ef', '#10b981', '#e11d48', '#3b82f6',
  '#fbbf24', '#ef4444', '#22d3ee', '#a855f7', '#34d399'
];

const SLOPE_COLORS = [
  { max: 12, color: '#22cc44', label: '平缓' },
  { max: 18, color: '#222dccff', label: '中等' },
  { max: 25, color: '#cc2222ff', label: '陡峭' },
  { max: 90, color: '#ff00bfff', label: '极陡' }
];

// 速度着色配置
const SPEED_COLORS = [
  { max: 20, color: '#22cc44', label: '慢速' },
  { max: 30, color: '#0ea5e9', label: '中速' },
  { max: 40, color: '#f59e0b', label: '快速' },
  { max: 999, color: '#e94560', label: '极速' }
];

// 【优化】：预先计算好半透明置灰的颜色，避免在循环中重复计算导致卡顿
const DIMMED_SLOPE_COLOR = Cesium.Color.fromCssColorString('#fd7b01ff').withAlpha(0.35); // 橙色
const DIMMED_SPEED_COLOR = Cesium.Color.fromCssColorString('#08bbf1ff').withAlpha(0.35); // 蓝色
const DIMMED_SOLID_COLOR = Cesium.Color.fromCssColorString('#f009abff').withAlpha(0.35); // 洋红

// Cesium Ion Token
const CESIUM_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiZmRlNWQzNS1lMWZiLTQ4YTktYmU3Zi03ZjcwZTJlMmJhMmMiLCJpZCI6NDMxNzkzLCJzdWIiOiJTa2llck1hcCIsImlzcyI6Imh0dHBzOi8vaW9uLmNlc2l1bS5jb20iLCJhdWQiOiJTa2kzRCIsImlhdCI6MTc3ODgxMTk4Nn0.EvHQAqMNfkD77qVjCIVaTOBJh1M2WPTXuviWmsHqiqU';

// ==================== State ====================
const state = {
  viewer: null,
  trackData: null,
  terrainTrackData: null,
  runEntities: [],
  visibleRuns: new Set(),
  colorMode: 'slope', // 'slope' | 'speed' | 'track'
  slopeColoring: true,
  terrainSnap: false,
  terrainSlope: false,
  slopeInterval: 0,
  showSmoothLine: false,
  lineWidth: 4,
  terrainEnabled: true,
  lightingEnabled: true,
  waterEnabled: false,
  currentTrackFilename: null,
  hoverHandler: null,
  hoverPointEntity: null,
  clickHandler: null,
  isFixed: false,
  fixedPoint: null,
  fixedEntity: null,
  smoothLineEntities: [],
  speedData: null // 存储计算后的速度数据
};

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initCesium();
    await loadTrackList();
    setupEventListeners();
    createLegend(); // 创建图例
    hideLoading();
  } catch (error) {
    console.error('Initialization error:', error);
    showError('初始化失败: ' + error.message);
  }
});

async function initCesium() {
  Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;

  state.viewer = new Cesium.Viewer('cesiumContainer', {
    terrain: Cesium.Terrain.fromWorldTerrain({
      requestVertexNormals: true,
      requestWaterMask: true
    }),
    baseLayer: Cesium.ImageryLayer.fromProviderAsync(
      Cesium.IonImageryProvider.fromAssetId(2)
    ),
    baseLayerPicker: true,
    sceneModePicker: true,
    navigationHelpButton: true,
    animation: false,
    timeline: false,
    homeButton: true,
    geocoder: true,
    fullscreenButton: false,
    requestRenderMode: true,
    maximumRenderTimeChange: 30
  });

  state.viewer.scene.globe.enableLighting = true;
  state.viewer.scene.globe.depthTestAgainstTerrain = true;

  state.viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(116.4, 39.9, 5000000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0
    }
  });

  setupHoverInteraction();
}

// ==================== Track Loading ====================
async function loadTrackList() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tracks`);
    const tracks = await response.json();

    const select = document.getElementById('fileSelect');
    select.innerHTML = '<option value="">-- 选择轨迹文件 --</option>';

    tracks.forEach(track => {
      const option = document.createElement('option');
      option.value = track.filename;
      option.textContent = `${track.resort} (${track.date})`;
      select.appendChild(option);
    });

    if (tracks.length > 0) {
      const lastTrack = tracks[tracks.length - 1];
      select.value = lastTrack.filename;
      await loadTrack(lastTrack.filename);
    }
  } catch (error) {
    console.error('Failed to load track list:', error);
  }
}

async function loadTrack(filename) {
  if (!filename) {
    clearTracks();
    return;
  }

  showLoading('正在加载轨迹数据...');

  try {
    const [originalResponse, terrainResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/api/tracks/${filename}`),
      fetch(`${API_BASE_URL}/api/tracks/${filename.replace('.gpx', '_terrain.gpx')}`)
    ]);

    state.trackData = await originalResponse.json();
    state.terrainTrackData = await terrainResponse.json();
    state.currentTrackFilename = filename;

    // 计算速度数据
    state.speedData = calculateSpeedData();

    updateStats(state.trackData);
    updateRunList(state.trackData.runs);

    visualizeTracks();
    flyToTrack();

  } catch (error) {
    console.error('Failed to load track:', error);
    showError('加载轨迹失败: ' + error.message);
    hideLoading();
  }
}

// ==================== Track Visualization ====================
function visualizeTracks() {
  clearTracks();
  clearSmoothLines();

  if (!state.trackData || !state.trackData.runs) {
    hideLoading();
    return;
  }

  const renderData = state.terrainSnap && state.terrainTrackData
    ? state.terrainTrackData
    : state.trackData;

  renderData.runs.forEach((run, index) => {
    const color = RUN_COLORS[index % RUN_COLORS.length];
    const entity = createRunEntity(run, index, color);
    state.runEntities.push({
      index: index,
      entity: entity,
      color: color,
      data: run
    });
  });

  if (state.showSmoothLine && state.slopeInterval > 0) {
    createSmoothLines(renderData);
  }

  updateTrackVisibility();
  hideLoading();
}

function createRunEntity(run, runIndex, color) {
  const positions = run.points.map(p =>
    Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.terrainEle || p.ele)
  );

  // 根据着色模式创建实体
  if (state.colorMode === 'slope') {
    return createAttributeColoredPolyline(run, runIndex, 'slope');
  } else if (state.colorMode === 'speed') {
    return createAttributeColoredPolyline(run, runIndex, 'speed');
  } else {
    // 轨迹着色模式 - 每条轨迹一个颜色
    const originalMaterial = new Cesium.PolylineGlowMaterialProperty({
      glowPower: 0.2,
      color: Cesium.Color.fromCssColorString(color)
    });

    const entity = state.viewer.entities.add({
      name: `Run ${runIndex + 1}`,
      polyline: {
        positions: positions,
        width: state.lineWidth,
        material: originalMaterial,
        clampToGround: false
      }
    });

    entity.customOriginalMaterial = originalMaterial;
    entity.colorMode = 'track';
    return entity;
  }
}

function createAttributeColoredPolyline(run, runIndex, attributeType) {
  const entities = [];
  const interval = state.slopeInterval;

  for (let i = 0; i < run.points.length - 1; i++) {
    const p1 = run.points[i];
    const p2 = run.points[i + 1];

    const p1Ele = p1.terrainEle || p1.ele;
    const p2Ele = p2.terrainEle || p2.ele;

    let colorStr;
    let attributeValue;

    if (attributeType === 'slope') {
      attributeValue = calculateSlopeWithInterval(runIndex, i, interval);
      colorStr = getSlopeColor(attributeValue);
    } else if (attributeType === 'speed') {
      attributeValue = getSpeedAtPoint(runIndex, i);
      colorStr = getSpeedColor(attributeValue);
    }

    const originalCesiumColor = Cesium.Color.fromCssColorString(colorStr);

    const entity = state.viewer.entities.add({
      name: `Run ${runIndex + 1} - Segment ${i}`,
      polyline: {
        positions: [
          Cesium.Cartesian3.fromDegrees(p1.lon, p1.lat, p1Ele),
          Cesium.Cartesian3.fromDegrees(p2.lon, p2.lat, p2Ele)
        ],
        width: state.lineWidth,
        material: originalCesiumColor,
        clampToGround: false
      },
      properties: {
        runIndex: runIndex,
        pointIndex: i,
        lat: p1.lat,
        lon: p1.lon,
        ele: p1Ele,
        slope: attributeType === 'slope' ? attributeValue : calculateSlopeWithInterval(runIndex, i, interval),
        speed: attributeType === 'speed' ? attributeValue : getSpeedAtPoint(runIndex, i)
      }
    });

    entity.customOriginalColor = originalCesiumColor;
    entity.colorMode = attributeType;
    entities.push(entity);
  }

  return entities;
}

function clearTracks() {
  state.runEntities.forEach(item => {
    if (Array.isArray(item.entity)) {
      item.entity.forEach(e => state.viewer.entities.remove(e));
    } else {
      state.viewer.entities.remove(item.entity);
    }
  });
  state.runEntities = [];
}

function clearSmoothLines() {
  state.smoothLineEntities.forEach(entity => {
    state.viewer.entities.remove(entity);
  });
  state.smoothLineEntities = [];
}

function createSmoothLines(renderData) {
  renderData.runs.forEach((run, runIndex) => {
    const color = RUN_COLORS[runIndex % RUN_COLORS.length];
    const points = run.points;
    if (points.length < 2) return;

    const interval = state.slopeInterval;
    const frontOffset = Math.ceil(interval / 2);
    const backOffset = Math.floor(interval / 2) + 1;

    const smoothPositions = [];

    for (let i = 0; i < points.length; i++) {
      const startIndex = Math.max(i - frontOffset, 0);
      const endIndex = Math.min(i + backOffset, points.length - 1);

      if (i === startIndex || i === endIndex || i % (interval + 1) === 0) {
        const p = points[i];
        const ele = p.terrainEle || p.ele;
        smoothPositions.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, ele));
      }
    }

    if (smoothPositions.length < 2) return;

    const smoothEntity = state.viewer.entities.add({
      name: `Smooth Line ${runIndex + 1}`,
      properties: { runIndex: runIndex },
      polyline: {
        positions: smoothPositions,
        width: state.lineWidth + 2,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.3,
          color: Cesium.Color.fromCssColorString(color).withAlpha(0.6)
        }),
        clampToGround: false
      }
    });

    state.smoothLineEntities.push(smoothEntity);
  });
}

function updateTrackVisibility() {
  requestAnimationFrame(() => {
    state.runEntities.forEach(item => {
      const isVisible = state.visibleRuns.has(item.index);

      if (Array.isArray(item.entity)) {
        // 坡度或速度着色模式
        item.entity.forEach(e => {
          e.show = true;
          // 根据着色模式选择对应的半透明颜色
          let dimmedColor;
          if (e.colorMode === 'speed') {
            dimmedColor = DIMMED_SPEED_COLOR;
          } else {
            dimmedColor = DIMMED_SLOPE_COLOR;
          }
          e.polyline.material = isVisible ? e.customOriginalColor : dimmedColor;
        });
      } else {
        // 轨迹着色模式
        item.entity.show = true;
        item.entity.polyline.material = isVisible ? item.entity.customOriginalMaterial : DIMMED_SOLID_COLOR;
      }
    });

    // 平滑线根据可见性显示/隐藏
    state.smoothLineEntities.forEach(entity => {
      const runIndex = entity.properties?.runIndex?.getValue?.();
      if (runIndex !== undefined) {
        entity.show = state.visibleRuns.has(runIndex);
      }
    });

    state.viewer.scene.requestRender();
  });
}

// ==================== Helper Functions ====================
function calculateSlope(p1, p2) {
  const dx = haversineDistance(p1.lat, p1.lon, p2.lat, p2.lon);
  const dy = Math.abs(p2.ele - p1.ele);
  return dx > 0 ? Math.atan2(dy, dx) * 180 / Math.PI : 0;
}

function calculateSlopeWithInterval(runIndex, currentIndex, interval) {
  const originalPoints = state.trackData.runs[runIndex].points;

  const frontOffset = Math.ceil(interval / 2);
  const backOffset = Math.floor(interval / 2) + 1;

  const startIndex = Math.max(currentIndex - frontOffset, 0);
  const endIndex = Math.min(currentIndex + backOffset, originalPoints.length - 1);

  const p1Original = originalPoints[startIndex];
  const p2Original = originalPoints[endIndex];

  let p1Ele = p1Original.ele;
  let p2Ele = p2Original.ele;

  if (state.terrainSlope && state.terrainTrackData) {
    const terrainPoints = state.terrainTrackData.runs[runIndex].points;
    p1Ele = terrainPoints[startIndex].terrainEle || terrainPoints[startIndex].ele;
    p2Ele = terrainPoints[endIndex].terrainEle || terrainPoints[endIndex].ele;
  }

  const p1Slope = { ...p1Original, ele: p1Ele };
  const p2Slope = { ...p2Original, ele: p2Ele };

  return calculateSlope(p1Slope, p2Slope);
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getSlopeColor(slope) {
  for (const sc of SLOPE_COLORS) {
    if (slope < sc.max) return sc.color;
  }
  return SLOPE_COLORS[SLOPE_COLORS.length - 1].color;
}

function getSlopeLabel(slope) {
  for (const sc of SLOPE_COLORS) {
    if (slope < sc.max) return sc.label;
  }
  return SLOPE_COLORS[SLOPE_COLORS.length - 1].label;
}

function getSpeedColor(speed) {
  for (const sc of SPEED_COLORS) {
    if (speed < sc.max) return sc.color;
  }
  return SPEED_COLORS[SPEED_COLORS.length - 1].color;
}

function getSpeedLabel(speed) {
  for (const sc of SPEED_COLORS) {
    if (speed < sc.max) return sc.label;
  }
  return SPEED_COLORS[SPEED_COLORS.length - 1].label;
}

// 计算所有点的速度
function calculateSpeedData() {
  if (!state.trackData || !state.trackData.runs) return null;

  const speedData = [];
  state.trackData.runs.forEach((run, runIndex) => {
    const runSpeeds = [];
    const points = run.points;
    
    for (let i = 0; i < points.length; i++) {
      if (i === 0) {
        runSpeeds.push(0);
        continue;
      }
      
      const p1 = points[i - 1];
      const p2 = points[i];
      
      // 计算距离（米）
      const distance = haversineDistance(p1.lat, p1.lon, p2.lat, p2.lon);
      
      // 计算时间差（秒）
      const t1 = new Date(p1.time).getTime();
      const t2 = new Date(p2.time).getTime();
      const timeDiff = (t2 - t1) / 1000;
      
      // 计算速度（km/h）
      let speed = 0;
      if (timeDiff > 0) {
        speed = (distance / timeDiff) * 3.6;
      }
      
      // 平滑处理：使用间隔平均
      const interval = state.slopeInterval;
      if (interval > 0 && i > interval) {
        let totalSpeed = 0;
        let count = 0;
        const startIdx = Math.max(0, i - interval);
        for (let j = startIdx; j <= i; j++) {
          if (runSpeeds[j] !== undefined) {
            totalSpeed += runSpeeds[j];
            count++;
          }
        }
        if (count > 0) {
          speed = totalSpeed / count;
        }
      }
      
      runSpeeds.push(speed);
    }
    
    speedData.push(runSpeeds);
  });
  
  return speedData;
}

// 获取指定点的速度
function getSpeedAtPoint(runIndex, pointIndex) {
  if (!state.speedData || !state.speedData[runIndex]) return 0;
  return state.speedData[runIndex][pointIndex] || 0;
}

// ==================== Legend ====================
function createLegend() {
  const legend = document.createElement('div');
  legend.id = 'legendPanel';
  legend.className = 'legend-panel';
  legend.innerHTML = `
    <div class="legend-title">图例</div>
    <div class="legend-content" id="legendContent"></div>
  `;
  document.body.appendChild(legend);
  updateLegend();
}

function updateLegend() {
  const content = document.getElementById('legendContent');
  if (!content) return;

  let html = '';
  
  if (state.colorMode === 'slope') {
    html = '<div class="legend-section">坡度等级</div>';
    SLOPE_COLORS.forEach(item => {
      html += `
        <div class="legend-item">
          <div class="legend-color" style="background: ${item.color}"></div>
          <span class="legend-label">&lt; ${item.max}° (${item.label})</span>
        </div>
      `;
    });
  } else if (state.colorMode === 'speed') {
    html = '<div class="legend-section">速度等级</div>';
    SPEED_COLORS.forEach((item, index) => {
      const prevMax = index === 0 ? 0 : SPEED_COLORS[index - 1].max;
      html += `
        <div class="legend-item">
          <div class="legend-color" style="background: ${item.color}"></div>
          <span class="legend-label">${prevMax}-${item.max === 999 ? '40+' : item.max} km/h (${item.label})</span>
        </div>
      `;
    });
  } else {
    html = '<div class="legend-section">轨迹颜色</div>';
    html += '<div class="legend-item"><span class="legend-text">每条轨迹使用不同颜色</span></div>';
  }
  
  content.innerHTML = html;
}

// ==================== UI Updates ====================
function updateStats(data) {
  document.getElementById('statRuns').textContent = data.totalRuns || '-';
  document.getElementById('statDistance').textContent = data.totalDistance ?
    `${data.totalDistance.toFixed(1)} km` : '-';
  document.getElementById('statMaxEle').textContent = data.maxElevation ?
    `${data.maxElevation.toFixed(0)} m` : '-';
  document.getElementById('statMinEle').textContent = data.minElevation ?
    `${data.minElevation.toFixed(0)} m` : '-';
}

function updateRunList(runs) {
  const container = document.getElementById('runList');
  container.innerHTML = '';

  state.visibleRuns.clear();

  if (!runs) return;

  runs.forEach((run, index) => {
    state.visibleRuns.add(index);

    const color = RUN_COLORS[index % RUN_COLORS.length];
    const item = document.createElement('div');
    item.className = 'run-item';
    item.innerHTML = `
      <input type="checkbox" class="run-checkbox" checked data-index="${index}">
      <div class="run-color" style="background: ${color}"></div>
      <span class="run-label">雪道 ${index + 1}</span>
      <span class="run-points">${run.points.length} 点</span>
    `;

    item.querySelector('.run-checkbox').addEventListener('change', (e) => {
      if (e.target.checked) {
        state.visibleRuns.add(index);
      } else {
        state.visibleRuns.delete(index);
      }
      updateSelectAllButtonState();
      updateTrackVisibility();
    });

    container.appendChild(item);
  });

  updateSelectAllButtonState();
}

function updateSelectAllButtonState() {
  const selectAllBtn = document.getElementById('selectAllBtn');
  const checkboxes = document.querySelectorAll('.run-checkbox');
  if (checkboxes.length === 0) return;
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);

  if (allChecked) {
    selectAllBtn.textContent = '取消全选';
    selectAllBtn.classList.add('active');
  } else {
    selectAllBtn.textContent = '全选';
    selectAllBtn.classList.remove('active');
  }
}

// ==================== Camera Control ====================
function flyToTrack() {
  if (!state.trackData || !state.trackData.runs || state.trackData.runs.length === 0) return;

  let highestPoint = null;
  let lowestPoint = null;
  let maxEle = -Infinity;
  let minEle = Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;

  state.trackData.runs.forEach(run => {
    run.points.forEach(p => {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);

      if (p.ele > maxEle) {
        maxEle = p.ele;
        highestPoint = p;
      }
      if (p.ele < minEle) {
        minEle = p.ele;
        lowestPoint = p;
      }
    });
  });

  const latPadding = (maxLat - minLat) * 0.3;
  const lonPadding = (maxLon - minLon) * 0.3;
  minLat -= latPadding;
  maxLat += latPadding;
  minLon -= lonPadding;
  maxLon += lonPadding;

  if (maxLat - minLat < 0.002) {
    const center = (maxLat + minLat) / 2;
    minLat = center - 0.001;
    maxLat = center + 0.001;
  }
  if (maxLon - minLon < 0.002) {
    const center = (maxLon + minLon) / 2;
    minLon = center - 0.001;
    maxLon = center + 0.001;
  }

  const dLon = highestPoint.lon - lowestPoint.lon;
  const dLat = highestPoint.lat - lowestPoint.lat;
  const extendFactor = 0.3;

  const cameraLon = lowestPoint.lon - dLon * extendFactor;
  const cameraLat = lowestPoint.lat - dLat * extendFactor;

  const heading = Math.atan2(dLon, dLat);
  const midEle = (maxEle + minEle) / 2;
  const heightOffset = (maxEle - minEle) * 0.5;
  const closerHeight = midEle + heightOffset;

  state.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      cameraLon,
      cameraLat,
      closerHeight
    ),
    orientation: {
      heading: heading,
      pitch: Cesium.Math.toRadians(-15),
      roll: 0
    },
    duration: 2.5
  });
}

function resetCamera() {
  state.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(116.4, 39.9, 5000000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0
    },
    duration: 2
  });
}

// ==================== Interaction ====================
function createHoverMarker() {
  if (state.hoverPointEntity) return;

  state.hoverPointEntity = state.viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
    point: {
      pixelSize: 20,
      color: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    show: false
  });
}

function setupHoverInteraction() {
  createHoverMarker();
  const handler = new Cesium.ScreenSpaceEventHandler(state.viewer.canvas);

  handler.setInputAction((movement) => {
    if (state.isFixed) return;

    const nearestPoint = findNearestPointOnTrack(movement.endPosition);

    if (nearestPoint) {
      showInfoPanelFromPoint(nearestPoint, movement.endPosition);
      updateHoverMarkerPosition(nearestPoint);
    } else {
      hideInfoPanel();
      hideHoverMarker();
    }
    state.viewer.scene.requestRender();
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction((click) => {
    if (state.isFixed) {
      unfixMarker();
    } else {
      const nearestPoint = findNearestPointOnTrack(click.position);
      if (nearestPoint) fixMarker(nearestPoint);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  state.hoverHandler = handler;
}

function fixMarker(point) {
  state.isFixed = true;
  state.fixedPoint = point;

  hideHoverMarker();

  if (state.fixedEntity) {
    state.viewer.entities.remove(state.fixedEntity);
  }

  state.fixedEntity = state.viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.ele),
    point: {
      pixelSize: 24,
      color: Cesium.Color.RED,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });

  showInfoPanelFromPoint(point, null);
  const panel = document.getElementById('infoPanel');
  panel.style.border = '2px solid #e94560';

  state.viewer.scene.requestRender();
}

function unfixMarker() {
  state.isFixed = false;
  state.fixedPoint = null;

  if (state.fixedEntity) {
    state.viewer.entities.remove(state.fixedEntity);
    state.fixedEntity = null;
  }

  hideInfoPanel();
  const panel = document.getElementById('infoPanel');
  panel.style.border = '';

  state.viewer.scene.requestRender();
}

function showInfoPanel(props, position) {
  const panel = document.getElementById('infoPanel');
  document.getElementById('infoLon').textContent = props.lon?.getValue()?.toFixed(6) || '-';
  document.getElementById('infoLat').textContent = props.lat?.getValue()?.toFixed(6) || '-';
  document.getElementById('infoEle').textContent = props.ele?.getValue()?.toFixed(1) + ' m' || '-';
  document.getElementById('infoSlope').textContent = props.slope?.getValue()?.toFixed(1) + '°' || '-';
  panel.classList.add('visible');
}

function hideInfoPanel() {
  document.getElementById('infoPanel').classList.remove('visible');
}

function updateHoverMarkerPosition(point) {
  if (!state.hoverPointEntity) createHoverMarker();
  state.hoverPointEntity.position = Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.ele);
  state.hoverPointEntity.show = true;
}

function hideHoverMarker() {
  if (state.hoverPointEntity) state.hoverPointEntity.show = false;
}

function removeHoverPointMarker() {
  if (state.hoverPointEntity) {
    state.viewer.entities.remove(state.hoverPointEntity);
    state.hoverPointEntity = null;
  }
}

function findNearestPointOnTrack(screenPosition) {
  if (!state.trackData || !state.trackData.runs) return null;

  const SNAP_DISTANCE_PIXELS = 50;
  let nearestPoint = null;
  let minDistance = SNAP_DISTANCE_PIXELS;

  const renderData = state.terrainSnap && state.terrainTrackData
    ? state.terrainTrackData
    : state.trackData;

  for (let runIndex = 0; runIndex < renderData.runs.length; runIndex++) {
    if (!state.visibleRuns.has(runIndex)) continue;

    const run = renderData.runs[runIndex];
    for (let i = 0; i < run.points.length; i++) {
      const point = run.points[i];
      const pointCartesian = Cesium.Cartesian3.fromDegrees(
        point.lon,
        point.lat,
        point.terrainEle || point.ele
      );

      const pointScreen = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
        state.viewer.scene,
        pointCartesian
      );

      if (!pointScreen) continue;

      const dx = pointScreen.x - screenPosition.x;
      const dy = pointScreen.y - screenPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < minDistance) {
        minDistance = distance;
        const slope = calculateSlopeWithInterval(runIndex, i, state.slopeInterval);
        const speed = getSpeedAtPoint(runIndex, i);
        nearestPoint = {
          lon: point.lon,
          lat: point.lat,
          ele: point.terrainEle || point.ele,
          slope: slope,
          slopeLabel: getSlopeLabel(slope),
          speed: speed,
          speedLabel: getSpeedLabel(speed),
          runIndex: runIndex,
          pointIndex: i
        };
      }
    }
  }

  return nearestPoint;
}

function showInfoPanelFromPoint(point, position) {
  const panel = document.getElementById('infoPanel');
  document.getElementById('infoLon').textContent = point.lon.toFixed(6);
  document.getElementById('infoLat').textContent = point.lat.toFixed(6);
  document.getElementById('infoEle').textContent = point.ele.toFixed(1) + ' m';
  document.getElementById('infoSlope').textContent = point.slope.toFixed(1) + '° (' + point.slopeLabel + ')';
  
  // 添加速度显示（在坡度下方）
  let speedElement = document.getElementById('infoSpeed');
  if (!speedElement) {
    speedElement = document.createElement('div');
    speedElement.id = 'infoSpeed';
    speedElement.className = 'info-row';
    const slopeRow = document.getElementById('infoSlope').closest('.info-row');
    if (slopeRow && slopeRow.parentNode) {
      slopeRow.parentNode.insertBefore(speedElement, slopeRow.nextSibling);
    }
  }
  speedElement.innerHTML = '<span class="info-label">速度:</span><span class="info-value">' + point.speed.toFixed(1) + ' km/h (' + point.speedLabel + ')</span>';
  
  panel.classList.add('visible');
}

// ==================== Event Listeners ====================
function setupEventListeners() {
  document.getElementById('fileSelect').addEventListener('change', (e) => {
    loadTrack(e.target.value);
  });

  const selectAllBtn = document.getElementById('selectAllBtn');
  selectAllBtn.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('.run-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);

    checkboxes.forEach((cb, index) => {
      cb.checked = !allChecked;
      if (!allChecked) {
        state.visibleRuns.add(index);
      } else {
        state.visibleRuns.delete(index);
      }
    });

    updateSelectAllButtonState();
    updateTrackVisibility();
  });

  // 着色模式切换
  const colorModeSelect = document.getElementById('colorModeSelect');
  if (colorModeSelect) {
    colorModeSelect.addEventListener('change', (e) => {
      state.colorMode = e.target.value;
      updateLegend();
      showLoading('正在切换着色模式...');
      setTimeout(() => { visualizeTracks(); }, 50);
    });
  }

  // 兼容旧的坡度切换按钮
  const slopeToggle = document.getElementById('slopeToggle');
  if (slopeToggle) {
    slopeToggle.addEventListener('change', (e) => {
      state.slopeColoring = e.target.checked;
      state.colorMode = e.target.checked ? 'slope' : 'track';
      updateLegend();
      showLoading('正在渲染...');
      setTimeout(() => { visualizeTracks(); }, 50);
    });
  }

  document.getElementById('terrainSnapToggle').addEventListener('change', (e) => {
    state.terrainSnap = e.target.checked;
    showLoading('正在重新计算地形贴合...');
    setTimeout(() => { visualizeTracks(); }, 50);
  });

  document.getElementById('terrainSlopeToggle').addEventListener('change', (e) => {
    state.terrainSlope = e.target.checked;
    showLoading('正在重新计算坡度...');
    setTimeout(() => { visualizeTracks(); }, 50);
  });

  document.getElementById('smoothLineToggle').addEventListener('change', (e) => {
    state.showSmoothLine = e.target.checked;
    showLoading('正在处理平滑线...');
    setTimeout(() => { visualizeTracks(); }, 50);
  });

  document.getElementById('slopeIntervalSlider').addEventListener('input', (e) => {
    document.getElementById('slopeIntervalValue').textContent = e.target.value;
  });
  document.getElementById('slopeIntervalSlider').addEventListener('change', (e) => {
    state.slopeInterval = parseInt(e.target.value);
    if (state.slopeColoring || state.showSmoothLine) {
      showLoading('正在重新计算...');
      setTimeout(() => { visualizeTracks(); }, 50);
    }
  });

  document.getElementById('widthSlider').addEventListener('input', (e) => {
    document.getElementById('widthValue').textContent = e.target.value;
  });
  document.getElementById('widthSlider').addEventListener('change', (e) => {
    state.lineWidth = parseInt(e.target.value);
    showLoading('正在修改线宽...');
    setTimeout(() => { visualizeTracks(); }, 50);
  });

  document.getElementById('btnTerrain').addEventListener('click', (e) => {
    state.terrainEnabled = !state.terrainEnabled;
    e.target.classList.toggle('active', state.terrainEnabled);
    state.viewer.scene.globe.depthTestAgainstTerrain = state.terrainEnabled;
  });
  document.getElementById('btnTerrain').classList.add('active');

  document.getElementById('btnLighting').addEventListener('click', (e) => {
    state.lightingEnabled = !state.lightingEnabled;
    e.target.classList.toggle('active', state.lightingEnabled);
    state.viewer.scene.globe.enableLighting = state.lightingEnabled;
  });
  document.getElementById('btnLighting').classList.add('active');

  document.getElementById('btnWater').addEventListener('click', (e) => {
    state.waterEnabled = !state.waterEnabled;
    e.target.classList.toggle('active', state.waterEnabled);
  });

  document.getElementById('btnFlyTo').addEventListener('click', flyToTrack);
  document.getElementById('btnReset').addEventListener('click', resetCamera);

  window.addEventListener('resize', () => {
    if (state.viewer) {
      state.viewer.resize();
    }
  });
}

// ==================== UI Helpers ====================
function showLoading(message = '加载中...') {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    const textDiv = overlay.querySelector('div:last-child');
    if (textDiv) textDiv.textContent = message;
    overlay.classList.remove('hidden');
  }
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function showError(message) {
  alert(message);
}