# UI Architecture and Data Bindings Documentation

## Overview

The Rossby Visualization system consists of an Earth.js-based frontend that visualizes global weather data through an interactive globe interface. This document describes the complete UI architecture, data bindings, and integration patterns discovered through system investigation.

## Key Findings Summary

✅ **All Server Endpoints Working Correctly**
- Test endpoints (`/proxy/*`): Working for API testing
- Earth frontend endpoints (`/data/weather/current/*`): Working for visualization
- Temperature overlay functionality: Successfully activated via Earth menu
- Server logs confirm: "Served Earth temperature data in 423ms"

## UI Architecture

### Core Display Components

```html
<div id="display">
    <svg id="map" class="fill-screen"></svg>           <!-- Geographic boundaries -->
    <canvas id="animation" class="fill-screen"></canvas> <!-- Particle animation -->
    <canvas id="overlay" class="fill-screen"></canvas>   <!-- Color overlays -->
    <svg id="foreground" class="fill-screen"></svg>     <!-- Interactive elements -->
</div>
```

### Agent-Based Architecture

The UI operates on an event-driven agent system where each agent handles specific aspects:

- **meshAgent**: Map topology data (coastlines, lakes)
- **globeAgent**: Globe projection and geometry
- **gridAgent**: Weather data grids from server
- **rendererAgent**: SVG rendering of geographic features
- **fieldAgent**: Interpolated wind vector fields
- **animatorAgent**: Particle animation system
- **overlayAgent**: Color overlay rendering

### Configuration Management

Central configuration object manages all UI state:

```javascript
var configuration = µ.buildConfiguration(globes, products.overlayTypes);
```

**Key Configuration Attributes:**
- `projection`: Globe projection type (orthographic, stereographic, etc.)
- `orientation`: Globe rotation/position
- `param`: Data mode ("wind" or "ocean")
- `surface`: Atmospheric level ("surface", "isobaric")
- `level`: Pressure level (850hPa, 500hPa, etc.)
- `overlayType`: Overlay visualization ("temp", "relative_humidity", etc.)
- `date`: Data date or "current"
- `hour`: Time of day for data

## Data Flow Architecture

### 1. Server Integration Points

#### Test Endpoints (For Development/Debugging)
```
/proxy/metadata          → Rossby metadata in original format
/proxy/data?vars=u10,v10  → Rossby wind data (u10, v10 components)
/proxy/data?vars=t2m      → Rossby temperature data (t2m)
```

#### Earth Frontend Endpoints (For Visualization)
```
/data/weather/current/current-wind-surface-level-gfs-1.0.json
/data/weather/current/current-temp-surface-level-gfs-1.0.json
```

### 2. Data Transformation Pipeline

**Rossby Format → Earth Format Conversion:**

```rust
// In handlers.rs
fn rossby_to_earth_grid(metadata: &Value) -> (nx, ny, lo1, la1, lo2, la2, dx, dy)

// Earth expects this structure:
struct EarthDataPoint {
    header: EarthHeader,    // Grid parameters + metadata
    data: Vec<f64>,        // Flattened grid data
    meta: serde_json::Value // Additional metadata
}
```

### 3. Frontend Data Loading

**Wind Data Loading (Automatic on startup):**
```javascript
// In products.js - Wind factory
"wind": {
    matches: _.matches({param: "wind"}),
    paths: [gfs1p0degPath(attr, "wind", attr.surface, attr.level)],
    builder: function(file) {
        var uData = file[0].data, vData = file[1].data;
        return {
            header: file[0].header,
            interpolate: bilinearInterpolateVector,
            data: function(i) { return [uData[i], vData[i]]; }
        }
    }
}
```

**Temperature Overlay Loading (On-demand):**
```javascript
// In products.js - Temperature factory  
"temp": {
    matches: _.matches({param: "wind", overlayType: "temp"}),
    paths: [gfs1p0degPath(attr, "temp", attr.surface, attr.level)],
    builder: function(file) {
        var record = file[0], data = record.data;
        return {
            header: record.header,
            interpolate: bilinearInterpolateScalar,
            data: function(i) { return data[i]; }
        }
    }
}
```

