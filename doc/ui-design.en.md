# `rossby-vis` UI & UX Design Document (v1.0)

## 1. Core Philosophy & Architecture

### 1.1. Design Philosophy: Extremely Lightweight

The core design philosophy of `rossby-vis` is to be **"Extremely Lightweight"**. This implies:
* **No Client-Side Configuration:** The application must not depend on any local configuration files. All state and settings should be fully serializable and transportable via the URL.
* **Minimal Interaction Burden:** The interface should be as clean as possible, avoiding complex editors or components that require users to "create" content. The priority is to provide well-designed "choices".
* **High Performance:** Backend-frontend interactions and rendering must be fluid and provide immediate responses to user actions.

### 1.2. Data Source Scope & Generality

This design is intended to be broadly applicable to geoscience, meteorology, and climatology NetCDF data that conforms to the CF (Climate and Forecast) metadata conventions.

**The primary test case will be the ERA5 dataset** to ensure validation against a mainstream, complex, real-world dataset. However, **no part of the design will be hard-bound to ERA5**. All features, such as mode detection, variable classification, and dimension controls, are based on generic metadata standards, not on any specific data source.

### 1.3. Core Architecture: Mode-Driven Adaptive UI

The core of the application is its adaptivity, which is achieved through a **Mode** system. This system automatically adjusts the entire UI's behavior and available options based on the physical dimensions of the loaded data.

| Mode                  | Identifier | Trigger Condition (Auto-Detection)                            | Core Vertical Coordinate |
| :-------------------- | :--------- | :---------------------------------------------------------- | :----------------------- |
| **Atmosphere Mode** | `atm`      | Data contains a `pressure` or `level` dimension.            | Pressure (hPa)           |
| **Ocean Mode** | `ocn`      | Data contains a `depth` dimension or ocean-specific variables (e.g., `sst`). | Depth (m)                |
| **Surface/Normal Mode** | `sfc`      | Data is 2D `(time, lat, lon)` with no vertical dimension.   | None                     |

## 2. Visualization & Interaction Model

### 2.1. Variable Presentation: "Base + Overlay" Model

To resolve the interaction complexity arising from multi-variable overlays, we adopt a binary **"Base + Overlay"** model.

* **Base Layer:** Typically a **Color Fill** variable that covers the entire map, such as temperature or humidity.
* **Overlay Layer:** A variable rendered in a non-occluding manner (e.g., particles, contour lines) on top of the base layer, such as wind fields or geopotential height.

The user selects these via two independent dropdown menus, the contents of which are dynamically filtered based on the current `Mode`.

### 2.2. Variable Classification Example (Using ERA5)

The following table provides an **example** of how variables can be classified within this model. The backend logic should dynamically generate these classifications from metadata rather than being hard-coded.

| Variable Category     | Example Variable Name (Short Name) | Suggested Role | Suggested Renderer        |
| :---------------------- | :------------------------------- | :------------- | :------------------------ |
| **General/Surface** | `t2m`, `sst`, `msl`, `tp`, `tcc`   | Base           | Color Fill                |
| **Wind Fields** | `u10`/`v10`, `u`/`v` on Levels   | Overlay        | **Particles** |
| **Geopotential/Pressure** | `z` on Levels, `msl`             | Overlay        | **Contours** |
| **Temperature/Humidity** | `t`, `r` on Levels               | Base           | Color Fill                |
| **Waves** | `swh`                            | Base           | Color Fill                |

### 2.3. Interactive Chart Elements

#### 2.3.1. Dynamic Legend

A semi-transparent panel in a corner of the UI whose content is **auto-generated** based on the currently selected variables. It clearly explains the physical meaning, name, and units represented by the colors, particles, and lines.

#### 2.3.2. Data Probe

Supports mouse **Hover or Click** actions. A tooltip appears near the cursor, displaying the precise numerical values of **all currently loaded variables** at that specific geographic coordinate. This is key to enabling analytical capabilities.

## 3. Controls & State Management

### 3.1. Dimension Controls

#### 3.1.1. Height/Level Control

This control dynamically changes based on the `Mode`:
* **Atmosphere Mode:** Labeled as **`Pressure Level`**, with options like `1000hPa`, `850hPa`...
* **Ocean Mode:** Labeled as **`Depth`**, with options like `0m`, `-50m`...
* **Surface Mode:** This control is **automatically disabled or hidden** to adhere to the "lightweight" philosophy.

#### 3.1.2. Enhanced Time Control

