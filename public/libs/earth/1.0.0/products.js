/**
 * products - defines the behavior of weather data grids, including grid construction, interpolation, and color scales.
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
var products = function() {
    "use strict";

    var WEATHER_PATH = "/data/weather";
    var OSCAR_PATH = "/data/oscar";
    var catalogs = {
        // The OSCAR catalog is an array of file names, sorted and prefixed with yyyyMMdd. Last item is the
        // most recent. For example: [ 20140101-abc.json, 20140106-abc.json, 20140112-abc.json, ... ]
        oscar: µ.loadJson([OSCAR_PATH, "catalog.json"].join("/"))
    };

    function buildProduct(overrides) {
        return _.extend({
            description: "",
            paths: [],
            date: null,
            navigate: function(step) {
                return gfsStep(this.date, step);
            },
            load: function(cancel) {
                var me = this;
                return when.map(this.paths, µ.loadJson).then(function(files) {
                    if(cancel.requested) return null;

                    // Handle both vector and scalar fields
                    if(me.field === "vector" && files instanceof Array) {
                        return _.extend(me, buildGrid(me.builder.apply(me, files)));
                    } else if(me.field === "scalar") {
                        return _.extend(me, buildGrid(me.builder.call(me, files[0])));
                    } else {
                        return null;
                    }
                });
            }
        }, overrides);
    }

    /**
     * @param attr
     * @param {String} type
     * @param {String?} surface
     * @param {String?} level
     * @returns {String}
     */
    function rossbyVisProxyPath(attr, type, surface, level) {
        // Check if we're in metadata-driven mode - for any type that needs time-based data
        if (attr.metadataTime && (type === "wind" || type === "temp")) {
            if (type === "wind") {

                return '/proxy/data?vars=u10,v10&time=' + attr.metadataTime + '&format=json';
            } else if (type === "temp") {
                return '/proxy/data?vars=t2m&time=' + attr.metadataTime + '&format=json';
            }
        }

    }

    function gfsDate(attr) {
        if (attr.date === "current") {
            // Construct the date from the current time, rounding down to the nearest three-hour block.
            var now = new Date(Date.now()), hour = Math.floor(now.getUTCHours() / 3);
            return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
        }
        var parts = attr.date.split("/");
        return new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], +attr.hour.substr(0, 2)));
    }

    /**
     * Returns a date for the chronologically next or previous GFS data layer. How far forward or backward in time
     * to jump is determined by the step. Steps of ±1 move in 3-hour jumps, and steps of ±10 move in 24-hour jumps.
     */
    function gfsStep(date, step) {
        var offset = (step > 1 ? 8 : step < -1 ? -8 : step) * 3, adjusted = new Date(date);
        adjusted.setHours(adjusted.getHours() + offset);
        return adjusted;
    }

    function netcdfHeader(time, lat, lon, center) {
        return {
            lo1: lon.sequence.start,
            la1: lat.sequence.start,
            dx: lon.sequence.delta,
            dy: -lat.sequence.delta,
            nx: lon.sequence.size,
            ny: lat.sequence.size,
            refTime: time.data[0],
            forecastTime: 0,
            centerName: center
        };
    }

    function describeSurface(attr) {
        return attr.surface === "surface" ? "surface" : µ.capitalize(attr.level);
    }

    function describeSurfaceJa(attr) {
        return attr.surface === "surface" ? "地上" : µ.capitalize(attr.level);
    }

    /**
     * Returns a function f(langCode) that, given table:
     *     {foo: {en: "A", ja: "あ"}, bar: {en: "I", ja: "い"}}
     * will return the following when called with "en":
     *     {foo: "A", bar: "I"}
     * or when called with "ja":
     *     {foo: "あ", bar: "い"}
     */
    function localize(table) {
        return function(langCode) {
            var result = {};
            _.each(table, function(value, key) {
                result[key] = value[langCode] || value.en || value;
            });
            return result;
        }
    }

    /**
     * Create Earth-compatible header from Rossby metadata for scalar variables
     */
    function createHeaderFromMetadata(metadata, variable, categoryName) {
        var coords = metadata.coordinates || {};
        var dims = metadata.dimensions || {};
        var variables = metadata.variables || {};
        
        var varInfo = variables[variable] || {};
        var attributes = varInfo.attributes || {};
        
        // Extract grid information - Earth expects longitude as nx, latitude as ny
        var nx = (dims.longitude && dims.longitude.size) || 1440;
        var ny = (dims.latitude && dims.latitude.size) || 721;
        
        var lonArray = coords.longitude || [];
        var latArray = coords.latitude || [];
        var timeArray = coords.time || [];
        
        // Rossby typically provides coordinates in ascending order
        var lo1 = lonArray.length > 0 ? lonArray[0] : 0;
        var lo2 = lonArray.length > 1 ? lonArray[lonArray.length - 1] : 359.75;
        var la1 = latArray.length > 0 ? latArray[0] : 90;  // Usually starts at 90 (North)  
        var la2 = latArray.length > 1 ? latArray[latArray.length - 1] : -90; // Ends at -90 (South)
        
        // Calculate grid spacing
        var dx = nx > 1 ? (lo2 - lo1) / (nx - 1) : 0.25;
        var dy = ny > 1 ? Math.abs(la1 - la2) / (ny - 1) : 0.25;
        
        console.log('Grid info for', variable, '- nx:', nx, 'ny:', ny, 'dx:', dx, 'dy:', dy);
        console.log('Coordinate bounds - lon:', lo1, 'to', lo2, 'lat:', la1, 'to', la2);
        
        // Get reference time from first time coordinate
        var refTimeValue = timeArray.length > 0 ? timeArray[0] : 700464;
        
        // Convert NetCDF time (hours since 1900-01-01) to ISO string
        var refTime;
        try {
            var baseDate = new Date('1900-01-01T00:00:00Z');
            var refDate = new Date(baseDate.getTime() + refTimeValue * 3600 * 1000);
            refTime = refDate.toISOString();
        } catch (e) {
            refTime = new Date().toISOString(); // Fallback to current time
        }
        
        return {
            discipline: 0,
            disciplineName: "Meteorological products",
            refTime: refTime,
            parameterCategory: 0, // Temperature category
            parameterCategoryName: categoryName || "Temperature",
            parameterNumber: 0,
            parameterNumberName: attributes.long_name || variable,
            parameterUnit: attributes.units || "K",
            nx: nx,
            ny: ny,
            lo1: lo1,
            la1: la1,
            lo2: lo2,
            la2: la2,
            dx: dx,
            dy: dy,
            forecastTime: 0
        };
    }

    var FACTORIES = {

        "wind": {
            matches: _.matches({param: "wind"}),
            create: function(attr) {
                return buildProduct({
                    field: "vector",
                    type: "wind",
                    description: localize({
                        name: {en: "wind", ja: "風速"},
                        qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                    }),
                    paths: [rossbyVisProxyPath(attr, "wind", attr.surface, attr.level)],
                    date: gfsDate(attr),
                    builder: function(file) {
                        console.log('Wind builder called with file:', file);
                        
                        // Check if this is a proxy response format (metadata-driven)
                        if (file && file.data && file.data.u10 && file.data.v10) {
                            // Proxy response format: {data: {u10: [...], v10: [...]}, metadata: {...}}
                            var uData = file.data.u10;
                            var vData = file.data.v10;
                            var metadata = file.metadata || {};
                            
                            console.log('Wind data loaded, U data length:', uData ? uData.length : 'no U data', 'V data length:', vData ? vData.length : 'no V data', 'metadata:', metadata);
                            
                            // Create Earth-compatible header from metadata
                            var header = createHeaderFromMetadata(metadata, "u10", "wind");
                            header.parameterCategoryName = "momentum";
                            header.parameterNumberName = "wind";
                            
                            return {
                                header: header,
                                interpolate: bilinearInterpolateVector,
                                data: function(i) {
                                    return [uData[i], vData[i]];
                                }
                            };
                        }
                        // Traditional Earth-compatible format (array of EarthDataPoint objects)
                        else if(file instanceof Array && file.length >= 2) {
                            // Wind data: file[0] is U component, file[1] is V component
                            var uData = file[0].data;
                            var vData = file[1].data;
                            
                            console.log('Wind data loaded, header:', file[0].header, 'U data length:', uData ? uData.length : 'no U data', 'V data length:', vData ? vData.length : 'no V data');
                            
                            return {
                                header: file[0].header,
                                interpolate: bilinearInterpolateVector,
                                data: function(i) {
                                    return [uData[i], vData[i]];
                                }
                            };
                        } else {
                            console.error('Wind builder: Invalid file format or insufficient components:', file);
                            return null;
                        }
                    },
                    units: [
                        {label: "km/h", conversion: function(x) { return x * 3.6; },      precision: 0},
                        {label: "m/s",  conversion: function(x) { return x; },            precision: 1},
                        {label: "kn",   conversion: function(x) { return x * 1.943844; }, precision: 0},
                        {label: "mph",  conversion: function(x) { return x * 2.236936; }, precision: 0}
                    ],
                    scale: {
                        bounds: [0, 100],
                        gradient: function(v, a) {
                            return µ.extendedSinebowColor(Math.min(v, 100) / 100, a);
                        }
                    },
                    particles: {velocityScale: 1/60000, maxIntensity: 17}
                });
            }
        },

        "currents": {
            matches: _.matches({param: "ocean", surface: "surface", level: "currents"}),
            create: function(attr) {
                return when(catalogs.oscar).then(function(catalog) {
                    return buildProduct({
                        field: "vector",
                        type: "currents",
                        description: localize({
                            name: {en: "Ocean Currents", ja: "海流"},
                            qualifier: {en: " @ surface", ja: " @ 地上"}
                        }),
                        paths: [oscar0p33Path(catalog, attr)],
                        date: oscarDate(catalog, attr),
                        navigate: function(step) {
                            return oscarStep(catalog, this.date, step);
                        },
                        builder: function(file) {
                            var uData = file[0].data, vData = file[1].data;
                            return {
                                header: file[0].header,
                                interpolate: bilinearInterpolateVector,
                                data: function(i) {
                                    var u = uData[i], v = vData[i];
                                    return µ.isValue(u) && µ.isValue(v) ? [u, v] : null;
                                }
                            }
                        },
                        units: [
                            {label: "m/s",  conversion: function(x) { return x; },            precision: 2},
                            {label: "km/h", conversion: function(x) { return x * 3.6; },      precision: 1},
                            {label: "kn",   conversion: function(x) { return x * 1.943844; }, precision: 1},
                            {label: "mph",  conversion: function(x) { return x * 2.236936; }, precision: 1}
                        ],
                        scale: {
                            bounds: [0, 1.5],
                            gradient: µ.segmentedColorScale([
                                [0, [10, 25, 68]],
                                [0.15, [10, 25, 250]],
                                [0.4, [24, 255, 93]],
                                [0.65, [255, 233, 102]],
                                [1.0, [255, 233, 15]],
                                [1.5, [255, 15, 15]]
                            ])
                        },
                        particles: {velocityScale: 1/4400, maxIntensity: 0.7}
                    });
                });
            }
        },

        // Generic scalar overlay factory for metadata variables (d2m, sd, sp, sst, tisr)
        "scalar_overlay": {
            matches: function(attr) {
                var overlayType = attr.overlayType;
                if (overlayType === "off") return false;
                return overlayType && typeof overlayType === 'string';
            },
            create: function(attr) {
                var overlayType = attr.overlayType;
                var path;
                if (attr.metadataLevel) {
                    path = '/proxy/data?vars=' + overlayType + '&time=' + attr.metadataTime + '&level=' + attr.metadataLevel + '&format=json';
                } else {
                    path = '/proxy/data?vars=' + overlayType + '&time=' + attr.metadataTime + '&format=json';
                }
                console.log('Creating scalar overlay product for variable:', overlayType);
                
                return buildProduct({
                    field: "scalar",
                    type: overlayType,
                    description: localize({
                        name: {en: overlayType, ja: overlayType},
                        qualifier: {en: " @ surface", ja: " @ 地上"}
                    }),
                    paths: [path],
                    date: gfsDate(attr),
                    builder: function(file) {
                        console.log('Scalar overlay builder called for', overlayType, 'with file:', file);
                        
                        // Handle proxy response format: {data: {variable: [...], metadata: {...}}
                        if(file && file.data && file.data[overlayType]) {
                            var data = file.data[overlayType];
                            var metadata = file.metadata || {};
                            
                            console.log(overlayType, 'data loaded, data length:', data ? data.length : 'no data', 'metadata:', metadata);
                            
                            // Create Earth-compatible header from metadata
                            var header = createHeaderFromMetadata(metadata, overlayType, µ.getVariableQuantity(overlayType));
                            
                            return {
                                header: header,
                                interpolate: bilinearInterpolateScalar,
                                data: function(i) {
                                    return data[i];
                                }
                            };
                        } else {
                            console.error('Scalar overlay builder: Invalid file format for', overlayType, ':', file);
                            return null;
                        }
                    },
                    units: getVariableUnits(overlayType),
                    scale: getVariableScale(overlayType)
                });
            }
        },

        "off": {
            matches: _.matches({overlayType: "off"}),
            create: function() {
                return null;
            }
        }
    };

    /**
     * Returns the file name for the most recent OSCAR data layer to the specified date. If offset is non-zero,
     * the file name that many entries from the most recent is returned.
     *
     * The result is undefined if there is no entry for the specified date and offset can be found.
     *
     * UNDONE: the catalog object itself should encapsulate this logic. GFS can also be a "virtual" catalog, and
     *         provide a mechanism for eliminating the need for /data/weather/current/* files.
     *
     * @param {Array} catalog array of file names, sorted and prefixed with yyyyMMdd. Last item is most recent.
     * @param {String} date string with format yyyy/MM/dd or "current"
     * @param {Number?} offset
     * @returns {String} file name
     */
    function lookupOscar(catalog, date, offset) {
        offset = +offset || 0;
        if (date === "current") {
            return catalog[catalog.length - 1 + offset];
        }
        var prefix = µ.ymdRedelimit(date, "/", ""), i = _.sortedIndex(catalog, prefix);
        i = (catalog[i] || "").indexOf(prefix) === 0 ? i : i - 1;
        return catalog[i + offset];
    }

    function oscar0p33Path(catalog, attr) {
        var file = lookupOscar(catalog, attr.date);
        return file ? [OSCAR_PATH, file].join("/") : null;
    }

    function oscarDate(catalog, attr) {
        var file = lookupOscar(catalog, attr.date);
        var parts = file ? µ.ymdRedelimit(file, "", "/").split("/") : null;
        return parts ? new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], 0)) : null;
    }

    /**
     * @returns {Date} the chronologically next or previous OSCAR data layer. How far forward or backward in
     * time to jump is determined by the step and the catalog of available layers. A step of ±1 moves to the
     * next/previous entry in the catalog (about 5 days), and a step of ±10 moves to the entry six positions away
     * (about 30 days).
     */
    function oscarStep(catalog, date, step) {
        var file = lookupOscar(catalog, µ.dateToUTCymd(date, "/"), step > 1 ? 6 : step < -1 ? -6 : step);
        var parts = file ? µ.ymdRedelimit(file, "", "/").split("/") : null;
        return parts ? new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], 0)) : null;
    }

    function dataSource(header) {
        // noinspection FallthroughInSwitchStatementJS
        switch (header.center || header.centerName) {
            case -3:
                return "OSCAR / Earth & Space Research";
            case 7:
            case "US National Weather Service, National Centres for Environmental Prediction (NCEP)":
                return "GFS / NCEP / US National Weather Service";
            default:
                return header.centerName;
        }
    }

    function bilinearInterpolateScalar(x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        return g00 * rx * ry + g10 * x * ry + g01 * rx * y + g11 * x * y;
    }

    function bilinearInterpolateVector(x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        var a = rx * ry,  b = x * ry,  c = rx * y,  d = x * y;
        var u = g00[0] * a + g10[0] * b + g01[0] * c + g11[0] * d;
        var v = g00[1] * a + g10[1] * b + g01[1] * c + g11[1] * d;
        return [u, v, Math.sqrt(u * u + v * v)];
    }

    /**
     * Builds an interpolator for the specified data in the form of JSON-ified GRIB files. Example:
     *
     *     [
     *       {
     *         "header": {
     *           "refTime": "2013-11-30T18:00:00.000Z",
     *           "parameterCategory": 2,
     *           "parameterNumber": 2,
     *           "surface1Type": 100,
     *           "surface1Value": 100000.0,
     *           "forecastTime": 6,
     *           "scanMode": 0,
     *           "nx": 360,
     *           "ny": 181,
     *           "lo1": 0,
     *           "la1": 90,
     *           "lo2": 359,
     *           "la2": -90,
     *           "dx": 1,
     *           "dy": 1
     *         },
     *         "data": [3.42, 3.31, 3.19, 3.08, 2.96, 2.84, 2.72, 2.6, 2.47, ...]
     *       }
     *     ]
     *
     */
    function buildGrid(builder) {
        // var builder = createBuilder(data);

        var header = builder.header;
        var λ0 = header.lo1, φ0 = header.la1;  // the grid's origin (e.g., 0.0E, 90.0N)
        var Δλ = header.dx, Δφ = header.dy;    // distance between grid points (e.g., 2.5 deg lon, 2.5 deg lat)
        var ni = header.nx, nj = header.ny;    // number of grid points W-E and N-S (e.g., 144 x 73)
        var date = new Date(header.refTime);
        date.setHours(date.getHours() + header.forecastTime);

        // Scan mode 0 assumed. Longitude increases from λ0, and latitude decreases from φ0.
        // http://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_table3-4.shtml
        var grid = [], p = 0;
        var isContinuous = Math.floor(ni * Δλ) >= 360;
        for (var j = 0; j < nj; j++) {
            var row = [];
            for (var i = 0; i < ni; i++, p++) {
                row[i] = builder.data(p);
            }
            if (isContinuous) {
                // For wrapped grids, duplicate first column as last column to simplify interpolation logic
                row.push(row[0]);
            }
            grid[j] = row;
        }

        function interpolate(λ, φ) {
            var i = µ.floorMod(λ - λ0, 360) / Δλ;  // calculate longitude index in wrapped range [0, 360)
            var j = (φ0 - φ) / Δφ;                 // calculate latitude index in direction +90 to -90

            //         1      2           After converting λ and φ to fractional grid indexes i and j, we find the
            //        fi  i   ci          four points "G" that enclose point (i, j). These points are at the four
            //         | =1.4 |           corners specified by the floor and ceiling of i and j. For example, given
            //      ---G--|---G--- fj 8   i = 1.4 and j = 8.3, the four surrounding grid points are (1, 8), (2, 8),
            //    j ___|_ .   |           (1, 9) and (2, 9).
            //  =8.3   |      |
            //      ---G------G--- cj 9   Note that for wrapped grids, the first column is duplicated as the last
            //         |      |           column, so the index ci can be used without taking a modulo.

            var fi = Math.floor(i), ci = fi + 1;
            var fj = Math.floor(j), cj = fj + 1;

            var row;
            if ((row = grid[fj])) {
                var g00 = row[fi];
                var g10 = row[ci];
                if (µ.isValue(g00) && µ.isValue(g10) && (row = grid[cj])) {
                    var g01 = row[fi];
                    var g11 = row[ci];
                    if (µ.isValue(g01) && µ.isValue(g11)) {
                        // All four points found, so interpolate the value.
                        return builder.interpolate(i - fi, j - fj, g00, g10, g01, g11);
                    }
                }
            }
            // console.log("cannot interpolate: " + λ + "," + φ + ": " + fi + " " + ci + " " + fj + " " + cj);
            return null;
        }

        return {
            source: dataSource(header),
            date: date,
            interpolate: interpolate,
            forEachPoint: function(cb) {
                for (var j = 0; j < nj; j++) {
                    var row = grid[j] || [];
                    for (var i = 0; i < ni; i++) {
                        cb(µ.floorMod(180 + λ0 + i * Δλ, 360) - 180, φ0 - j * Δφ, row[i]);
                    }
                }
            }
        };
    }

    /**
     * Get appropriate units for variable based on category
     */
    function getVariableUnits(variable) {
        var category = µ.getVariableQuantity(variable);
        switch (category) {
            case 'Temperature':
                return [
                    {label: "°C", conversion: function(x) { return x - 273.15; }, precision: 1},
                    {label: "°F", conversion: function(x) { return x * 9/5 - 459.67; }, precision: 1},
                    {label: "K", conversion: function(x) { return x; }, precision: 1}
                ];
            case 'Pressure':
                return [
                    {label: "hPa", conversion: function(x) { return x / 100; }, precision: 0},
                    {label: "Pa", conversion: function(x) { return x; }, precision: 0}
                ];
            case 'Humidity':
                return [
                    {label: "K", conversion: function(x) { return x; }, precision: 1}
                ];
            case 'Precipitation':
                return [
                    {label: "m", conversion: function(x) { return x; }, precision: 3},
                    {label: "mm", conversion: function(x) { return x * 1000; }, precision: 1}
                ];
            case 'Radiation':
                return [
                    {label: "J/m²", conversion: function(x) { return x; }, precision: 0},
                    {label: "kJ/m²", conversion: function(x) { return x / 1000; }, precision: 1}
                ];
            default:
                return [
                    {label: "units", conversion: function(x) { return x; }, precision: 2}
                ];
        }
    }

    /**
     * Get appropriate color scale for variable based on category
     */
    function getVariableScale(variable) {
        var category = µ.getVariableQuantity(variable);
        switch (category) {
            case 'Temperature':
                return {
                    bounds: [240, 320],  // More realistic temperature range in Kelvin
                    gradient: µ.segmentedColorScale([
                        [240,     [37, 4, 42]],      // Very cold (purple)
                        [250,     [41, 10, 130]],    // Cold (blue)
                        [260,     [70, 215, 215]],   // Cool (cyan)
                        [273.15,  [21, 84, 187]],    // 0°C (blue)
                        [280,     [24, 132, 14]],    // Mild (green)
                        [290,     [247, 251, 59]],   // Warm (yellow)
                        [300,     [235, 167, 21]],   // Hot (orange)
                        [320,     [88, 27, 67]]      // Very hot (red)
                    ])
                };

            // NEW: Case for Geopotential Height
            case 'Geopotential Height':
                return {
                    // Typical range for geopotential height in geopotential meters (gpm).
                    // This range effectively visualizes troughs (low values) and ridges (high values).
                    bounds: [100, 20100],
                    gradient: µ.segmentedColorScale([
                        [100,    [41, 10, 130]],    // Deep Trough (cool blue/purple)
                        [5100,    [70, 215, 215]],   // Trough (cyan)
                        [10100,    [24, 132, 14]],    // Zonal Flow (green)
                        [15100,    [247, 251, 59]],   // Ridge (warm yellow)
                        [20100,    [235, 167, 21]]     // Strong Ridge (hot orange)
                    ])
                };

            case 'Pressure':
                return {
                    bounds: [90000, 105000], // in Pascals
                    gradient: µ.segmentedColorScale([
                        [90000, [40, 0, 0]],
                        [95000, [187, 60, 31]],
                        [98000, [16, 1, 43]],
                        [101300, [241, 254, 18]],
                        [105000, [255, 255, 255]]
                    ])
                };
            case 'Humidity':
                return {
                    bounds: [200, 300], // in Kelvin (for dew point)
                    gradient: function(v, a) {
                        return µ.sinebowColor(Math.min(Math.max(v - 200, 0), 100) / 100, a);
                    }
                };
            case 'Precipitation':
                return {
                    bounds: [0, 0.01], // in meters/s or a similar unit
                    gradient: µ.segmentedColorScale([
                        [0, [135, 206, 235]],      // Light precipitation (light blue)
                        [0.002, [70, 130, 180]],   // Moderate (steel blue)
                        [0.005, [25, 25, 112]],    // Heavy (midnight blue)
                        [0.01, [0, 0, 139]]        // Very heavy (dark blue)
                    ])
                };
            case 'Radiation':
                return {
                    bounds: [0, 5000000],
                    gradient: µ.segmentedColorScale([
                        [0, [25, 25, 112]],
                        [1000000, [255, 215, 0]],
                        [3000000, [255, 140, 0]],
                        [5000000, [255, 69, 0]]
                    ])
                };
            default:
                return {
                    bounds: [0, 1],
                    gradient: function(v, a) {
                        return µ.sinebowColor(Math.min(Math.abs(v), 1), a);
                    }
                };
        }
    }

    function productsFor(attributes) {
        var attr = _.clone(attributes), results = [];
        _.values(FACTORIES).forEach(function(factory) {
            if (factory.matches(attr)) {
                results.push(factory.create(attr));
            }
        });
        return results.filter(µ.isValue);
    }
    productsFor.FACTORIES = FACTORIES;

    return {
        overlayTypes: d3.set(_.keys(FACTORIES)),
        productsFor: productsFor
    };

}();