## UI Component Bindings

### Menu System

#### Mode Selection
```javascript
// Wind/Ocean mode buttons
d3.select("#wind-mode-enable").on("click", function() {
    configuration.save({param: "wind", surface: "surface", level: "level", overlayType: "default"});
});

d3.select("#ocean-mode-enable").on("click", function() {
    configuration.save({param: "ocean", surface: "surface", level: "currents", overlayType: "default"});
});
```

#### Overlay Controls
```javascript
// Temperature overlay activation (confirmed working)
bindButtonToConfiguration("#overlay-temp", {overlayType: "temp"});

// Other overlays
bindButtonToConfiguration("#overlay-wind", {param: "wind", overlayType: "default"});
bindButtonToConfiguration("#overlay-relative_humidity", {overlayType: "relative_humidity"});
bindButtonToConfiguration("#overlay-off", {overlayType: "off"});
```

#### Pressure Level Controls
```javascript
// Atmospheric levels
bindButtonToConfiguration("#surface-level", {param: "wind", surface: "surface", level: "level"});
bindButtonToConfiguration("#isobaric-850hPa", {param: "wind", surface: "isobaric", level: "850hPa"});
bindButtonToConfiguration("#isobaric-500hPa", {param: "wind", surface: "isobaric", level: "500hPa"});
```

#### Projection Controls
```javascript
// Globe projections
globes.keys().forEach(function(p) {
    bindButtonToConfiguration("#" + p, {projection: p, orientation: ""}, ["projection"]);
});
```

### Time Navigation

```javascript
d3.select("#nav-backward-more").on("click", navigate.bind(null, -10)); // -1 Day
d3.select("#nav-backward").on("click", navigate.bind(null, -1));       // -3 Hours  
d3.select("#nav-forward").on("click", navigate.bind(null, +1));        // +3 Hours
d3.select("#nav-forward-more").on("click", navigate.bind(null, +10));  // +1 Day
d3.select("#nav-now").on("click", function() {
    configuration.save({date: "current", hour: ""});
});
```

### Location Details System

#### Interactive Click Handling
```javascript
// Location details on map click
inputController.on("click", showLocationDetails);

function showLocationDetails(point, coord) {
    var λ = coord[0], φ = coord[1]; // longitude, latitude
    var grids = gridAgent.value(), field = fieldAgent.value();
    
    if (field.isDefined(point[0], point[1]) && grids) {
        // Show wind data
        var wind = grids.primaryGrid.interpolate(λ, φ);
        if (µ.isValue(wind)) {
            showWindAtLocation(wind, grids.primaryGrid);
        }
        
        // Show overlay data (temperature, etc.)
        if (grids.overlayGrid !== grids.primaryGrid) {
            var value = grids.overlayGrid.interpolate(λ, φ);
            if (µ.isValue(value)) {
                showOverlayValueAtLocation(value, grids.overlayGrid);
            }
        }
    }
}
```

#### Unit Conversion System
```javascript
function createUnitToggle(id, product) {
    var units = product.units, size = units.length;
    return {
        value: function() { return units[index]; },
        next: function() { 
            d3.select(id).attr("data-index", index = ((index + 1) % size)); 
        }
    };
}

// Wind units: km/h, m/s, kn, mph
// Temperature units: °C, °F, K
```

## Test Interface System

### Rossby Server Test Panel

```html
<div id="rossby-test" style="...">
    <button id="test-metadata">Test Metadata</button>
    <button id="test-wind-data">Test Wind Data</button>  
    <button id="test-temp-data">Test Temperature</button>
    <div id="rossby-result">Ready to test...</div>
</div>
```