A comprehensive time control bar, including:
* **[Required]** Play/Pause button.
* **[Required]** Timeline slider.
* **[Required]** A clear timestamp text display (see format in 3.2).
* **[Recommended]** Frame-by-frame step buttons (`|<` and `>|`) for precise analysis.
* **[Optional]** Animation speed control.

### 3.2. Time Data Handling Strategy

To handle the variety of time definitions in different NetCDF files (e.g., `hours since...`, `days since...`, and different calendars) and to provide a unified interface for the frontend, we adopt a **centralized backend processing** strategy.

1.  **Backend Parsing & Conversion:** When loading a NetCDF file, the backend service **must** parse the `units` and `calendar` metadata of the `time` variable.
2.  **Build Standardized Time Table:** The backend **must** convert all time steps in the file into a unified **ISO 8601 format string** (`YYYY-MM-DDTHH:mm:ssZ`) in a **one-time** process, maintaining an index-to-timestamp map in memory.
3.  **Unified API Interface:** All time-related backend APIs, whether providing a list of available times or receiving a time-specific query, **must use only the ISO 8601 format**. This greatly simplifies frontend development and isolates complexity in the backend.

### 3.3. Style Customization

To follow the "Extremely Lightweight" philosophy, style customization **offers "selection" not "creation"**.

* **Colormap:** A dropdown menu allows the user to choose from a **pre-defined, high-quality list of colormaps** (e.g., `Viridis`, `Jet`, `cmocean`), which are hard-coded in the frontend.

## 4. Sharing & Persistence

### 4.1. URL State-Persistence Mechanism

All shareable application state will be serialized into the URL's **hash (`#`)** fragment, enabling a truly stateless client and a perfect sharing experience.

* **URL Structure:** `https://rossby-vis.app/#/view?key1=val1&key2=val2...`
* **State Synchronization:** Any change in the application state (e.g., switching variables, dragging the timeline, changing the view) should update the URL hash in real-time, preferably using the `history.pushState` API.

### 4.2. URL Parameter Definitions

| Parameter Key    | Description                                       | Example Value              |
| :--------------- | :------------------------------------------------ | :------------------------- |
| `dsrc`           | **[Required]** Data source identifier             | `era5-pl`, `oscar`, `custom` |
| `base`           | **[Required]** Base layer variable                | `t`, `sst`                 |
| `ov`             | **[Required]** Overlay layer variable             | `z`, `wnd10m`, `none`      |
| `ts`             | **[Required]** ISO 8601 Timestamp                 | `2024-01-01T12:00:00Z`     |
| `lvl`            | **[Conditionally Required]** Height/depth level     | `500`, `-50`               |
| `lon`, `lat`, `zm` | **[Required]** Viewport center and zoom level   | `121.5`, `31.2`, `4`       |
| `proj`           | **[Recommended]** Map projection                | `ortho`, `merc`            |
| `cmap`           | **[Recommended]** Colormap scheme               | `viridis`, `jet`           |

### 4.3. Handling User-Uploaded Files

When the data source is a user-uploaded file, the **"Share" functionality should be disabled**, with a clear message provided to the user, as local file paths cannot be shared via a URL.

## 5. Best Practices & Implementation Guidelines

### 5.1. Performance

* **Progressive Data Loading:** Dynamically request grid data at different resolutions based on the map's zoom level. Use coarse grids for low zoom levels and request finer grids for high zoom levels.
* **Web Workers:** For computationally intensive tasks like data parsing or interpolation, use Web Workers to avoid blocking the main thread and ensure a fluid UI.
* **Efficient Rendering:** Prioritize WebGL for rendering (via the underlying library from `nullschool` or alternatives like `deck.gl`) to achieve the best performance.

### 5.2. Accessibility (a11y)

Integrating ARIA (Accessible Rich Internet Applications) standards is a mark of a professional application.
* **Semantic HTML:** Use native HTML elements (`<button>`, `<select>`, `<input type="range">`) whenever possible, as they have built-in accessibility.
* **ARIA Roles & Attributes:** Provide `aria-label` or `aria-labelledby` for all interactive controls to describe their function. For example: `<button aria-label="Play animation">▶</button>`. For dynamic regions (like the timestamp display or data probe tooltip), use `aria-live="polite"` or `aria-live="assertive"` so that screen readers can announce changes.
* **Keyboard Navigation:** Ensure all functionality is accessible and operable using only the keyboard (`Tab`, `Shift+Tab`, `Enter`, `Space`, Arrow keys). Slider controls, in particular, must support arrow key navigation.