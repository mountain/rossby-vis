# UI Refactor: Metadata-Driven Interface Design Document

## Overview

The Metadata UI is metadata-sensitive and dynamically changes its UI components and behavior according to the metadata received from the Rossby server. This document outlines the complete refactor design to transform the hardcoded Earth.js interface into a fully adaptive system.

**Current State**: We made radical changes to `index.html`, which means we have broken the original logic and need to establish new logic as described in this document.

**Architecture**: The new system implements a three-phase approach:
- **Phase 4**: Enhanced mode system with metadata-driven time controls
- **Phase 5**: Intelligent variable-based overlay system
- **Phase 6**: Dynamic height selection for 3D data

## Phase 4: Enhanced Mode System with Metadata-Driven Time Controls

### 4.1 Mode System Revision

**Original**: `wind-mode`, `ocean-mode`
**New**: `wind-mode`, `ocean-mode`, `normal-mode`

#### Mode Detection Algorithm

```javascript
function detectMode(metadata) {
    const variables = Object.keys(metadata.variables || {});
    
    // Wind mode detection - look for u/v component pairs
    const windPairs = detectWindPairs(variables);
    if (windPairs.length > 0) {
        return {
            mode: 'wind',
            primaryVectorPair: windPairs[0], // e.g., {u: 'u10', v: 'v10'}
            allWindPairs: windPairs,
            availableVariables: variables.filter(v => !isWindComponent(v))
        };
    }
    
    // Ocean mode detection - look for ust/vst pairs
    const oceanPairs = detectOceanPairs(variables);
    if (oceanPairs.length > 0) {
        return {
            mode: 'ocean',
            primaryVectorPair: oceanPairs[0], // e.g., {u: 'ust', v: 'vst'}
            allOceanPairs: oceanPairs,
            availableVariables: variables.filter(v => !isOceanComponent(v))
        };
    }
    
    // Normal mode - no vector pairs detected
    return {
        mode: 'normal',
        availableVariables: variables
    };
}
```

#### Wind Pair Detection Patterns

```javascript
function detectWindPairs(variables) {
    const pairs = [];
    const windPatterns = [
        {u: /^u(\d+)$/, v: /^v(\d+)$/},        // u10/v10, u200/v200, u250/v250
        {u: /^u(\d+)hPa$/, v: /^v(\d+)hPa$/},  // u850hPa/v850hPa
        {u: /^uas$/, v: /^vas$/},              // Surface wind (CMIP naming)
        {u: /^ua$/, v: /^va$/},                // Generic atmospheric wind
        {u: /^u_wind$/, v: /^v_wind$/}         // Alternative naming
    ];
    
    windPatterns.forEach(pattern => {
        variables.forEach(uVar => {
            if (pattern.u.test(uVar)) {
                const match = uVar.match(pattern.u);
                const level = match[1] || '';
                const vVar = uVar.replace(pattern.u, pattern.v.source.replace('(\\d+)', level));
                if (variables.includes(vVar)) {
                    pairs.push({u: uVar, v: vVar, level: level});
                }
            }
        });
    });
    
    return pairs;
}

function detectOceanPairs(variables) {
    const pairs = [];
    const oceanPatterns = [
        {u: /^ust$/, v: /^vst$/},              // Ocean surface currents
        {u: /^u_current$/, v: /^v_current$/},  // Generic current naming
        {u: /^uo$/, v: /^vo$/}                 // CMIP ocean velocity naming
    ];
    
    oceanPatterns.forEach(pattern => {
        const uVars = variables.filter(v => pattern.u.test(v));
        const vVars = variables.filter(v => pattern.v.test(v));
        
        uVars.forEach(uVar => {
            const correspondingV = uVar.replace(pattern.u, pattern.v.source);
            if (vVars.includes(correspondingV)) {
                pairs.push({u: uVar, v: correspondingV});
            }
        });
    });
    
    return pairs;
}
```

#### Mode UI Setup

```javascript
function setupModeUI(mode, modeInfo) {
    // Update mode button states
    d3.selectAll('#wind-mode-enable, #ocean-mode-enable, #normal-mode-enable')
        .classed('highlighted', false);
    d3.select(`#${mode}-mode-enable`).classed('highlighted', true);
    
    // Show/hide mode-specific UI elements
    d3.selectAll('.wind-mode').classed('invisible', mode !== 'wind');
    d3.selectAll('.ocean-mode').classed('invisible', mode !== 'ocean');
    d3.selectAll('.normal-mode').classed('invisible', mode !== 'normal');
    
    // Update data layer display
    const dataLayerText = mode === 'wind' ? 'Wind' : 
                         mode === 'ocean' ? 'Ocean' : 'Data';
    d3.select('#data-layer').text(dataLayerText);
    
    console.log(`Mode set to: ${mode}`, modeInfo);
}
```

### 4.2 Metadata-Driven Time Navigation

#### Time Coordinate Processing

**Requirement**: Use time frames specified in NetCDF files instead of GFS forecast time frames.

**UI Elements**:
- `#nav-start`: Shows the beginning time
- `#nav-end`: Shows the last time  
- `#data-time`: Shows the time of current data