**JavaScript Test Implementation:**
```javascript
function testRequest(url, description) {
    fetch(url)
        .then(response => response.json())
        .then(data => {
            // Display successful data structure
            if (data.metadata) {
                logResult('Variables: ' + Object.keys(data.metadata.variables || {}).join(', '));
                logResult('Dimensions: ' + JSON.stringify(data.metadata.dimensions || {}));
            }
        })
        .catch(error => logResult('✗ Error: ' + error.message));
}

// Test endpoints
metadataBtn.onclick = () => testRequest('/proxy/metadata', 'metadata endpoint');
windBtn.onclick = () => testRequest('/proxy/data?vars=u10,v10&time=700464&format=json', 'wind data');
tempBtn.onclick = () => testRequest('/proxy/data?vars=t2m&time=700464&format=json', 'temperature data');
```

## Animation and Visualization

### Particle System (Wind Visualization)

```javascript
function animate(globe, field, grids) {
    var particleCount = Math.round(bounds.width * PARTICLE_MULTIPLIER);
    var particles = [];
    
    for (var i = 0; i < particleCount; i++) {
        particles.push(field.randomize({age: _.random(0, MAX_PARTICLE_AGE)}));
    }
    
    function evolve() {
        particles.forEach(function(particle) {
            var v = field(particle.x, particle.y);  // Get wind vector
            var xt = particle.x + v[0];             // New position
            var yt = particle.y + v[1];
            
            if (field.isDefined(xt, yt)) {
                particle.xt = xt;
                particle.yt = yt;
                buckets[colorStyles.indexFor(v[2])].push(particle); // Color by magnitude
            }
        });
    }
}
```

### Color Overlay System (Temperature, etc.)

```javascript
function drawOverlay(field, overlayType) {
    var ctx = d3.select("#overlay").node().getContext("2d");
    
    if (overlayType && overlayType !== "off") {
        ctx.putImageData(field.overlay, 0, 0); // Draw color overlay
    }
    
    // Draw color scale bar
    var scale = grid.scale, bounds = scale.bounds;
    for (var i = 0; i <= n; i++) {
        var rgb = scale.gradient(µ.spread(i / n, bounds[0], bounds[1]), 1);
        g.fillStyle = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
        g.fillRect(i, 0, 1, c.height);
    }
}
```

## Event System Integration

### Configuration Change Handlers

```javascript
// Grid updates trigger field recalculation
gridAgent.listenTo(configuration, "change", function() {
    var changed = _.keys(configuration.changedAttributes());
    if (_.intersection(changed, ["date", "hour", "param", "surface", "level"]).length > 0) {
        gridAgent.submit(buildGrids); // Fetch new data
    }
});

// Field updates trigger animation restart
animatorAgent.listenTo(fieldAgent, "update", function(field) {
    animatorAgent.submit(animate, globeAgent.value(), field, gridAgent.value());
});

// Overlay updates
overlayAgent.listenTo(fieldAgent, "update", function() {
    overlayAgent.submit(drawOverlay, fieldAgent.value(), configuration.get("overlayType"));
});
```

### Input Controller Events

```javascript
var inputController = buildInputController();

// Globe manipulation
inputController.on("moveStart", function() { /* Start low-res rendering */ });
inputController.on("move", function() { /* Update display during drag */ });
inputController.on("moveEnd", function() { /* High-res rendering, save state */ });
inputController.on("click", showLocationDetails); // Show data at clicked location
```

## Server Response Verification

### Confirmed Working Endpoints

**✅ Metadata Endpoint:**
```json
GET /proxy/metadata
Response: {
  "coordinates": {"latitude": [...], "longitude": [...], "time": [...]},
  "dimensions": {"latitude": {"size": 73}, "longitude": {"size": 144}},
  "variables": {"u10": {...}, "v10": {...}, "t2m": {...}}
}
```

**✅ Wind Data Endpoint:**
```json
GET /proxy/data?vars=u10,v10
Response: {
  "data": {"u10": [array], "v10": [array]},
  "metadata": {...}
}
```

