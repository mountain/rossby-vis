/**
 * Metadata-driven UI system for Earth.js integration with Rossby server
 * Phase 4: Enhanced Mode System with Metadata-Driven Time Controls
 */

var MetadataUI = (function() {
    "use strict";

    // Phase 4.1: Mode Detection System
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
            {u: /^u(\d+)$/, v: /^v(\d+)$/},        // u10/v10, u200/v200, u250/v250
            {u: /^u(\d+)hPa$/, v: /^v(\d+)hPa$/},  // u850hPa/v850hPa
            {u: /^uas$/, v: /^vas$/},              // Surface wind (CMIP naming)
            {u: /^ua$/, v: /^va$/},                // Generic atmospheric wind
            {u: /^u_wind$/, v: /^v_wind$/}         // Alternative naming
        ];
        
        windPatterns.forEach(function(pattern) {
            variables.forEach(function(uVar) {
                if (pattern.u.test(uVar)) {
                    var match = uVar.match(pattern.u);
                    var level = match && match[1] ? match[1] : '';
                    var vVar = uVar.replace(pattern.u, pattern.v.source.replace('(\\d+)', level));
                    if (variables.indexOf(vVar) !== -1) {
                        pairs.push({u: uVar, v: vVar, level: level});
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
            var vVars = variables.filter(function(v) { return pattern.v.test(v); });
            
            uVars.forEach(function(uVar) {
                var correspondingV = uVar.replace(pattern.u, pattern.v.source);
                if (vVars.indexOf(correspondingV) !== -1) {
                    pairs.push({u: uVar, v: correspondingV});
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

    // Phase 4.1: Mode UI Setup
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
        
        console.log('MetadataUI: Mode set to:', mode);
    }

    // Phase 4.2: Metadata-Driven Time Navigation
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
        
        // Update with pure numeric values from NC coordinates - no datetime parsing/formatting
        d3.select('#nav-start')
            .text(timeInfo.start.toString())
            .attr('title', 'Start: ' + timeInfo.start);
        
        d3.select('#nav-end')
            .text(timeInfo.end.toString())
            .attr('title', 'End: ' + timeInfo.end);
        
        // Update data-time with current time (Phase 4 requirement)
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
        
        // Direct navigation to start/end
        d3.select('#nav-start').on('click', function() { navigateToMetadataTime(0); });
        d3.select('#nav-end').on('click', function() { navigateToMetadataTime(-1); });
        
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
            
            // Update configuration to trigger data reload
            if (typeof configuration !== 'undefined') {
                configuration.save({
                    metadataTime: timeInfo.current,
                    date: 'metadata', // Flag to use metadata time
                    hour: ''
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
            
            console.log('MetadataUI: Navigated to time', timeInfo.current, '(index', newIndex + ')');
        }
    }

    function navigateToMetadataTime(index) {
        var timeInfo = window.metadataTimeInfo;
        if (!timeInfo) return;
        
        // Handle negative indices (from end)
        var targetIndex = index < 0 ? timeInfo.all.length + index : index;
        var clampedIndex = Math.max(0, Math.min(timeInfo.all.length - 1, targetIndex));
        
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

    // Phase 5: Variable Categorization Strategy
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

    // Phase 5: Use Variable Names Directly (No Smart Display Name Generation)
    function createDisplayName(varName, longName) {
        // Use the actual variable name from NC file directly
        return varName;
    }

    // Phase 5: Dynamic Overlay Control Generation
    function generateModeSpecificOverlays(mode, categorizedVars, metadata) {
        var container = d3.select('#overlay-variables');
        if (container.empty()) {
            // Try to find the overlay container in the existing structure
            container = d3.selectAll('p').filter(function() {
                return this.textContent.indexOf('Overlay') !== -1;
            });
        }
        
        if (container.empty()) {
            console.warn('MetadataUI: No overlay container found');
            return;
        }
        
        // Clear existing controls
        container.selectAll('*').remove();
        
        // Add default "None" option
        addOverlayButton(container, 'overlay-off', 'None', {overlayType: 'off'});
        
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
            var varInfo = metadata.variables[varName] || {};
            var displayName = createDisplayName(varName, varInfo.attributes && varInfo.attributes.long_name);
            
            addOverlayButton(container, 'overlay-' + varName, displayName, {
                overlayType: varName,
                param: mode === 'ocean' ? 'ocean' : 'wind'
            });
            
            // Register variable with products system
            registerVariableOverlay(varName, mode);
        });
        
        console.log('MetadataUI: Generated', availableVars.length, 'overlay controls for', mode, 'mode:', availableVars);
    }

    function addOverlayButton(container, id, text, config) {
        // Add separator
        if (container.selectAll('.text-button').size() > 0) {
            container.append('span').text(' – ');
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

    // Phase 5: Variable Selection Data Download System
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
        d3.select('#status').text('Loading ' + varName + ' data...');
        
        // Update data layer display
        var currentMode = d3.select('#data-layer').text();
        d3.select('#data-layer').text(currentMode + ' + ' + createDisplayName(varName));
        
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
    }

    function registerVariableOverlay(varName, mode) {
        // Register with products system using existing GFS-style data loading (not new Rossby proxy)
        if (typeof products !== 'undefined' && products && products.productsFor && products.productsFor.FACTORIES) {
            // Use the existing Earth.js overlay system instead of creating new Rossby endpoints
            // This maps NC file variables to existing overlay types that Earth.js already knows how to handle
            
            var overlayMapping = {
                't2m': 'temp',
                'temperature': 'temp', 
                'd2m': 'relative_humidity',
                'rh': 'relative_humidity',
                'sp': 'mean_sea_level_pressure',
                'msl': 'mean_sea_level_pressure',
                'sst': 'temp',
                'u10': 'wind',
                'v10': 'wind'
            };
            
            var earthOverlayType = overlayMapping[varName] || varName;
            
            console.log('MetadataUI: Mapping variable', varName, 'to existing Earth overlay type:', earthOverlayType);
            
            // Don't register new product factories - use existing Earth.js system
            // The existing products system already handles temp, wind, relative_humidity, etc.
            // We just need to make sure the UI correctly triggers the existing overlays
        }
    }

    // Main metadata service
    function MetadataService() {
        this.metadata = null;
        this.timeCoords = [];
    }

    MetadataService.prototype = {
        initialize: function() {
            console.log('MetadataUI: Starting Phase 4 initialization...');
            
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
                    
                    console.log('MetadataUI: Metadata loaded, starting Phase 4 setup...');
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

        // Phase 4 & 5: Master Initialization Flow
        initializeEnhancedMetadataUI: function(metadata) {
            console.log('MetadataUI: Starting enhanced metadata UI initialization (Phase 4 & 5)...');
            
            try {
                // Store metadata globally for access by other components
                window.lastMetadata = metadata;
                
                // Phase 4: Mode detection and time navigation
                var modeInfo = detectMode(metadata);
                setupModeUI(modeInfo.mode, modeInfo);
                setupMetadataTimeNavigation(metadata);
                
                // Phase 5: Variable-based overlay system
                var categorizedVars = categorizeVariables(metadata.variables, modeInfo.mode, modeInfo);
                generateModeSpecificOverlays(modeInfo.mode, categorizedVars, metadata);
                setupVariableSelectionHandlers();
                
                // Generate UI components
                this.generateHeightControls(metadata);
                
                // Update data source information
                this.updateDataSourceDisplay(metadata);
                
                console.log('MetadataUI: Enhanced metadata UI initialization complete (Phase 4 & 5)');
                
                return {
                    mode: modeInfo,
                    variables: categorizedVars,
                    metadata: metadata
                };
                
            } catch (error) {
                console.error('MetadataUI: Enhanced metadata UI initialization failed:', error);
                // Fallback to basic initialization
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
            var levels = ['surface']; // Surface only for now, Phase 6 will add 3D support
            console.log('MetadataUI: Generating height controls for levels:', levels);
            
            var container = d3.selectAll('p').filter(function() {
                return this.textContent.indexOf('Height') !== -1;
            });
            
            if (container.empty()) return;
            
            // Clear existing controls
            container.selectAll('.surface').remove();
            container.selectAll('span').filter(function() {
                return this.textContent === ' – ';
            }).remove();
            
            // Generate new controls
            levels.forEach(function(level, index) {
                var buttonId = 'level-' + level.replace(/[^a-zA-Z0-9]/g, '');
                var displayName = 'Sfc';
                
                if (index > 0) {
                    container.append('span').text(' – ');
                }
                
                container.append('span')
                    .attr('class', 'surface text-button')
                    .attr('id', buttonId)
                    .attr('title', level)
                    .text(displayName);
                    
                // Bind to configuration if available
                if (typeof bindButtonToConfiguration === 'function') {
                    try {
                        bindButtonToConfiguration('#' + buttonId, {
                            param: "wind", 
                            surface: 'surface',
                            level: level
                        });
                        console.log('MetadataUI: Successfully bound', '#' + buttonId);
                    } catch (error) {
                        console.warn('MetadataUI: Error binding button:', error);
                    }
                }
            });
            
            console.log('MetadataUI: Height controls generated successfully');
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
                console.log('MetadataUI: Starting Phase 4 integration');
                
                if (dependencies.configuration) {
                    window.configuration = dependencies.configuration;
                }
                if (dependencies.bindButtonToConfiguration) {
                    window.bindButtonToConfiguration = dependencies.bindButtonToConfiguration;
                }
                if (dependencies.products) {
                    window.products = dependencies.products;
                }
                
                var metadataService = new MetadataService();
                
                return metadataService.initialize()
                    .then(function(result) {
                        if (result && result.metadata) {
                            console.log('MetadataUI: Phase 4 initialization complete', result);
                            return result.metadata;
                        } else {
                            console.log('MetadataUI: No metadata available, continuing with defaults');
                            return null;
                        }
                    })
                    .catch(function(error) {
                        console.error('MetadataUI: Phase 4 integration failed:', error);
                        return null;
                    });
            }
        };
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