**Format**: Pure number directly from NC time coordinate (no date parsing/formatting)

```javascript
function setupMetadataTimeNavigation(metadata) {
    const timeCoords = metadata.coordinates?.time || [];
    
    if (timeCoords.length === 0) {
        console.warn('No time coordinates found in metadata');
        return;
    }
    
    // Store global time information for navigation
    window.metadataTimeInfo = {
        all: timeCoords,
        start: timeCoords[0],
        end: timeCoords[timeCoords.length - 1],
        current: timeCoords[0],
        currentIndex: 0,
        count: timeCoords.length
    };
    
    // Update UI elements with pure numeric format
    updateTimeDisplayElements();
    
    // Override existing navigation handlers
    setupMetadataNavigationHandlers();
    
    console.log(`Time navigation setup: ${timeCoords.length} time points from ${timeCoords[0]} to ${timeCoords[timeCoords.length - 1]}`);
}

function updateTimeDisplayElements() {
    const timeInfo = window.metadataTimeInfo;
    
    // Update with pure numeric values from NC coordinates
    d3.select('#nav-start')
        .text(timeInfo.start.toString())
        .attr('title', `Start: ${timeInfo.start}`);
    
    d3.select('#nav-end')
        .text(timeInfo.end.toString())
        .attr('title', `End: ${timeInfo.end}`);
    
    d3.select('#data-time')
        .text(timeInfo.current.toString())
        .attr('title', `Current: ${timeInfo.current} (${timeInfo.currentIndex + 1}/${timeInfo.count})`);
}
```

#### Navigation Handler Implementation

```javascript
function setupMetadataNavigationHandlers() {
    // Override existing Earth.js navigation with metadata-aware versions
    d3.select('#nav-backward').on('click', () => navigateMetadataTime(-1));
    d3.select('#nav-forward').on('click', () => navigateMetadataTime(1));
    d3.select('#nav-backward-more').on('click', () => navigateMetadataTime(-5));
    d3.select('#nav-forward-more').on('click', () => navigateMetadataTime(5));
    
    // Direct navigation to start/end
    d3.select('#nav-start').on('click', () => navigateToMetadataTime(0));
    d3.select('#nav-end').on('click', () => navigateToMetadataTime(-1));
    
    // Keyboard navigation support
    d3.select(document).on('keydown', function() {
        const event = d3.event;
        if (event.keyCode === 37) { // Left arrow
            event.preventDefault();
            navigateMetadataTime(-1);
        } else if (event.keyCode === 39) { // Right arrow
            event.preventDefault();
            navigateMetadataTime(1);
        }
    });
}

function navigateMetadataTime(step) {
    const timeInfo = window.metadataTimeInfo;
    if (!timeInfo) return;
    
    const newIndex = Math.max(0, Math.min(timeInfo.all.length - 1, timeInfo.currentIndex + step));
    
    if (newIndex !== timeInfo.currentIndex) {
        timeInfo.currentIndex = newIndex;
        timeInfo.current = timeInfo.all[newIndex];
        
        // Update configuration to trigger data reload
        if (typeof configuration !== 'undefined') {
            configuration.save({
                metadataTime: timeInfo.current,
                date: 'metadata', // Flag to use metadata time
                hour: ''
            });
        }
        
        updateTimeDisplayElements();
        console.log(`Navigated to time ${timeInfo.current} (index ${newIndex})`);
    }
}

function navigateToMetadataTime(index) {
    const timeInfo = window.metadataTimeInfo;
    if (!timeInfo) return;
    
    // Handle negative indices (from end)
    const targetIndex = index < 0 ? timeInfo.all.length + index : index;
    const clampedIndex = Math.max(0, Math.min(timeInfo.all.length - 1, targetIndex));
    
    timeInfo.currentIndex = clampedIndex;
    timeInfo.current = timeInfo.all[clampedIndex];
    
    if (typeof configuration !== 'undefined') {
        configuration.save({
            metadataTime: timeInfo.current,
            date: 'metadata',
            hour: ''
        });
    }
    
    updateTimeDisplayElements();
}
```

## Phase 5: Intelligent Variable-Based Overlay System

### 5.1 Variable Categorization Strategy

**Requirement**: Overlay system based on variables in metadata and selected UI mode.

#### Mode-Specific Variable Filtering

- **Normal Mode**: Variables shown directly in `#overlay-variables`
- **Wind Mode**: Variables filtered to remove u/v pairs, show air-related variables
- **Ocean Mode**: Variables filtered to remove ust/vst pairs, show ocean-related variables