**✅ Temperature Data Endpoint:**
```json
GET /proxy/data?vars=t2m  
Response: {
  "data": {"t2m": [array]},
  "metadata": {...}
}
```

**✅ Earth Frontend Integration:**
- Wind data loads automatically on startup
- Temperature overlay activates via: Menu → Overlay → Temp  
- Server logs confirm: `"Served Earth temperature data in 423ms"`
- UI updates to show: `"Wind + Temp @ Surface"`

## Color Scales and Visual Encoding

### Temperature Scale
```javascript
scale: {
    bounds: [193, 328], // Kelvin range
    gradient: µ.segmentedColorScale([
        [193,     [37, 4, 42]],     // Very cold (purple)
        [233.15,  [192, 37, 149]],  // -40°C/F (magenta)
        [255.372, [70, 215, 215]],  // 0°F (cyan)
        [273.15,  [21, 84, 187]],   // 0°C (blue)
        [298,     [235, 167, 21]],  // Warm (orange)
        [328,     [88, 27, 67]]     // Hot (dark red)
    ])
}
```

### Wind Speed Scale
```javascript
scale: {
    bounds: [0, 100], // m/s
    gradient: function(v, a) {
        return µ.extendedSinebowColor(Math.min(v, 100) / 100, a);
    }
}
```

## Troubleshooting Guide

### Common Issues and Solutions

**Issue**: Temperature overlay not showing
**Solution**: ✅ **RESOLVED** - Use Menu → Overlay → Temp (confirmed working)

**Issue**: Test buttons not responding  
**Solution**: ✅ **RESOLVED** - All endpoints working correctly

**Issue**: No wind animation
**Cause**: Field interpolation failed or no valid data
**Check**: Browser console for interpolation errors

**Issue**: Wrong colors in overlay
**Cause**: Data units mismatch (Kelvin vs Celsius)
**Check**: Server response units vs frontend expectations

### Server Logs to Monitor

```
INFO earth_wind_data: Served Earth wind data in 612ms
INFO earth_temp_data: Served Earth temperature data in 423ms  
INFO proxy: Serving Earth-compatible data
```

## Development Notes

### Key Files
- `public/index.html`: Main UI structure and test interface
- `public/libs/earth/1.0.0/earth.js`: Core Earth frontend logic
- `public/libs/earth/1.0.0/products.js`: Data product definitions
- `src/handlers.rs`: Server-side data transformation

### Data Format Requirements
- Earth frontend expects GRIB-like JSON with header + data array structure
- Coordinate arrays must be in specific order (longitude W→E, latitude N→S)
- Time values as ISO strings, data arrays as flattened grid values
- Units: Wind in m/s, Temperature in Kelvin, Pressure in Pa

This documentation reflects the actual working state of the system as confirmed through testing and server log verification.

---

## Metadata-Driven UI Migration Strategy

### Overview

The current UI uses hardcoded components that need to become dynamic based on Rossby server metadata. This migration strategy transforms the static Earth frontend into a flexible, adaptable interface that automatically configures itself based on available data.

### Current Hardcoded Elements Requiring Migration

#### 1. Height Controls (Atmospheric Levels)
**Current**: Hardcoded pressure levels
```html
<span id="isobaric-1000hPa">1000</span>
<span id="isobaric-850hPa">850</span>
<span id="isobaric-500hPa">500</span>
<!-- etc. -->
```

**Target**: Dynamic generation from metadata
```javascript
// Extract from metadata.coordinates.level or variable dimensions
const availableLevels = extractLevelsFromMetadata(metadata);
// Example: ["surface", "1000hPa", "850hPa", "500hPa"] or ["10m", "100m", "surface"]
```

#### 2. Overlay Controls (Variable Visualizations)
**Current**: Hardcoded overlay types
```html
<span id="overlay-temp" title="Temperature">Temp</span>
<span id="overlay-relative_humidity" title="Relative Humidity">RH</span>
<!-- etc. -->
```

