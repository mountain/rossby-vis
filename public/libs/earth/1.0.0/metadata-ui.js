/**
 * Metadata-driven UI system for Earth.js
 * Automatically adapts UI components based on Rossby server metadata
 */

var MetadataUI = (function() {
    'use strict';

    /**
     * Metadata service for fetching and processing Rossby server metadata
     */
    function MetadataService() {
        this.metadata = null;
        this.uiConfig = null;
    }

    MetadataService.prototype = {
        /**
         * Initialize the metadata service
         */
        initialize: function() {
            console.log('MetadataService: Initializing...');
            
            var self = this;
            
            return this.fetchMetadata()
                .then(function(metadata) {
                    self.metadata = metadata;
                    self.uiConfig = self.buildUIConfig(metadata);
                    console.log('MetadataService: Initialized successfully', self.uiConfig);
                    return self.uiConfig;
                })
                .catch(function(error) {
                    console.warn('MetadataService: Failed to load metadata, using defaults:', error);
                    self.uiConfig = self.getDefaultConfig();
                    return self.uiConfig;
                });
        },

        /**
         * Fetch metadata from the Rossby server
         */
        fetchMetadata: function() {
            return fetch('/proxy/metadata')
                .then(function(response) {
                    if (!response.ok) {
                        throw new Error('HTTP ' + response.status + ' ' + response.statusText);
                    }
                    return response.json();
                })
                .then(function(data) {
                    console.log('MetadataService: Metadata fetched successfully');
                    return data;
                });
        },

        /**
         * Build UI configuration from metadata
         */
        buildUIConfig: function(metadata) {
            var variableMapper = new VariableMapper();
            var variableAnalysis = variableMapper.analyzeVariables(metadata);
            
            return {
                levels: this.extractLevels(metadata),
                variables: variableAnalysis,
                timeRange: this.extractTimeRange(metadata),
                source: this.extractSource(metadata),
                grid: this.extractGridInfo(metadata),
                coordinates: metadata.coordinates || {}
            };
        },

        /**
         * Extract available atmospheric levels from metadata - robust for varying NetCDF structures
         */
        extractLevels: function(metadata) {
            var levels = [];
            
            // Strategy 1: Look for explicit level coordinates
            if (metadata.coordinates && metadata.coordinates.level) {
                levels = metadata.coordinates.level.map(this.formatLevel);
            }
            
            // Strategy 2: Look for pressure levels in coordinates (different naming conventions)
            var possibleLevelCoords = ['level', 'pressure', 'plev', 'lev', 'z', 'height'];
            for (var i = 0; i < possibleLevelCoords.length; i++) {
                var coordName = possibleLevelCoords[i];
                if (metadata.coordinates && metadata.coordinates[coordName] && levels.length === 0) {
                    levels = metadata.coordinates[coordName].map(this.formatLevel);
                    console.log('MetadataService: Found levels in coordinate:', coordName);
                    break;
                }
            }
            
            // Strategy 3: Infer levels from variable dimensions
            if (levels.length === 0) {
                levels = this.inferLevelsFromVariables(metadata);
            }
            
            // Strategy 4: Check if any variables have surface-level data
            if (levels.length === 0 && this.hasVariablesAtSurface(metadata)) {
                levels = ['surface'];
                console.log('MetadataService: Detected surface-only variables');
            }
            
            // Clean and sort levels
            if (levels.length > 0) {
                levels = Array.from(new Set(levels)).sort(function(a, b) {
                    if (a === 'surface') return -1;
                    if (b === 'surface') return 1;
                    // Extract numeric values for comparison
                    var aNum = parseFloat(a);
                    var bNum = parseFloat(b);
                    if (!isNaN(aNum) && !isNaN(bNum)) {
                        return bNum - aNum; // Descending order (higher levels first)
                    }
                    return a.localeCompare(b);
                });
            }
            
            console.log('MetadataService: Extracted levels:', levels);
            return levels;
        },

        /**
         * Infer levels from variable dimensions for files without explicit level coordinates
         */
        inferLevelsFromVariables: function(metadata) {
            var levels = [];
            var variables = metadata.variables || {};
            
            // Look for variables with level-like dimensions
            Object.keys(variables).forEach(function(varName) {
                var variable = variables[varName];
                if (variable.dimensions) {
                    var dims = variable.dimensions;
                    
                    // Check for level-like dimension names
                    var levelDimNames = ['level', 'lev', 'plev', 'pressure', 'z', 'height'];
                    for (var i = 0; i < levelDimNames.length; i++) {
                        var dimName = levelDimNames[i];
                        if (dims.indexOf(dimName) !== -1) {
                            // Found a level dimension - try to get values
                            if (metadata.dimensions && metadata.dimensions[dimName] && metadata.dimensions[dimName].size) {
                                // Generate level labels based on dimension size and variable type
                                levels = this.generateLevelLabels(metadata.dimensions[dimName].size, varName);
                                console.log('MetadataService: Inferred levels from variable', varName, 'dimension', dimName);
                                break;
                            }
                        }
                    }
                }
            });
            
            return levels;
        },

        /**
         * Generate level labels when only dimension sizes are available
         */
        generateLevelLabels: function(levelCount, variableName) {
            var levels = [];
            
            // If it looks like pressure data, generate common pressure levels
            if (variableName.toLowerCase().includes('pressure') || 
                variableName.toLowerCase().includes('plev') ||
                levelCount >= 10) {
                // Common atmospheric pressure levels
                var commonLevels = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30, 20, 10];
                levels = commonLevels.slice(0, levelCount).map(function(p) { return p + 'hPa'; });
            } else {
                // Generate generic level labels
                for (var i = 0; i < levelCount; i++) {
                    levels.push('Level' + (i + 1));
                }
            }
            
            return levels;
        },

        /**
         * Format level values for display
         */
        formatLevel: function(level) {
            if (typeof level === 'number') {
                // Pressure level in Pa → hPa
                if (level > 10000) {
                    return Math.round(level / 100) + 'hPa';
                }
                // Height level in meters
                return level + 'm';
            }
            return String(level); // String levels like "surface"
        },

        /**
         * Check if metadata has variables available at surface - robust for different NetCDF conventions
         */
        hasVariablesAtSurface: function(metadata) {
            var variables = metadata.variables || {};
            
            return Object.keys(variables).some(function(varName) {
                var variable = variables[varName];
                var dimensions = variable.dimensions || [];
                var attributes = variable.attributes || {};
                
                // Strategy 1: Common surface variable naming patterns
                var surfacePatterns = [
                    /2m/, /10m/, /100m/,           // Height above surface
                    /^sp$/, /^sst$/, /^slp$/,      // Common surface variables
                    /surface/, /ground/, /skin/,   // Surface indicators
                    /^t2m$/, /^d2m$/, /^u10$/, /^v10$/ // ERA5-style surface variables
                ];
                
                var isSurfaceByName = surfacePatterns.some(function(pattern) {
                    return pattern.test(varName.toLowerCase());
                });
                
                if (isSurfaceByName) return true;
                
                // Strategy 2: Check dimension structure (time, lat, lon only = surface)
                var hasTimeLatLon = dimensions.length === 3 &&
                    (dimensions.indexOf('time') !== -1 || dimensions.indexOf('t') !== -1) &&
                    (dimensions.indexOf('latitude') !== -1 || dimensions.indexOf('lat') !== -1 || dimensions.indexOf('y') !== -1) &&
                    (dimensions.indexOf('longitude') !== -1 || dimensions.indexOf('lon') !== -1 || dimensions.indexOf('x') !== -1);
                
                if (hasTimeLatLon) return true;
                
                // Strategy 3: Check variable attributes for surface indicators
                var longName = (attributes.long_name || '').toLowerCase();
                var standardName = (attributes.standard_name || '').toLowerCase();
                
                var surfaceInAttributes = longName.includes('surface') || 
                                        longName.includes('2 metre') ||
                                        longName.includes('10 metre') ||
                                        standardName.includes('surface');
                
                return surfaceInAttributes;
            });
        },

        /**
         * Extract time range information - robust for different time coordinate formats
         */
        extractTimeRange: function(metadata) {
            var timeCoords = this.findTimeCoordinates(metadata);
            
            if (timeCoords.length === 0) {
                console.log('MetadataService: No time coordinates found, using default interval');
                return { interval: 3, unit: 'hours', source: 'default' };
            }
            
            // Detect time units and format from metadata
            var timeInfo = this.analyzeTimeCoordinates(timeCoords, metadata);
            
            // Calculate average interval between time points
            var intervals = [];
            for (var i = 1; i < Math.min(timeCoords.length, 10); i++) {
                intervals.push(timeCoords[i] - timeCoords[i-1]);
            }
            
            if (intervals.length > 0) {
                var avgInterval = intervals.reduce(function(a, b) { return a + b; }, 0) / intervals.length;
                
                return {
                    interval: Math.abs(Math.round(avgInterval)),
                    unit: timeInfo.unit,
                    source: 'metadata',
                    format: timeInfo.format,
                    count: timeCoords.length
                };
            }
            
            return { 
                interval: 1, 
                unit: timeInfo.unit || 'hours', 
                source: 'inferred',
                count: timeCoords.length
            };
        },

        /**
         * Find time coordinates using different possible naming conventions
         */
        findTimeCoordinates: function(metadata) {
            // Try different possible time coordinate names
            var possibleTimeNames = ['time', 't', 'Time', 'TIME'];
            
            for (var i = 0; i < possibleTimeNames.length; i++) {
                var timeName = possibleTimeNames[i];
                if (metadata.coordinates && metadata.coordinates[timeName]) {
                    console.log('MetadataService: Found time coordinates as:', timeName);
                    return metadata.coordinates[timeName];
                }
            }
            
            // Fallback: look in variables for time-like variables
            var variables = metadata.variables || {};
            for (var varName in variables) {
                var variable = variables[varName];
                var attributes = variable.attributes || {};
                
                if (attributes.units && 
                    (attributes.units.includes('since') || 
                     attributes.units.toLowerCase().includes('hour') ||
                     attributes.units.toLowerCase().includes('day'))) {
                    console.log('MetadataService: Found time variable:', varName);
                    // This variable seems to be time - but we need coordinate values
                    return []; // Return empty for now - would need actual values
                }
            }
            
            return [];
        },

        /**
         * Analyze time coordinates to determine units and format
         */
        analyzeTimeCoordinates: function(timeCoords, metadata) {
            var timeInfo = { unit: 'hours', format: 'numeric' };
            
            // Look for time variable attributes
            var timeVarNames = ['time', 't', 'Time', 'TIME'];
            var variables = metadata.variables || {};
            
            for (var i = 0; i < timeVarNames.length; i++) {
                var timeName = timeVarNames[i];
                if (variables[timeName] && variables[timeName].attributes) {
                    var attrs = variables[timeName].attributes;
                    
                    if (attrs.units) {
                        var units = attrs.units.toLowerCase();
                        
                        if (units.includes('days since') || units.includes('day since')) {
                            timeInfo.unit = 'days';
                        } else if (units.includes('hours since') || units.includes('hour since')) {
                            timeInfo.unit = 'hours';
                        } else if (units.includes('minutes since') || units.includes('minute since')) {
                            timeInfo.unit = 'minutes';
                        } else if (units.includes('seconds since') || units.includes('second since')) {
                            timeInfo.unit = 'seconds';
                        }
                        
                        timeInfo.unitsString = attrs.units;
                        console.log('MetadataService: Detected time units:', attrs.units);
                        break;
                    }
                }
            }
            
            return timeInfo;
        },

        /**
         * Extract data source information - comprehensive for different NetCDF conventions
         */
        extractSource: function(metadata) {
            // Try multiple possible attribute locations and names
            var sourceLocations = [
                metadata.global_attributes || {},
                metadata.attributes || {},
                metadata.metadata || {},
                metadata
            ];
            
            var sourceAttributes = [
                'source', 'Source', 'SOURCE',
                'institution', 'Institution', 'INSTITUTION',
                'centre', 'center', 'Centre', 'Center',
                'data_source', 'dataset_source',
                'title', 'Title', 'TITLE',
                'dataset', 'dataset_name',
                'model', 'model_name',
                'product', 'product_name'
            ];
            
            // Search through all possible locations and attribute names
            for (var i = 0; i < sourceLocations.length; i++) {
                var attrs = sourceLocations[i];
                if (!attrs) continue;
                
                for (var j = 0; j < sourceAttributes.length; j++) {
                    var attrName = sourceAttributes[j];
                    if (attrs[attrName] && typeof attrs[attrName] === 'string' && attrs[attrName].trim()) {
                        console.log('MetadataService: Found data source in', attrName + ':', attrs[attrName]);
                        return attrs[attrName].trim();
                    }
                }
            }
            
            // Fallback: try to infer from variable names or other metadata
            var inferredSource = this.inferDataSource(metadata);
            if (inferredSource) {
                return inferredSource;
            }
            
            return 'Rossby Server';
        },

        /**
         * Infer data source from variable names and patterns
         */
        inferDataSource: function(metadata) {
            var variables = metadata.variables || {};
            var varNames = Object.keys(variables);
            
            // ERA5 patterns
            if (varNames.some(function(name) { return /^(u10|v10|t2m|d2m|sp|sst)$/.test(name); })) {
                return 'ERA5 / ECMWF';
            }
            
            // GFS patterns
            if (varNames.some(function(name) { return /^(UGRD|VGRD|TMP|HGT)/.test(name); })) {
                return 'GFS / NCEP';
            }
            
            // OSCAR ocean patterns
            if (varNames.some(function(name) { return /current|oscar/i.test(name); })) {
                return 'OSCAR / Ocean Currents';
            }
            
            // Generic atmospheric model
            if (varNames.some(function(name) { return /^(u|v|temp|temperature|wind)/.test(name.toLowerCase()); })) {
                return 'Atmospheric Model';
            }
            
            return null;
        },

        /**
         * Extract grid information
         */
        extractGridInfo: function(metadata) {
            var dims = metadata.dimensions || {};
            var coords = metadata.coordinates || {};
            
            return {
                nx: (dims.longitude && dims.longitude.size) || 0,
                ny: (dims.latitude && dims.latitude.size) || 0,
                latRange: coords.latitude ? [
                    Math.min.apply(Math, coords.latitude),
                    Math.max.apply(Math, coords.latitude)
                ] : [-90, 90],
                lonRange: coords.longitude ? [
                    Math.min.apply(Math, coords.longitude),
                    Math.max.apply(Math, coords.longitude)
                ] : [0, 360]
            };
        },

        /**
         * Get default configuration when metadata loading fails
         */
        getDefaultConfig: function() {
            return {
                levels: ['surface', '1000hPa', '850hPa', '700hPa', '500hPa', '250hPa', '70hPa', '10hPa'],
                variables: {
                    scalar: [
                        {name: 'temp', display: 'Temp', category: 'temperature', longName: 'Temperature'},
                        {name: 'relative_humidity', display: 'RH', category: 'humidity', longName: 'Relative Humidity'}
                    ],
                    vector: [
                        {name: 'wind', display: 'Wind', category: 'wind', longName: 'Wind Speed', pair: {u: 'u10', v: 'v10'}}
                    ],
                    unknown: []
                },
                timeRange: {interval: 3, unit: 'hours'},
                source: 'GFS / NCEP / US National Weather Service',
                grid: {nx: 360, ny: 181, latRange: [-90, 90], lonRange: [0, 360]},
                coordinates: {}
            };
        }
    };

    /**
     * Variable analysis and mapping system
     */
    function VariableMapper() {
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

    VariableMapper.prototype = {
        /**
         * Analyze all variables from metadata
         */
        analyzeVariables: function(metadata) {
            var variables = metadata.variables || {};
            var variableKeys = Object.keys(variables);
            var analysis = {
                scalar: [],
                vector: [],
                unknown: []
            };
            
            var processedVectorComponents = new Set();
            
            // Filter out coordinate variables (dimensions)
            var coordinateVars = new Set(['longitude', 'latitude', 'time', 'level']);
            
            // Process each variable from metadata
            variableKeys.forEach(function(varName) {
                if (processedVectorComponents.has(varName)) {
                    return; // Skip already processed vector components
                }
                
                // Skip coordinate/dimension variables
                if (coordinateVars.has(varName)) {
                    return;
                }
                
                var varData = variables[varName];
                var attributes = varData.attributes || {};
                
                // Extract information from metadata
                var variableInfo = {
                    name: varName,
                    display: this.createDisplayName(varName, attributes.long_name),
                    longName: attributes.long_name || varName,
                    units: attributes.units || '',
                    category: this.categorizeVariable(varName, attributes.long_name),
                    type: this.detectVariableType(varName, attributes.long_name)
                };
                
                // Check if this is part of a vector pair
                var vectorPair = this.findVectorPair(varName, variableKeys);
                if (vectorPair && variableInfo.type === 'vector') {
                    // Create combined vector variable
                    var vectorInfo = Object.assign({}, variableInfo);
                    vectorInfo.pair = vectorPair;
                    vectorInfo.isVectorComponent = true;
                    vectorInfo.display = this.createVectorDisplayName(varName, vectorPair.v);
                    analysis.vector.push(vectorInfo);
                    
                    // Mark both components as processed
                    processedVectorComponents.add(varName);
                    processedVectorComponents.add(vectorPair.v);
                } else if (variableInfo.type === 'scalar') {
                    analysis.scalar.push(variableInfo);
                } else if (!this.isVectorComponent(varName)) {
                    // Only add to unknown if it's not obviously a vector component
                    analysis.unknown.push(variableInfo);
                }
            }, this);
            
            return analysis;
        },

        /**
         * Create display name from variable name - use metadata names directly
         */
        createDisplayName: function(varName, longName) {
            // Just use the variable name directly from metadata
            // No capitalization, no mapping - keep it faithful to the data source
            return varName;
        },

        /**
         * Create display name for vector variables
         */
        createVectorDisplayName: function(uVar, vVar) {
            // Extract common part (e.g., "10" from "u10"/"v10")
            var uNum = uVar.replace(/^u/i, '');
            var vNum = vVar.replace(/^v/i, '');
            
            if (uNum === vNum && uNum) {
                if (uNum.includes('10')) return 'Wind';
                if (uNum.includes('100')) return 'Wind100';
                return 'Wind' + uNum;
            }
            
            return 'Wind';
        },

        /**
         * Categorize variable based on name and long_name
         */
        categorizeVariable: function(varName, longName) {
            var searchText = (varName + ' ' + (longName || '')).toLowerCase();
            
            for (var category in this.categoryPatterns) {
                if (this.categoryPatterns[category].test(searchText)) {
                    return category;
                }
            }
            
            return 'general';
        },

        /**
         * Detect if variable is scalar or vector type
         */
        detectVariableType: function(varName, longName) {
            var searchText = (varName + ' ' + (longName || '')).toLowerCase();
            
            // Check for wind components
            if (/u.*component|eastward|u10|u100|uas/i.test(searchText) ||
                /v.*component|northward|v10|v100|vas/i.test(searchText)) {
                return 'vector';
            }
            
            // Default to scalar
            return 'scalar';
        },

        /**
         * Check if variable name indicates it's a vector component
         */
        isVectorComponent: function(varName) {
            return /^[uv]\d+/i.test(varName) || /^[uv]as$/i.test(varName) || /^[uv]a$/i.test(varName);
        },

        /**
         * Find vector pair for wind components
         */
        findVectorPair: function(varName, availableVars) {
            for (var i = 0; i < this.vectorPairs.length; i++) {
                var pair = this.vectorPairs[i];
                if (varName === pair.u && availableVars.indexOf(pair.v) !== -1) {
                    return {u: pair.u, v: pair.v};
                }
                if (varName === pair.v && availableVars.indexOf(pair.u) !== -1) {
                    return {u: pair.u, v: pair.v};
                }
            }
            
            // Dynamic pattern matching for other wind components
            if (/^u/i.test(varName)) {
                var vComponent = varName.replace(/^u/i, 'v');
                if (availableVars.indexOf(vComponent) !== -1) {
                    return {u: varName, v: vComponent};
                }
            }
            if (/^v/i.test(varName)) {
                var uComponent = varName.replace(/^v/i, 'u');
                if (availableVars.indexOf(uComponent) !== -1) {
                    return {u: uComponent, v: varName};
                }
            }
            
            return null;
        }
    };

    /**
     * Dynamic UI component generation
     */
    var UIGenerator = {
        /**
         * Generate height control buttons dynamically
         */
        generateHeightControls: function(levels) {
            console.log('UIGenerator: Generating height controls for levels:', levels);
            
            var container = d3.selectAll('p.wind-mode').filter(function() {
                return this.textContent.indexOf('Height') !== -1;
            });
            
            if (container.empty()) {
                console.warn('UIGenerator: Height control container not found');
                return;
            }
            
            // Clear existing controls (but keep the "Height | " text)
            container.selectAll('.surface').remove();
            container.selectAll('span').filter(function() {
                return this.textContent === ' – ';
            }).remove();
            
            // If no levels available, hide the entire height control section
            if (levels.length === 0) {
                container.style('display', 'none');
                console.log('UIGenerator: No levels available, hiding height controls');
                return;
            }
            
            // Show the container if it was previously hidden
            container.style('display', null);
            
            // Generate new controls
            levels.forEach(function(level, index) {
                var buttonId = 'level-' + level.replace(/[^a-zA-Z0-9]/g, '');
                var displayName = UIGenerator.getDisplayName(level);
                
                if (index > 0) {
                    container.append('span').text(' – ');
                }
                
                var button = container.append('span')
                    .attr('class', 'surface text-button')
                    .attr('id', buttonId)
                    .attr('title', level)
                    .text(displayName);
                    
                // Use robust event binding with retry mechanism
                UIGenerator.bindButtonWithRetry('#' + buttonId, {
                    param: "wind", 
                    surface: level === 'surface' ? 'surface' : 'isobaric',
                    level: level
                });
            });
            
            // Add the unit label only if there are pressure levels
            var hasPressureLevels = levels.some(function(level) {
                return level.includes('hPa');
            });
            if (hasPressureLevels) {
                container.append('span').text(' hPa');
            }
            
            console.log('UIGenerator: Height controls generated successfully');
        },

        /**
         * Generate overlay controls from variable analysis
         */
        generateOverlayControls: function(variableAnalysis) {
            console.log('UIGenerator: Generating overlay controls for variables:', variableAnalysis);
            
            // Find both overlay control containers
            var overlayContainers = d3.selectAll('p.wind-mode').filter(function() {
                return this.textContent.indexOf('Overlay') !== -1;
            });
            
            if (overlayContainers.empty()) {
                console.warn('UIGenerator: Overlay control containers not found');
                return;
            }
            
            // Clear ALL existing overlay buttons from all containers
            overlayContainers.selectAll('.text-button').filter(function() {
                return this.id && this.id.startsWith('overlay-');
            }).remove();
            overlayContainers.selectAll('span').filter(function() {
                return this.textContent === ' – ';
            }).remove();
            
            // Remove the old hardcoded TPW/TCW/MSLP line completely
            overlayContainers.filter(function() {
                return this.textContent.indexOf('TPW') !== -1;
            }).remove();
            
            // Use the first remaining container for our metadata-driven controls
            var mainContainer = d3.selectAll('p.wind-mode').filter(function() {
                return this.textContent.indexOf('Overlay') !== -1 && this.textContent.indexOf('TPW') === -1;
            });
            
            if (mainContainer.empty()) {
                console.warn('UIGenerator: Main overlay control container not found after cleanup');
                return;
            }
            
            // Add default controls
            this.addOverlayButton(mainContainer, 'overlay-off', 'None', {overlayType: 'off'});
            this.addOverlayButton(mainContainer, 'overlay-wind', 'Wind', {overlayType: 'default'});
            
            // Add scalar variable overlays
            variableAnalysis.scalar.forEach(function(variable) {
                var buttonId = 'overlay-' + variable.name;
                UIGenerator.addOverlayButton(mainContainer, buttonId, variable.display, {
                    overlayType: variable.name
                });
            });
            
            console.log('UIGenerator: Overlay controls generated successfully');
        },

        /**
         * Add a single overlay button
         */
        addOverlayButton: function(container, id, text, config) {
            container.append('span').text(' – ');
            container.append('span')
                .attr('class', 'text-button')
                .attr('id', id)
                .attr('title', text)
                .text(text);
                
            // Use robust event binding with retry mechanism
            this.bindButtonWithRetry('#' + id, config);
        },

        /**
         * Robust event binding with retry mechanism - enhanced for metadata overlays
         */
        bindButtonWithRetry: function(selector, config, maxRetries, currentAttempt) {
            maxRetries = maxRetries || 15;
            currentAttempt = currentAttempt || 0;
            
            // Check if Earth.js configuration system is ready
            if (typeof bindButtonToConfiguration === 'function' && 
                typeof configuration !== 'undefined' && 
                configuration &&
                configuration.save &&
                typeof d3 !== 'undefined') {
                try {
                    // For metadata overlay types, register them first
                    if (config.overlayType && config.overlayType !== 'off' && config.overlayType !== 'default') {
                        this.registerMetadataOverlayType(config.overlayType);
                    }
                    
                    bindButtonToConfiguration(selector, config);
                    console.log('UIGenerator: Successfully bound', selector, 'with config:', config);
                    return true;
                } catch (error) {
                    console.warn('UIGenerator: Error binding event for', selector, ':', error);
                    // Try direct binding as fallback
                    this.createDirectBinding(selector, config);
                    return false;
                }
            } else if (currentAttempt < maxRetries) {
                // Wait for Earth.js to be ready with exponential backoff
                var delay = Math.min(1000, 100 * Math.pow(1.5, currentAttempt));
                setTimeout(function() {
                    UIGenerator.bindButtonWithRetry(selector, config, maxRetries, currentAttempt + 1);
                }, delay);
            } else {
                // Final fallback after all retries
                console.log('UIGenerator: Using direct binding for', selector, 'after', maxRetries, 'attempts');
                this.createDirectBinding(selector, config);
            }
        },

        /**
         * Register metadata overlay type with Earth.js products system
         */
        registerMetadataOverlayType: function(overlayType) {
            try {
                // Add to products.overlayTypes if available
                if (typeof products !== 'undefined' && products && products.overlayTypes) {
                    if (typeof products.overlayTypes.add === 'function') {
                        products.overlayTypes.add(overlayType);
                    } else if (Array.isArray(products.overlayTypes)) {
                        if (products.overlayTypes.indexOf(overlayType) === -1) {
                            products.overlayTypes.push(overlayType);
                        }
                    }
                    console.log('UIGenerator: Registered overlay type:', overlayType);
                }
                
                // Also ensure the product factory exists
                this.ensureProductFactory(overlayType);
                
            } catch (error) {
                console.warn('UIGenerator: Failed to register overlay type', overlayType, ':', error);
            }
        },

        /**
         * Ensure product factory exists for metadata overlay
         */
        ensureProductFactory: function(overlayType) {
            if (typeof products !== 'undefined' && products && products.all) {
                // Check if factory already exists
                if (!products.all[overlayType]) {
                    // Create a basic factory for the metadata overlay
                    products.all[overlayType] = {
                        matches: function(attr) {
                            return attr.param === "wind" && attr.overlayType === overlayType;
                        },
                        create: function(attr) {
                            return UIGenerator.createMetadataOverlayProduct(overlayType, attr);
                        }
                    };
                    console.log('UIGenerator: Created product factory for:', overlayType);
                }
            }
        },

        /**
         * Create Earth.js product for metadata overlay
         */
        createMetadataOverlayProduct: function(overlayType, attr) {
            // Get current time from metadata if available
            var timeParam = 'time=700464'; // Default fallback
            if (window.metadataTimeInfo && window.metadataTimeInfo.all) {
                var currentIndex = window.currentTimeIndex || 0;
                var currentTime = window.metadataTimeInfo.all[currentIndex];
                timeParam = 'time=' + currentTime;
            }
            
            var proxyPath = '/proxy/data?vars=' + overlayType + '&' + timeParam + '&format=json';
            
            return {
                field: "scalar",
                type: overlayType,
                description: overlayType + " @ Surface",
                paths: [proxyPath],
                date: new Date(),
                builder: function(file) {
                    if (!file || !file[0] || !file[0].data) {
                        console.warn('UIGenerator: No data for overlay:', overlayType);
                        return null;
                    }
                    
                    var record = file[0];
                    var data = record.data[overlayType] || record.data;
                    
                    return {
                        header: record.header || {},
                        interpolate: window.bilinearInterpolateScalar || function() { return null; },
                        data: function(i) {
                            return Array.isArray(data) ? data[i] : null;
                        }
                    };
                },
                units: [{label: "units", conversion: function(x) { return x; }, precision: 2}],
                scale: {
                    bounds: [0, 1],
                    gradient: function(v, a) { return [200, 200, 200, a || 1]; }
                }
            };
        },

        /**
         * Create direct event binding when bindButtonToConfiguration fails
         */
        createDirectBinding: function(selector, config) {
            var element = d3.select(selector);
            if (!element.empty()) {
                element.on('click', function() {
                    console.log('UIGenerator: Direct click for', selector, 'with config:', config);
                    
                    // Apply configuration directly
                    if (typeof configuration !== 'undefined' && configuration && configuration.save) {
                        try {
                            // For metadata overlay types, ensure they're registered
                            if (config.overlayType && config.overlayType !== 'off' && config.overlayType !== 'default') {
                                UIGenerator.registerMetadataOverlayType(config.overlayType);
                            }
                            
                            configuration.save(config);
                            console.log('UIGenerator: Direct configuration applied:', config);
                        } catch (error) {
                            console.warn('UIGenerator: Failed to apply configuration directly:', error);
                        }
                    } else {
                        console.warn('UIGenerator: Configuration system not available');
                    }
                });
            }
        },

        /**
         * Get display name for level
         */
        getDisplayName: function(level) {
            if (level === 'surface') return 'Sfc';
            if (level.includes('hPa')) return level.replace('hPa', '');
            if (level.includes('m')) return level;
            return level;
        },

        /**
         * Update data source information
         */
        updateDataSource: function(source) {
            console.log('UIGenerator: Updating data source to:', source);
            
            this.waitForEarthJS(function() {
                var sourceElement = d3.select('#data-center');
                if (!sourceElement.empty()) {
                    sourceElement.text(source);
                }
            });
        },

        /**
         * Wait for Earth.js to be fully loaded before executing callback
         */
        waitForEarthJS: function(callback, maxRetries, currentAttempt) {
            maxRetries = maxRetries || 10;
            currentAttempt = currentAttempt || 0;
            
            if (typeof bindButtonToConfiguration === 'function' && 
                typeof configuration !== 'undefined' && 
                configuration &&
                typeof d3 !== 'undefined') {
                callback();
            } else if (currentAttempt < maxRetries) {
                setTimeout(function() {
                    UIGenerator.waitForEarthJS(callback, maxRetries, currentAttempt + 1);
                }, 500 * (currentAttempt + 1));
            } else {
                console.warn('UIGenerator: Earth.js not ready after', maxRetries, 'attempts');
            }
        },

        /**
         * Adapt time controls based on metadata - use raw temporal info from NetCDF
         */
        adaptTimeControls: function(timeRange, coordinates) {
            console.log('UIGenerator: Adapting time controls for metadata');
            
            if (!coordinates || !coordinates.time) {
                console.log('UIGenerator: No time coordinates available, using defaults');
                this.updateDateDisplayDefault();
                return;
            }
            
            var timeCoords = coordinates.time;
            console.log('UIGenerator: Processing time coordinates (total:', timeCoords.length, 'points)');
            
            if (timeCoords.length === 0) {
                this.updateDateDisplayDefault();
                return;
            }
            
            // Use raw time values directly from metadata (hours since 1900-01-01 00:00 UTC)
            var timeInfo = {
                start: timeCoords[0],
                end: timeCoords[timeCoords.length - 1],
                count: timeCoords.length,
                all: timeCoords,
                current: timeCoords[0] // Start at first available time
            };
            
            console.log('UIGenerator: Time range from metadata: start =', timeInfo.start, ', end =', timeInfo.end, ', count =', timeInfo.count);
            
            // Store time info globally for navigation
            window.metadataTimeInfo = timeInfo;
            window.currentTimeIndex = 0;
            
            // Update navigation with actual intervals
            var interval = this.detectTimeInterval(timeCoords);
            this.updateNavigationTitles(interval);
            
            // Update date display with raw time info from NetCDF metadata
            this.updateDateDisplay(timeInfo);
            
            // Update control section to show actual time range boundaries
            this.updateControlSection(timeInfo, interval);
            
            // Set up navigation logic within metadata bounds
            this.setupMetadataNavigation(timeInfo, interval);
            
            // Integrate with Earth.js data loading system
            this.integrateWithEarthDataSystem(timeInfo, interval);
        },

        /**
         * Integrate metadata time navigation with Earth.js data loading system
         */
        integrateWithEarthDataSystem: function(timeInfo, interval) {
            var self = this;
            
            // Wait for Earth.js to be ready
            this.waitForEarthJS(function() {
                // Override Earth.js time navigation to use metadata bounds
                if (typeof configuration !== 'undefined' && configuration) {
                    // Listen for configuration changes to validate time bounds
                    configuration.on('change', function(model) {
                        var changed = model.changedAttributes();
                        if (changed.metadataTime !== undefined) {
                            // Handle metadata time changes
                            self.handleMetadataTimeChange(changed.metadataTime, timeInfo);
                        }
                    });
                    
                    console.log('UIGenerator: Integrated with Earth.js configuration system');
                }
                
                // Extend products.js with metadata-aware path generation
                if (typeof products !== 'undefined') {
                    // Store original path functions
                    window.originalGfsPath = products.gfs1p0degPath || function() { return ""; };
                    
                    // Override with metadata-aware paths
                    products.gfs1p0degPath = function(attr, variable, surface, level) {
                        return self.generateMetadataAwarePath(attr, variable, surface, level, timeInfo);
                    };
                    
                    console.log('UIGenerator: Enhanced products.js with metadata-aware paths');
                }
            });
        },

        /**
         * Generate metadata-aware data paths for proxy endpoints
         */
        generateMetadataAwarePath: function(attr, variable, surface, level, timeInfo) {
            // Use proxy endpoint with metadata time information
            var currentTime = window.metadataTimeInfo ? 
                window.metadataTimeInfo.all[window.currentTimeIndex || 0] : 
                timeInfo.start;
                
            // Convert NetCDF time to proxy query parameters
            var timeParam = 'time=' + currentTime;
            var varsParam = 'vars=' + variable;
            var formatParam = 'format=json';
            
            // Build proxy URL
            var proxyPath = '/proxy/data?' + [varsParam, timeParam, formatParam].join('&');
            
            console.log('UIGenerator: Generated metadata-aware path:', proxyPath, 'for variable:', variable);
            return proxyPath;
        },

        /**
         * Handle metadata time changes
         */
        handleMetadataTimeChange: function(newTime, timeInfo) {
            if (timeInfo.all.indexOf(newTime) !== -1) {
                var newIndex = timeInfo.all.indexOf(newTime);
                window.currentTimeIndex = newIndex;
                this.updateCurrentTimeDisplay(newTime, timeInfo);
                console.log('UIGenerator: Time changed to:', newTime, 'index:', newIndex);
            } else {
                console.warn('UIGenerator: Invalid time:', newTime, 'not in available times');
            }
        },

        /**
         * Update date display with raw temporal info from NetCDF metadata
         */
        updateDateDisplay: function(timeInfo) {
            console.log('UIGenerator: updateDateDisplay called with:', timeInfo);
            
            // Find the date element immediately, don't wait
            var attempts = 0;
            var maxAttempts = 50;
            
            function tryUpdateDate() {
                attempts++;
                var dateElement = d3.select('#data-date');
                
                console.log('UIGenerator: Attempt', attempts, 'to find date element, found:', !dateElement.empty());
                
                if (!dateElement.empty()) {
                    // Display raw time values directly from NetCDF metadata without conversion
                    var displayText;
                    if (timeInfo.count === 1) {
                        displayText = timeInfo.start + ' (1 time step)';
                    } else {
                        displayText = timeInfo.start + ' - ' + timeInfo.end + ' (' + timeInfo.count + ' steps)';
                    }
                    displayText += ' | Raw NetCDF time coordinates';
                    
                    dateElement.text(displayText);
                    
                    // Remove any timezone-related elements that might exist
                    var toggleElement = d3.select('#toggle-zone');
                    if (!toggleElement.empty()) {
                        toggleElement.remove();
                    }
                    
                    console.log('UIGenerator: Successfully updated date display with:', displayText);
                    
                    // Set up a periodic updater to override any Earth.js date formatting
                    if (!window.dateDisplayOverrideInterval) {
                        window.dateDisplayOverrideInterval = setInterval(function() {
                            var currentDateElement = d3.select('#data-date');
                            if (!currentDateElement.empty() && 
                                (currentDateElement.text().includes('NaN') || 
                                 currentDateElement.text().includes('Invalid') ||
                                 (!currentDateElement.text().includes('Raw NetCDF') && 
                                  !currentDateElement.text().includes('Current:')))) {
                                // Update with current time position if available
                                if (window.metadataTimeInfo && window.currentTimeIndex !== undefined) {
                                    var currentTime = window.metadataTimeInfo.all[window.currentTimeIndex];
                                    var currentIndex = window.currentTimeIndex;
                                    var currentDisplayText = 'Date | ' + currentTime + ' (step ' + (currentIndex + 1) + '/' + window.metadataTimeInfo.count + ') | Raw NetCDF time coordinates';
                                    currentDateElement.text(currentDisplayText);
                                } else {
                                    currentDateElement.text(displayText);
                                }
                                console.log('UIGenerator: Override applied to date display');
                            }
                        }, 1000);
                    }
                    
                    return true;
                } else if (attempts < maxAttempts) {
                    setTimeout(tryUpdateDate, 100);
                    return false;
                } else {
                    console.warn('UIGenerator: Could not find date element after', maxAttempts, 'attempts');
                    return false;
                }
            }
            
            tryUpdateDate();
        },

        /**
         * Update date display with default info when no time coordinates available
         */
        updateDateDisplayDefault: function() {
            this.waitForEarthJS(function() {
                var dateElement = d3.select('#data-date');
                if (dateElement.empty()) return;
                
                dateElement.text('No temporal information available');
                
                // Remove any timezone-related elements
                var toggleElement = d3.select('#toggle-zone');
                if (!toggleElement.empty()) {
                    toggleElement.remove();
                }
                
                console.log('UIGenerator: Set default date display (no time coordinates)');
            });
        },

        /**
         * Detect time interval from coordinates
         */
        detectTimeInterval: function(timeCoords) {
            if (timeCoords.length < 2) return 1;
            
            // Calculate interval from first few points  
            var intervals = [];
            for (var i = 1; i < Math.min(timeCoords.length, 5); i++) {
                intervals.push(timeCoords[i] - timeCoords[i-1]);
            }
            
            var avgInterval = intervals.reduce(function(a, b) { return a + b; }, 0) / intervals.length;
            console.log('UIGenerator: Detected time interval:', avgInterval, 'hours');
            return Math.round(avgInterval);
        },

        /**
         * Update navigation button titles
         */
        updateNavigationTitles: function(interval) {
            this.waitForEarthJS(function() {
                // Update navigation button titles
                d3.select('#nav-backward')
                    .attr('title', '-' + UIGenerator.formatTimeInterval(interval));
                d3.select('#nav-forward')
                    .attr('title', '+' + UIGenerator.formatTimeInterval(interval));
                d3.select('#nav-backward-more')
                    .attr('title', '-' + UIGenerator.formatTimeInterval(interval * 8));
                d3.select('#nav-forward-more')
                    .attr('title', '+' + UIGenerator.formatTimeInterval(interval * 8));
            });
        },

        /**
         * Format time interval for display
         */
        formatTimeInterval: function(hours) {
            if (Math.abs(hours) >= 24) {
                var days = Math.round(hours / 24);
                return Math.abs(days) + ' Day' + (Math.abs(days) !== 1 ? 's' : '');
            }
            return Math.abs(hours) + ' Hour' + (Math.abs(hours) !== 1 ? 's' : '');
        },

        /**
         * Update control section to show exact format: "Control | 700464 « – ‹ – › – » 700487"
         */
        updateControlSection: function(timeInfo, interval) {
            console.log('UIGenerator: Updating control section with metadata time range');
            
            this.waitForEarthJS(function() {
                // Find the control section
                var controlElements = d3.selectAll('p').filter(function() {
                    return this.textContent.indexOf('Control') !== -1;
                });
                
                if (controlElements.empty()) {
                    console.warn('UIGenerator: Control section not found');
                    return;
                }
                
                // Update the control section to show time boundaries
                var controlElement = controlElements.node();
                if (controlElement) {
                    // Clear and rebuild the control section with exact format: "Control | 700464 « – ‹ – › – » 700487"
                    d3.select(controlElement).selectAll('*').remove();
                    d3.select(controlElement).text('');
                    
                    // Add the control label and current time (initially start time)
                    var currentTimeSpan = d3.select(controlElement).append('span')
                        .attr('id', 'control-current-time')
                        .text('Control | ' + timeInfo.start + ' ');
                    
                    // Add navigation buttons in exact format
                    d3.select(controlElement).append('span')
                        .attr('class', 'text-button')
                        .attr('id', 'nav-backward-more-metadata')
                        .attr('title', 'Previous 8 steps')
                        .text('«')
                        .on('click', function() {
                            UIGenerator.navigateBySteps(-8, timeInfo, interval);
                        });
                    
                    d3.select(controlElement).append('span').text(' – ');
                    
                    d3.select(controlElement).append('span')
                        .attr('class', 'text-button')
                        .attr('id', 'nav-backward-metadata')
                        .attr('title', 'Previous step')
                        .text('‹')
                        .on('click', function() {
                            UIGenerator.navigateBySteps(-1, timeInfo, interval);
                        });
                    
                    d3.select(controlElement).append('span').text(' – ');
                    
                    d3.select(controlElement).append('span')
                        .attr('class', 'text-button')
                        .attr('id', 'nav-forward-metadata')
                        .attr('title', 'Next step')
                        .text('›')
                        .on('click', function() {
                            UIGenerator.navigateBySteps(1, timeInfo, interval);
                        });
                    
                    d3.select(controlElement).append('span').text(' – ');
                    
                    d3.select(controlElement).append('span')
                        .attr('class', 'text-button')
                        .attr('id', 'nav-forward-more-metadata')
                        .attr('title', 'Next 8 steps')
                        .text('»')
                        .on('click', function() {
                            UIGenerator.navigateBySteps(8, timeInfo, interval);
                        });
                    
                    d3.select(controlElement).append('span').text(' – » ' + timeInfo.end);
                    
                    console.log('UIGenerator: Control section updated with exact format:', 
                               'Control | ' + timeInfo.start + ' « – ‹ – › – » ' + timeInfo.end);
                }
            });
        },

        /**
         * Set up navigation logic within metadata bounds
         */
        setupMetadataNavigation: function(timeInfo, interval) {
            console.log('UIGenerator: Setting up metadata-aware navigation');
            
            // Store current time index (start at first time)
            window.currentTimeIndex = 0;
            window.metadataTimeInfo = timeInfo;
            window.metadataInterval = interval;
            
            // Override the original navigation buttons if they exist
            this.waitForEarthJS(function() {
                var originalButtons = ['#nav-now', '#nav-backward', '#nav-forward', '#nav-backward-more', '#nav-forward-more'];
                
                originalButtons.forEach(function(buttonId) {
                    var button = d3.select(buttonId);
                    if (!button.empty()) {
                        // Remove original event listeners and add metadata-aware ones
                        button.on('click', null); // Remove existing handlers
                        
                        switch(buttonId) {
                            case '#nav-now':
                                button.on('click', function() {
                                    UIGenerator.navigateToTime(timeInfo.start, timeInfo);
                                });
                                break;
                            case '#nav-backward':
                                button.on('click', function() {
                                    UIGenerator.navigateBySteps(-1, timeInfo, interval);
                                });
                                break;
                            case '#nav-forward':
                                button.on('click', function() {
                                    UIGenerator.navigateBySteps(1, timeInfo, interval);
                                });
                                break;
                            case '#nav-backward-more':
                                button.on('click', function() {
                                    UIGenerator.navigateBySteps(-8, timeInfo, interval);
                                });
                                break;
                            case '#nav-forward-more':
                                button.on('click', function() {
                                    UIGenerator.navigateBySteps(8, timeInfo, interval);
                                });
                                break;
                        }
                    }
                });
                
                console.log('UIGenerator: Original navigation buttons overridden with metadata logic');
            });
        },

        /**
         * Navigate to specific time within metadata bounds
         */
        navigateToTime: function(targetTime, timeInfo) {
            console.log('UIGenerator: Navigating to time:', targetTime);
            
            // Find the index of the target time
            var targetIndex = timeInfo.all.indexOf(targetTime);
            if (targetIndex === -1) {
                console.warn('UIGenerator: Time', targetTime, 'not found in available times');
                return;
            }
            
            // Update current time index
            window.currentTimeIndex = targetIndex;
            
            // Update the date display to show current position
            this.updateCurrentTimeDisplay(targetTime, timeInfo);
            
            // Trigger data reload if configuration system is available
            if (typeof configuration !== 'undefined' && configuration) {
                // Update configuration to trigger data reload
                configuration.save({
                    metadataTime: targetTime,
                    metadataTimeIndex: targetIndex
                });
            }
        },

        /**
         * Navigate by relative steps within metadata bounds
         */
        navigateBySteps: function(steps, timeInfo, interval) {
            var currentIndex = window.currentTimeIndex || 0;
            var newIndex = currentIndex + steps;
            
            // Clamp to bounds
            newIndex = Math.max(0, Math.min(newIndex, timeInfo.all.length - 1));
            
            if (newIndex !== currentIndex) {
                var newTime = timeInfo.all[newIndex];
                this.navigateToTime(newTime, timeInfo);
                console.log('UIGenerator: Navigated', steps, 'steps to index', newIndex, 'time', newTime);
            } else {
                console.log('UIGenerator: Navigation blocked - already at boundary');
            }
        },

        /**
         * Update date display to show current time position
         */
        updateCurrentTimeDisplay: function(currentTime, timeInfo) {
            var dateElement = d3.select('#data-date');
            if (!dateElement.empty()) {
                var currentIndex = timeInfo.all.indexOf(currentTime);
                var displayText = 'Date | ' + currentTime + ' (step ' + (currentIndex + 1) + '/' + timeInfo.count + ') | Raw NetCDF time coordinates';
                dateElement.text(displayText);
                console.log('UIGenerator: Updated current time display:', displayText);
                
                // Update the control display as well to highlight current time
                this.updateControlCurrentTime(currentTime, timeInfo);
            }
        },

        /**
         * Update control display to highlight current time position
         */
        updateControlCurrentTime: function(currentTime, timeInfo) {
            // Update the control-current-time span specifically
            var currentTimeElement = d3.select('#control-current-time');
            if (!currentTimeElement.empty()) {
                currentTimeElement.text('Control | ' + currentTime + ' ');
                console.log('UIGenerator: Updated control current time to:', currentTime);
            } else {
                // Fallback: find control section and update
                var controlElements = d3.selectAll('p').filter(function() {
                    return this.textContent.indexOf('Control') !== -1;
                });
                
                if (!controlElements.empty()) {
                    var controlElement = controlElements.node();
                    if (controlElement) {
                        // Update the text content to reflect current time
                        var controlText = controlElement.textContent;
                        var newText = controlText.replace(/Control \| \d+/, 'Control | ' + currentTime);
                        if (newText !== controlText) {
                            // Find the first text node and update it
                            var firstSpan = d3.select(controlElement).select('span');
                            if (!firstSpan.empty()) {
                                firstSpan.text('Control | ' + currentTime + ' ');
                            }
                        }
                    }
                }
            }
        }
    };

    /**
     * Dynamic product factory generator for Earth.js integration
     */
    var ProductFactoryGenerator = {
        /**
         * Generate dynamic product factories for discovered variables
         */
        generateProductFactories: function(variables) {
            var dynamicFactories = {};
            
            // Generate factories for scalar variables
            variables.scalar.forEach(function(variable) {
                dynamicFactories[variable.name] = {
                    matches: function(attr) {
                        return attr.param === "wind" && attr.overlayType === variable.name;
                    },
                    create: function(attr) {
                        return this.createScalarProduct(variable, attr);
                    }.bind(this)
                };
            });
            
            // Generate factories for vector variables (wind components)
            variables.vector.forEach(function(variable) {
                if (variable.var_type && variable.var_type.u_component) {
                    var baseName = variable.display_name.toLowerCase();
                    dynamicFactories[baseName] = {
                        matches: function(attr) {
                            return attr.param === "wind" && attr.overlayType === "default";
                        },
                        create: function(attr) {
                            return this.createVectorProduct(variable, attr);
                        }.bind(this)
                    };
                }
            });
            
            return dynamicFactories;
        },
        
        /**
         * Create Earth product for scalar variables
         */
        createScalarProduct: function(variable, attr) {
            // Determine appropriate units and scale based on variable type
            var productConfig = this.getProductConfig(variable);
            
            return this.buildProduct({
                field: "scalar",
                type: variable.name,
                description: this.localize({
                    name: {en: variable.display_name, ja: variable.display_name},
                    qualifier: {en: " @ " + this.describeSurface(attr), ja: " @ " + this.describeSurface(attr)}
                }),
                paths: [this.dynamicDataPath(attr, variable.name)],
                date: this.gfsDate(attr),
                builder: function(file) {
                    var record = file[0], data = record.data;
                    return {
                        header: record.header,
                        interpolate: window.bilinearInterpolateScalar,
                        data: function(i) {
                            return data[i];
                        }
                    };
                },
                units: productConfig.units,
                scale: productConfig.scale
            });
        },
        
        /**
         * Create Earth product for vector variables (wind)
         */
        createVectorProduct: function(variable, attr) {
            return this.buildProduct({
                field: "vector",
                type: "wind",
                description: this.localize({
                    name: {en: variable.display_name, ja: variable.display_name},
                    qualifier: {en: " @ " + this.describeSurface(attr), ja: " @ " + this.describeSurface(attr)}
                }),
                paths: [this.dynamicDataPath(attr, variable.name)],
                date: this.gfsDate(attr),
                builder: function(file) {
                    var uData = file[0].data, vData = file[1].data;
                    return {
                        header: file[0].header,
                        interpolate: window.bilinearInterpolateVector,
                        data: function(i) {
                            return [uData[i], vData[i]];
                        }
                    };
                },
                units: [
                    {label: "km/h", conversion: function(x) { return x * 3.6; }, precision: 0},
                    {label: "m/s", conversion: function(x) { return x; }, precision: 1},
                    {label: "kn", conversion: function(x) { return x * 1.943844; }, precision: 0},
                    {label: "mph", conversion: function(x) { return x * 2.236936; }, precision: 0}
                ],
                scale: {
                    bounds: [0, 100],
                    gradient: function(v, a) {
                        return typeof µ !== 'undefined' && µ.extendedSinebowColor ? 
                            µ.extendedSinebowColor(Math.min(v, 100) / 100, a) :
                            [255, 255, 255, a]; // Fallback color
                    }
                },
                particles: {velocityScale: 1/60000, maxIntensity: 17}
            });
        },
        
        /**
         * Get appropriate product configuration based on variable type
         */
        getProductConfig: function(variable) {
            switch (variable.category) {
                case 'temperature':
                    return {
                        units: [
                            {label: "°C", conversion: function(x) { return x - 273.15; }, precision: 1},
                            {label: "°F", conversion: function(x) { return x * 9/5 - 459.67; }, precision: 1},
                            {label: "K", conversion: function(x) { return x; }, precision: 1}
                        ],
                        scale: {
                            bounds: [193, 328],
                            gradient: typeof µ !== 'undefined' && µ.segmentedColorScale ? µ.segmentedColorScale([
                                [193, [37, 4, 42]],
                                [206, [41, 10, 130]],
                                [219, [81, 40, 40]],
                                [233.15, [192, 37, 149]],
                                [255.372, [70, 215, 215]],
                                [273.15, [21, 84, 187]],
                                [275.15, [24, 132, 14]],
                                [291, [247, 251, 59]],
                                [298, [235, 167, 21]],
                                [311, [230, 71, 39]],
                                [328, [88, 27, 67]]
                            ]) : function() { return [255, 255, 255]; }
                        }
                    };
                    
                case 'pressure':
                    return {
                        units: [
                            {label: "hPa", conversion: function(x) { return x / 100; }, precision: 0},
                            {label: "Pa", conversion: function(x) { return x; }, precision: 0}
                        ],
                        scale: {
                            bounds: [92000, 105000],
                            gradient: typeof µ !== 'undefined' && µ.segmentedColorScale ? µ.segmentedColorScale([
                                [92000, [40, 0, 0]],
                                [95000, [187, 60, 31]],
                                [98000, [16, 1, 43]],
                                [101300, [241, 254, 18]],
                                [105000, [255, 255, 255]]
                            ]) : function() { return [255, 255, 255]; }
                        }
                    };
                    
                case 'humidity':
                    return {
                        units: [
                            {label: variable.units || "K", conversion: function(x) { return x; }, precision: 1}
                        ],
                        scale: {
                            bounds: [0, 100],
                            gradient: function(v, a) {
                                return typeof µ !== 'undefined' && µ.sinebowColor ? 
                                    µ.sinebowColor(Math.min(v, 100) / 100, a) :
                                    [255, 255, 255, a];
                            }
                        }
                    };
                    
                default:
                    // Generic configuration for unknown variable types
                    return {
                        units: [
                            {label: variable.units || "units", conversion: function(x) { return x; }, precision: 2}
                        ],
                        scale: {
                            bounds: [0, 1],
                            gradient: function(v, a) {
                                return typeof µ !== 'undefined' && µ.sinebowColor ? 
                                    µ.sinebowColor(Math.min(Math.abs(v), 1), a) :
                                    [255, 255, 255, a];
                            }
                        }
                    };
            }
        },
        
        /**
         * Dynamic data path generator using new server endpoint
         */
        dynamicDataPath: function(attr, variable) {
            var dir = attr.date, stamp = dir === "current" ? "current" : attr.hour;
            var file = [stamp, variable, attr.surface, attr.level, "gfs", "1.0"].filter(function(x) { return x != null; }).join("-") + ".json";
            return ["/data/weather", dir, file].join("/");
        },
        
        /**
         * Helper functions (simplified versions of products.js functions)
         */
        buildProduct: function(overrides) {
            var defaultProduct = {
                description: "",
                paths: [],
                date: null,
                navigate: function(step) {
                    return this.gfsStep(this.date, step);
                },
                load: function(cancel) {
                    var me = this;
                    return when.map(this.paths, µ.loadJson).then(function(files) {
                        return cancel.requested ? null : _.extend(me, buildGrid(me.builder.apply(me, files)));
                    });
                }
            };
            return _.extend(defaultProduct, overrides);
        },
        
        describeSurface: function(attr) {
            return attr.surface === "surface" ? "Surface" : (attr.level || "Level");
        },
        
        gfsDate: function(attr) {
            if (attr.date === "current") {
                var now = new Date(Date.now()), hour = Math.floor(now.getUTCHours() / 3);
                return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
            }
            var parts = attr.date.split("/");
            return new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], +attr.hour.substr(0, 2)));
        },
        
        gfsStep: function(date, step) {
            var offset = (step > 1 ? 8 : step < -1 ? -8 : step) * 3, adjusted = new Date(date);
            adjusted.setHours(adjusted.getHours() + offset);
            return adjusted;
        },
        
        localize: function(table) {
            return function(langCode) {
                var result = {};
                Object.keys(table).forEach(function(key) {
                    var value = table[key];
                    result[key] = (value && value[langCode]) || (value && value.en) || value;
                });
                return result;
            };
        }
    };

    /**
     * Enhanced product integration for Earth.js
     */
    var EarthJSIntegration = {
        /**
         * Integrate metadata-driven products with Earth.js product system
         */
        integrateProducts: function(uiConfig) {
            if (typeof products === 'undefined') {
                console.warn('EarthJSIntegration: products.js not available');
                return;
            }
            
            // Add metadata variables to overlay types
            uiConfig.variables.scalar.forEach(function(variable) {
                if (products.overlayTypes && products.overlayTypes.add) {
                    products.overlayTypes.add(variable.name);
                }
            });
            
            // Generate metadata-aware product factories
            var metadataProducts = this.generateMetadataProducts(uiConfig);
            
            // Merge with existing products
            if (products.all) {
                Object.keys(metadataProducts).forEach(function(key) {
                    products.all[key] = metadataProducts[key];
                });
            }
            
            console.log('EarthJSIntegration: Integrated', Object.keys(metadataProducts).length, 'metadata products');
        },
        
        /**
         * Generate Earth.js compatible products from metadata
         */
        generateMetadataProducts: function(uiConfig) {
            var metadataProducts = {};
            
            // Generate scalar overlay products
            uiConfig.variables.scalar.forEach(function(variable) {
                metadataProducts[variable.name] = {
                    matches: function(attr) {
                        return attr.param === "wind" && attr.overlayType === variable.name;
                    },
                    create: function(attr) {
                        return EarthJSIntegration.createScalarProduct(variable, attr);
                    }
                };
            });
            
            // Generate vector products for wind
            uiConfig.variables.vector.forEach(function(variable) {
                if (variable.pair) {
                    metadataProducts['wind-' + variable.name] = {
                        matches: function(attr) {
                            return attr.param === "wind" && attr.overlayType === "default";
                        },
                        create: function(attr) {
                            return EarthJSIntegration.createVectorProduct(variable, attr);
                        }
                    };
                }
            });
            
            return metadataProducts;
        },
        
        /**
         * Create scalar product for Earth.js
         */
        createScalarProduct: function(variable, attr) {
            var config = this.getVariableConfig(variable);
            
            return {
                field: "scalar",
                type: variable.name,
                description: variable.longName || variable.name,
                paths: [this.buildProxyPath(variable.name, attr)],
                date: new Date(), // Current time
                builder: function(file) {
                    var record = file[0];
                    if (!record || !record.data) {
                        console.warn('EarthJSIntegration: Invalid data for', variable.name);
                        return null;
                    }
                    
                    return {
                        header: record.header || {},
                        interpolate: window.bilinearInterpolateScalar || function() { return null; },
                        data: function(i) {
                            return record.data && record.data[i];
                        }
                    };
                },
                units: config.units,
                scale: config.scale
            };
        },
        
        /**
         * Create vector product for Earth.js (wind)
         */
        createVectorProduct: function(variable, attr) {
            return {
                field: "vector",
                type: "wind",
                description: variable.longName || 'Wind',
                paths: [this.buildProxyPathForWind(variable.pair, attr)],
                date: new Date(),
                builder: function(file) {
                    var record = file[0];
                    if (!record || !record.data) {
                        console.warn('EarthJSIntegration: Invalid wind data');
                        return null;
                    }
                    
                    var uData = record.data[variable.pair.u];
                    var vData = record.data[variable.pair.v];
                    
                    if (!uData || !vData) {
                        console.warn('EarthJSIntegration: Missing wind components');
                        return null;
                    }
                    
                    return {
                        header: record.header || {},
                        interpolate: window.bilinearInterpolateVector || function() { return [0, 0]; },
                        data: function(i) {
                            return [uData[i] || 0, vData[i] || 0];
                        }
                    };
                },
                units: [
                    {label: "km/h", conversion: function(x) { return x * 3.6; }, precision: 0},
                    {label: "m/s", conversion: function(x) { return x; }, precision: 1},
                    {label: "kn", conversion: function(x) { return x * 1.943844; }, precision: 0},
                    {label: "mph", conversion: function(x) { return x * 2.236936; }, precision: 0}
                ],
                scale: {
                    bounds: [0, 100],
                    gradient: function(v, a) {
                        return window.µ && window.µ.extendedSinebowColor ? 
                            window.µ.extendedSinebowColor(Math.min(v, 100) / 100, a) :
                            [255, 255, 255, a];
                    }
                }
            };
        },
        
        /**
         * Build proxy path for single variable
         */
        buildProxyPath: function(variable, attr) {
            var timeParam = this.getCurrentTimeParam();
            return '/proxy/data?vars=' + variable + '&' + timeParam + '&format=json';
        },
        
        /**
         * Build proxy path for wind variables (u and v components)
         */
        buildProxyPathForWind: function(pair, attr) {
            var timeParam = this.getCurrentTimeParam();
            var vars = pair.u + ',' + pair.v;
            return '/proxy/data?vars=' + vars + '&' + timeParam + '&format=json';
        },
        
        /**
         * Get current time parameter from metadata
         */
        getCurrentTimeParam: function() {
            if (window.metadataTimeInfo && window.metadataTimeInfo.all) {
                var currentIndex = window.currentTimeIndex || 0;
                var currentTime = window.metadataTimeInfo.all[currentIndex];
                return 'time=' + currentTime;
            }
            return 'time=current';
        },
        
        /**
         * Get variable configuration for visualization
         */
        getVariableConfig: function(variable) {
            switch (variable.category) {
                case 'temperature':
                    return {
                        units: [
                            {label: "°C", conversion: function(x) { return x - 273.15; }, precision: 1},
                            {label: "°F", conversion: function(x) { return x * 9/5 - 459.67; }, precision: 1},
                            {label: "K", conversion: function(x) { return x; }, precision: 1}
                        ],
                        scale: {
                            bounds: [193, 328],
                            gradient: function(v, a) {
                                if (window.µ && window.µ.segmentedColorScale) {
                                    return window.µ.segmentedColorScale([
                                        [193, [37, 4, 42]],
                                        [233.15, [192, 37, 149]],
                                        [255.372, [70, 215, 215]],
                                        [273.15, [21, 84, 187]],
                                        [298, [235, 167, 21]],
                                        [328, [88, 27, 67]]
                                    ])(v, a);
                                }
                                return [255, 255, 255, a || 1];
                            }
                        }
                    };
                    
                case 'pressure':
                    return {
                        units: [
                            {label: "hPa", conversion: function(x) { return x / 100; }, precision: 0},
                            {label: "Pa", conversion: function(x) { return x; }, precision: 0}
                        ],
                        scale: {
                            bounds: [90000, 105000],
                            gradient: function(v, a) { return [100, 150, 200, a || 1]; }
                        }
                    };
                    
                default:
                    return {
                        units: [
                            {label: variable.units || "units", conversion: function(x) { return x; }, precision: 2}
                        ],
                        scale: {
                            bounds: [0, 1],
                            gradient: function(v, a) { return [200, 200, 200, a || 1]; }
                        }
                    };
            }
        }
    };

    /**
     * Main initialization function for metadata-driven UI
     */
    function initializeMetadataDrivenUI() {
        console.log('MetadataUI: Starting initialization...');
        
        var metadataService = new MetadataService();
        
        return metadataService.initialize()
            .then(function(uiConfig) {
                console.log('MetadataUI: Metadata loaded, generating UI components...');
                
                // Generate dynamic components with better timing
                setTimeout(function() {
                    UIGenerator.generateHeightControls(uiConfig.levels);
                    UIGenerator.generateOverlayControls(uiConfig.variables);
                    UIGenerator.adaptTimeControls(uiConfig.timeRange, uiConfig.coordinates);
                    UIGenerator.updateDataSource(uiConfig.source);
                }, 100);
                
                // Integrate with Earth.js products system
                setTimeout(function() {
                    EarthJSIntegration.integrateProducts(uiConfig);
                }, 200);
                
                console.log('MetadataUI: UI components generated successfully');
                
                // Store metadata service globally for potential future use
                window.metadataService = metadataService;
                window.metadataUIConfig = uiConfig;
                
                return uiConfig;
            })
            .catch(function(error) {
                console.error('MetadataUI: Initialization failed:', error);
                // Continue with default configuration
                return null;
            });
    }

    // Public API
    return {
        MetadataService: MetadataService,
        VariableMapper: VariableMapper,
        UIGenerator: UIGenerator,
        initialize: initializeMetadataDrivenUI
    };

})();