```javascript
function categorizeVariables(variables, mode, modeInfo) {
    const categorized = {
        atmospheric: [],
        oceanic: [],
        surface: [],
        excluded: [],
        vectorComponents: []
    };
    
    // Pattern-based categorization
    const patterns = {
        atmospheric: /^(t2m|temp|temperature|d2m|dewpoint|humidity|rh|relative.*humidity|sp|surface.*pressure|msl|mean.*sea.*level|tisr|radiation|solar|tcw|total.*cloud.*water|cloud)$/i,
        oceanic: /^(sst|sea.*surface.*temp|salinity|sal|ssh|sea.*surface.*height|mld|mixed.*layer.*depth)$/i,
        surface: /^(sd|snow.*depth|tp|total.*precip|precipitation|rain|sf|surface.*flux|lhf|latent.*heat|shf|sensible.*heat)$/i
    };
    
    Object.keys(variables).forEach(varName => {
        // Skip coordinate variables
        if (['latitude', 'longitude', 'time', 'level', 'plev', 'height'].includes(varName.toLowerCase())) {
            categorized.excluded.push(varName);
            return;
        }
        
        // Filter out vector components based on mode
        if (mode === 'wind' && isWindComponent(varName, modeInfo.allWindPairs)) {
            categorized.vectorComponents.push(varName);
            return;
        }
        if (mode === 'ocean' && isOceanComponent(varName, modeInfo.allOceanPairs)) {
            categorized.vectorComponents.push(varName);
            return;
        }
        
        // Categorize remaining variables
        if (patterns.atmospheric.test(varName)) {
            categorized.atmospheric.push(varName);
        } else if (patterns.oceanic.test(varName)) {
            categorized.oceanic.push(varName);
        } else if (patterns.surface.test(varName)) {
            categorized.surface.push(varName);
        } else {
            // Default to atmospheric for unknown variables
            categorized.atmospheric.push(varName);
        }
    });
    
    return categorized;
}

function isWindComponent(varName, windPairs) {
    return windPairs.some(pair => pair.u === varName || pair.v === varName);
}

function isOceanComponent(varName, oceanPairs) {
    return oceanPairs.some(pair => pair.u === varName || pair.v === varName);
}
```

### 5.2 Dynamic Overlay Control Generation

```javascript
function generateModeSpecificOverlays(mode, categorizedVars, metadata) {
    const container = d3.select('#overlay-variables');
    container.selectAll('*').remove(); // Clear existing controls
    
    // Add default "None" option
    addOverlayButton(container, 'overlay-off', 'None', {overlayType: 'off'});
    
    let availableVars = [];
    
    switch (mode) {
        case 'normal':
            // Show all non-coordinate variables directly
            availableVars = [
                ...categorizedVars.atmospheric,
                ...categorizedVars.oceanic,
                ...categorizedVars.surface
            ];
            break;
            
        case 'wind':
            // Show air-related variables (atmospheric + surface), filtered out u/v pairs
            availableVars = [
                ...categorizedVars.atmospheric,
                ...categorizedVars.surface
            ];
            break;
            
        case 'ocean':
            // Show ocean-related variables, filtered out ust/vst pairs
            availableVars = categorizedVars.oceanic;
            break;
    }
    
    // Generate overlay buttons for available variables
    availableVars.forEach(varName => {
        const varInfo = metadata.variables[varName] || {};
        const displayName = createDisplayName(varName, varInfo.attributes?.long_name);
        
        addOverlayButton(container, `overlay-${varName}`, displayName, {
            overlayType: varName,
            param: mode === 'ocean' ? 'ocean' : 'wind'
        });
        
        // Register variable with products system
        registerVariableOverlay(varName, mode);
    });
    
    console.log(`Generated ${availableVars.length} overlay controls for ${mode} mode:`, availableVars);
}

function addOverlayButton(container, id, text, config) {
    // Add separator
    if (container.selectAll('.text-button').size() > 0) {
        container.append('span').text(' – ');
    }
    
    // Add button
    const button = container.append('span')
        .attr('class', 'text-button')
        .attr('id', id)
        .attr('title', text)
        .text(text);
    
    // Bind to configuration system
    if (typeof bindButtonToConfiguration === 'function') {
        bindButtonToConfiguration(`#${id}`, config);
    }
    
    return button;
}
```

### 5.3 Smart Display Name Generation

```javascript
function createDisplayName(varName, longName) {
    // Predefined abbreviations for common variables
    const abbreviations = {
        't2m': 'T2m',
        'temperature': 'Temp',
        '2 metre temperature': 'T2m',
        'dewpoint temperature': 'Dew',
        'd2m': 'Dew',
        'surface pressure': 'Press',
        'sp': 'Press',
        'sea surface temperature': 'SST',
        'sst': 'SST',
        'snow depth': 'Snow',
        'sd': 'Snow',
        'total cloud water': 'Cloud',
        'tcw': 'Cloud',
        'relative humidity': 'RH',
        'rh': 'RH',
        'total precipitation': 'Precip',
        'tp': 'Precip',
        'surface solar radiation': 'Solar',
        'tisr': 'Solar'
    };
    
    // Check for predefined abbreviations
    const lowerVar = varName.toLowerCase();
    const lowerLong = (longName || '').toLowerCase();
    
    // Direct variable name match
    if (abbreviations[lowerVar]) {
        return abbreviations[lowerVar];
    }
    
    // Long name match
    for (const [full, abbrev] of Object.entries(abbreviations)) {
        if (lowerLong.includes(full)) {
            return abbrev;
        }
    }
    
    // Generate smart abbreviation from long name
    if (longName && longName.length > 0) {
        // Remove common prefixes/suffixes
        let cleaned = longName
            .replace(/\d+\s*(metre|meter|m)\s*/gi, '') // Remove height specifications
            .replace(/\s*(component|wind|current)\s*/gi, '') // Remove redundant words
            .replace(/\s*(total|surface|mean)\s*/gi, '') // Remove qualifiers
            .trim();
        
        // Create abbreviation
        if (cleaned.length <= 6) {
            return cleaned;
        } else {
            // Multi-word: take first letter of each word
            const words = cleaned.split(/\s+/);
            if (words.length > 1) {
                return words.map(w => w.charAt(0).toUpperCase()).join('');
            } else {
                // Single long word: take first 6 characters
                return cleaned.substring(0, 6);
            }
        }
    }
    
    // Fallback: use variable name, uppercase, max 6 chars
    return varName.toUpperCase().substring(0, 6);
}
```

### 5.4 Variable Selection Data Download System

**Requirement**: When a variable is selected, it triggers Rossby data downloading and rendering.

```javascript
function setupVariableSelectionHandlers() {
    // Listen for overlay selection changes in configuration
    if (typeof configuration !== 'undefined') {
        configuration.on('change:overlayType', function(model, overlayType) {
            if (overlayType && overlayType !== 'off' && overlayType !== 'default') {
                triggerVariableDataDownload(overlayType);
            }
        });
        
        // Also listen for mode changes that might affect available variables
        configuration.on('change:param', function(model, param) {
            // Regenerate overlays when mode changes
            if (window.lastMetadata) {
                const modeInfo = detectMode(window.lastMetadata);
                const categorizedVars = categorizeVariables(window.lastMetadata.variables, param, modeInfo);
                generateModeSpecificOverlays(param, categorizedVars, window.lastMetadata);
            }
        });
    }
}