**Target**: Generated from available variables
```javascript
// Extract from metadata.variables
const availableVariables = Object.keys(metadata.variables);
// Map to overlay types: ["t2m" → "Temp", "rh" → "RH", "sp" → "Pressure"]
```

#### 3. Date/Time Controls
**Current**: Assumes GFS time scheduling (3-hour intervals)
```javascript
d3.select("#nav-backward").on("click", navigate.bind(null, -1)); // -3 Hours
```

**Target**: Use actual time intervals from metadata
```javascript
const timeCoords = metadata.coordinates.time;
const timeInterval = detectTimeInterval(timeCoords);
// Adapt navigation based on actual time spacing
```

#### 4. Data Source Information
**Current**: Hardcoded "GFS / NCEP / US National Weather Service"
```javascript
function dataSource(header) {
    return "GFS / NCEP / US National Weather Service";
}
```

**Target**: Extract from metadata attributes
```javascript
const dataSource = metadata.attributes?.source || 
                  metadata.global_attributes?.institution || 
                  "Unknown Source";
```

## Dynamic Component Generation

### Metadata Service Architecture

```javascript
/**
 * Central metadata service for UI initialization
 */
class MetadataService {
    constructor() {
        this.metadata = null;
        this.uiConfig = null;
    }
    
    async initialize() {
        try {
            this.metadata = await fetch('/proxy/metadata').then(r => r.json());
            this.uiConfig = this.buildUIConfig(this.metadata);
            return this.uiConfig;
        } catch (error) {
            console.warn('Failed to load metadata, using defaults:', error);
            return this.getDefaultConfig();
        }
    }
    
    buildUIConfig(metadata) {
        return {
            levels: this.extractLevels(metadata),
            variables: this.extractVariables(metadata),
            timeRange: this.extractTimeRange(metadata),
            source: this.extractSource(metadata),
            grid: this.extractGridInfo(metadata)
        };
    }
}
```

### Level Detection and Height Controls

```javascript
/**
 * Extract available atmospheric levels from metadata
 */
function extractLevels(metadata) {
    const levels = [];
    
    // Check for coordinate-based levels
    if (metadata.coordinates?.level) {
        levels.push(...metadata.coordinates.level.map(formatLevel));
    }
    
    // Check for variable-specific levels in dimensions
    Object.values(metadata.variables || {}).forEach(variable => {
        if (variable.dimensions?.includes('level')) {
            // Extract from variable's level dimension
        }
    });
    
    // Always include surface if available
    if (hasVariablesAtSurface(metadata)) {
        levels.unshift('surface');
    }
    
    return [...new Set(levels)]; // Remove duplicates
}

function formatLevel(level) {
    if (typeof level === 'number') {
        // Pressure level in Pa → hPa
        if (level > 10000) {
            return `${Math.round(level / 100)}hPa`;
        }
        // Height level in meters
        return `${level}m`;
    }
    return level; // String levels like "surface"
}

/**
 * Generate height control buttons dynamically
 */
function generateHeightControls(levels) {
    const container = d3.select('.wind-mode').select('p').filter(function() {
        return this.textContent.includes('Height');
    });
    
    // Clear existing controls
    container.selectAll('.surface').remove();
    
    // Generate new controls
    levels.forEach((level, index) => {
        const buttonId = `level-${level.replace(/[^a-zA-Z0-9]/g, '')}`;
        const displayName = getDisplayName(level);
        
        if (index > 0) container.append('span').text(' – ');
        
        const button = container.append('span')
            .attr('class', 'surface text-button')
            .attr('id', buttonId)
            .attr('title', level)
            .text(displayName);
            
        // Bind to configuration
        bindButtonToConfiguration(`#${buttonId}`, {
            param: "wind", 
            surface: level === 'surface' ? 'surface' : 'isobaric',
            level: level
        });
    });
}
```

### Variable Mapping and Discovery

```javascript
/**
 * Dynamic variable mapping system using metadata
 */
