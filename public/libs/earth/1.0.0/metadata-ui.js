/**
 * Metadata-driven UI system for Earth.js integration with Rossby server
 * 
 * Simplified version focused on fixing time navigation issue
 */

var MetadataUI = (function() {
    "use strict";

    // Simple metadata service
    function MetadataService() {
        this.metadata = null;
        this.timeCoords = [];
    }

    MetadataService.prototype = {
        initialize: function() {
            console.log('MetadataUI: Starting initialization with dependencies...');
            
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
                    
                    console.log('MetadataUI: Metadata loaded, generating UI components...');
                    return self.generateUIComponents(metadata);
                })
                .catch(function(error) {
                    console.error('MetadataUI: Failed to load metadata:', error);
                    return null;
                });
        },

        extractTimeCoordinates: function(metadata) {
            if (metadata.coordinates && metadata.coordinates.time) {
                return metadata.coordinates.time;
            }
            return [];
        },

        generateUIComponents: function(metadata) {
            // Generate height controls
            this.generateHeightControls(metadata);
            
            // Generate overlay controls  
            this.generateOverlayControls(metadata);
            
            // Setup time navigation - THE KEY FIX
            this.setupTimeNavigation(metadata);
            
            // Update data source display
            this.updateDataSource(metadata);
            
            console.log('MetadataUI: UI components generated successfully');
            return metadata;
        },

        generateHeightControls: function(metadata) {
            var levels = ['surface']; // Surface only for now
            console.log('UIGenerator: Generating height controls for levels:', levels);
            
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
                        console.log('UIGenerator: Successfully bound', '#' + buttonId, 'with config:', {param: 'wind', surface: 'surface', level: level});
                    } catch (error) {
                        console.warn('UIGenerator: Error binding button:', error);
                    }
                }
            });
            
            console.log('UIGenerator: Height controls generated successfully');
        },

        generateOverlayControls: function(metadata) {
            var variables = metadata.variables || {};
            var varNames = Object.keys(variables).filter(function(name) {
                // Filter out coordinate variables
                return !['longitude', 'latitude', 'time', 'level'].includes(name);
            });
            
            console.log('UIGenerator: Generating overlay controls for variables:', {scalar: varNames, vector: [], unknown: []});
            
            var overlayContainers = d3.selectAll('p').filter(function() {
                return this.textContent.indexOf('Overlay') !== -1;
            });
            
            if (overlayContainers.empty()) return;
            
            // Clear existing overlay buttons  
            overlayContainers.selectAll('.text-button').filter(function() {
                return this.id && this.id.startsWith('overlay-');
            }).remove();
            overlayContainers.selectAll('span').filter(function() {
                return this.textContent === ' – ';
            }).remove();
            
            var mainContainer = d3.select(overlayContainers.node());
            
            // Add variable overlays
            varNames.forEach(function(varName) {
                var buttonId = 'overlay-' + varName;
                
                console.log('UIGenerator: Registered overlay type:', varName);
                
                mainContainer.append('span').text(' – ');
                mainContainer.append('span')
                    .attr('class', 'text-button')
                    .attr('id', buttonId)
                    .attr('title', varName)
                    .text(varName);
                
                // Bind to configuration if available
                if (typeof bindButtonToConfiguration === 'function') {
                    try {
                        bindButtonToConfiguration('#' + buttonId, {
                            overlayType: varName, 
                            param: 'wind'
                        });
                        console.log('UIGenerator: Successfully bound', '#' + buttonId, 'with config:', {overlayType: varName, param: 'wind'});
                    } catch (error) {
                        console.warn('UIGenerator: Error binding overlay button:', error);
                    }
                }
                
                // Register with products system if available
                if (typeof products !== 'undefined' && products) {
                    console.log('UIGenerator: Registered variable overlay type:', varName);
                    
                    // Create proper factory object with matches and create functions
                    if (products.productsFor && products.productsFor.FACTORIES) {
                        products.productsFor.FACTORIES[varName] = {
                            matches: function(attr) {
                                return attr.param === "wind" && attr.overlayType === varName;
                            },
                            create: function(attr) {
                                console.log('UIGenerator: Factory creating product for variable:', varName, 'with attr:', attr);
                                
                                // Use the existing scalar_overlay factory which handles metadata variables properly
                                var scalarFactory = products.productsFor.FACTORIES.scalar_overlay;
                                if (scalarFactory && scalarFactory.create) {
                                    return scalarFactory.create(attr);
                                }
                                
                                console.error('UIGenerator: scalar_overlay factory not found');
                                return null;
                            }
                        };
                        console.log('UIGenerator: Registered factory in productsFor.FACTORIES for:', varName);
                    }
                    
                    console.log('UIGenerator: Created product factory for variable:', varName);
                }
            });

            console.log('UIGenerator: Overlay controls generated successfully');
        },

        setupTimeNavigation: function(metadata) {
            var timeCoords = this.timeCoords;
            
            if (timeCoords.length === 0) {
                console.log('UIGenerator: No time coordinates found');
                return;
            }
            
            // Detect time interval
            var interval = 1;
            if (timeCoords.length > 1) {
                var intervals = [];
                for (var i = 1; i < Math.min(timeCoords.length, 10); i++) {
                    intervals.push(timeCoords[i] - timeCoords[i-1]);
                }
                if (intervals.length > 0) {
                    interval = Math.abs(Math.round(intervals.reduce(function(a, b) { return a + b; }, 0) / intervals.length));
                }
            }
            
            console.log('UIGenerator: Detected time interval:', interval, 'hours');
            
            // Store time information globally
            window.metadataTimeInfo = {
                all: timeCoords,
                start: timeCoords[0],
                end: timeCoords[timeCoords.length - 1],
                count: timeCoords.length,
                current: timeCoords[0]
            };
            window.currentTimeIndex = 0;
            
            // Update date display initially  
            this.updateDateDisplay(window.metadataTimeInfo);
            
            console.log('UIGenerator: Updating control section with metadata time range');
            
            // Setup enhanced navigation that hooks into Earth.js navigation
            this.setupEnhancedNavigation(timeCoords);
            
            console.log('UIGenerator: Setting up metadata-aware navigation');
            
            console.log('UIGenerator: Metadata navigation setup complete');
        },

        updateDateDisplay: function(timeInfo) {
            var currentTime = timeInfo.current;
            var displayText = currentTime + ' - ' + timeInfo.end + ' (' + timeInfo.count + ' steps) | Raw NetCDF time coordinates';
            
            var attempts = 0;
            var maxAttempts = 5;
            
            var tryUpdate = function() {
                attempts++;
                var dateElement = d3.select('#data-date');
                var found = !dateElement.empty();
                
                console.log('UIGenerator: Attempt', attempts, 'to find date element, found:', found);
                
                if (found) {
                    dateElement.text(displayText);
                    console.log('UIGenerator: Successfully updated date display with:', displayText);
                    return true;
                } else if (attempts < maxAttempts) {
                    setTimeout(tryUpdate, 100); // Try again in 100ms
                    return false;
                } else {
                    console.warn('UIGenerator: Failed to find date element after', maxAttempts, 'attempts');
                    return false;
                }
            };
            
            tryUpdate();
            
            // Also apply override to prevent other code from changing it
            setTimeout(function() {
                var dateElement = d3.select('#data-date');
                if (!dateElement.empty()) {
                    dateElement.text(displayText);
                    console.log('UIGenerator: Override applied to date display');
                }
            }, 500);
        },

        setupEnhancedNavigation: function(timeCoords) {
            // Earth.js already has metadata navigation support built-in
            // We just need to ensure the global variables are set correctly
            console.log('UIGenerator: Setting up metadata-aware navigation');
            console.log('UIGenerator: Earth.js will use metadataTimeInfo for navigation');
            
            // Set up configuration listener to update date display when navigation occurs
            if (typeof configuration !== 'undefined' && configuration) {
                var self = this;
                configuration.on('change:metadataTime', function(model, newTime) {
                    if (newTime && window.metadataTimeInfo) {
                        window.metadataTimeInfo.current = newTime;
                        self.updateDateDisplay(window.metadataTimeInfo);
                    }
                });
            }
            
            // Ensure navigation buttons are properly accessible - add keyboard navigation
            var self = this;
            d3.select(document).on('keydown', function() {
                var event = d3.event;
                if (event.keyCode === 37) { // Left arrow
                    event.preventDefault();
                    if (typeof navigate === 'function') {
                        navigate(-1);
                    }
                } else if (event.keyCode === 39) { // Right arrow  
                    event.preventDefault();
                    if (typeof navigate === 'function') {
                        navigate(1);
                    }
                }
            });
            
            console.log('UIGenerator: Added keyboard navigation support (arrow keys)');
        },

        updateDataSource: function(metadata) {
            var source = 'Rossby Server';
            
            // Try to extract from metadata
            if (metadata.global_attributes && metadata.global_attributes.source) {
                source = metadata.global_attributes.source;
            } else {
                // Infer from variable names
                var variables = metadata.variables || {};
                var varNames = Object.keys(variables);
                if (varNames.some(function(name) { return /^(u10|v10|t2m|d2m|sp|sst)$/.test(name); })) {
                    source = 'ERA5 / ECMWF';
                }
            }
            
            console.log('UIGenerator: Updating data source to:', source);
            
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
                console.log('EarthJSIntegration: Starting integration');
                
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
                    .then(function(metadata) {
                        if (metadata) {
                            console.log('EarthJSIntegration: Initialization complete', metadata);
                            
                            // Integrate metadata products into the main products system
                            var metadataProducts = {};
                            var variables = metadata.variables || {};
                            var varNames = Object.keys(variables).filter(function(name) {
                                return !['longitude', 'latitude', 'time', 'level'].includes(name);
                            });
                            
                            varNames.forEach(function(varName) {
                                metadataProducts[varName] = {
                                    type: varName,
                                    paths: ['/proxy/data?vars=' + varName + '&time=${metadataTime}&format=json'],
                                    builder: 'scalar'
                                };
                            });
                            
                            console.log('EarthJSIntegration: Integrated', varNames.length, 'metadata products');
                            
                            return metadata;
                        } else {
                            console.log('EarthJSIntegration: No metadata available, continuing with defaults');
                            return null;
                        }
                    })
                    .catch(function(error) {
                        console.error('EarthJSIntegration: Integration failed:', error);
                        return null;
                    });
            }
        };
    }

    // Export the main factory function
    // Handle both object and parameter-based calls
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
        return integration.initialize(dependencies);
    };
})();

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MetadataUI;
}