function triggerVariableDataDownload(varName) {
    console.log(`Triggering data download for variable: ${varName}`);
    
    // Update status display
    d3.select('#status').text(`Loading ${varName} data...`);
    
    // Update data layer display
    const currentMode = d3.select('#data-layer').text();
    d3.select('#data-layer').text(`${currentMode} + ${createDisplayName(varName)}`);
    
    // The existing gridAgent system will handle the actual download
    // when configuration changes trigger a rebuild
    if (typeof gridAgent !== 'undefined' && gridAgent.submit) {
        gridAgent.submit(buildGrids);
    }
    
    // Also update overlay agent if available
    if (typeof overlayAgent !== 'undefined' && overlayAgent.submit) {
        overlayAgent.submit(function() {
            console.log(`Overlay agent processing ${varName}`);
        });
    }
}

function registerVariableOverlay(varName, mode) {
    // Register with products system for data loading
    if (typeof products !== 'undefined' && products.productsFor && products.productsFor.FACTORIES) {
        products.productsFor.FACTORIES[varName] = {
            matches: function(attr) {
                return attr.param === (mode === 'ocean' ? 'ocean' : 'wind') && 
                       attr.overlayType === varName;
            },
            create: function(attr) {
                console.log(`Creating product for variable: ${varName} with attributes:`, attr);
                
                // Return product configuration for scalar overlay
                return {
                    type: 'scalar_overlay',
                    variable: varName,
                    paths: [`/proxy/data?vars=${varName}&time=\${metadataTime}&format=json`],
                    builder: 'scalar'
                };
            }
        };
        
        console.log(`Registered product factory for variable: ${varName}`);
    }
}
```

## Phase 6: Dynamic Height Selection for 3D Data

### 6.1 Dimensional Analysis System

**Requirement**: Height selection is hidden when data is 2D, only shown when data is 3D.

```javascript
function analyzeDimensions(metadata) {
    const variables = metadata.variables || {};
    const analysis = {
        is3D: false,
        availableLevels: [],
        levelDimension: null,
        variablesWith3D: [],
        levelType: null // 'pressure', 'height', 'model'
    };
    
    // Check each variable for dimensional structure
    Object.entries(variables).forEach(([varName, varInfo]) => {
        const dimensions = varInfo.dimensions || [];
        
        // Look for level/height dimensions
        const levelDims = dimensions.filter(dim => {
            const dimLower = dim.toLowerCase();
            return ['level', 'plev', 'height', 'isobaric', 'lev', 'z'].includes(dimLower);
        });
        
        if (levelDims.length > 0) {
            analysis.is3D = true;
            analysis.levelDimension = levelDims[0];
            analysis.variablesWith3D.push(varName);
        }
    });
    
    // Extract available levels from coordinates
    if (analysis.is3D && analysis.levelDimension) {
        const levelCoords = metadata.coordinates?.[analysis.levelDimension];
        if (levelCoords && Array.isArray(levelCoords)) {
            analysis.availableLevels = levelCoords.map(formatLevel);
            analysis.levelType = determineLevelType(levelCoords);
        }
    }
    
    // Check dimensions metadata for additional info
    const dimInfo = metadata.dimensions?.[analysis.levelDimension];
    if (dimInfo && dimInfo.size) {
        console.log(`Found ${dimInfo.size} levels in dimension ${analysis.levelDimension}`);
    }
    
    return analysis;
}