class VariableMapper {
    constructor() {
        // Pattern-based categorization rules
        this.categoryPatterns = {
            temperature: /temperature|temp|sst|t2m|skin/i,
            wind: /wind|u10|v10|u100|v100|gust/i,
            pressure: /pressure|sp|msl|slp/i,
            humidity: /humidity|dewpoint|d2m|rh|specific/i,
            precipitation: /precipitation|rain|snow|tp|sd/i,
            radiation: /radiation|solar|tisr|surface.*radiation/i,
            cloud: /cloud|tcw|total.*cloud/i
        };
        
        // Wind component pairs detection
        this.vectorPairs = [
            {u: 'u10', v: 'v10'},
            {u: 'u100', v: 'v100'},
            {u: 'uas', v: 'vas'},
            {u: 'ua', v: 'va'}
        ];
    }
    
    analyzeVariables(metadata) {
        const variables = metadata.variables || {};
        const variableKeys = Object.keys(variables);
        const analysis = {
            scalar: [],
            vector: [],
            unknown: []
        };
        
        // Process each variable from metadata
        variableKeys.forEach(varName => {
            const varData = variables[varName];
            const attributes = varData.attributes || {};
            
            // Extract information from metadata
            const variableInfo = {
                name: varName,
                display: this.createDisplayName(varName, attributes.long_name),
                longName: attributes.long_name || varName,
                units: attributes.units || '',
                category: this.categorizeVariable(varName, attributes.long_name),
                type: this.detectVariableType(varName, attributes.long_name)
            };
            
            // Check if this is part of a vector pair
            const vectorPair = this.findVectorPair(varName, variableKeys);
            if (vectorPair && variableInfo.type === 'vector') {
                analysis.vector.push({
                    ...variableInfo,
                    pair: vectorPair,
                    isVectorComponent: true
                });
            } else if (variableInfo.type === 'scalar') {
                analysis.scalar.push(variableInfo);
            } else {
                analysis.unknown.push(variableInfo);
            }
        });
        
        return analysis;
    }
    
    /**
     * Create display name from variable name and long_name
     */
    createDisplayName(varName, longName) {
        if (longName) {
            // Extract meaningful part from long_name
            const cleanName = longName
                .replace(/\d+\s*(metre|meter|m)\s*/i, '') // Remove height/level info
                .replace(/\s*(component|wind)\s*/i, '')   // Remove redundant words
                .replace(/\s+/g, ' ')                     // Normalize spaces
                .trim();
                
            // Create abbreviated display name
            if (cleanName.length <= 6) {
                return cleanName;
            } else {
                // Create abbreviation from key words
                const words = cleanName.split(/\s+/);
                if (words.length === 1) {
                    return words[0].substring(0, 6);
                } else {
                    return words.map(w => w.charAt(0).toUpperCase()).join('');
                }
            }
        }
        
        // Fallback to variable name
        return varName.toUpperCase();
    }
    
    /**
     * Categorize variable based on name and long_name
     */
    categorizeVariable(varName, longName) {
        const searchText = `${varName} ${longName || ''}`.toLowerCase();
        
        for (const [category, pattern] of Object.entries(this.categoryPatterns)) {
            if (pattern.test(searchText)) {
                return category;
            }
        }
        
        return 'general';
    }
    
    /**
     * Detect if variable is scalar or vector type
     */
    detectVariableType(varName, longName) {
        const searchText = `${varName} ${longName || ''}`.toLowerCase();
        
        // Check for wind components
        if (/u.*component|eastward|u10|u100|uas/i.test(searchText) ||
            /v.*component|northward|v10|v100|vas/i.test(searchText)) {
            return 'vector';
        }
        
        // Default to scalar
        return 'scalar';
    }
    
