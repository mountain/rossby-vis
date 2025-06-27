/**
 * Metadata-driven UI system for Earth.js integration with Rossby server
 */

var MetadataUI = (function() {
    "use strict";

    function detectMode(metadata) {
        var variables = Object.keys(metadata.variables || {});

        // Wind mode detection - look for u/v component pairs
        var windPairs = detectWindPairs(variables);
        if (windPairs.length > 0) {
            return {
                mode: 'wind',
                primaryVectorPair: windPairs[0], // e.g., {u: 'u10', v: 'v10'}
                allWindPairs: windPairs,
                availableVariables: variables.filter(function(v) { return !isWindComponent(v, windPairs); })
            };
        }
        
        // Ocean mode detection - look for ust/vst pairs
        var oceanPairs = detectOceanPairs(variables);
        if (oceanPairs.length > 0) {
            return {
                mode: 'ocean',
                primaryVectorPair: oceanPairs[0], // e.g., {u: 'ust', v: 'vst'}
                allOceanPairs: oceanPairs,
                availableVariables: variables.filter(function(v) { return !isOceanComponent(v, oceanPairs); })
            };
        }
        
        // Normal mode - no vector pairs detected
        return {
            mode: 'normal',
            availableVariables: variables
        };
    }

    function detectWindPairs(variables) {
        var pairs = [];
        var windPatterns = [
            {u: /^u(\d+)$/, v: /^v(\d+)$/},        // u10/v10, u100/v100
            {u: /^u(\d+)hPa$/, v: /^v(\d+)hPa$/},  // u850hPa/v850hPa
            {u: /^uas$/, v: /^vas$/},              // Surface wind (CMIP naming)
            {u: /^ua$/, v: /^va$/},                // Generic atmospheric wind
            {u: /^u_wind$/, v: /^v_wind$/}         // Alternative naming
        ];

        windPatterns.forEach(function(pattern) {
            variables.forEach(function(uVar) {
                if (pattern.u.test(uVar)) {
                    var vVar = uVar.replace(/^u/, 'v');

                    if (variables.indexOf(vVar) !== -1) {
                         var match = uVar.match(pattern.u);
                        var level = match && match[1] ? match[1] : '';

                        if (!pairs.some(p => p.u === uVar && p.v === vVar)) {
                            pairs.push({u: uVar, v: vVar, level: level});
                        }
                    }
                }
            });
        });

        return pairs;
    }

    function detectOceanPairs(variables) {
        var pairs = [];
        var oceanPatterns = [
            {u: /^ust$/, v: /^vst$/},              // Ocean surface currents
            {u: /^u_current$/, v: /^v_current$/},  // Generic current naming
            {u: /^uo$/, v: /^vo$/}                 // CMIP ocean velocity naming
        ];

        oceanPatterns.forEach(function(pattern) {
            var uVars = variables.filter(function(v) { return pattern.u.test(v); });

            uVars.forEach(function(uVar) {
                var correspondingV = uVar.replace(/^u/, 'v');

                if (variables.indexOf(correspondingV) !== -1) {
                    if (!pairs.some(p => p.u === uVar && p.v === correspondingV)) {
                        pairs.push({u: uVar, v: correspondingV});
                    }
                }
            });
        });

        return pairs;
    }

    function isWindComponent(varName, windPairs) {
        return windPairs.some(function(pair) {
            return pair.u === varName || pair.v === varName;
        });
    }

    function isOceanComponent(varName, oceanPairs) {
        return oceanPairs.some(function(pair) {
            return pair.u === varName || pair.v === varName;
        });
    }

    function setupModeUI(mode, modeInfo) {
        console.log('MetadataUI: Setting up mode UI for:', mode, modeInfo);
        
        // Update mode button states
        d3.selectAll('#wind-mode-enable, #ocean-mode-enable, #normal-mode-enable')
            .classed('highlighted', false);
        d3.select('#' + mode + '-mode-enable').classed('highlighted', true);
        
        // Show/hide mode-specific UI elements
        d3.selectAll('.wind-mode').classed('invisible', mode !== 'wind');
        d3.selectAll('.ocean-mode').classed('invisible', mode !== 'ocean');
        d3.selectAll('.normal-mode').classed('invisible', mode !== 'normal');
        
        // Update data layer display
        var dataLayerText = mode === 'wind' ? 'Wind' : 
                           mode === 'ocean' ? 'Ocean' : 'Data';
        d3.select('#data-layer').text(dataLayerText);
        
        // Update dynamic icon rendering based on metadata
        updateModeIconStates(mode, modeInfo);
        
        console.log('MetadataUI: Mode set to:', mode);
    }
    
    function updateModeIconStates(activeMode, modeInfo) {
        console.log('MetadataUI: Updating mode icon states for active mode:', activeMode);
        
        // Determine available modes based on metadata
        var availableModes = determinAvailableModes(modeInfo);
        
        // Update each mode icon and hide/show corresponding table rows
        var modes = ['wind', 'ocean', 'normal'];
        modes.forEach(function(mode) {
            var buttonId = '#' + mode + '-mode-enable';
            var button = d3.select(buttonId);
            var img = button.select('img');
            
            var isActive = mode === activeMode;
            var isAvailable = availableModes.indexOf(mode) !== -1;
            
            // Hide/show the entire table row based on availability
            var tableRow = d3.select('tr.' + mode + '-mode');
            if (!tableRow.empty()) {
                tableRow.classed('invisible', !isAvailable);
                console.log('MetadataUI: ' + (isAvailable ? 'Showing' : 'Hiding') + ' table row for', mode, 'mode');
            }
            
            if (!img.empty()) {
                // Update SVG stroke color and opacity based on state
                updateSVGIconState(img.node(), isActive, isAvailable, mode);
                
                // Update button interactivity
                button.classed('disabled', !isAvailable)
                      .style('opacity', isAvailable ? '1' : '0.5')
                      .style('cursor', isAvailable ? 'pointer' : 'not-allowed');
                      
                console.log('MetadataUI: Updated', mode, 'mode icon - active:', isActive, 'available:', isAvailable);
            }
        });
    }
    
    function determinAvailableModes(modeInfo) {
        var availableModes = [];
        
        // Normal mode is always available
        availableModes.push('normal');
        
        // Wind mode is available if wind pairs were detected
        if (modeInfo.mode === 'wind' || (modeInfo.allWindPairs && modeInfo.allWindPairs.length > 0)) {
            availableModes.push('wind');
        }
        
        // Ocean mode is available if ocean pairs were detected  
        if (modeInfo.mode === 'ocean' || (modeInfo.allOceanPairs && modeInfo.allOceanPairs.length > 0)) {
            availableModes.push('ocean');
        }
        
        // If we have wind pairs available but current mode is different, still mark wind as available
        if (window.lastMetadata) {
            var variables = Object.keys(window.lastMetadata.variables || {});
            var windPairs = detectWindPairs(variables);
            var oceanPairs = detectOceanPairs(variables);
            
            if (windPairs.length > 0 && availableModes.indexOf('wind') === -1) {
                availableModes.push('wind');
            }
            if (oceanPairs.length > 0 && availableModes.indexOf('ocean') === -1) {
                availableModes.push('ocean');
            }
        }
        
        console.log('MetadataUI: Available modes determined:', availableModes);
        return availableModes;
    }
    
    function updateSVGIconState(imgElement, isActive, isAvailable, mode) {
        if (!imgElement || !imgElement.src) return;
        
        // Load and modify SVG content
        fetch(imgElement.src)
            .then(function(response) {
                return response.text();
            })
            .then(function(svgText) {
                // Parse SVG and update stroke color
                var parser = new DOMParser();
                var svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
                var svgElement = svgDoc.documentElement;
                
                // Determine stroke color based on state
                var strokeColor;
                var opacity = '1';
                
                if (isActive) {
                    // Active mode: bright white stroke
                    strokeColor = 'white';
                    opacity = '1';
                } else if (isAvailable) {
                    // Available but inactive: gray stroke
                    strokeColor = '#888888';
                    opacity = '0.8';
                } else {
                    // Disabled/unavailable: dark gray stroke with reduced opacity
                    strokeColor = '#555555';
                    opacity = '0.4';
                }
                
                // Update all path elements with stroke
                var paths = svgElement.querySelectorAll('path[stroke]');
                paths.forEach(function(path) {
                    if (path.getAttribute('stroke') !== 'none') {
                        path.setAttribute('stroke', strokeColor);
                    }
                });
                
                // Also update the root SVG stroke if it exists
                if (svgElement.getAttribute('stroke') && svgElement.getAttribute('stroke') !== 'none') {
                    svgElement.setAttribute('stroke', strokeColor);
                }
                
                // Set opacity on the entire SVG
                svgElement.setAttribute('opacity', opacity);
                
                // Convert back to data URL and update img src
                var serializer = new XMLSerializer();
                var modifiedSvgText = serializer.serializeToString(svgElement);
                var dataUrl = 'data:image/svg+xml;base64,' + btoa(modifiedSvgText);
                
                imgElement.src = dataUrl;
                
                console.log('MetadataUI: Updated SVG icon for', mode, 'mode - stroke:', strokeColor, 'opacity:', opacity);
            })
            .catch(function(error) {
                console.warn('MetadataUI: Failed to update SVG icon for', mode, 'mode:', error);
            });
    }

    function setupMetadataTimeNavigation(metadata) {
        var timeCoords = metadata.coordinates && metadata.coordinates.time ? metadata.coordinates.time : [];
        
        if (timeCoords.length === 0) {
            console.warn('MetadataUI: No time coordinates found in metadata');
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
        
        // Also set currentTimeIndex for earth.js compatibility
        window.currentTimeIndex = 0;
        
        // Update UI elements with pure numeric format
        updateTimeDisplayElements();
        
        // Override existing navigation handlers
        setupMetadataNavigationHandlers();
        
        console.log('MetadataUI: Time navigation setup:', timeCoords.length, 'time points from', timeCoords[0], 'to', timeCoords[timeCoords.length - 1]);
    }

    function updateTimeDisplayElements() {
        var timeInfo = window.metadataTimeInfo;
        if (!timeInfo) return;

        d3.select('#data-time')
            .text(timeInfo.current.toString())
            .attr('title', 'Current: ' + timeInfo.current + ' (' + (timeInfo.currentIndex + 1) + '/' + timeInfo.count + ')');
        
        console.log('MetadataUI: Updated time display - current:', timeInfo.current, 'index:', timeInfo.currentIndex);
    }

    function setupMetadataNavigationHandlers() {
        // Override existing Earth.js navigation with metadata-aware versions
        d3.select('#nav-backward').on('click', function() { navigateMetadataTime(-1); });
        d3.select('#nav-forward').on('click', function() { navigateMetadataTime(1); });
        d3.select('#nav-backward-more').on('click', function() { navigateMetadataTime(-5); });
        d3.select('#nav-forward-more').on('click', function() { navigateMetadataTime(5); });

        // Keyboard navigation support
        d3.select(document).on('keydown', function() {
            var event = d3.event;
            if (event.keyCode === 37) { // Left arrow
                event.preventDefault();
                navigateMetadataTime(-1);
            } else if (event.keyCode === 39) { // Right arrow
                event.preventDefault();
                navigateMetadataTime(1);
            }
        });
        
        console.log('MetadataUI: Metadata navigation handlers setup complete');
    }

    function navigateMetadataTime(step) {
        var timeInfo = window.metadataTimeInfo;
        if (!timeInfo) return;
        
        var newIndex = Math.max(0, Math.min(timeInfo.all.length - 1, timeInfo.currentIndex + step));
        
        if (newIndex !== timeInfo.currentIndex) {
            timeInfo.currentIndex = newIndex;
            timeInfo.current = timeInfo.all[newIndex];
            
            // Update compatibility index for earth.js
            window.currentTimeIndex = newIndex;
            
            // Store the metadata time globally for products system to use
            window.currentMetadataTime = timeInfo.current;
            
            // Update configuration to trigger data reload with metadata time
            if (typeof configuration !== 'undefined') {
                // Use the actual metadata time value for data requests
                configuration.save({
                    metadataTime: timeInfo.current,
                    currentTime: timeInfo.current, // Also set as currentTime
                    date: 'metadata', // Flag to use metadata time
                    hour: '',
                    // Force data reload by changing a timestamp
                    _timeChanged: Date.now()
                });
            }
            
            updateTimeDisplayElements();
            
            // Force update after a brief delay to override any Earth.js time formatting
            setTimeout(function() {
                updateTimeDisplayElements();
            }, 100);
            
            // Also set up interval to maintain our time display
            if (!window.metadataTimeDisplayInterval) {
                window.metadataTimeDisplayInterval = setInterval(function() {
                    if (window.metadataTimeInfo) {
                        d3.select('#data-time').text(window.metadataTimeInfo.current.toString());
                    }
                }, 500);
            }
            
            console.log('MetadataUI: Navigated to time', timeInfo.current, '(index', newIndex + '), stored as currentMetadataTime');
        }
    }

    function categorizeVariables(variables, mode, modeInfo) {
        var categorized = {
            atmospheric: [],
            oceanic: [],
            surface: [],
            excluded: [],
            vectorComponents: []
        };

        // Pattern-based categorization
        var patterns = {
            atmospheric: /^(t2m|temp|temperature|d2m|dewpoint|humidity|rh|relative.*humidity|sp|surface.*pressure|msl|mean.*sea.*level|tisr|radiation|solar|tcw|total.*cloud.*water|cloud)$/i,
            oceanic: /^(sst|sea.*surface.*temp|salinity|sal|ssh|sea.*surface.*height|mld|mixed.*layer.*depth)$/i,
            surface: /^(sd|snow.*depth|tp|total.*precip|precipitation|rain|sf|surface.*flux|lhf|latent.*heat|shf|sensible.*heat)$/i
        };
        
        Object.keys(variables).forEach(function(varName) {
            // Skip coordinate variables
            if (['latitude', 'longitude', 'time', 'level', 'plev', 'height'].indexOf(varName.toLowerCase()) !== -1) {
                categorized.excluded.push(varName);
                return;
            }
            
            // Filter out vector components based on mode
            if (mode === 'wind' && modeInfo.allWindPairs && isWindComponent(varName, modeInfo.allWindPairs)) {
                categorized.vectorComponents.push(varName);
                return;
            }
            if (mode === 'ocean' && modeInfo.allOceanPairs && isOceanComponent(varName, modeInfo.allOceanPairs)) {
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

    function generateModeSpecificOverlays(mode, categorizedVars, metadata) {
        const html_id = "#" + mode + "-mode-overlay-variables"
        var container = d3.select(html_id);

        if (container.empty()) {
            console.warn('MetadataUI: No overlay container found');
            return;
        }
        
        // Clear existing controls
        container.selectAll('*').remove();

        // Add default "none" option
        addOverlayButton(container, 'overlay-off', 'none', {overlayType: 'off'});

        var availableVars = [];

        switch (mode) {
            case 'normal':
                // Show all non-coordinate variables directly
                availableVars = [].concat(
                    categorizedVars.atmospheric,
                    categorizedVars.oceanic,
                    categorizedVars.surface
                );
                break;
                
            case 'wind':
                // Show air-related variables (atmospheric + surface), filtered out u/v pairs
                availableVars = [].concat(
                    categorizedVars.atmospheric,
                    categorizedVars.surface
                );
                break;
                
            case 'ocean':
                // Show ocean-related variables, filtered out ust/vst pairs
                availableVars = categorizedVars.oceanic;
                break;
        }
        
        // Generate overlay buttons for available variables
        availableVars.forEach(function(varName) {
            addOverlayButton(container, 'overlay-' + varName, varName, {
                overlayType: varName,
                param: mode  // Use the actual detected mode directly
            });

            // Register variable with products system
            registerVariableOverlay(varName, mode);
        });

        console.log('MetadataUI: Generated', availableVars.length, 'overlay controls for', mode, 'mode:', availableVars);
    }

    function addOverlayButton(container, id, text, config) {
        // Add separator
        if (container.selectAll('.text-button').size() > 0) {
            container.append('span').text(' ');
        }

        // Add button
        var button = container.append('span')
            .attr('class', 'text-button')
            .attr('id', id)
            .attr('title', text)
            .text(text);
        
        // Bind to configuration system
        if (typeof bindButtonToConfiguration === 'function') {
            try {
                bindButtonToConfiguration('#' + id, config);
                console.log('MetadataUI: Successfully bound overlay button:', id);
            } catch (error) {
                console.warn('MetadataUI: Error binding overlay button:', error);
            }
        }
        
        return button;
    }

    function setupVariableSelectionHandlers() {
        // Listen for overlay selection changes in configuration
        if (typeof configuration !== 'undefined' && configuration.on) {
            configuration.on('change:overlayType', function(model, overlayType) {
                if (overlayType && overlayType !== 'off' && overlayType !== 'default') {
                    triggerVariableDataDownload(overlayType);
                }
            });
            
            // Also listen for mode changes that might affect available variables
            configuration.on('change:param', function(model, param) {
                // Regenerate overlays when mode changes
                if (window.lastMetadata) {
                    var modeInfo = detectMode(window.lastMetadata);
                    var categorizedVars = categorizeVariables(window.lastMetadata.variables, param, modeInfo);
                    generateModeSpecificOverlays(param, categorizedVars, window.lastMetadata);
                }
            });
            
            console.log('MetadataUI: Variable selection handlers setup complete');
        }
    }

    function triggerVariableDataDownload(varName) {
        console.log('MetadataUI: Triggering data download for variable:', varName);
        
        // Update status display
        updateStatus('Loading ' + varName + ' data...');
        
        // Update data layer display
        var currentMode = d3.select('#data-layer').text();
        d3.select('#data-layer').text(currentMode + ' + ' + varName);

        // The existing gridAgent system will handle the actual download
        // when configuration changes trigger a rebuild
        if (typeof gridAgent !== 'undefined' && gridAgent.submit) {
            gridAgent.submit(buildGrids);
        }
        
        // Also update overlay agent if available
        if (typeof overlayAgent !== 'undefined' && overlayAgent.submit) {
            overlayAgent.submit(function() {
                console.log('MetadataUI: Overlay agent processing', varName);
            });
        }
        
        // Set timeout to clear status if no completion is detected
        setTimeout(function() {
            clearStatusIfStale('Loading ' + varName + ' data...');
        }, 5000);
    }

    function registerVariableOverlay(varName, mode) {
        // Register with products system for metadata-driven variables
        if (typeof products !== 'undefined' && products && products.productsFor && products.productsFor.FACTORIES) {
            // Create a dynamic product factory for this variable that uses metadata time AND level
            products.productsFor.FACTORIES[varName] = {
                matches: function(attr) {
                    // Don't match if param is 'disabled' (normal mode only)
                    if (attr.param === 'disabled') {
                        return false;
                    }
                    return attr.overlayType === varName && 
                           (attr.param === mode || attr.param === 'disabled');  // Accept the detected mode or disabled
                },
                create: function(attr) {
                    console.log('Creating scalar overlay product for variable:', varName, 'with attributes:', attr);
                    
                    // Use current metadata time if available, fallback to configuration time
                    var currentTime = window.currentMetadataTime || 
                                    (window.metadataTimeInfo && window.metadataTimeInfo.current) ||
                                    attr.metadataTime ||
                                    attr.currentTime; // Use metadata time as fallback, not old GFS time
                    
                    // Build data URL with time and level parameters
                    var dataUrl = '/proxy/data?vars=' + varName + '&time=' + currentTime;
                    
                    // Add level parameter if 3D data is selected
                    if (attr.metadataLevel && attr.metadataLevel !== 'Sfc' && attr.metadataLevel !== 'surface') {
                        dataUrl += '&level=' + attr.metadataLevel;
                        console.log('MetadataUI: Including level parameter:', attr.metadataLevel);
                    }

                    dataUrl += '&format=json';

                    console.log('MetadataUI: Generated data URL:', dataUrl);
                    
                    // Return a product structure that Earth.js expects
                    return {
                        load: function() {
                            console.log('MetadataUI: Loading data from:', dataUrl);
                            return µ.loadJson(dataUrl).then(function(data) {
                                console.log('MetadataUI: Data loaded for variable:', varName, data);
                                
                                // Transform Rossby data to Earth format
                                if (data && data.data && data.data[varName]) {
                                    return [{
                                        header: {
                                            // Extract grid info from metadata
                                            nx: data.metadata && data.metadata.shape ? data.metadata.shape[2] : 144,
                                            ny: data.metadata && data.metadata.shape ? data.metadata.shape[1] : 73,
                                            lo1: 0, la1: 90, lo2: 359, la2: -90,
                                            dx: 2.5, dy: 2.5,
                                            parameterNumberName: varName,
                                            parameterUnit: data.metadata && data.metadata.variables && data.metadata.variables[varName] ? 
                                                          data.metadata.variables[varName].units || '' : ''
                                        },
                                        data: data.data[varName]
                                    }];
                                } else {
                                    console.error('MetadataUI: Invalid data structure for variable:', varName);
                                    return null;
                                }
                            }, function(error) {
                                console.error('MetadataUI: Failed to load data for variable:', varName, error);
                                return null;
                            });
                        }
                    };
                }
            };
            
            console.log('MetadataUI: Registered product factory for variable:', varName);
        }
    }

     function analyzeDimensions(metadata) {
        var variables = metadata.variables || {};
        var analysis = {
            is3D: false,
            availableLevels: [],
            levelDimension: null,
            variablesWith3D: [],
            levelType: null // 'pressure', 'height', 'model'
        };
        
        // Check each variable for dimensional structure
        Object.keys(variables).forEach(function(varName) {
            var varInfo = variables[varName];
            var dimensions = varInfo.dimensions || [];
            
            // Look for level/height dimensions
            var levelDims = dimensions.filter(function(dim) {
                var dimLower = dim.toLowerCase();
                return ['level', 'plev', 'height', 'isobaric', 'lev', 'z'].indexOf(dimLower) !== -1;
            });
            
            if (levelDims.length > 0) {
                analysis.is3D = true;
                analysis.levelDimension = levelDims[0];
                analysis.variablesWith3D.push(varName);
            }
        });
        
        // Extract available levels from coordinates
        if (analysis.is3D && analysis.levelDimension) {
            var levelCoords = metadata.coordinates && metadata.coordinates[analysis.levelDimension];
            if (levelCoords && Array.isArray(levelCoords)) {
                analysis.availableLevels = levelCoords.map(formatLevel);
                analysis.levelType = determineLevelType(levelCoords);
            }
        }
        
        // Check dimensions metadata for additional info
        var dimInfo = metadata.dimensions && metadata.dimensions[analysis.levelDimension];
        if (dimInfo && dimInfo.size) {
            console.log('MetadataUI: Found', dimInfo.size, 'levels in dimension', analysis.levelDimension);
        }
        
        console.log('MetadataUI: Dimension analysis complete:', {
            is3D: analysis.is3D,
            levelDimension: analysis.levelDimension,
            availableLevels: analysis.availableLevels.length,
            levelType: analysis.levelType,
            variables3D: analysis.variablesWith3D
        });
        
        return analysis;
    }

    function determineLevelType(levelCoords) {
        if (!levelCoords || levelCoords.length === 0) return 'unknown';
        
        var firstLevel = levelCoords[0];
        var lastLevel = levelCoords[levelCoords.length - 1];
        var minLevel = Math.min.apply(Math, levelCoords);
        var maxLevel = Math.max.apply(Math, levelCoords);
        
        // Pressure levels - check for typical pressure ranges
        // Pa range: 100-101325 Pa (1-1013.25 hPa)
        // hPa range: 1-1013 hPa
        if ((minLevel >= 100 && maxLevel <= 101325) || (minLevel >= 1 && maxLevel <= 1013)) {
            return minLevel > 1000 ? 'pressure_pa' : 'pressure_hpa';
        }
        
        // Large pressure values in Pa (10000+ Pa = 100+ hPa)
        if (minLevel > 10000 && maxLevel > 10000) {
            return 'pressure_pa';
        }
        
        // Height levels (meters) - typically 0-20000m range
        if (minLevel >= 0 && maxLevel < 50000 && minLevel < maxLevel) {
            return 'height_meters';
        }
        
        // Model levels (dimensionless) - typically 0-1 range
        if (minLevel >= 0 && maxLevel <= 1) {
            return 'model_levels';
        }
        
        // Default to pressure if values are in typical atmospheric pressure range
        if (minLevel > 50 && maxLevel > 50) {
            return minLevel > 1500 ? 'pressure_pa' : 'pressure_hpa';
        }
        
        return 'unknown';
    }

    function formatLevel(level) {
        return level.toString();
    }

    function manageHeightSelection(dimensionAnalysis) {
        var heightRow = d3.select('#height-selection');
        if (heightRow.empty()) {
            console.warn('MetadataUI: Height selection row not found in DOM');
            return;
        }

        if (dimensionAnalysis.is3D && dimensionAnalysis.availableLevels.length > 0) {
            // Show height selection for 3D data
            heightRow.classed('invisible', false);
            
            // Generate level controls
            generateHeightControls(dimensionAnalysis.availableLevels, dimensionAnalysis.levelType);
            
            console.log('MetadataUI: Showing height selection for 3D data:', {
                dimension: dimensionAnalysis.levelDimension,
                levels: dimensionAnalysis.availableLevels.length,
                type: dimensionAnalysis.levelType,
                variables: dimensionAnalysis.variablesWith3D
            });

            setTimeout(function () {
                handleLevelSelection(dimensionAnalysis.availableLevels[0], dimensionAnalysis.levelType);
            }, 1000);
        } else {
            // Hide height selection for 2D data
            heightRow.classed('invisible', true);
            
            console.log('MetadataUI: Hiding height selection for 2D data');
        }
    }

    function generateHeightControls(levels, levelType) {
        var container = d3.select('#surface-level');
        
        if (container.empty()) {
            console.warn('MetadataUI: Height control container not found');
            return;
        }
        
        container.selectAll('*').remove();

        // Always include surface if not already present and if appropriate
        var needsSurface = !levels.some(function(level) {
            var levelLower = level.toLowerCase();
            return levelLower.indexOf('sfc') !== -1 || 
                   levelLower.indexOf('surface') !== -1 ||
                   level === '1000hPa'; // Surface-like pressure
        });
        
        if (needsSurface && levelType !== 'height_meters') {
            levels = ['Sfc'].concat(levels);
        }
        
        // Limit number of levels shown (max 8 for UI space)
        var displayLevels = levels.length > 8 ? 
            [levels[0]].concat(levels.slice(1).filter(function(level, index) { 
                return index % Math.ceil(levels.length / 7) === 0; 
            })) :
            levels;
        
        displayLevels.forEach(function(level, index) {
            if (index > 0) {
                container.append('span').text(' ');
            }

            var buttonId = 'level-' + level.replace(/[^a-zA-Z0-9]/g, '');
            var button = container.append('span')
                .attr('class', 'surface text-button')
                .attr('id', buttonId)
                .attr('title', 'Level: ' + level)
                .text(level);
            
            // Bind click handler for level selection
            button.on('click', function() {
                handleLevelSelection(level, levelType);
            });
        });
        
        // Add appropriate unit label
        var unitLabel = levelType === 'pressure_hpa' || levelType === 'pressure_pa' ? ' hPa' :
                        levelType === 'height_meters' ? ' m' : '';
        if (unitLabel) {
            container.append('span').text(unitLabel);
        }
        
        console.log('MetadataUI: Generated', displayLevels.length, 'height controls:', displayLevels);
    }

    function handleLevelSelection(selectedLevel, levelType) {
        console.log('MetadataUI: Level selected:', selectedLevel, '(type:', levelType + ')');
        
        // Update configuration to trigger data reload
        if (typeof configuration !== 'undefined') {
            var surface = selectedLevel === 'Sfc' || selectedLevel.indexOf('surface') !== -1 ? 'surface' : 'isobaric';
            var levelValue = selectedLevel === 'Sfc' ? 'level' : selectedLevel;
            
            // Preserve the current param (mode) to prevent mode switching
            var currentParam = configuration.get('param');
            
            configuration.save({
                surface: surface,
                level: levelValue,
                // Preserve the current mode to prevent switching back to wind mode
                param: currentParam,
                // Add metadata flag to indicate this is a metadata-driven selection
                metadataLevel: selectedLevel,
                // Force reload
                _levelChanged: Date.now()
            });
            
            console.log('MetadataUI: Configuration updated:', {surface: surface, level: levelValue, param: currentParam, metadataLevel: selectedLevel});
        }
        
        // Update visual selection state
        d3.selectAll('#height-selection .surface, p .surface').classed('highlighted', false);
        d3.select('#level-' + selectedLevel.replace(/[^a-zA-Z0-9]/g, '')).classed('highlighted', true);
        
        // Update status
        d3.select('#status').text('Loading data for level ' + selectedLevel + '...');
    }

    // Main metadata service
    function MetadataService() {
        this.metadata = null;
        this.timeCoords = [];
    }

    MetadataService.prototype = {
        initialize: function() {
            console.log('MetadataUI: Starting initialization...');
            
            var self = this;
            return fetch('/proxy/metadata')
                .then(function(response) {
                    if (!response.ok) {
                        throw new Error('HTTP ' + response.status);
                    }
                    return response.json();
                })
                .then(function(metadata) {
                    self.metadata = metadata;
                    self.timeCoords = self.extractTimeCoordinates(metadata);
                    
                    console.log('MetadataUI: Metadata loaded, starting setup...');
                    return self.initializeEnhancedMetadataUI(metadata);
                })
                .catch(function(error) {
                    console.error('MetadataUI: Failed to load metadata:', error);
                    return self.initializeBasicUI();
                });
        },

        extractTimeCoordinates: function(metadata) {
            if (metadata.coordinates && metadata.coordinates.time) {
                return metadata.coordinates.time;
            }
            return [];
        },

        initializeEnhancedMetadataUI: function(metadata) {
            console.log('MetadataUI: Starting enhanced metadata UI initialization...');
            
            try {
                // Store metadata globally for access by other components
                window.lastMetadata = metadata;
                
                var modeInfo = detectMode(metadata);
                setupModeUI(modeInfo.mode, modeInfo);
                setupMetadataTimeNavigation(metadata);
                
                 var categorizedVars = categorizeVariables(metadata.variables, modeInfo.mode, modeInfo);
                generateModeSpecificOverlays(modeInfo.mode, categorizedVars, metadata);
                setupVariableSelectionHandlers();
                
                this.generateHeightControls(metadata);
                
                this.updateDataSourceDisplay(metadata);
                
                // Setup status management
                setupStatusClearingHandlers();
                
                console.log('MetadataUI: Enhanced metadata UI initialization complete');
                
                return {
                    mode: modeInfo,
                    variables: categorizedVars,
                    metadata: metadata
                };
                
            } catch (error) {
                console.error('MetadataUI: Enhanced metadata UI initialization failed:', error);
                return this.initializeBasicUI();
            }
        },

        initializeBasicUI: function() {
            console.log('MetadataUI: Falling back to basic UI initialization');
            
            // Basic fallback configuration
            return {
                mode: {mode: 'wind', availableVariables: []},
                metadata: null
            };
        },

        generateHeightControls: function(metadata) {
            var dimensionAnalysis = analyzeDimensions(metadata);
            manageHeightSelection(dimensionAnalysis);
        },


        updateDataSourceDisplay: function(metadata) {
            var source = 'Rossby Server';
            
            // Try to extract from metadata
            if (metadata.global_attributes && metadata.global_attributes.source) {
                source = metadata.global_attributes.source;
            } else if (metadata.global_attributes && metadata.global_attributes.institution) {
                source = metadata.global_attributes.institution;
            } else {
                // Infer from variable names
                var variables = metadata.variables || {};
                var varNames = Object.keys(variables);
                if (varNames.some(function(name) { return /^(u10|v10|t2m|d2m|sp|sst)$/.test(name); })) {
                    source = 'ERA5 / ECMWF';
                } else if (varNames.some(function(name) { return /^(ust|vst|uo|vo)$/.test(name); })) {
                    source = 'Ocean Model Data';
                }
            }
            
            console.log('MetadataUI: Updating data source display to:', source);
            
            // Update data center display
            var centerElement = d3.select('#data-center');
            if (!centerElement.empty()) {
                centerElement.text(source);
            }
        }
    };

    // Integration function for Earth.js
    function EarthJSIntegration() {
        return {
            initialize: function(dependencies) {
                console.log('MetadataUI: Starting integration');
                
                if (dependencies.configuration) {
                    window.configuration = dependencies.configuration;
                }
                if (dependencies.bindButtonToConfiguration) {
                    window.bindButtonToConfiguration = dependencies.bindButtonToConfiguration;
                }
                if (dependencies.products) {
                    window.products = dependencies.products;
                }
                
                // ISSUE 1 FIX: Prevent initial data loading by setting a flag
                console.log('MetadataUI: Preventing initial data load until metadata is ready');
                window.metadataUIReady = false;
                
                // Override the configuration to prevent automatic data loading
                if (dependencies.configuration) {
                    // Temporarily disable auto-loading by setting invalid parameters
                    dependencies.configuration.set({
                        param: 'metadata_loading', // Temporary mode to prevent data loading
                        date: 'pending',           // Invalid date to prevent data requests
                        overlayType: 'off'         // No overlays initially
                    }, {silent: true});
                }
                
                var metadataService = new MetadataService();
                
                return metadataService.initialize()
                    .then(function(result) {
                        if (result && result.metadata) {
                            console.log('MetadataUI: initialization complete, enabling data loading', result);
                            
                            // ISSUE 1 FIX: Now enable data loading with proper metadata-driven configuration
                            window.metadataUIReady = true;
                            
                            // Set proper initial configuration based on detected mode
                            if (dependencies.configuration && result.mode) {
                                var paramValue;
                                var overlayType = 'off';
                                
                                if (result.mode.mode === 'ocean') {
                                    paramValue = 'ocean';
                                } else if (result.mode.mode === 'wind') {
                                    paramValue = 'wind';
                                } else {
                                    // Normal mode - no vector data available, use normal param to prevent wind rendering
                                    paramValue = 'normal'; // Use normal param instead of disabled
                                    console.log('MetadataUI: Normal mode only - using normal param to prevent wind rendering');
                                    
                                    // If we have scalar variables, select the first one as overlay
                                    if (result.variables && result.variables.atmospheric && result.variables.atmospheric.length > 0) {
                                        overlayType = result.variables.atmospheric[0];
                                        console.log('MetadataUI: Auto-selecting first scalar variable as overlay:', overlayType);
                                    }
                                }
                                
                                var initialConfig = {
                                    param: paramValue,
                                    date: 'metadata', // Use metadata time
                                    overlayType: overlayType,
                                    metadataTime: window.metadataTimeInfo ? window.metadataTimeInfo.current : null
                                };
                                
                                console.log('MetadataUI: Setting initial configuration:', initialConfig);
                                dependencies.configuration.save(initialConfig);
                            }
                            
                            return result.metadata;
                        } else {
                            console.log('MetadataUI: No metadata available, enabling default behavior');
                            window.metadataUIReady = true;
                            return null;
                        }
                    })
                    .catch(function(error) {
                        console.error('MetadataUI: integration failed, enabling default behavior:', error);
                        window.metadataUIReady = true;
                        return null;
                    });
            }
        };
    }

    // Status management functions
    function updateStatus(message) {
        var statusElement = d3.select('#status');
        if (!statusElement.empty()) {
            statusElement.text(message);
            console.log('MetadataUI: Status updated:', message);
        }
        
        // Store the current status message and timestamp
        window.currentStatusMessage = message;
        window.statusTimestamp = Date.now();
    }
    
    function clearStatusIfStale(expectedMessage) {
        var statusElement = d3.select('#status');
        if (!statusElement.empty()) {
            var currentText = statusElement.text();
            
            // Only clear if the status hasn't been updated by something else
            if (currentText === expectedMessage || currentText === window.currentStatusMessage) {
                // Check if enough time has passed and no new activity
                var timeSinceUpdate = Date.now() - (window.statusTimestamp || 0);
                if (timeSinceUpdate > 3000) { // 3 seconds grace period
                    statusElement.text('Ready');
                    console.log('MetadataUI: Cleared stale status:', expectedMessage);
                    setTimeout(function() {
                        statusElement.text('');
                    }, 1000);
                }
            }
        }
    }
    
    function clearStatus() {
        var statusElement = d3.select('#status');
        if (!statusElement.empty()) {
            statusElement.text('Ready');
            console.log('MetadataUI: Status cleared');
            setTimeout(function() {
                statusElement.text('');
            }, 1000);
        }
        window.currentStatusMessage = null;
        window.statusTimestamp = null;
    }
    
    // Listen for data completion events to clear status
    function setupStatusClearingHandlers() {
        // Listen for gridAgent completion
        if (typeof gridAgent !== 'undefined' && gridAgent.on) {
            gridAgent.on('update', function(grids) {
                if (grids && grids.primaryGrid) {
                    setTimeout(function() {
                        clearStatus();
                    }, 1000); // Brief delay to show completion
                }
            });
        }
        
        // Listen for configuration changes that indicate completion
        if (typeof configuration !== 'undefined' && configuration.on) {
            configuration.on('change', function() {
                // Clear status when configuration settles (no rapid changes)
                setTimeout(function() {
                    if (Date.now() - (window.statusTimestamp || 0) > 2000) {
                        clearStatus();
                    }
                }, 3000);
            });
        }
        
        console.log('MetadataUI: Status clearing handlers setup');
    }

    // Export the main factory function
    return function(configurationOrDependencies, bindButtonToConfig, productsParam) {
        var dependencies;
        
        // Check if called with individual parameters (from Earth.js) or single object
        if (arguments.length > 1) {
            dependencies = {
                configuration: configurationOrDependencies,
                bindButtonToConfiguration: bindButtonToConfig,
                products: productsParam
            };
        } else {
            dependencies = configurationOrDependencies || {};
        }
        
        var integration = new EarthJSIntegration();
        
        // Return an object that matches Earth.js expectations
        return {
            initialize: function() {
                return integration.initialize(dependencies);
            }
        };
    };
})();

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MetadataUI;
}