function determineLevelType(levelCoords) {
    if (!levelCoords || levelCoords.length === 0) return 'unknown';
    
    const firstLevel = levelCoords[0];
    const lastLevel = levelCoords[levelCoords.length - 1];
    
    // Pressure levels (Pa or hPa)
    if (firstLevel > 1000 && lastLevel > 1000) {
        return firstLevel > 10000 ? 'pressure_pa' : 'pressure_hpa';
    }
    
    // Height levels (meters)
    if (firstLevel >= 0 && lastLevel > firstLevel) {
        return 'height_meters';
    }
    
    // Model levels (dimensionless)
    if (firstLevel >= 0 && firstLevel <= 1 && lastLevel >= 0 && lastLevel <= 1) {
        return 'model_levels';
    }
    
    return 'unknown';
}

function formatLevel(level) {
    if (typeof level !== 'number') {
        return level.toString();
    }
    
    // Pressure levels - convert Pa to hPa if needed
    if (level > 10000) {
        return `${Math.round(level / 100)}hPa`;
    }
    
    // Already in hPa or other pressure unit
    if (level >= 100 && level <= 1100) {
        return `${Math.round(level)}hPa`;
    }
    
    // Height levels in meters
    if (level >= 0 && level < 50000) {
        return level < 1000 ? `${level}m` : `${Math.round(level/1000)}km`;
    }
    
    // Model or unknown levels
    return level.toString();
}
```

### 6.2 Dynamic Height Control Management

```javascript
function manageHeightSelection(dimensionAnalysis) {
    const heightRow = d3.select('#height-selection').node()?.closest('tr');
    
    if (!heightRow) {
        console.warn('Height selection row not found in DOM');
        return;
    }
    
    if (dimensionAnalysis.is3D && dimensionAnalysis.availableLevels.length > 0) {
        // Show height selection for 3D data
        d3.select(heightRow).classed('invisible', false);
        
        // Generate level controls
        generateHeightControls(dimensionAnalysis.availableLevels, dimensionAnalysis.levelType);
        
        console.log(`Showing height selection for 3D data:`, {
            dimension: dimensionAnalysis.levelDimension,
            levels: dimensionAnalysis.availableLevels.length,
            type: dimensionAnalysis.levelType,
            variables: dimensionAnalysis.variablesWith3D
        });
    } else {
        // Hide height selection for 2D data
        d3.select(heightRow).classed('invisible', true);
        
        console.log('Hiding height selection for 2D data');
    }
}

function generateHeightControls(levels, levelType) {
    const container = d3.select('#height-selection');
    container.selectAll('*').remove();
    
    // Always include surface if not already present and if appropriate
    const needsSurface = !levels.some(level => 
        level.toLowerCase().includes('sfc') || 
        level.toLowerCase().includes('surface') ||
        level === '1000hPa' // Surface-like pressure
    );
    
    if (needsSurface && levelType !== 'height_meters') {
        levels = ['Sfc', ...levels];
    }
    
    // Limit number of levels shown (max 8 for UI space)
    const displayLevels = levels.length > 8 ? 
        [levels[0], ...levels.slice(1).filter((level, index) => index % Math.ceil(levels.length / 7) === 0)] :
        levels;
    
    displayLevels.forEach((level, index) => {
        if (index > 0) {
            container.append('span').text(' – ');
        }
        
        const buttonId = `level-${level.replace(/[^a-zA-Z0-9]/g, '')}`;
        const button = container.append('span')
            .attr('class', 'surface text-button')
            .attr('id', buttonId)
            .attr('title', `Level: ${level}`)
            .text(level);
        
        // Bind click handler for level selection
        button.on('click', function() {
            handleLevelSelection(level, levelType);
        });
    });
    
    // Add appropriate unit label
    const unitLabel = levelType === 'pressure_hpa' || levelType === 'pressure_pa' ? ' hPa' :
                      levelType === 'height_meters' ? ' m' : '';
    if (unitLabel) {
        container.append('span').text(unitLabel);
    }
    
    console.log(`Generated ${displayLevels.length} height controls:`, displayLevels);
}