    /**
     * Find vector pair for wind components
     */
    findVectorPair(varName, availableVars) {
        for (const pair of this.vectorPairs) {
            if (varName === pair.u && availableVars.includes(pair.v)) {
                return pair.v;
            }
            if (varName === pair.v && availableVars.includes(pair.u)) {
                return pair.u;
            }
        }
        
        // Dynamic pattern matching for other wind components
        if (/^u/i.test(varName)) {
            const vComponent = varName.replace(/^u/i, 'v');
            if (availableVars.includes(vComponent)) {
                return vComponent;
            }
        }
        if (/^v/i.test(varName)) {
            const uComponent = varName.replace(/^v/i, 'u');
            if (availableVars.includes(uComponent)) {
                return uComponent;
            }
        }
        
        return null;
    }
}

/**
 * Generate overlay controls from variable analysis
 */
function generateOverlayControls(variableAnalysis) {
    const windModeContainer = d3.selectAll('.wind-mode').filter(function() {
        return this.textContent.includes('Overlay');
    });
    
    // Clear existing overlay buttons
    windModeContainer.selectAll('.text-button').filter(function() {
        return this.id.startsWith('overlay-');
    }).remove();
    
    // Add default controls
    addOverlayButton(windModeContainer, 'overlay-off', 'None', {overlayType: 'off'});
    addOverlayButton(windModeContainer, 'overlay-wind', 'Wind', {overlayType: 'default'});
    
    // Add scalar variable overlays
    variableAnalysis.scalar.forEach(variable => {
        const buttonId = `overlay-${variable.name}`;
        addOverlayButton(windModeContainer, buttonId, variable.display, {
            overlayType: variable.name
        });
    });
}

function addOverlayButton(container, id, text, config) {
    container.append('span').text(' – ');
    container.append('span')
        .attr('class', 'text-button')
        .attr('id', id)
        .attr('title', text)
        .text(text);
        
    bindButtonToConfiguration(`#${id}`, config);
}
```

### Time Range Adaptation

```javascript
/**
 * Extract and adapt time controls based on metadata
 */
function adaptTimeControls(metadata) {
    const timeCoords = metadata.coordinates?.time || [];
    if (timeCoords.length === 0) return;
    
    // Detect time interval
    const interval = detectTimeInterval(timeCoords);
    
    // Update navigation button titles and step sizes
    const navConfig = {
        backward: {step: -1, interval: interval},
        forward: {step: 1, interval: interval},
        backwardMore: {step: -10, interval: interval * 8}, // Approximate day jump
        forwardMore: {step: 10, interval: interval * 8}
    };
    
    // Update button titles
    d3.select('#nav-backward')
        .attr('title', `${formatTimeInterval(-navConfig.backward.interval)}`);
    d3.select('#nav-forward')
        .attr('title', `+${formatTimeInterval(navConfig.forward.interval)}`);
    d3.select('#nav-backward-more')
        .attr('title', `${formatTimeInterval(-navConfig.backwardMore.interval)}`);
    d3.select('#nav-forward-more')
        .attr('title', `+${formatTimeInterval(navConfig.forwardMore.interval)}`);
}

function detectTimeInterval(timeCoords) {
    if (timeCoords.length < 2) return 3; // Default 3 hours
    
    // Calculate average interval between time points
    const intervals = [];
    for (let i = 1; i < Math.min(timeCoords.length, 10); i++) {
        intervals.push(timeCoords[i] - timeCoords[i-1]);
    }
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return Math.round(avgInterval); // Hours
}

function formatTimeInterval(hours) {
    if (Math.abs(hours) >= 24) {
        return `${Math.round(hours / 24)} Day${Math.abs(hours) >= 48 ? 's' : ''}`;
    }
    return `${hours} Hour${Math.abs(hours) !== 1 ? 's' : ''}`;
}
```

## Implementation Architecture

### Initialization Flow

```javascript
/**
 * Main initialization sequence for metadata-driven UI
 */