// Initialize metadata-driven UI when DOM is ready and after Earth.js loads
if (typeof window !== 'undefined') {
    var metadataUIInitialized = false;
    
    function startMetadataUI() {
        if (metadataUIInitialized) {
            return; // Prevent multiple initializations
        }
        
        console.log('MetadataUI: Starting initialization...');
        metadataUIInitialized = true;
        
        MetadataUI.initialize()
            .then(function(config) {
                console.log('MetadataUI: Initialization complete', config);
            })
            .catch(function(error) {
                console.error('MetadataUI: Failed to initialize:', error);
                metadataUIInitialized = false; // Allow retry on error
            });
    }
    
    // Check for Earth.js readiness before initializing
    function checkEarthJSReady() {
        return typeof d3 !== 'undefined' && 
               typeof bindButtonToConfiguration !== 'undefined' &&
               typeof configuration !== 'undefined';
    }
    
    function waitForEarthJSAndStart() {
        if (checkEarthJSReady()) {
            startMetadataUI();
        } else {
            setTimeout(waitForEarthJSAndStart, 250);
        }
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(waitForEarthJSAndStart, 1000);
        });
    } else {
        setTimeout(waitForEarthJSAndStart, 1000);
    }
    
    // Fallback initialization with longer delays
    setTimeout(function() {
        if (!metadataUIInitialized) {
            console.log('MetadataUI: Fallback initialization attempt');
            startMetadataUI();
        }
    }, 3000);
}