function handleLevelSelection(selectedLevel, levelType) {
    console.log(`Level selected: ${selectedLevel} (type: ${levelType})`);
    
    // Update configuration to trigger data reload
    if (typeof configuration !== 'undefined') {
        const surface = selectedLevel === 'Sfc' || selectedLevel.includes('surface') ? 'surface' : 'isobaric';
        const levelValue = selectedLevel === 'Sfc' ? 'level' : selectedLevel;
        
        configuration.save({
            surface: surface,
            level: levelValue,
            // Add metadata flag to indicate this is a metadata-driven selection
            metadataLevel: selectedLevel,
            // Force reload
            _levelChanged: Date.now()
        });
        
        console.log(`Configuration updated:`, {surface, level: levelValue, metadataLevel: selectedLevel});
    }
    
    // Update visual selection state
    d3.selectAll('#height-selection .surface').classed('highlighted', false);
    d3.select(`#level-${selectedLevel.replace(/[^a-zA-Z0-9]/g, '')}`).classed('highlighted', true);
    
    // Update status
    d3.select('#status').text(`Loading data for level ${selectedLevel}...`);
}
```

## Implementation Architecture

### Master Initialization Flow

```javascript
function initializeEnhancedMetadataUI(metadata) {
    console.log('Starting enhanced metadata UI initialization...');
    
    try {
        // Store metadata globally for access by other components
        window.lastMetadata = metadata;
        
        // Phase 4: Mode detection and time navigation
        const modeInfo = detectMode(metadata);
        setupModeUI(modeInfo.mode, modeInfo);
        setupMetadataTimeNavigation(metadata);
        
        // Phase 5: Variable-based overlays
        const categorizedVars = categorizeVariables(metadata.variables, modeInfo.mode, modeInfo);
        generateModeSpecificOverlays(modeInfo.mode, categorizedVars, metadata);
        setupVariableSelectionHandlers();
        
        // Phase 6: Dynamic height selection
        const dimensionAnalysis = analyzeDimensions(metadata);
        manageHeightSelection(dimensionAnalysis);
        
        // Update data source information
        updateDataSourceDisplay(metadata);
        
        console.log('Enhanced metadata UI initialization complete');
        
        return {
            mode: modeInfo,
            variables: categorizedVars,
            dimensions: dimensionAnalysis,
            metadata: metadata
        };
        
    } catch (error) {
        console.error('Enhanced metadata UI initialization failed:', error);
        // Fallback to basic initialization
        return initializeBasicUI();
    }
}

function updateDataSourceDisplay(metadata) {
    let source = 'Rossby Server';
    
    // Try to extract from metadata
    if (metadata.global_attributes?.source) {
        source = metadata.global_attributes.source;
    } else if (metadata.global_attributes?.institution) {
        source = metadata.global_attributes.institution;
    } else {
        // Infer from variable names and patterns
        const variables = Object.keys(metadata.variables || {});
        if (variables.some(name => /^(u10|v10|t2m|d2m|sp|sst)$/.test(name))) {
            source = 'ERA5 / ECMWF';
        } else if (variables.some(name => /^(ust|vst|uo|vo)$/.test(name))) {
            source = 'Ocean Model Data';
        }
    }
    
    console.log(`Updating data source display to: ${source}`);
    
    // Update data center display
    const centerElement = d3.select('#data-center');
    if (!centerElement.empty()) {
        centerElement.text(source);
    }
}

function initializeBasicUI() {
    console.log('Falling back to basic UI initialization');
    
    // Basic fallback configuration
    return {
        mode: {mode: 'wind', availableVariables: []},
        variables: {atmospheric: [], oceanic: [], surface: []},
        dimensions: {is3D: false, availableLevels: []},
        metadata: null
    };
}
```

## Error Handling and Robustness

### Graceful Degradation Strategy

```javascript
function safelyExecute(operation, fallback, context = '') {
    try {
        return operation();
    } catch (error) {
        console.warn(`${context} failed:`, error);
        return fallback ? fallback() : null;
    }
}

function validateMetadata(metadata) {
    const validation = {
        isValid: true,
        errors: [],
        warnings: []
    };
    
    // Check required structure
    if (!metadata || typeof metadata !== 'object') {
        validation.isValid = false;
        validation.errors.push('Metadata is not a valid object');
        return validation;
    }
    
    // Check for coordinates
    if (!metadata.coordinates) {
        validation.warnings.push('No coordinates found in metadata');
    } else {
        if (!metadata.coordinates.time) {
            validation.warnings.push('No time coordinates found');
        }
        if (!metadata.coordinates.latitude || !metadata.coordinates.longitude) {
            validation.warnings.push('Missing spatial coordinates');
        }
    }
    
    // Check for variables
    if (!metadata.variables || Object.keys(metadata.variables).length === 0) {
        validation.warnings.push('No variables found in metadata');
    }
    
    return validation;
}