async function initializeMetadataDrivenUI() {
    try {
        // 1. Load metadata
        const metadataService = new MetadataService();
        const uiConfig = await metadataService.initialize();
        
        // 2. Generate dynamic components
        generateHeightControls(uiConfig.levels);
        
        // 3. Analyze variables and generate overlays
        const variableMapper = new VariableMapper();
        const variableAnalysis = variableMapper.analyzeVariables(metadataService.metadata);
        generateOverlayControls(variableAnalysis);
        
        // 4. Adapt time controls
        adaptTimeControls(metadataService.metadata);
        
        // 5. Update data source information
        updateDataSource(uiConfig.source);
        
        // 6. Continue with existing Earth initialization
        continueEarthInitialization();
        
    } catch (error) {
        console.error('Metadata-driven initialization failed:', error);
        // Fallback to hardcoded configuration
        continueEarthInitialization();
    }
}

/**
 * Backward compatibility fallback
 */
function getDefaultConfig() {
    return {
        levels: ['surface', '1000hPa', '850hPa', '700hPa', '500hPa', '250hPa', '70hPa', '10hPa'],
        variables: {
            scalar: [
                {name: 'temp', display: 'Temp', category: 'temperature'},
                {name: 'relative_humidity', display: 'RH', category: 'humidity'}
            ],
            vector: [
                {name: 'wind', display: 'Wind', category: 'wind'}
            ]
        },
        timeRange: {interval: 3, unit: 'hours'},
        source: 'GFS / NCEP / US National Weather Service'
    };
}
```

### Configuration Integration

```javascript
/**
 * Enhanced configuration system for metadata-driven UI
 */
function buildConfiguration(globes, overlayTypes, metadataConfig) {
    // Extend existing configuration with metadata-driven options
    const config = µ.buildConfiguration(globes, overlayTypes);
    
    // Add metadata-derived attributes
    if (metadataConfig) {
        config.set('availableLevels', metadataConfig.levels);
        config.set('availableVariables', metadataConfig.variables);
        config.set('dataSource', metadataConfig.source);
        config.set('timeInterval', metadataConfig.timeRange.interval);
    }
    
    // Validation against metadata
    config.on('change', function(model) {
        validateConfigurationAgainstMetadata(model.attributes, metadataConfig);
    });
    
    return config;
}

function validateConfigurationAgainstMetadata(attributes, metadataConfig) {
    // Validate level selection
    if (attributes.level && metadataConfig.levels) {
        if (!metadataConfig.levels.includes(attributes.level)) {
            console.warn(`Level ${attributes.level} not available, using default`);
            // Auto-correct to available level
        }
    }
    
    // Validate overlay selection
    if (attributes.overlayType && metadataConfig.variables) {
        const availableVars = metadataConfig.variables.scalar.map(v => v.name);
        if (!availableVars.includes(attributes.overlayType)) {
            console.warn(`Overlay ${attributes.overlayType} not available`);
        }
    }
}
```

### Migration Strategy Summary

#### Phase 1: Core Infrastructure
1. **Metadata Service**: Centralized metadata loading and parsing
2. **Variable Mapper**: Extensible system for variable analysis
3. **Dynamic Generators**: Components for UI element creation
4. **Backward Compatibility**: Graceful fallback to hardcoded values

#### Phase 2: Component Migration
1. **Height Controls**: Replace hardcoded pressure levels
2. **Overlay Controls**: Generate from available variables
3. **Time Navigation**: Adapt to actual time intervals
4. **Source Information**: Extract from metadata

#### Phase 3: Enhanced Features
1. **Smart Defaults**: Intelligent initial selections
2. **Variable Relationships**: Automatic wind component pairing
3. **Validation**: Configuration validation against metadata
4. **Error Handling**: Robust fallback mechanisms

This migration strategy ensures the UI becomes fully adaptable to any Rossby server configuration while maintaining backward compatibility and providing enhanced user experience through intelligent defaults and validation.