function handleMetadataError(error, context) {
    console.error(`Metadata error in ${context}:`, error);
    
    // Show user-friendly error message
    d3.select('#status').text(`Error loading metadata: ${error.message || 'Unknown error'}`);
    
    // Attempt recovery
    setTimeout(() => {
        d3.select('#status').text('Using default configuration...');
        initializeBasicUI();
    }, 2000);
}
```

## Integration Points with Earth.js

### Configuration System Integration

```javascript
function integrateWithEarthConfiguration(config, metadataResult) {
    // Extend existing configuration with metadata-driven options
    if (config && metadataResult) {
        // Add metadata-specific attributes
        config.set('metadataMode', metadataResult.mode.mode);
        config.set('availableVariables', metadataResult.variables);
        config.set('availableLevels', metadataResult.dimensions.availableLevels);
        config.set('is3D', metadataResult.dimensions.is3D);
        
        // Set up validation listeners
        config.on('change', function(model) {
            validateConfigurationAgainstMetadata(model.attributes, metadataResult);
        });
        
        console.log('Earth.js configuration integrated with metadata');
    }
}

function validateConfigurationAgainstMetadata(attributes, metadataResult) {
    // Validate overlay selection
    if (attributes.overlayType && attributes.overlayType !== 'off') {
        const allVars = [
            ...metadataResult.variables.atmospheric,
            ...metadataResult.variables.oceanic,
            ...metadataResult.variables.surface
        ];
        
        if (!allVars.includes(attributes.overlayType)) {
            console.warn(`Overlay ${attributes.overlayType} not available in metadata`);
            // Auto-correct to default
            if (typeof configuration !== 'undefined') {
                configuration.set('overlayType', 'off', {silent: true});
            }
        }
    }
    
    // Validate level selection
    if (attributes.level && metadataResult.dimensions.is3D) {
        if (!metadataResult.dimensions.availableLevels.includes(attributes.level)) {
            console.warn(`Level ${attributes.level} not available in metadata`);
        }
    }
}
```

### Products System Integration

```javascript
function integrateWithProductsSystem(productsSystem, metadataResult) {
    if (!productsSystem || !metadataResult) return;
    
    // Register metadata-driven products
    const allVariables = [
        ...metadataResult.variables.atmospheric,
        ...metadataResult.variables.oceanic,
        ...metadataResult.variables.surface
    ];
    
    allVariables.forEach(varName => {
        if (productsSystem.productsFor && productsSystem.productsFor.FACTORIES) {
            productsSystem.productsFor.FACTORIES[varName] = createVariableProductFactory(varName, metadataResult.mode.mode);
        }
    });
    
    console.log(`Integrated ${allVariables.length} variables with products system`);
}

function createVariableProductFactory(varName, mode) {
    return {
        matches: function(attr) {
            return attr.overlayType === varName && 
                   attr.param === (mode === 'ocean' ? 'ocean' : 'wind');
        },
        create: function(attr) {
            return {
                type: 'scalar_overlay',
                variable: varName,
                paths: [`/proxy/data?vars=${varName}&time=\${metadataTime}&format=json`],
                builder: 'scalar',
                metadata: {
                    source: 'rossby',
                    variable: varName,
                    mode: mode
                }
            };
        }
    };
}
```

## Performance Considerations

### Optimization Strategies

```javascript
// Debounced metadata updates to prevent excessive re-renders
function createDebouncedUpdater(updateFunction, delay = 300) {
    let timeoutId;
    
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => updateFunction.apply(this, args), delay);
    };
}

// Memoization for expensive operations
const memoizedOperations = new Map();

function memoize(key, operation) {
    if (memoizedOperations.has(key)) {
        return memoizedOperations.get(key);
    }
    
    const result = operation();
    memoizedOperations.set(key, result);
    return result;
}

// Efficient DOM updates
function batchDOMUpdates(updates) {
    // Use requestAnimationFrame for smooth updates
    requestAnimationFrame(() => {
        updates.forEach(update => {
            try {
                update();
            } catch (error) {
                console.warn('DOM update failed:', error);
            }
        });
    });
}
```

### Memory Management

```javascript
function cleanupMetadataUI() {
    // Remove event listeners
    d3.select(document).on('keydown', null);
    d3.selectAll('.text-button').on('click', null);
    
    // Clear global references
    delete window.metadataTimeInfo;
    delete window.lastMetadata;
    delete window.currentTimeIndex;
    
    // Clear memoization cache
    memoizedOperations.clear();
    
    console.log('Metadata UI cleanup completed');
}

// Auto-cleanup on page unload
window.addEventListener('beforeunload', cleanupMetadataUI);
```

## Testing Strategy

### Unit Testing Framework

```javascript
// Test utilities for metadata UI components
function createMockMetadata(options = {}) {
    return {
        coordinates: {
            time: options.time || [700464, 700465, 700466],
            latitude: options.latitude || [90, 89.75, 89.5],
            longitude: options.longitude || [0, 0.25, 0.5]
        },
        variables: options.variables || {
            u10: {attributes: {long_name: '10 metre U wind component', units: 'm s**-1'}},
            v10: {attributes: {long_name: '10 metre V wind component', units: 'm s**-1'}},
            t2m: {attributes: {long_name: '2 metre temperature', units: 'K'}}
        },
        dimensions: options.dimensions || {
            time: {size: 3},
            latitude: {size: 3},
            longitude: {size: 3}
        }
    };
}

function testModeDetection() {
    const testCases = [
        {
            name: 'Wind mode detection',
            metadata: createMockMetadata(),
            expectedMode: 'wind'
        },
        {
            name: 'Normal mode detection',
            metadata: createMockMetadata({
                variables: {
                    t2m: {attributes: {long_name: '2 metre temperature'}}
                }
            }),
            expectedMode: 'normal'
        }
    ];
    
    testCases.forEach(testCase => {
        const result = detectMode(testCase.metadata);
        console.assert(
            result.mode === testCase.expectedMode,
            `${testCase.name}: Expected ${testCase.expectedMode}, got ${result.mode}`
        );
    });
}

function testVariableCategorization() {
    const mockMetadata = createMockMetadata();
    const modeInfo = detectMode(mockMetadata);
    const result = categorizeVariables(mockMetadata.variables, modeInfo.mode, modeInfo);
    
    console.assert(
        result.atmospheric.includes('t2m'),
        'Temperature variable should be categorized as atmospheric'
    );
    
    console.assert(
        result.vectorComponents.includes('u10') && result.vectorComponents.includes('v10'),
        'Wind components should be categorized as vector components'
    );
}
```

### Integration Testing

```javascript
function testFullIntegration() {
    // Mock Earth.js dependencies
    const mockConfiguration = {
        on: function() {},
        save: function() {},
        set: function() {}
    };
    
    const mockBindFunction = function() {};
    const mockProducts = {
        productsFor: {
            FACTORIES: {}
        }
    };
    
    // Test full initialization
    const mockMetadata = createMockMetadata();
    const result = safelyExecute(
        () => initializeEnhancedMetadataUI(mockMetadata),
        () => initializeBasicUI(),
        'Full integration test'
    );
    
    console.assert(
        result && result.mode && result.variables && result.dimensions,
        'Full integration should return complete result object'
    );
}

// Run tests in development mode
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    console.log('Running metadata UI tests...');
    testModeDetection();
    testVariableCategorization();
    testFullIntegration();
    console.log('Metadata UI tests completed');
}
```

## Implementation Checklist

### Phase 4 Implementation Tasks
- [ ] Implement `detectMode()` function with all wind/ocean pair patterns
- [ ] Create `setupMetadataTimeNavigation()` with pure numeric time display
- [ ] Implement `setupMetadataNavigationHandlers()` with keyboard support
- [ ] Add mode button state management and UI visibility controls
- [ ] Test time navigation with various NetCDF time coordinate formats

### Phase 5 Implementation Tasks  
- [ ] Implement `categorizeVariables()` with comprehensive pattern matching
- [ ] Create `generateModeSpecificOverlays()` for dynamic overlay generation
- [ ] Implement `createDisplayName()` smart abbreviation system
- [ ] Add `setupVariableSelectionHandlers()` for data download triggers
- [ ] Register variables with Earth.js products system
- [ ] Test overlay generation with various variable sets

### Phase 6 Implementation Tasks
- [ ] Implement `analyzeDimensions()` for 2D/3D detection
- [ ] Create `manageHeightSelection()` for dynamic height control visibility
- [ ] Implement `generateHeightControls()` with level formatting
- [ ] Add `handleLevelSelection()` for configuration updates
- [ ] Test height selection with pressure levels, height levels, and model levels
- [ ] Validate hide/show behavior for 2D vs 3D data

### Integration Tasks
- [ ] Update `metadata-ui.js` with all new functions
- [ ] Integrate with existing Earth.js configuration system
- [ ] Test compatibility with existing Earth.js data loading pipeline
- [ ] Add error handling and graceful degradation
- [ ] Implement performance optimizations
- [ ] Add comprehensive test coverage

### Documentation Tasks
- [ ] Update API documentation with new function signatures
- [ ] Create user guide for metadata-driven UI features
- [ ] Document configuration parameters and metadata requirements
- [ ] Add troubleshooting guide for common issues
- [ ] Create migration guide from hardcoded to metadata-driven UI

## Conclusion

This comprehensive UI refactor design transforms the static Earth.js interface into a fully adaptive, metadata-driven system. The three-phase approach ensures:

1. **Intelligent Mode Detection**: Automatic detection of wind, ocean, or normal modes based on available variables
2. **Dynamic Time Navigation**: Direct use of NetCDF time coordinates for accurate temporal navigation  
3. **Adaptive Variable Overlays**: Mode-specific variable filtering and smart display name generation
4. **Responsive Height Controls**: Automatic 2D/3D detection with appropriate UI adaptation
5. **Robust Error Handling**: Graceful degradation and comprehensive validation
6. **Performance Optimization**: Efficient DOM updates and memory management
7. **Comprehensive Testing**: Unit and integration tests for reliability

The design maintains backward compatibility with existing Earth.js functionality while providing a foundation for future enhancements and broader metadata format support.
