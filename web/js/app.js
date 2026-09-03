(function () {
  const config = window.Experiment8Config;
  const demo = window.Experiment8DemoData;
  const assessmentData = window.Experiment8AssessmentData;

  // 主脚本负责把配置数据、演示数据和 ArcGIS JS API 组织成一个完整的交互式 WebGIS 页面。
  // 下面 require 的模块基本覆盖了底图、服务图层、矢量图形、空间分析、查询和绘图工具。
  require([
    "esri/Map",
    "esri/Basemap",
    "esri/views/MapView",
    "esri/layers/WebTileLayer",
    "esri/layers/MapImageLayer",
    "esri/layers/GraphicsLayer",
    "esri/Graphic",
    "esri/geometry/Polygon",
    "esri/geometry/Polyline",
    "esri/geometry/Point",
    "esri/geometry/geometryEngine",
    "esri/geometry/support/webMercatorUtils",
    "esri/tasks/IdentifyTask",
    "esri/tasks/support/IdentifyParameters",
    "esri/tasks/QueryTask",
    "esri/tasks/support/Query",
    "esri/widgets/Sketch/SketchViewModel",
    "esri/widgets/LayerList",
    "esri/widgets/Legend",
    "esri/widgets/ScaleBar",
    "esri/widgets/Expand"
  ], function (
    Map,
    Basemap,
    MapView,
    WebTileLayer,
    MapImageLayer,
    GraphicsLayer,
    Graphic,
    Polygon,
    Polyline,
    Point,
    geometryEngine,
    webMercatorUtils,
    IdentifyTask,
    IdentifyParameters,
    QueryTask,
    Query,
    SketchViewModel,
    LayerList,
    Legend,
    ScaleBar,
    Expand
  ) {
    // 统一状态中心：界面切换、查询模式、对比模式和历史视图都从这里读取/写入。
    const state = {
      algorithm: "maximumLikelihood",
      resultMode: "full",
      opacity: 1,
      queryMode: "idle",
      // 记录每个算法真实服务是否可用，供图层降级和状态提示使用。
      serviceAvailability: {},
      // 是否处于左右对比模式。
      comparisonMode: false,
      activePresentationStep: -1,
      activeVectorLayerId: (config.assessmentLayers[0] && config.assessmentLayers[0].id) || "",
      labelsEnabled: false,
      // 复用 SketchViewModel 时，用它区分当前是普通绘图还是查询/分析动作。
      pendingSketchAction: null,
      // 主图视图历史，只记录中心点、缩放级别和旋转角。
      viewHistory: [],
      viewHistoryIndex: -1,
      // 恢复历史时临时置为 true，避免 goTo 触发 stationary 后又把恢复动作记成新历史。
      restoringHistory: false
    };

    // 缓存页面上的 DOM 节点，避免后续反复 document.getElementById。
    const nodes = {};
    [
      "serviceStatus",
      "basemapSelect",
      "algorithmSelect",
      "opacityRange",
      "opacityValue",
      "toggleServiceLayer",
      "toggleConsensusLayer",
      "queryStatus",
      "coordDisplay",
      "scaleDisplay",
      "algorithmInfo",
      "legendList",
      "areaStats",
      "accuracyBody",
      "resultPanel",
      "studentBody",
      "presentationSteps",
      "printPanel",
      "mainMapShell",
      "compareShell",
      "leftAlgorithm",
      "rightAlgorithm",
      "assessmentLayerList",
      "demLayerList",
      "activeVectorLayerSelect",
      "vectorRendererSelect",
      "toggleVectorLabels",
      "vectorLabelFieldSelect",
      "queryTargetSelect",
      "attributeFieldSelect",
      "attributeOperatorSelect",
      "attributeKeyword",
      "spatialTargetLayerSelect",
      "bufferDistanceInput"
    ].forEach(function (id) {
      nodes[id] = document.getElementById(id);
    });

    let mainMap = null;
    let mainView = null;
    // 鹰眼图是独立的第二个 MapView，不是主图的截图。
    let overviewView = null;
    // 点线面绘制、范围查询、缓冲区查询共用同一个 SketchViewModel。
    let sketchVM = null;
    // 每个算法对应一个 IdentifyTask，用于真实栅格点查询。
    let identifyTasks = {};
    let queryTask = null;
    // 主图上下文：包含地图、视图和一组业务图层。
    let mainLayers = null;
    // 左右对比模式下各自维护独立上下文，避免互相污染图层状态。
    let leftContext = null;
    let rightContext = null;
    // 视图同步和鹰眼图同步都使用简单防抖，避免拖拽时高频触发。
    let viewSyncTimer = null;
    // 标记当前是谁在驱动同步，防止左右视图互相回写形成循环。
    let activeSyncSource = null;

    const pointSymbol = {
      type: "simple-marker",
      style: "circle",
      size: 10,
      color: [227, 111, 37, 0.95],
      outline: { color: [255, 255, 255, 1], width: 1.5 }
    };

    const lineSymbol = {
      type: "simple-line",
      color: [35, 105, 167, 0.95],
      width: 2.5
    };

    const polygonDrawSymbol = {
      type: "simple-fill",
      color: [35, 105, 167, 0.12],
      outline: { color: [35, 105, 167, 0.95], width: 2 }
    };

    const highlightPointSymbol = {
      type: "simple-marker",
      style: "circle",
      size: 12,
      color: [255, 214, 95, 0.7],
      outline: { color: [202, 86, 22, 1], width: 2 }
    };

    const highlightLineSymbol = {
      type: "simple-line",
      color: [202, 86, 22, 1],
      width: 4
    };

    const highlightPolygonSymbol = {
      type: "simple-fill",
      color: [255, 214, 95, 0.25],
      outline: { color: [202, 86, 22, 1], width: 2.5 }
    };

    // 通用状态写入函数：把提示文本写入 DOM，并按 warn 参数切换警告样式。
    function setStatus(node, text, warn) {
      if (!node) {
        return;
      }
      node.textContent = text;
      node.classList.toggle("is-warn", Boolean(warn));
    }

    // 读取“显示当前分类结果”复选框；如果页面没有该控件，默认允许显示结果图层。
    function isResultLayerToggleEnabled() {
      return !nodes.toggleServiceLayer || nodes.toggleServiceLayer.checked;
    }

    // 读取算法一致性图开关；该控件可能不存在，所以用 Boolean 做安全判断。
    function isConsensusLayerToggleEnabled() {
      return Boolean(nodes.toggleConsensusLayer && nodes.toggleConsensusLayer.checked);
    }

    // 从左右对比下拉框读取算法 key；控件缺失时退回当前主算法。
    function getCompareAlgorithmValue(side) {
      const node = side === "left" ? nodes.leftAlgorithm : nodes.rightAlgorithm;
      return node ? node.value : state.algorithm;
    }

    // 根据算法 key 读取统计和说明数据；未知 key 统一退回最大似然原版。
    function getAlgorithmInfo(key) {
      return demo.algorithmStats[key] || demo.algorithmStats.maximumLikelihood;
    }

    // 统一图例中的类别名称，避免同一含义出现“城镇”和“城镇/建设用地”两个标签。
    function normalizeLegendClassName(className) {
      if (className === "城镇/建设用地") {
        return "城镇";
      }
      return className;
    }

    // 根据分类名称和透明度生成 ArcGIS 符号可用的 rgba 数组。
    function getClassColor(className, alpha) {
      const normalizedClassName = normalizeLegendClassName(className);
      // 先从演示图例表里找颜色；找不到时用非柑橘颜色兜底。
      const item = demo.legendItems.find(function (entry) {
        return entry.className === normalizedClassName;
      });
      const rgba = item ? item.rgba.slice() : demo.palette.nonCitrus.slice();
      rgba[3] = alpha;
      return rgba;
    }

    // 根据一致性等级返回对应颜色；alpha 由调用方控制，便于不同图层复用。
    function getConsensusColor(consensus, alpha) {
      if (consensus === "三法一致") {
        return [demo.palette.consensusHigh[0], demo.palette.consensusHigh[1], demo.palette.consensusHigh[2], alpha];
      }
      if (consensus === "两法一致") {
        return [demo.palette.consensusMedium[0], demo.palette.consensusMedium[1], demo.palette.consensusMedium[2], alpha];
      }
      return [demo.palette.consensusLow[0], demo.palette.consensusLow[1], demo.palette.consensusLow[2], alpha];
    }

    // 把 ArcGIS 常用的数组颜色转成 CSS 字符串，供自定义 HTML 图例使用。
    function toCssColor(color) {
      if (!Array.isArray(color)) {
        return color || "rgba(0,0,0,0.4)";
      }
      if (color.length === 4) {
        return "rgba(" + color[0] + "," + color[1] + "," + color[2] + "," + color[3] + ")";
      }
      return "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
    }

    // 根据几何类型选择图例颜色来源：面用 fillColor，线用 lineColor，点用 markerColor。
    function colorForLegend(style, geometryType) {
      if (!style) {
        return "rgba(120,120,120,0.6)";
      }
      if (geometryType === "polygon") {
        return toCssColor(style.fillColor || [200, 200, 200, 0.35]);
      }
      if (geometryType === "polyline") {
        return toCssColor(style.lineColor || [120, 120, 120, 1]);
      }
      if (geometryType === "raster") {
        return toCssColor(style.fillColor || [120, 150, 120, 0.5]);
      }
      return toCssColor(style.markerColor || [120, 120, 120, 1]);
    }

    // 格式化可为空的数字，避免 precision/kappa 为空时直接输出 NaN。
    function formatNullableNumber(value, digits, suffix, fallback) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
      }
      return value.toFixed(digits) + suffix;
    }

    // 右侧算法说明卡片：跟随当前算法，展示面积、精度和与基准算法的差异。
    function updateAlgorithmInfo() {
      const current = getAlgorithmInfo(state.algorithm);
      const base = demo.algorithmStats.maximumLikelihood.areaKm2;
      // diff 用来说明当前算法识别面积相对基准算法增加或减少多少。
      const diff = current.areaKm2 - base;
      const diffText = diff === 0 ? "基准算法" : (diff > 0 ? "+" : "") + diff.toFixed(1) + " km²";
      const precisionText = formatNullableNumber(current.precision, 1, "%", "未提供");
      const kappaText = formatNullableNumber(current.kappa, 4, "", "未提供");

      // 右侧说明面板由多行 span 组成，便于 CSS 做纵向排版。
      nodes.algorithmInfo.innerHTML =
        "<strong>" + current.label + "</strong>" +
        "<span>柑橘识别面积：" + current.areaKm2.toFixed(1) + " km²</span>" +
        "<span>总体精度：" + precisionText + "，Kappa：" + kappaText + "</span>" +
        "<span>相对最大似然原版：" + diffText + "</span>" +
        "<span class=\"muted\">" + current.note + "</span>";
    }

    // 渲染右侧面积统计列表，每个算法一行，并显示相对基准面积差。
    function renderAreaStats() {
      nodes.areaStats.innerHTML = "";
      const base = demo.algorithmStats.maximumLikelihood.areaKm2;
      Object.keys(demo.algorithmStats).forEach(function (key) {
        const rowData = demo.algorithmStats[key];
        const row = document.createElement("div");
        row.className = "stat-line";
        const diff = rowData.areaKm2 - base;
        const diffLabel = diff === 0 ? "基准" : (diff > 0 ? "+" : "") + diff.toFixed(1);
        row.innerHTML = "<span>" + rowData.shortLabel + "</span><strong>" + rowData.areaKm2.toFixed(1) + " km² / " + diffLabel + "</strong>";
        nodes.areaStats.appendChild(row);
      });
    }

    // 渲染右侧精度评价表，数据来自 demo.accuracyRows。
    function renderAccuracyTable() {
      nodes.accuracyBody.innerHTML = "";
      demo.accuracyRows.forEach(function (rowData) {
        const row = document.createElement("tr");
        row.innerHTML = "<td>" + rowData.algorithm + "</td><td>" + rowData.overall + "</td><td>" + rowData.kappa + "</td>";
        nodes.accuracyBody.appendChild(row);
      });
    }

    // 创建一行自定义图例：色块 + 文本标签。
    function createLegendRow(container, color, label) {
      const row = document.createElement("div");
      row.className = "legend-item";

      // 色块颜色由分类图例或矢量渲染样式计算得出。
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = color;

      const text = document.createElement("span");
      text.textContent = label;

      row.appendChild(swatch);
      row.appendChild(text);
      container.appendChild(row);
    }

    // 在图例中插入一个小标题，用于分隔分类结果、矢量图层、DEM 等不同来源。
    function createLegendHeading(container, text) {
      const heading = document.createElement("div");
      heading.className = "muted";
      heading.textContent = text;
      container.appendChild(heading);
    }

    // 根据图层 id 查找基础/专题矢量图层配置。
    function getAssessmentLayerConfig(layerId) {
      return assessmentData.assessmentLayers.find(function (layer) {
        return layer.id === layerId;
      }) || null;
    }

    // 根据图层 id 查找 DEM 服务图层配置。
    function getDemLayerConfig(layerId) {
      return assessmentData.demLayers.find(function (layer) {
        return layer.id === layerId;
      }) || null;
    }

    // 获取指定渲染模式的配置；缺失时回退到该图层的默认渲染模式。
    function getRendererPreset(layerConfig, mode) {
      if (!layerConfig || !layerConfig.rendererPresets) {
        return null;
      }
      return layerConfig.rendererPresets[mode] || layerConfig.rendererPresets[layerConfig.defaultRenderer] || null;
    }

    // 读取当前活动矢量图层对象；查询、标注、渲染都依赖这个入口。
    function getActiveVectorEntry() {
      if (!mainLayers || !mainLayers.assessmentLayers) {
        return null;
      }
      return mainLayers.assessmentLayers[state.activeVectorLayerId] || null;
    }

    // 读取空间分析目标图层，默认使用空间分析下拉框当前值。
    function getSpatialTargetEntry() {
      if (!mainLayers || !mainLayers.assessmentLayers || !nodes.spatialTargetLayerSelect) {
        return null;
      }
      const targetId = nodes.spatialTargetLayerSelect.value || state.activeVectorLayerId;
      return mainLayers.assessmentLayers[targetId] || null;
    }

    // 根据字段名查找字段定义，用于判断字段类型和展示中文标签。
    function getFieldDefinition(layerConfig, fieldName) {
      if (!layerConfig) {
        return null;
      }
      // 查询字段和标注字段都可能被界面使用，所以合并后查找。
      const fields = (layerConfig.queryFields || []).concat(layerConfig.labelFields || []);
      return fields.find(function (field) {
        return field.name === fieldName;
      }) || null;
    }

    // 将 GeoJSON 或内置 geometry 定义转换成 ArcGIS 几何对象，坐标仍保持 WGS84。
    function createGeographicGeometry(layerConfig, geometryDefinition) {
      if (geometryDefinition && geometryDefinition.type) {
        // GeoJSON Point：coordinates 是 [x, y]，对应经纬度。
        if (geometryDefinition.type === "Point") {
          return new Point({
            longitude: geometryDefinition.coordinates[0],
            latitude: geometryDefinition.coordinates[1],
            spatialReference: { wkid: 4326 }
          });
        }
        // GeoJSON LineString 转成 Polyline，ArcGIS 需要 paths 数组。
        if (geometryDefinition.type === "LineString") {
          return new Polyline({
            paths: [geometryDefinition.coordinates],
            spatialReference: { wkid: 4326 }
          });
        }
        // GeoJSON MultiLineString 已经是多条 path，直接作为 paths 传入。
        if (geometryDefinition.type === "MultiLineString") {
          return new Polyline({
            paths: geometryDefinition.coordinates,
            spatialReference: { wkid: 4326 }
          });
        }
        // GeoJSON Polygon 的 coordinates 对应 ArcGIS Polygon 的 rings。
        if (geometryDefinition.type === "Polygon") {
          return new Polygon({
            rings: geometryDefinition.coordinates,
            spatialReference: { wkid: 4326 }
          });
        }
        // MultiPolygon 需要把多个面的 rings 展平成一个 rings 数组。
        if (geometryDefinition.type === "MultiPolygon") {
          return new Polygon({
            rings: geometryDefinition.coordinates.reduce(function (rings, polygonRings) {
              return rings.concat(polygonRings);
            }, []),
            spatialReference: { wkid: 4326 }
          });
        }
      }

      // 兼容内置演示数据的简化 geometry 结构。
      if (layerConfig.geometryType === "point") {
        return new Point({
          longitude: geometryDefinition.x,
          latitude: geometryDefinition.y,
          spatialReference: { wkid: 4326 }
        });
      }
      if (layerConfig.geometryType === "polyline") {
        return new Polyline({
          paths: geometryDefinition.paths,
          spatialReference: { wkid: 4326 }
        });
      }
      return new Polygon({
        rings: geometryDefinition.rings,
        spatialReference: { wkid: 4326 }
      });
    }

    // 将 WGS84 几何转换到当前 Web Mercator 地图视图使用的坐标系。
    function toMapGeometry(layerConfig, geometryDefinition) {
      const geometry = createGeographicGeometry(layerConfig, geometryDefinition);
      return webMercatorUtils.geographicToWebMercator(geometry) || geometry;
    }

    // 根据图层几何类型和样式配置构造 ArcGIS 符号。
    function buildSymbol(layerConfig, style) {
      if (layerConfig.geometryType === "point") {
        return {
          type: "simple-marker",
          style: "circle",
          size: style.markerSize || 9,
          color: style.markerColor || [205, 205, 205, 0.95],
          outline: {
            color: style.outlineColor || [105, 105, 105, 1],
            width: style.outlineWidth || 1.2
          }
        };
      }
      // 线图层只需要颜色和宽度。
      if (layerConfig.geometryType === "polyline") {
        return {
          type: "simple-line",
          color: style.lineColor || [120, 120, 120, 0.95],
          width: style.lineWidth || 2.5
        };
      }
      // 默认按面图层处理，使用填充色和边线。
      return {
        type: "simple-fill",
        color: style.fillColor || [200, 200, 200, 0.25],
        outline: {
          color: style.outlineColor || [110, 110, 110, 0.95],
          width: style.outlineWidth || 1.2
        }
      };
    }

    // 根据当前渲染模式和要素属性，计算该要素应使用的样式。
    function resolveRendererStyle(layerConfig, rendererMode, attributes) {
      const renderer = getRendererPreset(layerConfig, rendererMode);
      if (!renderer) {
        return {};
      }

      // 唯一值渲染：取指定字段的属性值，到 classes 表里找对应样式。
      if (rendererMode === "unique" && renderer.classes) {
        const classValue = attributes[renderer.field];
        const uniqueEntry = renderer.classes[classValue];
        if (!uniqueEntry && renderer.fallbackStyle) {
          return renderer.fallbackStyle;
        }
        return uniqueEntry ? uniqueEntry.style : {};
      }

      // 分级渲染：把字段转成数字后，按 breaks 区间匹配样式。
      if (rendererMode === "classBreaks" && Array.isArray(renderer.breaks)) {
        const value = Number(attributes[renderer.field]);
        for (let index = 0; index < renderer.breaks.length; index += 1) {
          const currentBreak = renderer.breaks[index];
          const isLast = index === renderer.breaks.length - 1;
          if (value >= currentBreak.min && (value < currentBreak.max || (isLast && value <= currentBreak.max))) {
            return currentBreak.style;
          }
        }
      }

      return renderer.style || {};
    }

    // 根据图层字段定义构造弹窗表格 HTML。
    function buildPopupTable(layerConfig, attributes) {
      const fields = layerConfig.queryFields || [];
      return fields.map(function (field) {
        return "<tr><th>" + field.label + "</th><td>" + String(attributes[field.name] == null ? "-" : attributes[field.name]) + "</td></tr>";
      }).join("");
    }

    // 把一个要素定义转换成 ArcGIS Graphic，并绑定符号、属性和弹窗模板。
    function createFeatureGraphic(layerConfig, featureDefinition, rendererMode) {
      const geometry = toMapGeometry(layerConfig, featureDefinition.geometry);
      // 额外写入内部字段，方便查询结果知道要素来自哪个图层和数据源。
      const attributes = Object.assign({}, featureDefinition.attributes, {
        __featureId: featureDefinition.id,
        __layerId: layerConfig.id,
        __layerLabel: layerConfig.label,
        __sourceLabel: layerConfig.sourceLabel
      });

      return new Graphic({
        geometry: geometry,
        attributes: attributes,
        symbol: buildSymbol(layerConfig, resolveRendererStyle(layerConfig, rendererMode, attributes)),
        popupTemplate: {
          title: attributes.name || attributes.zone || layerConfig.label,
          content: "<table class=\"result-table\"><tbody>" + buildPopupTable(layerConfig, attributes) + "</tbody></table>"
        }
      });
    }

    // 将标准 GeoJSON FeatureCollection 转成系统内部的 featureDefinition 数组。
    function geoJsonToFeatureDefinitions(layerConfig, geojson) {
      const features = geojson && Array.isArray(geojson.features) ? geojson.features : [];
      return features.map(function (feature, index) {
        return {
          id: feature.id || (layerConfig.id + "-" + (index + 1)),
          attributes: Object.assign({}, feature.properties || {}),
          geometry: feature.geometry
        };
      }).filter(function (featureDefinition) {
        // 没有 geometry 的记录无法在地图上渲染，直接过滤掉。
        return Boolean(featureDefinition.geometry);
      });
    }

    // 按当前 rendererMode 重建图层中的所有 Graphic。
    function rebuildLayerGraphics(entry) {
      if (!entry || !entry.layer || typeof entry.layer.removeAll !== "function") {
        return;
      }
      entry.layer.removeAll();
      // GeoJSON 加载后使用 entry.featureDefinitions；内置数据则直接使用 config.features。
      const featureDefinitions = entry.featureDefinitions || entry.config.features || [];
      featureDefinitions.forEach(function (featureDefinition) {
        entry.layer.add(createFeatureGraphic(entry.config, featureDefinition, entry.rendererMode));
      });
    }

    // 加载 GeoJSON 数据，转换成内部要素定义，再重建 GraphicsLayer。
    function loadGeoJsonFeatures(entry) {
      if (!entry || entry.config.sourceType !== "geojson" || !entry.config.url) {
        return Promise.resolve(entry);
      }
      // 已经有加载任务时直接复用，避免重复请求同一个文件。
      if (entry.loadingPromise) {
        return entry.loadingPromise;
      }

      entry.loadStatus = "loading";
      entry.loadingPromise = fetch(entry.config.url)
        .then(function (response) {
          // fetch 成功但 HTTP 状态异常时，主动抛错进入 catch 分支。
          if (!response.ok) {
            throw new Error("HTTP " + response.status);
          }
          return response.json();
        })
        .then(function (geojson) {
          // 成功后把 GeoJSON Feature 转成 Graphic 所需的数据结构。
          entry.featureDefinitions = geoJsonToFeatureDefinitions(entry.config, geojson);
          rebuildLayerGraphics(entry);
          entry.loadStatus = "loaded";
          // 数据数量、图层选项、标注和图例都依赖加载结果，需要同步刷新。
          renderAssessmentLayerControls();
          renderVectorLayerOptions();
          refreshVectorLabels();
          renderLegend();
          return entry;
        })
        .catch(function (error) {
          entry.loadStatus = "failed";
          console.warn(entry.config.label + " GeoJSON 加载失败", error);
          // 这里提示用户用本地 Web 服务打开页面，避免 file:// 下 fetch 本地文件失败。
          setStatus(nodes.queryStatus, "查询状态：" + entry.config.label + " 加载失败，请通过本地 Web 服务打开页面", true);
          renderAssessmentLayerControls();
          throw error;
        });
      return entry.loadingPromise;
    }

    // 确保矢量图层数据已经可用；GeoJSON 图层需要等待异步加载完成。
    function ensureVectorEntryReady(entry) {
      if (!entry) {
        return Promise.resolve(null);
      }
      if (entry.config.sourceType === "geojson") {
        return loadGeoJsonFeatures(entry);
      }
      return Promise.resolve(entry);
    }

    // 创建基础/专题矢量图层集合，每个业务图层包含数据图层和标注图层。
    function createAssessmentLayers() {
      const layers = {};
      config.assessmentLayers.forEach(function (layerMeta) {
        const layerConfig = getAssessmentLayerConfig(layerMeta.id);
        if (!layerConfig) {
          return;
        }
        // entry 统一保存配置、GraphicsLayer、标注层和当前渲染模式。
        const entry = {
          config: layerConfig,
          layer: new GraphicsLayer({
            title: layerConfig.label,
            visible: layerConfig.visibleByDefault
          }),
          labelLayer: new GraphicsLayer({
            title: layerConfig.label + " 标注",
            visible: false,
            listMode: "hide"
          }),
          rendererMode: layerConfig.defaultRenderer || "single"
        };
        if (layerConfig.sourceType === "geojson") {
          // GeoJSON 先放空数组，加载完成后再填充并重建图形。
          entry.featureDefinitions = [];
          loadGeoJsonFeatures(entry).catch(function () {});
        } else {
          // 内置 features 不需要异步请求，可以立即构造 Graphic。
          entry.featureDefinitions = layerConfig.features || [];
          rebuildLayerGraphics(entry);
        }
        layers[layerConfig.id] = entry;
      });
      return layers;
    }

    // 根据 DEM 图层配置创建真实 MapImageLayer 服务图层。
    function createRealDemServiceLayer(layerConfig) {
      const serviceConfig = config.demServices && config.demServices[layerConfig.serviceKey];
      const sublayerId = serviceConfig ? serviceConfig.sublayerId : 0;
      // DEM 服务通过指定 sublayerId 控制要显示的栅格子图层。
      return new MapImageLayer({
        url: serviceConfig.url,
        title: layerConfig.label,
        visible: layerConfig.visibleByDefault,
        sublayers: [
          {
            id: sublayerId,
            visible: true
          }
        ]
      });
    }

    // 创建 DEM 图层集合；当前主要用于真实坡度栅格服务。
    function createDemLayers() {
      const layers = {};
      config.demLayers.forEach(function (layerMeta) {
        const layerConfig = getDemLayerConfig(layerMeta.id);
        if (!layerConfig) {
          return;
        }
        if (layerConfig.sourceType === "map-service") {
          // map-service 类型直接创建 MapImageLayer，并监听加载结果刷新图例或提示错误。
          const entry = {
            config: layerConfig,
            layer: createRealDemServiceLayer(layerConfig),
            rendererMode: layerConfig.defaultRenderer || "service"
          };
          entry.layer.when(function () {
            renderLegend();
          }).catch(function (error) {
            console.warn(layerConfig.label + " 服务加载失败", error);
            setStatus(nodes.queryStatus, "查询状态：真实 DEM 服务加载失败，请确认 firsttest.MapServer 已启动", true);
          });
          layers[layerConfig.id] = entry;
          return;
        }

        // 预留非服务型 DEM/专题图层的 GraphicsLayer 处理路径。
        const entry = {
          config: layerConfig,
          layer: new GraphicsLayer({
            title: layerConfig.label,
            visible: layerConfig.visibleByDefault
          }),
          rendererMode: layerConfig.defaultRenderer || "classBreaks",
          featureDefinitions: layerConfig.features || []
        };
        rebuildLayerGraphics(entry);
        layers[layerConfig.id] = entry;
      });
      return layers;
    }

    // 计算标注文字放置点：点用自身，线/面用范围中心点。
    function getLabelPoint(geometry) {
      if (!geometry) {
        return null;
      }
      if (geometry.type === "point") {
        return geometry;
      }
      if (geometry.extent) {
        // extent.center 是简单稳定的标注位置，不需要额外几何计算。
        return geometry.extent.center;
      }
      return null;
    }

    // 根据“显示属性标注”开关和当前活动图层，重建矢量标注层。
    function refreshVectorLabels() {
      if (!mainLayers || !mainLayers.assessmentLayers) {
        return;
      }

      // 先清空所有标注层，避免切换图层或字段后残留旧标注。
      Object.keys(mainLayers.assessmentLayers).forEach(function (layerId) {
        const entry = mainLayers.assessmentLayers[layerId];
        entry.labelLayer.removeAll();
        entry.labelLayer.visible = false;
      });

      if (!nodes.toggleVectorLabels || !nodes.toggleVectorLabels.checked) {
        return;
      }

      // 只给当前活动且可见的矢量图层生成标注。
      const entry = getActiveVectorEntry();
      if (!entry || !entry.layer.visible) {
        return;
      }

      // 标注字段来自界面下拉框，没有字段时不生成文字。
      const labelField = nodes.vectorLabelFieldSelect.value;
      if (!labelField) {
        return;
      }

      // 遍历当前图层中的 Graphic，把选定字段值转换成 text symbol。
      entry.layer.graphics.forEach(function (graphic) {
        const labelValue = graphic.attributes[labelField];
        if (labelValue == null || labelValue === "") {
          return;
        }
        const labelPoint = getLabelPoint(graphic.geometry);
        if (!labelPoint) {
          return;
        }

        // 标注作为普通 Graphic 放在独立 labelLayer，便于统一清空和显隐。
        entry.labelLayer.add(new Graphic({
          geometry: labelPoint,
          symbol: {
            type: "text",
            text: String(labelValue),
            color: "#23303d",
            haloColor: [255, 255, 255, 0.96],
            haloSize: 1.5,
            yoffset: graphic.geometry.type === "point" ? 10 : 0,
            font: {
              size: 11,
              family: "Microsoft YaHei",
              weight: "bold"
            }
          }
        }));
      });

      entry.labelLayer.visible = true;
    }

    // 根据当前分类图例、活动矢量渲染和可见 DEM 图层，重建右侧统一图例。
    function renderLegend() {
      nodes.legendList.innerHTML = "";
      // 分类结果图例固定来自 demo.legendItems，与当前算法服务共用同一套类别颜色。
      createLegendHeading(nodes.legendList, "分类结果");
      demo.legendItems.forEach(function (item) {
        createLegendRow(nodes.legendList, item.color, item.className);
      });

      // 活动矢量图层的图例根据 rendererMode 动态展开。
      const activeVectorEntry = getActiveVectorEntry();
      if (activeVectorEntry) {
        const renderer = getRendererPreset(activeVectorEntry.config, activeVectorEntry.rendererMode);
        if (renderer) {
          createLegendHeading(nodes.legendList, "活动矢量渲染");
          if (activeVectorEntry.rendererMode === "unique") {
            // 唯一值渲染把每个类别都单独显示成一行图例。
            Object.keys(renderer.classes).forEach(function (key) {
              const classItem = renderer.classes[key];
              createLegendRow(
                nodes.legendList,
                colorForLegend(classItem.style, activeVectorEntry.config.geometryType),
                classItem.label
              );
            });
          } else if (activeVectorEntry.rendererMode === "classBreaks") {
            // 分级渲染把每个数值区间显示成一行图例。
            renderer.breaks.forEach(function (breakItem) {
              createLegendRow(
                nodes.legendList,
                colorForLegend(breakItem.style, activeVectorEntry.config.geometryType),
                breakItem.label
              );
            });
          } else {
            // 单值渲染只有一套样式，因此只生成一行图例。
            createLegendRow(
              nodes.legendList,
              colorForLegend(renderer.style, activeVectorEntry.config.geometryType),
              activeVectorEntry.config.label
            );
          }
        }
      }

      // DEM 图例只为当前可见的 DEM 图层生成。
      Object.keys(mainLayers && mainLayers.demLayers ? mainLayers.demLayers : {}).forEach(function (layerId) {
        const entry = mainLayers.demLayers[layerId];
        if (!entry.layer.visible) {
          return;
        }
        const renderer = getRendererPreset(entry.config, entry.rendererMode);
        if (!renderer) {
          return;
        }
        createLegendHeading(nodes.legendList, entry.config.label);
        if (renderer.classes) {
          // 唯一值类图例。
          Object.keys(renderer.classes).forEach(function (key) {
            const classItem = renderer.classes[key];
            createLegendRow(nodes.legendList, colorForLegend(classItem.style, entry.config.geometryType), classItem.label);
          });
          return;
        }
        if (Array.isArray(renderer.breaks)) {
          // 分级区间类图例。
          renderer.breaks.forEach(function (breakItem) {
            createLegendRow(nodes.legendList, colorForLegend(breakItem.style, entry.config.geometryType), breakItem.label);
          });
          return;
        }
        if (renderer.style) {
          // 服务渲染或单一样式图例。
          createLegendRow(nodes.legendList, colorForLegend(renderer.style, entry.config.geometryType), renderer.label || entry.config.label);
        }
      });
    }

    // 演示斑块数据原始坐标是经纬度，渲染到 Web Mercator 视图前先转换坐标系。
    function patchToPolygon(patch) {
      const polygon = new Polygon({
        rings: patch.rings,
        spatialReference: { wkid: 4326 }
      });
      return webMercatorUtils.geographicToWebMercator(polygon) || polygon;
    }

    // 当真实分类服务不可用时，使用演示斑块图形兜底展示分类结果。
    function createPatchGraphic(patch, algorithmKey, mode, opacity) {
      const algorithmClass = patch.algorithms[algorithmKey] || patch.className;
      if (mode === "citrus" && algorithmClass !== "柑橘") {
        return null;
      }

      return new Graphic({
        geometry: patchToPolygon(patch),
        attributes: {
          id: patch.id,
          algorithm: getAlgorithmInfo(algorithmKey).label,
          className: algorithmClass,
          county: patch.county,
          areaKm2: (18.5 + patch.id * 4.7).toFixed(1),
          consensus: patch.consensus
        },
        symbol: {
          type: "simple-fill",
          color: getClassColor(algorithmClass, opacity),
          outline: {
            color: [62, 72, 82, 0.75],
            width: 0.8
          }
        }
      });
    }

    // 根据演示斑块的一致性字段创建一致性图层 Graphic。
    function createConsensusGraphic(patch) {
      if (patch.consensus === "非柑橘") {
        return null;
      }

      return new Graphic({
        geometry: patchToPolygon(patch),
        attributes: {
          className: patch.consensus,
          county: patch.county
        },
        symbol: {
          type: "simple-fill",
          color: getConsensusColor(patch.consensus, 0.7),
          outline: {
            color: [116, 86, 18, 0.8],
            width: 1
          }
        }
      });
    }

    // 创建演示分类结果图层；只有真实服务不可用或未配置时才显示。
    function createDemoAlgorithmLayer() {
      return new GraphicsLayer({
        title: "未接入服务的分类结果（演示）",
        opacity: 1,
        visible: false
      });
    }

    // 重新填充演示分类图层；如果当前算法有真实服务，则关闭演示图层。
    function replaceAlgorithmGraphics(layer, algorithmKey, mode, opacity) {
      layer.removeAll();
      if (hasAlgorithmService(algorithmKey)) {
        layer.visible = false;
        layer.title = getAlgorithmServiceConfig(algorithmKey).title;
        return;
      }

      // 按当前算法和结果模式，把演示斑块转换成 Graphic 加入图层。
      demo.demoPatches.forEach(function (patch) {
        const graphic = createPatchGraphic(patch, algorithmKey, mode, opacity);
        if (graphic) {
          layer.add(graphic);
        }
      });

      layer.title = getAlgorithmInfo(algorithmKey).label + (mode === "citrus" ? " 柑橘提取结果（演示）" : " 四分类结果（演示）");
    }

    // 创建算法一致性演示图层，初始化时一次性把可显示斑块加入图层。
    function createConsensusLayer() {
      const layer = new GraphicsLayer({
        title: "算法一致性图（演示）",
        visible: false
      });

      demo.demoPatches.forEach(function (patch) {
        const graphic = createConsensusGraphic(patch);
        if (graphic) {
          layer.add(graphic);
        }
      });
      return layer;
    }

    // 根据算法 key 读取真实服务配置；未配置或没有 url 时返回 null。
    function getAlgorithmServiceConfig(algorithmKey) {
      const service = config.algorithmServices && config.algorithmServices[algorithmKey];
      if (!service || !service.url) {
        return null;
      }
      return service;
    }

    // 判断某个算法是否配置了真实 ArcGIS Server 服务。
    function hasAlgorithmService(algorithmKey) {
      return Boolean(getAlgorithmServiceConfig(algorithmKey));
    }

    // 根据底图 id 获取底图配置；缺失时回退到默认底图或第一个底图。
    function getBasemapConfig(basemapId) {
      const targetId = basemapId || config.fallbackBasemap;
      return config.basemaps.find(function (entry) {
        return entry.id === targetId;
      }) || config.basemaps[0];
    }

    // 创建天地图 WebTileLayer；layerType 决定矢量/影像/地形和注记类型。
    function createTiandituWebTileLayer(layerType, title) {
      return new WebTileLayer({
        urlTemplate: "https://t{subDomain}.tianditu.gov.cn/DataServer?T=" + layerType + "&x={col}&y={row}&l={level}&tk=" + config.tianditu.token,
        subDomains: config.tianditu.subDomains,
        title: title,
        copyright: "Tianditu"
      });
    }

    // 根据配置组合底图和注记图层，生成 ArcGIS Basemap 对象。
    function createConfiguredBasemap(basemapId) {
      const basemapConfig = getBasemapConfig(basemapId);
      return new Basemap({
        id: basemapConfig.id,
        title: basemapConfig.label,
        baseLayers: [
          createTiandituWebTileLayer(basemapConfig.baseLayerType, basemapConfig.label + "底图"),
          createTiandituWebTileLayer(basemapConfig.annotationLayerType, basemapConfig.label + "注记")
        ]
      });
    }

    // 根据“四分类/仅柑橘”模式返回当前算法服务应显示的子图层。
    function getAlgorithmSublayers(algorithmKey) {
      const service = getAlgorithmServiceConfig(algorithmKey);
      if (!service) {
        return [];
      }
      const showCitrusOnly = state.resultMode === "citrus";
      return [
        { id: service.citrusLayerId, visible: showCitrusOnly },
        { id: service.fullLayerId, visible: !showCitrusOnly }
      ];
    }

    // 创建某个算法的 MapImageLayer，初始不显示，后续由 refreshResultLayers 控制显隐。
    function createAlgorithmServiceLayer(algorithmKey) {
      const service = getAlgorithmServiceConfig(algorithmKey);
      return new MapImageLayer({
        url: service.url,
        title: service.title,
        opacity: state.opacity,
        visible: false,
        sublayers: getAlgorithmSublayers(algorithmKey)
      });
    }

    // 把服务加载错误整理成一行字符串，便于 console.warn 中定位失败原因。
    function summarizeServiceLoadError(error) {
      if (!error) {
        return "unknown error";
      }
      const details = [];
      // name/message/details 分开收集，避免只打印 [object Object]。
      if (error.name) {
        details.push("name=" + error.name);
      }
      if (error.message) {
        details.push("message=" + error.message);
      }
      if (error.details && typeof error.details === "object") {
        const detailKeys = Object.keys(error.details);
        if (detailKeys.length) {
          details.push("details=" + JSON.stringify(error.details));
        }
      }
      return details.join(" | ") || String(error);
    }

    // 重建失败的算法服务图层，常用于本地 ArcGIS Server 重启后的恢复尝试。
    function recreateAlgorithmServiceLayer(layers, algorithmKey) {
      if (!layers || !layers.map || !layers.serviceLayers[algorithmKey]) {
        return null;
      }
      const oldLayer = layers.serviceLayers[algorithmKey];
      // 尽量把新图层插回旧图层所在的位置，保持图层顺序稳定。
      const layerIndex = layers.map.layers.indexOf(oldLayer);
      const newLayer = createAlgorithmServiceLayer(algorithmKey);
      layers.map.add(newLayer, layerIndex >= 0 ? layerIndex : 0);
      layers.map.remove(oldLayer);
      layers.serviceLayers[algorithmKey] = newLayer;
      bindServiceLayerStatus(layers, algorithmKey, newLayer);
      ensureOperationalLayerOrder(layers.map, layers);
      return newLayer;
    }

    // 一次性创建配置中所有算法的真实服务图层。
    function createAlgorithmServiceLayers() {
      const serviceLayers = {};
      Object.keys(config.algorithmServices || {}).forEach(function (algorithmKey) {
        if (hasAlgorithmService(algorithmKey)) {
          serviceLayers[algorithmKey] = createAlgorithmServiceLayer(algorithmKey);
        }
      });
      return serviceLayers;
    }

    // 真实服务和演示图层共用一套刷新入口：
    // 1. 先统一重置所有服务图层状态
    // 2. 如果当前算法有真实服务，优先显示服务图层
    // 3. 如果服务不存在或不可用，再回落到演示 GraphicsLayer
    function refreshResultLayers(layers, algorithmKey) {
      const showResult = isResultLayerToggleEnabled();
      // preferredServiceOrder 保证四个算法图层按固定顺序处理，其他扩展算法追加在后面。
      const preferredServiceOrder = ["maximumLikelihood", "maximumLikelihoodRemake", "randomTrees", "svm"];
      const serviceAlgorithmKeys = preferredServiceOrder.concat(Object.keys(layers.serviceLayers).filter(function (key) {
        return preferredServiceOrder.indexOf(key) === -1;
      }));

      // 每次刷新先把所有真实服务图层重置为隐藏，再打开当前需要的那一个。
      serviceAlgorithmKeys.forEach(function (serviceAlgorithmKey) {
        const serviceLayer = layers.serviceLayers[serviceAlgorithmKey];
        if (!serviceLayer) {
          return;
        }
        serviceLayer.opacity = state.opacity;
        serviceLayer.sublayers = getAlgorithmSublayers(serviceAlgorithmKey);
        serviceLayer.visible = false;
      });

      if (hasAlgorithmService(algorithmKey)) {
        // 有真实服务时清空并隐藏演示 GraphicsLayer，避免两套结果叠加。
        layers.demoAlgorithmLayer.removeAll();
        layers.demoAlgorithmLayer.visible = false;
        if (layers.serviceLayers[algorithmKey]) {
          // 服务图层加载失败后，下一次重新显示时尝试重建，给本地服务重启后的恢复机会。
          if (showResult && layers.serviceLayers[algorithmKey].loadStatus === "failed") {
            state.serviceAvailability[algorithmKey] = undefined;
            recreateAlgorithmServiceLayer(layers, algorithmKey);
          }
          layers.serviceLayers[algorithmKey].visible = showResult && isAlgorithmServiceAvailable(algorithmKey);
        }
        return;
      }

      // 没有真实服务时，用演示斑块按当前算法重新生成图形。
      replaceAlgorithmGraphics(layers.demoAlgorithmLayer, algorithmKey, state.resultMode, state.opacity);
      layers.demoAlgorithmLayer.visible = showResult;
    }

    // 统一控制业务图层顺序，保证底层在下、绘制和高亮在上。
    function ensureOperationalLayerOrder(map, layers) {
      const orderedLayers = [];

      // DEM 放在分类结果下方，作为地形背景或专题底层。
      Object.keys(layers.demLayers || {}).forEach(function (layerId) {
        orderedLayers.push(layers.demLayers[layerId].layer);
      });

      // 所有算法服务图层在 DEM 之上。
      Object.keys(layers.serviceLayers || {}).forEach(function (algorithmKey) {
        orderedLayers.push(layers.serviceLayers[algorithmKey]);
      });

      // 演示分类图层和真实服务互斥显示，但仍参与固定排序。
      orderedLayers.push(layers.demoAlgorithmLayer);

      // 基础矢量图层压在一致性图和标注图层下。
      Object.keys(layers.assessmentLayers || {}).forEach(function (layerId) {
        orderedLayers.push(layers.assessmentLayers[layerId].layer);
      });

      orderedLayers.push(layers.consensusLayer);

      // 标注图层需要盖在对应矢量图层上。
      Object.keys(layers.assessmentLayers || {}).forEach(function (layerId) {
        orderedLayers.push(layers.assessmentLayers[layerId].labelLayer);
      });

      // 绘图和查询高亮始终放在最上面，避免被业务图层遮住。
      orderedLayers.push(layers.drawLayer, layers.highlightLayer);

      orderedLayers.forEach(function (layer, index) {
        if (layer) {
          map.reorder(layer, index);
        }
      });
    }

    // 算法服务只要没有明确标记为 false，就视为可尝试显示。
    function isAlgorithmServiceAvailable(algorithmKey) {
      return hasAlgorithmService(algorithmKey) && state.serviceAvailability[algorithmKey] !== false;
    }

    // 一个 map context 代表一个完整的地图运行环境。
    // 主图和左右对比图都复用这套工厂函数，只是是否挂载基础矢量图层不同。
    function createMapContext(containerId, algorithmKey, includeAssessment) {
      // 每个 MapView 使用独立 Map，这样主图和对比图可以独立控制图层显隐。
      const map = new Map({
        basemap: createConfiguredBasemap(nodes.basemapSelect.value || config.fallbackBasemap)
      });

      // 先创建所有业务图层对象，再按顺序加入 map。
      const serviceLayers = createAlgorithmServiceLayers();
      const demoAlgorithmLayer = createDemoAlgorithmLayer();
      const consensusLayer = createConsensusLayer();
      const drawLayer = new GraphicsLayer({ title: "绘制图元" });
      const highlightLayer = new GraphicsLayer({ title: "查询高亮", listMode: "hide" });
      const assessmentLayers = includeAssessment ? createAssessmentLayers() : {};
      const demLayers = includeAssessment ? createDemLayers() : {};

      const operationalLayers = [];
      // 这里的添加顺序和 ensureOperationalLayerOrder 保持一致。
      Object.keys(demLayers).forEach(function (layerId) {
        operationalLayers.push(demLayers[layerId].layer);
      });
      Object.keys(serviceLayers).forEach(function (algorithm) {
        operationalLayers.push(serviceLayers[algorithm]);
      });
      operationalLayers.push(demoAlgorithmLayer);
      Object.keys(assessmentLayers).forEach(function (layerId) {
        operationalLayers.push(assessmentLayers[layerId].layer);
      });
      operationalLayers.push(consensusLayer);
      Object.keys(assessmentLayers).forEach(function (layerId) {
        operationalLayers.push(assessmentLayers[layerId].labelLayer);
      });
      operationalLayers.push(drawLayer, highlightLayer);
      map.addMany(operationalLayers);

      // containerId 指向 HTML 中的 div，ArcGIS 会把地图渲染到该 DOM 节点。
      const view = new MapView({
        container: containerId,
        map: map,
        center: config.initialView.center,
        zoom: config.initialView.zoom,
        ui: { components: ["zoom", "attribution"] }
      });

      // context 把 map、view、layers 打包返回，后续主图和左右对比图都用同一结构操作。
      const context = {
        map: map,
        view: view,
        layers: {
          map: map,
          serviceLayers: serviceLayers,
          demoAlgorithmLayer: demoAlgorithmLayer,
          consensusLayer: consensusLayer,
          drawLayer: drawLayer,
          highlightLayer: highlightLayer,
          assessmentLayers: assessmentLayers,
          demLayers: demLayers
        }
      };

      ensureOperationalLayerOrder(map, context.layers);
      refreshResultLayers(context.layers, algorithmKey);
      return context;
    }

    // 给指定 MapView 挂载 ArcGIS 原生控件：图层列表、图例和比例尺。
    function wireMapWidgets(view) {
      view.when(function () {
        const layerList = new LayerList({ view: view });
        const legend = new Legend({ view: view });
        const scaleBar = new ScaleBar({ view: view, unit: "metric" });

        // LayerList 和 Legend 放进 Expand，避免默认占据地图主要空间。
        view.ui.add(new Expand({
          view: view,
          content: layerList,
          expanded: false,
          tooltip: "图层列表"
        }), "top-right");

        view.ui.add(new Expand({
          view: view,
          content: legend,
          expanded: false,
          tooltip: "ArcGIS 图例"
        }), "top-right");

        view.ui.add(scaleBar, "bottom-left");
      });
    }

    // 鹰眼图只保留底图和视图范围，不承载复杂业务图层，目的是给主图提供空间参照。
    function initOverviewMap() {
      // 鹰眼图使用和主图相同的底图配置，但不加载业务图层。
      const overviewMap = new Map({
        basemap: createConfiguredBasemap(nodes.basemapSelect.value || config.fallbackBasemap)
      });

      overviewView = new MapView({
        container: "overviewDiv",
        map: overviewMap,
        center: mainView.center,
        // 初始 zoom 比主图小 3 级，让鹰眼图看到更大范围。
        zoom: Math.max(mainView.zoom - 3, 2),
        ui: { components: [] },
        constraints: { snapToZoom: false }
      });

      // 主图平移或缩放后同步鹰眼图中心与比例尺。
      mainView.watch("center", syncOverview);
      mainView.watch("scale", syncOverview);

      overviewView.when(function () {
        overviewView.on("click", function (event) {
          if (event.mapPoint) {
            // 点击鹰眼图时反向控制主图中心，实现快速定位。
            mainView.goTo({ center: event.mapPoint }, { duration: 300 });
          }
        });
      });
    }

    // 用轻量防抖避免主图连续拖动时频繁重绘鹰眼图。
    function syncOverview() {
      if (!overviewView) {
        return;
      }
      window.clearTimeout(viewSyncTimer);
      viewSyncTimer = window.setTimeout(function () {
        overviewView.center = mainView.center;
        // 鹰眼图比例尺放大 3 倍，始终比主图显示更广的区域。
        overviewView.scale = (mainView.scale || 50000) * 3;
      }, 80);
    }

    // 把地图点转换成经纬度点；状态栏和查询结果都需要经纬度显示。
    function asGeographic(point) {
      if (!point) {
        return null;
      }
      if (point.spatialReference && point.spatialReference.isWGS84) {
        return point;
      }
      return webMercatorUtils.webMercatorToGeographic(point) || point;
    }

    // 状态栏上的坐标、比例尺和历史视图记录都依附在主图 watch/on 事件上。
    function watchPointerAndScale(view) {
      // 鼠标移动时把屏幕坐标转换成地图坐标，再显示经纬度。
      view.on("pointer-move", function (event) {
        const point = view.toMap(event);
        const geographicPoint = asGeographic(point);
        if (!geographicPoint) {
          return;
        }
        nodes.coordDisplay.textContent = "经度：" + geographicPoint.longitude.toFixed(5) + " 纬度：" + geographicPoint.latitude.toFixed(5);
      });

      // 比例尺变化时更新底部状态栏。
      view.watch("scale", function (scale) {
        nodes.scaleDisplay.textContent = "比例尺：1:" + Math.round(scale).toLocaleString();
      });

      // stationary 为 true 表示地图停止移动，此时记录历史视图比较稳定。
      view.watch("stationary", function (isStationary) {
        if (isStationary) {
          recordViewHistory();
        }
      });
    }

    // 每当主图稳定下来就记录一次快照，形成类似浏览器前进/后退的视图历史。
    function recordViewHistory() {
      if (!mainView || state.restoringHistory || !mainView.center) {
        return;
      }
      const geographicCenter = asGeographic(mainView.center);
      // 历史快照只保存恢复视角需要的最小字段。
      const snapshot = {
        center: [Number(geographicCenter.longitude.toFixed(6)), Number(geographicCenter.latitude.toFixed(6))],
        zoom: mainView.zoom,
        rotation: mainView.rotation || 0
      };

      const last = state.viewHistory[state.viewHistory.length - 1];
      // 避免同一个视图状态被连续重复记录。
      if (last &&
        last.center[0] === snapshot.center[0] &&
        last.center[1] === snapshot.center[1] &&
        last.zoom === snapshot.zoom &&
        last.rotation === snapshot.rotation) {
        return;
      }

      // 如果用户先回退历史，再继续浏览新范围，旧的“前进记录”应当被截断。
      if (state.viewHistoryIndex < state.viewHistory.length - 1) {
        state.viewHistory = state.viewHistory.slice(0, state.viewHistoryIndex + 1);
      }

      state.viewHistory.push(snapshot);
      if (state.viewHistory.length > 40) {
        // 历史记录最多保留 40 条，避免长时间浏览后数组无限增长。
        state.viewHistory.shift();
      }
      state.viewHistoryIndex = state.viewHistory.length - 1;
    }

    // 按历史记录索引恢复主图视角。
    function restoreHistorySnapshot(index) {
      if (index < 0 || index >= state.viewHistory.length) {
        return;
      }
      const snapshot = state.viewHistory[index];
      state.restoringHistory = true;
      // 恢复历史时关闭动画，保证前进/后退更像视图状态切换。
      mainView.goTo({
        center: snapshot.center,
        zoom: snapshot.zoom,
        rotation: snapshot.rotation
      }, { animate: false }).finally(function () {
        state.viewHistoryIndex = index;
        state.restoringHistory = false;
      });
    }

    // 切换到上一条历史视图；没有更早记录时只提示状态。
    function goToPreviousView() {
      if (state.viewHistoryIndex <= 0) {
        setStatus(nodes.queryStatus, "查询状态：已到达最早视图记录", true);
        return;
      }
      restoreHistorySnapshot(state.viewHistoryIndex - 1);
      setStatus(nodes.queryStatus, "查询状态：已切换到前一视图", false);
    }

    // 切换到下一条历史视图；没有更新记录时只提示状态。
    function goToNextView() {
      if (state.viewHistoryIndex >= state.viewHistory.length - 1) {
        setStatus(nodes.queryStatus, "查询状态：已到达最新视图记录", true);
        return;
      }
      restoreHistorySnapshot(state.viewHistoryIndex + 1);
      setStatus(nodes.queryStatus, "查询状态：已切换到后一视图", false);
    }

    // 根据真实算法服务加载结果，刷新左侧服务状态提示。
    function renderServiceStatus() {
      if (!mainLayers) {
        return;
      }
      const serviceKeys = Object.keys(mainLayers.serviceLayers);
      // failed/loaded 分别统计明确失败和明确成功的服务。
      const failed = serviceKeys.filter(function (algorithmKey) {
        return state.serviceAvailability[algorithmKey] === false;
      });
      const loaded = serviceKeys.filter(function (algorithmKey) {
        return state.serviceAvailability[algorithmKey] === true;
      });

      if (failed.length) {
        setStatus(nodes.serviceStatus, "服务状态：" + failed.map(function (key) {
          return getAlgorithmInfo(key).label;
        }).join("、") + " 不可用", true);
        return;
      }

      if (loaded.length === serviceKeys.length) {
        setStatus(nodes.serviceStatus, "服务状态：真实分类服务已全部接入", false);
        return;
      }

      setStatus(nodes.serviceStatus, "服务状态：分类服务正在初始化", false);
    }

    // 监听单个算法服务图层的加载结果，并把结果写回 state.serviceAvailability。
    function bindServiceLayerStatus(layers, algorithmKey, layer) {
      const service = getAlgorithmServiceConfig(algorithmKey);
      layer.when(function () {
        // 服务可用时重新刷新当前图层，确保之前被隐藏的服务图层能显示出来。
        state.serviceAvailability[algorithmKey] = true;
        if (mainLayers) {
          refreshResultLayers(mainLayers, state.algorithm);
        }
        renderServiceStatus();
      }).catch(function (error) {
        console.warn(service.name + " 服务加载失败，使用降级展示。", summarizeServiceLoadError(error), error);
        // 服务失败后标记为 false，refreshResultLayers 会隐藏该服务并使用演示兜底。
        state.serviceAvailability[algorithmKey] = false;
        layer.visible = false;
        if (mainLayers) {
          refreshResultLayers(mainLayers, state.algorithm);
        }
        renderServiceStatus();
      });
    }

    // 为当前上下文中的所有算法服务图层绑定加载状态监听。
    function updateServiceLayerStatus(layers) {
      Object.keys(layers.serviceLayers).forEach(function (algorithmKey) {
        bindServiceLayerStatus(layers, algorithmKey, layers.serviceLayers[algorithmKey]);
      });
    }

    // 同步顶部算法按钮高亮和左侧算法下拉框值。
    function updateAlgorithmTabs() {
      document.querySelectorAll(".method-tab").forEach(function (button) {
        button.classList.toggle("is-active", button.dataset.algorithm === state.algorithm);
      });
      nodes.algorithmSelect.value = state.algorithm;
    }

    // 同步“四分类/仅柑橘”分段按钮的高亮状态。
    function updateModeButtons() {
      document.querySelectorAll(".segmented button").forEach(function (button) {
        button.classList.toggle("is-active", button.dataset.mode === state.resultMode);
      });
    }

    // 算法切换是界面主线入口之一：切图层、切按钮高亮、切说明面板，并联动对比视图。
    function setAlgorithm(algorithmKey) {
      // 更新当前算法状态后，所有依赖算法的 UI 和图层都要刷新。
      state.algorithm = algorithmKey;
      refreshResultLayers(mainLayers, state.algorithm);
      updateAlgorithmTabs();
      updateAlgorithmInfo();
      if (state.comparisonMode) {
        refreshCompareLayers();
      }
    }

    // 切换分类结果模式：四分类或仅柑橘。
    function setResultMode(mode) {
      state.resultMode = mode;
      refreshResultLayers(mainLayers, state.algorithm);
      updateModeButtons();
      refreshCompareLayers();
    }

    // 更新分类图层透明度，并同步主图和左右对比图层。
    function setOpacity(value) {
      state.opacity = Number(value) / 100;
      nodes.opacityValue.textContent = value + "%";
      refreshResultLayers(mainLayers, state.algorithm);
      refreshCompareLayers();
    }

    // 刷新左右对比图中的算法结果和一致性图显隐。
    function refreshCompareLayers() {
      if (!leftContext || !rightContext) {
        return;
      }
      refreshResultLayers(leftContext.layers, getCompareAlgorithmValue("left"));
      refreshResultLayers(rightContext.layers, getCompareAlgorithmValue("right"));
      leftContext.layers.consensusLayer.visible = isConsensusLayerToggleEnabled();
      rightContext.layers.consensusLayer.visible = isConsensusLayerToggleEnabled();
    }

    // 对比模式会隐藏主图容器、显示双屏容器；退出时保留主图上下文继续使用。
    function setComparisonMode(enabled) {
      state.comparisonMode = enabled;
      // 切换对比模式时退出查询/绘图后续动作，避免隐藏主图后仍等待点击。
      state.queryMode = "idle";
      state.pendingSketchAction = null;
      nodes.mainMapShell.classList.toggle("is-hidden", enabled);
      nodes.compareShell.classList.toggle("is-hidden", !enabled);

      const compareButton = document.getElementById("btnCompare");
      if (compareButton) {
        compareButton.textContent = enabled ? "返回单图" : "左右对比";
      }

      if (enabled) {
        // 进入对比模式时按需创建左右 MapView。
        ensureCompareViews();
      } else if (mainView) {
        // 回到单图后重新计算主图尺寸，避免容器显隐后地图尺寸异常。
        mainView.resize();
      }
    }

    // 左右视图的底图和图层各自独立，但视角需要保持同步，方便做同位置比较。
    function ensureCompareViews() {
      if (leftContext && rightContext) {
        // 已创建过对比视图时只需要 resize 和刷新图层。
        leftContext.view.resize();
        rightContext.view.resize();
        refreshCompareLayers();
        return;
      }

      window.requestAnimationFrame(function () {
        // requestAnimationFrame 确保 compareShell 已经显示后再创建 MapView。
        leftContext = createMapContext("leftViewDiv", getCompareAlgorithmValue("left"), false);
        rightContext = createMapContext("rightViewDiv", getCompareAlgorithmValue("right"), false);
        leftContext.layers.consensusLayer.visible = isConsensusLayerToggleEnabled();
        rightContext.layers.consensusLayer.visible = isConsensusLayerToggleEnabled();
        refreshCompareLayers();
        syncViews(leftContext.view, rightContext.view);
      });
    }

    // 通过 activeSyncSource 防止左视图更新右视图后，右视图又反过来触发一次同步。
    // 同时用 60ms 延迟合并连续拖动事件，降低 goTo 调用频率。
    function syncViews(leftViewRef, rightViewRef) {
      // relay 把 source 当前视角复制到 target。
      function relay(source, target) {
        if (activeSyncSource && activeSyncSource !== source) {
          return;
        }
        activeSyncSource = source;
        window.clearTimeout(viewSyncTimer);
        viewSyncTimer = window.setTimeout(function () {
          target.goTo({
            center: source.center,
            scale: source.scale,
            rotation: source.rotation
          }, { animate: false }).finally(function () {
            activeSyncSource = null;
          });
        }, 60);
      }

      // 同步中心、比例尺和旋转角，保证两侧空间位置一致。
      ["center", "scale", "rotation"].forEach(function (propertyName) {
        leftViewRef.watch(propertyName, function () {
          relay(leftViewRef, rightViewRef);
        });
        rightViewRef.watch(propertyName, function () {
          relay(rightViewRef, leftViewRef);
        });
      });
    }

    // 在演示分类规则中寻找离点击点最近的一条规则，用于服务不可用时兜底。
    function findNearestRule(mapPoint) {
      const geographicPoint = asGeographic(mapPoint);
      let nearest = demo.demoClassificationRules[0];
      let nearestDistance = Number.POSITIVE_INFINITY;
      demo.demoClassificationRules.forEach(function (rule) {
        // 使用经纬度差值的欧式距离做近似匹配，足够用于演示兜底。
        const dx = rule.center[0] - geographicPoint.longitude;
        const dy = rule.center[1] - geographicPoint.latitude;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < nearestDistance) {
          nearest = rule;
          nearestDistance = distance;
        }
      });
      return nearest;
    }

    // 转义查询结果中的普通文本，避免属性值被当成 HTML 注入到结果面板。
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, function (character) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "\"": "&quot;",
          "'": "&#39;"
        }[character];
      });
    }

    // 把多行查询结果写入右侧结果面板；允许少量受控 html 行用于标题。
    function renderQueryLines(lines) {
      nodes.resultPanel.innerHTML = lines.map(function (line) {
        if (line.html) {
          return line.html;
        }
        return escapeHtml(line);
      }).join("<br>");
    }

    // 把查询/分析结果渲染成表格，字段列由 fieldDefinitions 控制。
    function renderResultTable(title, rows, fieldDefinitions, extraLines) {
      let html = "<div class=\"result-title\">" + escapeHtml(title) + "</div>";
      if (extraLines && extraLines.length) {
        html += "<div>" + extraLines.map(escapeHtml).join("<br>") + "</div>";
      }

      if (!rows.length) {
        // 没有命中时仍更新面板，明确告诉用户查询已执行。
        html += "<div>未找到符合条件的要素。</div>";
        nodes.resultPanel.innerHTML = html;
        return;
      }

      // 先输出表头，再按字段定义逐列输出属性值。
      html += "<table class=\"result-table\"><thead><tr>";
      fieldDefinitions.forEach(function (field) {
        html += "<th>" + escapeHtml(field.label) + "</th>";
      });
      html += "</tr></thead><tbody>";

      rows.forEach(function (row) {
        html += "<tr>";
        fieldDefinitions.forEach(function (field) {
          html += "<td>" + escapeHtml(row[field.name] == null ? "-" : row[field.name]) + "</td>";
        });
        html += "</tr>";
      });

      html += "</tbody></table>";
      nodes.resultPanel.innerHTML = html;
    }

    // 根据当前结果模式，返回真实服务中应 Identify 的子图层 id。
    function getActiveServiceLayerId(algorithmKey) {
      const service = getAlgorithmServiceConfig(algorithmKey);
      if (!service) {
        return null;
      }
      return state.resultMode === "citrus" ? service.citrusLayerId : service.fullLayerId;
    }

    // 根据当前结果模式，返回像元值到中文类别名称的映射表。
    function getActiveServiceValueClassMap(algorithmKey) {
      const service = getAlgorithmServiceConfig(algorithmKey);
      if (!service || !service.valueClasses) {
        return {};
      }
      const modeKey = state.resultMode === "citrus" ? "citrus" : "full";
      return service.valueClasses[modeKey] || {};
    }

    // 统一服务返回的像元值格式，把空值和 NoData 规范成同一个字符串。
    function normalizeRasterPixelValue(value) {
      if (value === undefined || value === null) {
        return "NoData";
      }
      const rawValue = String(value).trim();
      if (!rawValue || rawValue.toLowerCase() === "nodata") {
        return "NoData";
      }
      const numericValue = Number(rawValue);
      if (Number.isFinite(numericValue) && Math.floor(numericValue) === numericValue) {
        // 整数像元值统一转成字符串，方便和 config.valueClasses 的 key 对齐。
        return String(numericValue);
      }
      return rawValue;
    }

    // Identify 结果在不同服务中可能把属性放在不同字段，统一收集候选属性对象。
    function getIdentifyAttributeSources(identifyResult) {
      const sources = [];
      if (identifyResult && identifyResult.attributes) {
        sources.push(identifyResult.attributes);
      }
      const featureAttributes = identifyResult && identifyResult.feature && identifyResult.feature.attributes;
      if (featureAttributes) {
        sources.push(featureAttributes);
      }
      return sources;
    }

    // 从 Identify 结果中提取栅格像元值，兼容多种 ArcGIS Server 字段命名。
    function extractRasterPixelValue(identifyResult) {
      const candidateNames = [
        "像素值",
        "Pixel Value",
        "pixel value",
        "Value",
        "VALUE",
        "Raster.Value",
        "Stretch.Pixel Value",
        "ClassName"
      ];

      // 逐个候选字段、逐个属性来源查找第一个可用值。
      for (let index = 0; index < candidateNames.length; index += 1) {
        const fieldName = candidateNames[index];
        const attributeSources = getIdentifyAttributeSources(identifyResult);
        for (let sourceIndex = 0; sourceIndex < attributeSources.length; sourceIndex += 1) {
          const attributes = attributeSources[sourceIndex];
          if (attributes[fieldName] !== undefined && attributes[fieldName] !== null) {
            return attributes[fieldName];
          }
        }
      }

      // 部分 Identify 结果直接把值放在 result.value 上。
      if (identifyResult && identifyResult.value !== undefined && identifyResult.value !== null) {
        return identifyResult.value;
      }
      return null;
    }

    // 把真实服务像元值转换成结果面板可展示的分类对象。
    function classifyServicePixelValue(pixelValue, algorithmKey) {
      const valueKey = normalizeRasterPixelValue(pixelValue);
      const classMap = getActiveServiceValueClassMap(algorithmKey);
      const className = classMap[valueKey] || (valueKey === "NoData" ? "无数据/未识别" : "未知类别");
      return {
        value: valueKey,
        className: className
      };
    }

    // 从 IdentifyTask 响应中找到指定子图层的结果。
    function findIdentifyResultForLayer(response, layerId) {
      const results = response && response.results ? response.results : [];
      return results.find(function (result) {
        return Number(result.layerId) === Number(layerId);
      }) || null;
    }

    // 演示点查询只在真实服务不可用时使用，按最近规则点返回一个近似分类结果。
    function runDemoPointQuery(mapPoint) {
      const geographicPoint = asGeographic(mapPoint);
      // 根据点击点找最近的演示规则，再取当前算法对应的分类。
      const demoRule = findNearestRule(mapPoint);
      const currentClass = demoRule.classes[state.algorithm] || "-";
      renderQueryLines([
        { html: "<strong>当前位置</strong>" },
        "经度：" + geographicPoint.longitude.toFixed(5),
        "纬度：" + geographicPoint.latitude.toFixed(5),
        "当前算法：" + getAlgorithmInfo(state.algorithm).label,
        "分类结果：" + currentClass,
        "所在区县：" + demoRule.county,
        "数据来源：演示规则（当前算法真实服务暂不可用）"
      ]);
      setStatus(nodes.queryStatus, "查询状态：已完成演示点查询", false);
    }

    // 真实栅格点查询走 ArcGIS Server IdentifyTask。
    // 这里不是查矢量要素，而是读取当前位置在指定子图层上的像元值。
    function runServicePointQuery(algorithmKey, mapPoint) {
      const service = getAlgorithmServiceConfig(algorithmKey);
      const task = identifyTasks[algorithmKey];
      const algorithmLabel = getAlgorithmInfo(algorithmKey).label;
      const geographicPoint = asGeographic(mapPoint);

      if (!service || state.serviceAvailability[algorithmKey] === false || !task) {
        // 服务配置不存在、已失败或 IdentifyTask 不存在时，直接在结果面板说明不可查询。
        renderQueryLines([
          { html: "<strong>当前位置</strong>" },
          "经度：" + geographicPoint.longitude.toFixed(5),
          "纬度：" + geographicPoint.latitude.toFixed(5),
          "当前算法：" + algorithmLabel,
          "分类结果：真实服务不可用，无法读取栅格像元值"
        ]);
        setStatus(nodes.queryStatus, "查询状态：真实服务不可用", true);
        return;
      }

      // layerIds 只查当前结果模式对应的子图层，避免四分类和柑橘专用层互相干扰。
      const targetLayerId = getActiveServiceLayerId(algorithmKey);
      const params = new IdentifyParameters();
      params.geometry = mapPoint;
      params.mapExtent = mainView.extent;
      params.spatialReference = mainView.spatialReference;
      params.width = mainView.width;
      params.height = mainView.height;
      params.tolerance = 6;
      params.returnGeometry = false;
      params.layerOption = "all";
      params.layerIds = [targetLayerId];

      setStatus(nodes.queryStatus, "查询状态：正在读取真实栅格像元值", false);

      // 执行 IdentifyTask 后，只读取目标子图层返回的像元结果。
      task.execute(params).then(function (response) {
        const result = findIdentifyResultForLayer(response, targetLayerId);
        const modeLabel = state.resultMode === "citrus" ? "仅柑橘" : "四分类";
        if (!result) {
          // 服务正常响应但当前位置没有像元结果时，按无数据处理。
          renderQueryLines([
            { html: "<strong>当前位置</strong>" },
            "经度：" + geographicPoint.longitude.toFixed(5),
            "纬度：" + geographicPoint.latitude.toFixed(5),
            "当前算法：" + algorithmLabel,
            "结果模式：" + modeLabel,
            "查询图层：" + service.name + " / Layer " + targetLayerId,
            "分类结果：未识别/无数据"
          ]);
          setStatus(nodes.queryStatus, "查询状态：真实栅格未返回该位置结果", true);
          return;
        }

        // 真实服务返回的是像元值，需要再映射成系统里的中文分类名称。
        const classification = classifyServicePixelValue(extractRasterPixelValue(result), algorithmKey);
        renderQueryLines([
          { html: "<strong>当前位置</strong>" },
          "经度：" + geographicPoint.longitude.toFixed(5),
          "纬度：" + geographicPoint.latitude.toFixed(5),
          "当前算法：" + algorithmLabel,
          "结果模式：" + modeLabel,
          "查询图层：" + service.name + " / Layer " + targetLayerId,
          "像元值：" + classification.value,
          "分类结果：" + classification.className
        ]);
        setStatus(nodes.queryStatus, "查询状态：已完成真实栅格点查询", false);
      }).catch(function (error) {
        // IdentifyTask 异常说明真实服务查询失败，这里不再降级到演示规则，避免混淆真实结果。
        console.warn("IdentifyTask 查询失败", error);
        renderQueryLines([
          { html: "<strong>当前位置</strong>" },
          "经度：" + geographicPoint.longitude.toFixed(5),
          "纬度：" + geographicPoint.latitude.toFixed(5),
          "当前算法：" + algorithmLabel,
          "分类结果：真实服务查询失败，未使用演示规则兜底"
        ]);
        setStatus(nodes.queryStatus, "查询状态：真实服务查询失败", true);
      });
    }

    // 将一个几何对象添加到高亮图层，并根据几何类型选择高亮符号。
    function highlightGraphicGeometry(geometry) {
      if (!geometry) {
        return;
      }
      let symbol = highlightPolygonSymbol;
      // 默认按面符号处理，点和线分别切换到对应符号。
      if (geometry.type === "point") {
        symbol = highlightPointSymbol;
      } else if (geometry.type === "polyline") {
        symbol = highlightLineSymbol;
      }
      mainLayers.highlightLayer.add(new Graphic({
        geometry: geometry,
        symbol: symbol
      }));
    }

    // 清空旧高亮后，把一组要素的几何全部高亮出来。
    function highlightFeatureGraphics(graphics) {
      mainLayers.highlightLayer.removeAll();
      graphics.forEach(function (graphic) {
        highlightGraphicGeometry(graphic.geometry);
      });
    }

    // 将 Graphic 数组转换成结果表格，表格字段来自图层配置和额外字段。
    function renderGraphicResults(title, layerConfig, graphics, extraLines, extraFields) {
      const fields = (layerConfig.queryFields || []).slice();
      (extraFields || []).forEach(function (field) {
        fields.push(field);
      });
      // renderResultTable 只关心普通对象行，因此这里取出 Graphic.attributes。
      const rows = graphics.map(function (graphic) {
        return graphic.attributes;
      });
      renderResultTable(title, rows, fields, extraLines);
    }

    // 为演示数据源补充说明文字；真实数据源不额外标注。
    function getOperationSourceNote(layerConfig, operationType) {
      if (layerConfig && layerConfig.sourceType === "demo") {
        return "（演示" + operationType + "）";
      }
      return "";
    }

    // 在当前活动矢量图层中执行点选查询。
    function runVectorPointQuery(event) {
      const entry = getActiveVectorEntry();
      if (!entry) {
        setStatus(nodes.queryStatus, "查询状态：当前没有可用的活动矢量图层", true);
        return;
      }
      if (!entry.layer.visible) {
        setStatus(nodes.queryStatus, "查询状态：请先显示活动矢量图层", true);
        return;
      }
      if (entry.config.sourceType === "geojson" && entry.loadStatus !== "loaded") {
        setStatus(nodes.queryStatus, "查询状态：正在加载 " + entry.config.label + "，加载完成后继续点查", false);
        // 数据没加载完时先等待加载，然后用原始点击事件重新执行点查。
        ensureVectorEntryReady(entry).then(function () {
          runVectorPointQuery(event);
        }).catch(function () {});
        return;
      }

      setStatus(nodes.queryStatus, "查询状态：正在执行矢量点查询", false);
      mainView.hitTest(event).then(function (response) {
        // hitTest 会返回多个命中结果，这里只保留来自当前活动图层的 Graphic。
        const results = response.results.filter(function (result) {
          return result.graphic && result.graphic.layer === entry.layer;
        });

        if (!results.length) {
          // 没命中时清空高亮，并输出空表结果。
          mainLayers.highlightLayer.removeAll();
          renderResultTable(
            "矢量点查询",
            [],
            entry.config.queryFields || [],
            ["活动图层：" + entry.config.label, "数据来源：" + entry.config.sourceLabel]
          );
          setStatus(nodes.queryStatus, "查询状态：未命中活动矢量要素", true);
          return;
        }

        // 命中多个要素时取第一个作为点查结果，并同步高亮。
        const graphic = results[0].graphic;
        highlightFeatureGraphics([graphic]);
        renderGraphicResults(
          "矢量点查询",
          entry.config,
          [graphic],
          ["活动图层：" + entry.config.label, "数据来源：" + entry.config.sourceLabel + getOperationSourceNote(entry.config, "查询")]
        );
        setStatus(nodes.queryStatus, "查询状态：已完成矢量点查询", false);
      });
    }

    // 点击查询总入口：
    // - 目标是矢量时，查活动矢量图层
    // - 目标是分类结果时，优先查真实服务，否则回落到演示规则
    function runPointQuery(event) {
      if (nodes.queryTargetSelect && nodes.queryTargetSelect.value === "vector") {
        // 下拉框选择“活动矢量图层”时，点查不走分类栅格服务。
        runVectorPointQuery(event);
        return;
      }

      // 分类点查先把点击位置画到高亮层，给用户明确的空间反馈。
      mainLayers.highlightLayer.removeAll();
      mainLayers.highlightLayer.add(new Graphic({
        geometry: event.mapPoint,
        symbol: pointSymbol
      }));

      if (hasAlgorithmService(state.algorithm)) {
        // 当前算法配置了真实服务时，优先读取服务像元值。
        runServicePointQuery(state.algorithm, event.mapPoint);
        return;
      }

      // 没有真实服务时，用演示规则返回近似分类结果。
      runDemoPointQuery(event.mapPoint);
    }

    // 范围查询只针对当前活动矢量图层。
    // 用户画出的矩形/圆/多边形与图层中的每个要素做 intersects 判断。
    function runGeometrySelectionQuery(geometry, shapeType) {
      const entry = getActiveVectorEntry();
      if (!entry) {
        setStatus(nodes.queryStatus, "查询状态：当前没有可用的活动矢量图层", true);
        return;
      }
      if (!entry.layer.visible) {
        setStatus(nodes.queryStatus, "查询状态：请先显示活动矢量图层", true);
        return;
      }
      if (entry.config.sourceType === "geojson" && entry.loadStatus !== "loaded") {
        setStatus(nodes.queryStatus, "查询状态：正在加载 " + entry.config.label + "，加载完成后继续范围查询", false);
        // GeoJSON 图层支持按需加载，首次查询时如果还没准备好，就先加载再递归重试本次查询。
        ensureVectorEntryReady(entry).then(function () {
          runGeometrySelectionQuery(geometry, shapeType);
        }).catch(function () {});
        return;
      }

      // 只要与查询范围相交就算命中，不要求完全落在范围内。
      const matched = entry.layer.graphics.toArray().filter(function (graphic) {
        return geometryEngine.intersects(geometry, graphic.geometry);
      });

      highlightFeatureGraphics(matched);
      highlightGraphicGeometry(geometry);

      // shapeType 是 SketchViewModel 的几何类型，转换成结果面板显示用中文。
      const shapeLabel = {
        rectangle: "矩形",
        circle: "圆形",
        polygon: "多边形"
      }[shapeType] || "范围";

      renderGraphicResults(
        shapeLabel + "范围查询",
        entry.config,
        matched,
        ["活动图层：" + entry.config.label, "说明：仅对矢量图层执行范围查询"]
      );
      setStatus(nodes.queryStatus, "查询状态：" + shapeLabel + "范围查询命中 " + matched.length + " 个要素", false);
    }

    // 根据字段类型和操作符判断一个属性值是否满足查询条件。
    function compareAttributeValue(value, operator, keyword, fieldType) {
      if (fieldType === "number") {
        // 数值字段先转 Number，无法转成有效数字时不匹配。
        const numericValue = Number(value);
        const numericKeyword = Number(keyword);
        if (!Number.isFinite(numericValue) || !Number.isFinite(numericKeyword)) {
          return false;
        }
        if (operator === "greaterThan") {
          return numericValue > numericKeyword;
        }
        if (operator === "lessThan") {
          return numericValue < numericKeyword;
        }
        return numericValue === numericKeyword;
      }

      // 字符串字段统一转小写，做不区分大小写的比较。
      const normalizedValue = String(value == null ? "" : value).toLowerCase();
      const normalizedKeyword = String(keyword == null ? "" : keyword).toLowerCase();
      if (operator === "equals") {
        return normalizedValue === normalizedKeyword;
      }
      if (operator === "startsWith") {
        return normalizedValue.indexOf(normalizedKeyword) === 0;
      }
      return normalizedValue.indexOf(normalizedKeyword) > -1;
    }

    // 根据当前活动矢量图层，刷新标注字段、属性查询字段和渲染模式控件。
    function renderQueryFieldOptions() {
      const entry = getActiveVectorEntry();
      if (!entry) {
        return;
      }

      // 尽量保留用户之前选中的标注字段。
      const labelField = nodes.vectorLabelFieldSelect.value;
      nodes.vectorLabelFieldSelect.innerHTML = "";
      (entry.config.labelFields || []).forEach(function (field) {
        const option = document.createElement("option");
        option.value = field.name;
        option.textContent = field.label;
        if (!labelField || labelField === field.name) {
          option.selected = true;
        }
        nodes.vectorLabelFieldSelect.appendChild(option);
      });

      // 尽量保留用户之前选中的属性查询字段。
      const queryField = nodes.attributeFieldSelect.value;
      nodes.attributeFieldSelect.innerHTML = "";
      (entry.config.queryFields || []).forEach(function (field) {
        const option = document.createElement("option");
        option.value = field.name;
        option.textContent = field.label;
        if (!queryField || queryField === field.name) {
          option.selected = true;
        }
        nodes.attributeFieldSelect.appendChild(option);
      });

      nodes.vectorRendererSelect.value = entry.rendererMode;
      refreshVectorLabels();
      renderLegend();
    }

    // 对当前活动矢量图层执行属性查询。
    function runAttributeQuery() {
      const entry = getActiveVectorEntry();
      if (!entry) {
        setStatus(nodes.queryStatus, "查询状态：当前没有可用的活动矢量图层", true);
        return;
      }
      if (entry.config.sourceType === "geojson" && entry.loadStatus !== "loaded") {
        setStatus(nodes.queryStatus, "查询状态：正在加载 " + entry.config.label + "，加载完成后继续属性查询", false);
        // GeoJSON 还没加载完时，加载完成后重新执行同一个属性查询。
        ensureVectorEntryReady(entry).then(runAttributeQuery).catch(function () {});
        return;
      }

      // 从界面读取字段、操作符和用户输入值。
      const fieldName = nodes.attributeFieldSelect.value;
      const operator = nodes.attributeOperatorSelect.value;
      const keyword = nodes.attributeKeyword.value.trim();
      if (!fieldName || !keyword) {
        setStatus(nodes.queryStatus, "查询状态：请输入属性查询条件", true);
        return;
      }

      // 根据字段定义决定按数值还是字符串比较。
      const field = getFieldDefinition(entry.config, fieldName) || { type: "string", name: fieldName, label: fieldName };
      const matched = entry.layer.graphics.toArray().filter(function (graphic) {
        return compareAttributeValue(graphic.attributes[fieldName], operator, keyword, field.type);
      });

      // 查询命中结果同时体现在地图高亮和右侧结果表格中。
      highlightFeatureGraphics(matched);
      renderGraphicResults(
        "属性查询",
        entry.config,
        matched,
        ["活动图层：" + entry.config.label, "字段：" + field.label + "，条件：" + operator + "，值：" + keyword]
      );
      setStatus(nodes.queryStatus, "查询状态：属性查询命中 " + matched.length + " 个要素", false);
    }

    // 读取空间分析目标图层；没有目标时统一给出状态提示。
    function getAnalysisTargetOrWarn() {
      const entry = getSpatialTargetEntry();
      if (!entry) {
        setStatus(nodes.queryStatus, "查询状态：当前没有可用的空间分析目标图层", true);
        return null;
      }
      return entry;
    }

    // 缓冲区查询以一个点为输入，再根据用户填写的距离构造实际查询范围。
    function runBufferAnalysis(geometry) {
      const targetEntry = getAnalysisTargetOrWarn();
      if (!targetEntry) {
        return;
      }
      if (targetEntry.config.sourceType === "geojson" && targetEntry.loadStatus !== "loaded") {
        setStatus(nodes.queryStatus, "查询状态：正在加载 " + targetEntry.config.label + "，加载完成后继续缓冲区查询", false);
        // 目标数据尚未加载完成时，先完成加载，再用同一个参数重新执行缓冲区查询。
        ensureVectorEntryReady(targetEntry).then(function () {
          runBufferAnalysis(geometry);
        }).catch(function () {});
        return;
      }
      // 使用 geodesicBuffer 按米构造测地缓冲区，更符合真实地理距离语义。
      const distance = Number(nodes.bufferDistanceInput.value) || config.spatialDefaults.bufferDistanceMeters;
      const bufferGeometry = geometryEngine.geodesicBuffer(geometry, distance, "meters");
      // 缓冲区查询用相交关系判断命中，不要求要素完全落入缓冲区。
      const matched = targetEntry.layer.graphics.toArray().filter(function (graphic) {
        return geometryEngine.intersects(bufferGeometry, graphic.geometry);
      });

      // 同时高亮命中要素和生成的缓冲区面。
      highlightFeatureGraphics(matched);
      highlightGraphicGeometry(bufferGeometry);
      renderGraphicResults(
        "缓冲区查询",
        targetEntry.config,
        matched,
        [
          "目标图层：" + targetEntry.config.label,
          "缓冲距离：" + distance + " 米",
          "说明：" + targetEntry.config.sourceLabel + getOperationSourceNote(targetEntry.config, "分析")
        ]
      );
      setStatus(nodes.queryStatus, "查询状态：缓冲区查询命中 " + matched.length + " 个要素", false);
    }

    // 对用户绘制的几何和目标图层执行相交查询。
    function runIntersectAnalysis(geometry) {
      const targetEntry = getAnalysisTargetOrWarn();
      if (!targetEntry) {
        return;
      }
      if (targetEntry.config.sourceType === "geojson" && targetEntry.loadStatus !== "loaded") {
        setStatus(nodes.queryStatus, "查询状态：正在加载 " + targetEntry.config.label + "，加载完成后继续相交查询", false);
        // 数据未加载完成时，加载后用原几何继续相交查询。
        ensureVectorEntryReady(targetEntry).then(function () {
          runIntersectAnalysis(geometry);
        }).catch(function () {});
        return;
      }
      // 遍历目标图层，筛选与绘制范围相交的要素。
      const matched = targetEntry.layer.graphics.toArray().filter(function (graphic) {
        return geometryEngine.intersects(geometry, graphic.geometry);
      });

      // 高亮命中要素和用户绘制的相交范围。
      highlightFeatureGraphics(matched);
      highlightGraphicGeometry(geometry);
      renderGraphicResults(
        "相交查询",
        targetEntry.config,
        matched,
        ["目标图层：" + targetEntry.config.label, "说明：" + targetEntry.config.sourceLabel + getOperationSourceNote(targetEntry.config, "分析")]
      );
      setStatus(nodes.queryStatus, "查询状态：相交查询命中 " + matched.length + " 个要素", false);
    }

    // 对目标图层执行裁剪分析，并把裁剪后的几何高亮显示。
    function runClipAnalysis(geometry) {
      const targetEntry = getAnalysisTargetOrWarn();
      if (!targetEntry) {
        return;
      }
      if (targetEntry.config.sourceType === "geojson" && targetEntry.loadStatus !== "loaded") {
        setStatus(nodes.queryStatus, "查询状态：正在加载 " + targetEntry.config.label + "，加载完成后继续裁剪分析", false);
        // 数据未加载完成时，加载后用原几何继续裁剪分析。
        ensureVectorEntryReady(targetEntry).then(function () {
          runClipAnalysis(geometry);
        }).catch(function () {});
        return;
      }

      const rows = [];
      mainLayers.highlightLayer.removeAll();
      // 逐个检查目标要素，只有与裁剪范围相交的要素才继续求裁剪结果。
      targetEntry.layer.graphics.forEach(function (graphic) {
        if (!geometryEngine.intersects(geometry, graphic.geometry)) {
          return;
        }
        let clippedGeometry = null;
        if (graphic.geometry.type === "point") {
          // 点要素没有可裁剪面积，只判断是否被裁剪范围包含。
          clippedGeometry = geometryEngine.contains(geometry, graphic.geometry) ? graphic.geometry : null;
        } else {
          // 线和面使用 geometryEngine.intersect 得到真正落在范围内的几何。
          clippedGeometry = geometryEngine.intersect(graphic.geometry, geometry);
        }
        if (clippedGeometry) {
          rows.push(Object.assign({}, graphic.attributes));
          highlightGraphicGeometry(clippedGeometry);
        }
      });
      // 同时高亮用户绘制的裁剪范围，便于看出分析边界。
      highlightGraphicGeometry(geometry);

      renderResultTable(
        "裁剪分析",
        rows,
        targetEntry.config.queryFields || [],
        ["目标图层：" + targetEntry.config.label, "说明：" + targetEntry.config.sourceLabel + getOperationSourceNote(targetEntry.config, "分析")]
      );
      setStatus(nodes.queryStatus, "查询状态：裁剪分析生成 " + rows.length + " 条结果", false);
    }

    // 计算用户点击/绘制起点到目标图层要素的距离，并展示最近若干条。
    function runDistanceStats(geometry) {
      const targetEntry = getAnalysisTargetOrWarn();
      if (!targetEntry) {
        return;
      }
      if (targetEntry.config.sourceType === "geojson" && targetEntry.loadStatus !== "loaded") {
        setStatus(nodes.queryStatus, "查询状态：正在加载 " + targetEntry.config.label + "，加载完成后继续距离统计", false);
        // 数据未加载完成时，加载后用原几何继续距离统计。
        ensureVectorEntryReady(targetEntry).then(function () {
          runDistanceStats(geometry);
        }).catch(function () {});
        return;
      }

      const limit = config.spatialDefaults.distanceResultLimit || 5;
      // 先计算每个要素到输入几何的距离，再过滤无效距离、升序排序、截取前 limit 条。
      const rows = targetEntry.layer.graphics.toArray().map(function (graphic) {
        return {
          graphic: graphic,
          distanceMeters: geometryEngine.distance(geometry, graphic.geometry, "meters")
        };
      }).filter(function (item) {
        return Number.isFinite(item.distanceMeters);
      }).sort(function (a, b) {
        return a.distanceMeters - b.distanceMeters;
      }).slice(0, limit);

      // 高亮起点和最近的若干目标要素。
      mainLayers.highlightLayer.removeAll();
      highlightGraphicGeometry(geometry);
      rows.forEach(function (item) {
        highlightGraphicGeometry(item.graphic.geometry);
      });

      renderResultTable(
        "距离统计",
        rows.map(function (item) {
          // 结果行在原属性基础上追加 distanceMeters 字段。
          return Object.assign({}, item.graphic.attributes, {
            distanceMeters: item.distanceMeters.toFixed(0)
          });
        }),
        (targetEntry.config.queryFields || []).concat([{ name: "distanceMeters", label: "距离(米)", type: "number" }]),
        ["目标图层：" + targetEntry.config.label, "说明：距离统计结果按最近 " + rows.length + " 条展示"]
      );
      setStatus(nodes.queryStatus, "查询状态：已完成距离统计", false);
    }

    // SketchViewModel 是绘图与几何输入的统一入口：
    // 普通绘图、范围查询、缓冲区、相交、裁剪、距离统计都从这里收集几何。
    function initSketchTools() {
      // SketchViewModel 绑定主视图和绘制图层，用户画出的图形会进入 drawLayer。
      sketchVM = new SketchViewModel({
        view: mainView,
        layer: mainLayers.drawLayer,
        pointSymbol: pointSymbol,
        polylineSymbol: lineSymbol,
        polygonSymbol: polygonDrawSymbol
      });

      sketchVM.on("create", function (event) {
        // create 事件会经历 start/active/complete，只在 complete 时处理最终几何。
        if (event.state !== "complete") {
          return;
        }

        // 根据实际几何类型修正符号，保证手工绘制和查询输入样式一致。
        if (event.graphic.geometry.type === "point") {
          event.graphic.symbol = pointSymbol;
        }
        if (event.graphic.geometry.type === "polyline") {
          event.graphic.symbol = lineSymbol;
        }
        if (event.graphic.geometry.type === "polygon" || event.graphic.geometry.type === "extent") {
          event.graphic.symbol = polygonDrawSymbol;
        }

        // 没有待处理动作时，说明这次只是普通手工绘制，不需要触发后续分析。
        if (!state.pendingSketchAction) {
          setStatus(nodes.queryStatus, "查询状态：已完成图元绘制", false);
          return;
        }

        // 这里根据 pendingSketchAction 把“画完图形”分发成不同业务动作。
        const action = state.pendingSketchAction;
        state.pendingSketchAction = null;
        if (action.type === "selection") {
          runGeometrySelectionQuery(event.graphic.geometry, action.shapeType);
          return;
        }
        if (action.type === "buffer") {
          runBufferAnalysis(event.graphic.geometry);
          return;
        }
        if (action.type === "intersect") {
          runIntersectAnalysis(event.graphic.geometry);
          return;
        }
        if (action.type === "clip") {
          runClipAnalysis(event.graphic.geometry);
          return;
        }
        if (action.type === "distance") {
          runDistanceStats(event.graphic.geometry);
        }
      });
    }

    // 渲染学生/课程/成绩表格；该功能用于非地理 WebService 数据展示。
    function renderStudentTable(rows, sourceName) {
      if (!nodes.studentBody) {
        return;
      }
      nodes.studentBody.innerHTML = "";
      // 兼容不同接口字段名：name/studentName、course/courseName、score/grade。
      rows.forEach(function (rowData) {
        const row = document.createElement("tr");
        row.innerHTML =
          "<td>" + (rowData.name || rowData.studentName || "-") + "</td>" +
          "<td>" + (rowData.course || rowData.courseName || "-") + "</td>" +
          "<td>" + (rowData.score || rowData.grade || "-") + "</td>";
        nodes.studentBody.appendChild(row);
      });
      setStatus(nodes.queryStatus, "非地理数据：已从 " + sourceName + " 加载 " + rows.length + " 条记录", false);
    }

    // 把不同接口返回形态统一转换成数组。
    function normalizeStudentResponse(json) {
      if (Array.isArray(json)) {
        return json;
      }
      if (json && Array.isArray(json.data)) {
        return json.data;
      }
      if (json && Array.isArray(json.students)) {
        return json.students;
      }
      return [];
    }

    // 从 WebService 加载学生数据；失败时使用内置示例数据兜底。
    function loadStudentRows() {
      fetch(config.studentServiceUrl)
        .then(function (response) {
          if (!response.ok) {
            throw new Error("HTTP " + response.status);
          }
          return response.json();
        })
        .then(function (json) {
          const rows = normalizeStudentResponse(json);
          renderStudentTable(rows, "WebService");
        })
        .catch(function (error) {
          // 非地理服务不可用不影响地图功能，直接降级到 demo.studentRows。
          console.warn("WebService 不可用，使用内置示例数据。", error);
          renderStudentTable(demo.studentRows, "内置示例数据");
        });
    }

    // 渲染打印/导出面板按钮。
    function renderExportPanel() {
      if (!nodes.printPanel) {
        return;
      }

      nodes.printPanel.innerHTML =
        "<p class=\"muted\">支持导出当前地图 PNG，并使用浏览器打印版式输出地图、图例和统计信息。</p>" +
        "<button type=\"button\" id=\"btnExportPng\" class=\"primary-button full-width\">导出当前地图 PNG</button>" +
        "<button type=\"button\" id=\"btnPrintLayout\" class=\"ghost-button full-width\">打印当前版式</button>";
    }

    // 生成导出文件名使用的时间戳，格式为 yyyyMMddHHmmss。
    function buildExportTimestamp() {
      const now = new Date();
      return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0")
      ].join("");
    }

    // 调用 MapView.takeScreenshot 导出当前主图 PNG。
    function downloadCurrentMapPng() {
      if (!mainView) {
        setStatus(nodes.queryStatus, "导出状态：地图视图尚未初始化", true);
        return;
      }

      setStatus(nodes.queryStatus, "导出状态：正在生成 PNG 截图", false);
      mainView.takeScreenshot({
        format: "png",
        // 宽高放大 2 倍，提高导出图片清晰度。
        width: Math.round(mainView.width * 2),
        height: Math.round(mainView.height * 2)
      }).then(function (screenshot) {
        // 通过临时 a 标签触发浏览器下载。
        const link = document.createElement("a");
        link.href = screenshot.dataUrl;
        link.download = "nanchong_citrus_map_" + buildExportTimestamp() + ".png";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setStatus(nodes.queryStatus, "导出状态：PNG 已生成并开始下载", false);
      }).catch(function (error) {
        console.warn("地图 PNG 导出失败", error);
        setStatus(nodes.queryStatus, "导出状态：PNG 导出失败", true);
      });
    }

    // 打印布局切换后需要主动 resize 所有可见/可能可见的 MapView。
    function resizePrintableViews() {
      [mainView, overviewView, leftContext && leftContext.view, rightContext && rightContext.view].forEach(function (view) {
        if (view && typeof view.resize === "function") {
          view.resize();
        }
      });
    }

    // 进入打印布局：给 body 加样式类，并触发地图尺寸重算。
    function preparePrintLayout() {
      document.body.classList.add("is-printing-layout");
      resizePrintableViews();
    }

    // 离开打印布局：移除样式类，并在下一轮事件循环重算地图尺寸。
    function restorePrintLayout() {
      document.body.classList.remove("is-printing-layout");
      window.setTimeout(resizePrintableViews, 0);
    }

    // 等待打印布局中的地图高度稳定后再调用 window.print。
    function waitForPrintLayoutReady(callback, attempt) {
      const currentAttempt = attempt || 0;
      const mapNode = document.getElementById("mainViewDiv");
      const mapHeight = mapNode ? mapNode.getBoundingClientRect().height : 0;
      const viewHeight = mainView && typeof mainView.height === "number" ? mainView.height : mapHeight;
      const layoutReady = mapHeight >= 600 && Math.abs(viewHeight - mapHeight) <= 8;

      resizePrintableViews();
      if (layoutReady || currentAttempt >= 12) {
        // 留 120ms 给 ArcGIS 视图完成最后一次 resize。
        window.setTimeout(callback, 120);
        return;
      }

      // 布局未稳定时下一帧继续检测，最多尝试 12 次。
      window.requestAnimationFrame(function () {
        waitForPrintLayoutReady(callback, currentAttempt + 1);
      });
    }

    // 打印当前地图版式。
    function printCurrentLayout() {
      setStatus(nodes.queryStatus, "导出状态：正在打开浏览器打印版式", false);
      preparePrintLayout();
      waitForPrintLayoutReady(function () {
        resizePrintableViews();
        window.print();
      });
    }

    // 浏览器原生打印前后也会触发布局切换，保证直接 Ctrl+P 时版式一致。
    window.addEventListener("beforeprint", preparePrintLayout);
    window.addEventListener("afterprint", restorePrintLayout);

    // 渲染演示步骤列表；当前页面如果没有该容器则直接跳过。
    function renderPresentationSteps() {
      if (!nodes.presentationSteps) {
        return;
      }
      nodes.presentationSteps.innerHTML = "";
      demo.presentationSteps.forEach(function (step, index) {
        const li = document.createElement("li");
        li.textContent = step.title;
        li.title = step.description;
        li.onclick = function () {
          startPresentationStep(index);
        };
        nodes.presentationSteps.appendChild(li);
      });
    }

    // 执行某个演示步骤，自动切换视图、算法、对比模式或打印区域。
    function startPresentationStep(index) {
      const step = demo.presentationSteps[index];
      if (!step) {
        return;
      }

      state.activePresentationStep = index;
      if (nodes.presentationSteps) {
        // 同步演示步骤列表高亮。
        Array.prototype.forEach.call(nodes.presentationSteps.children, function (child, childIndex) {
          child.classList.toggle("is-active", childIndex === index);
        });
      }

      // 不同步骤通过 action 字段驱动不同地图行为。
      if (step.action === "studyArea" || step.action === "source") {
        setComparisonMode(false);
        mainView.goTo({ center: config.initialView.center, zoom: config.initialView.zoom }, { duration: 500 });
      } else if (step.action === "maximumLikelihood" || step.action === "maximumLikelihoodRemake" || step.action === "randomTrees" || step.action === "svm") {
        setComparisonMode(false);
        setAlgorithm(step.action);
      } else if (step.action === "compare") {
        if (nodes.leftAlgorithm) {
          nodes.leftAlgorithm.value = "maximumLikelihood";
        }
        if (nodes.rightAlgorithm) {
          nodes.rightAlgorithm.value = "randomTrees";
        }
        setComparisonMode(true);
      } else if (step.action === "stats") {
        setComparisonMode(false);
        updateAlgorithmInfo();
      } else if (step.action === "print") {
        setComparisonMode(false);
        nodes.printPanel.scrollIntoView({ block: "nearest" });
      }

      // 同时把当前演示步骤说明写入右侧结果面板。
      nodes.resultPanel.innerHTML = "<strong>" + step.title + "</strong><br>" + step.description;
    }

    // 渲染基础/专题矢量图层控制列表。
    function renderAssessmentLayerControls() {
      if (!nodes.assessmentLayerList || !mainLayers) {
        return;
      }
      nodes.assessmentLayerList.innerHTML = "";
      Object.keys(mainLayers.assessmentLayers).forEach(function (layerId) {
        const entry = mainLayers.assessmentLayers[layerId];
        const row = document.createElement("div");
        row.className = "layer-row";

        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = entry.layer.visible;
        checkbox.onchange = function () {
          // 勾选变化直接控制 GraphicsLayer 可见性，并刷新标注和图例。
          entry.layer.visible = checkbox.checked;
          refreshVectorLabels();
          renderLegend();
        };
        const text = document.createElement("span");
        text.textContent = entry.config.label;
        label.appendChild(checkbox);
        label.appendChild(text);

        const meta = document.createElement("div");
        meta.className = "layer-meta";
        // GeoJSON 图层额外显示加载状态或要素数量。
        const loadText = entry.config.sourceType === "geojson" ? " / " + (entry.loadStatus === "loaded" ? entry.layer.graphics.length + " 要素" : (entry.loadStatus || "待加载")) : "";
        meta.textContent = entry.config.sourceLabel + " / " + entry.config.geometryType + loadText;

        row.appendChild(label);
        row.appendChild(meta);
        nodes.assessmentLayerList.appendChild(row);
      });
    }

    // 渲染 DEM/地形服务图层控制列表。
    function renderDemLayerControls() {
      if (!nodes.demLayerList || !mainLayers) {
        return;
      }
      nodes.demLayerList.innerHTML = "";
      Object.keys(mainLayers.demLayers).forEach(function (layerId) {
        const entry = mainLayers.demLayers[layerId];
        const row = document.createElement("div");
        row.className = "layer-row";

        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = entry.layer.visible;
        checkbox.onchange = function () {
          // DEM 图层显隐只影响地图和图例，不参与矢量标注。
          entry.layer.visible = checkbox.checked;
          renderLegend();
        };
        const text = document.createElement("span");
        text.textContent = entry.config.label;
        label.appendChild(checkbox);
        label.appendChild(text);

        const meta = document.createElement("div");
        meta.className = "layer-meta";
        meta.textContent = entry.config.sourceLabel;

        row.appendChild(label);
        row.appendChild(meta);
        nodes.demLayerList.appendChild(row);
      });
    }

    // 渲染活动矢量图层下拉框和空间分析目标图层下拉框。
    function renderVectorLayerOptions() {
      if (!nodes.activeVectorLayerSelect || !nodes.spatialTargetLayerSelect) {
        return;
      }
      // 保留用户之前选择的空间分析目标图层。
      const previousTarget = nodes.spatialTargetLayerSelect.value;
      nodes.activeVectorLayerSelect.innerHTML = "";
      nodes.spatialTargetLayerSelect.innerHTML = "";

      assessmentData.assessmentLayers.forEach(function (layerConfig) {
        // 活动图层选项用于渲染、标注、属性查询和点/范围查询。
        const option = document.createElement("option");
        option.value = layerConfig.id;
        option.textContent = layerConfig.label;
        if (layerConfig.id === state.activeVectorLayerId) {
          option.selected = true;
        }
        nodes.activeVectorLayerSelect.appendChild(option);

        // 空间分析目标图层独立维护，允许分析目标不同于活动查询图层。
        const targetOption = document.createElement("option");
        targetOption.value = layerConfig.id;
        targetOption.textContent = layerConfig.label;
        if ((previousTarget && previousTarget === layerConfig.id) || (!previousTarget && layerConfig.id === state.activeVectorLayerId)) {
          targetOption.selected = true;
        }
        nodes.spatialTargetLayerSelect.appendChild(targetOption);
      });

      if (!state.activeVectorLayerId && assessmentData.assessmentLayers.length) {
        state.activeVectorLayerId = assessmentData.assessmentLayers[0].id;
      }
      renderQueryFieldOptions();
    }

    // 应用活动矢量图层的渲染模式变化。
    function applyVectorRenderer() {
      const entry = getActiveVectorEntry();
      if (!entry) {
        return;
      }
      entry.rendererMode = nodes.vectorRendererSelect.value;
      // 渲染模式变化需要重建 Graphic 符号，再刷新标注和图例。
      rebuildLayerGraphics(entry);
      refreshVectorLabels();
      renderLegend();
      setStatus(nodes.queryStatus, "查询状态：已更新活动矢量图层渲染模式", false);
    }

    // 把“先画图，再执行分析”封装成统一入口，避免每个按钮都重复写 Sketch 逻辑。
    function startSketchAction(actionType, shapeType, statusText) {
      if (!mainView || !sketchVM) {
        return;
      }
      // 几何输入类操作不属于点查模式，因此先退出 queryMode。
      state.queryMode = "idle";
      state.pendingSketchAction = {
        type: actionType,
        shapeType: shapeType
      };
      // 新动作开始前清空旧的绘制和高亮，避免多次分析结果叠在一起影响判断。
      mainLayers.drawLayer.removeAll();
      mainLayers.highlightLayer.removeAll();
      sketchVM.create(shapeType);
      setStatus(nodes.queryStatus, statusText, false);
    }

    // 所有界面事件都集中在这里绑定，便于梳理“按钮 -> 状态 -> 地图更新”的主链路。
    function bindUiEvents() {
      // 简化按钮绑定写法：控件不存在时静默跳过，兼容页面裁剪版本。
      function bindClick(id, handler) {
        const node = document.getElementById(id);
        if (node) {
          node.onclick = handler;
        }
      }

      nodes.basemapSelect.onchange = function () {
        const basemapId = nodes.basemapSelect.value;
        // 底图切换需要同步主图、鹰眼图和已创建的左右对比图。
        mainMap.basemap = createConfiguredBasemap(basemapId);
        ensureOperationalLayerOrder(mainMap, mainLayers);
        if (overviewView) {
          overviewView.map.basemap = createConfiguredBasemap(basemapId);
        }
        if (leftContext) {
          leftContext.map.basemap = createConfiguredBasemap(basemapId);
          ensureOperationalLayerOrder(leftContext.map, leftContext.layers);
        }
        if (rightContext) {
          rightContext.map.basemap = createConfiguredBasemap(basemapId);
          ensureOperationalLayerOrder(rightContext.map, rightContext.layers);
        }
      };

      nodes.algorithmSelect.onchange = function () {
        // 左侧算法下拉框和顶部算法按钮共用 setAlgorithm。
        setAlgorithm(nodes.algorithmSelect.value);
      };

      document.querySelectorAll(".method-tab").forEach(function (button) {
        button.onclick = function () {
          // 顶部算法 tab 使用 data-algorithm 保存算法 key。
          setAlgorithm(button.dataset.algorithm);
        };
      });

      document.querySelectorAll(".segmented button").forEach(function (button) {
        button.onclick = function () {
          // 结果模式按钮使用 data-mode 保存 full/citrus。
          setResultMode(button.dataset.mode);
        };
      });

      nodes.opacityRange.oninput = function () {
        // 透明度滑块用 input 事件实现拖动时实时刷新。
        setOpacity(nodes.opacityRange.value);
      };

      if (nodes.toggleServiceLayer) {
        nodes.toggleServiceLayer.onchange = function () {
          // 分类结果显隐变化需要同时刷新主图和左右对比图。
          refreshResultLayers(mainLayers, state.algorithm);
          refreshCompareLayers();
        };
      }

      if (nodes.activeVectorLayerSelect) {
        nodes.activeVectorLayerSelect.onchange = function () {
          // 活动图层改变后，字段选项、标注和后续查询目标都要跟着更新。
          state.activeVectorLayerId = nodes.activeVectorLayerSelect.value;
          renderQueryFieldOptions();
          refreshVectorLabels();
        };
      }

      if (nodes.vectorRendererSelect) {
        nodes.vectorRendererSelect.onchange = applyVectorRenderer;
      }

      if (nodes.toggleVectorLabels) {
        nodes.toggleVectorLabels.onchange = function () {
          // labelsEnabled 记录当前标注开关状态，实际图形由 refreshVectorLabels 重建。
          state.labelsEnabled = nodes.toggleVectorLabels.checked;
          refreshVectorLabels();
        };
      }

      if (nodes.vectorLabelFieldSelect) {
        nodes.vectorLabelFieldSelect.onchange = refreshVectorLabels;
      }

      bindClick("drawPoint", function () {
        // 普通绘点不设置 pendingSketchAction，画完后只保留图元。
        state.queryMode = "draw";
        state.pendingSketchAction = null;
        sketchVM.create("point");
      });
      bindClick("drawLine", function () {
        // 普通绘线不触发查询或空间分析。
        state.queryMode = "draw";
        state.pendingSketchAction = null;
        sketchVM.create("polyline");
      });
      bindClick("drawPolygon", function () {
        // 普通绘面只用于临时标注或展示。
        state.queryMode = "draw";
        state.pendingSketchAction = null;
        sketchVM.create("polygon");
      });
      bindClick("clearDrawings", function () {
        state.queryMode = "idle";
        state.pendingSketchAction = null;
        // 清空不仅删除手工绘图，也一并清掉查询高亮和结果面板，回到干净交互状态。
        mainLayers.drawLayer.removeAll();
        mainLayers.highlightLayer.removeAll();
        nodes.resultPanel.textContent = "暂无查询结果。";
        setStatus(nodes.queryStatus, "查询状态：已清空图元和高亮", false);
      });
      bindClick("btnPointQuery", function () {
        // 点查分两步：先进入 point 模式，再等待 mainView click 事件。
        state.queryMode = "point";
        const targetLabel = nodes.queryTargetSelect && nodes.queryTargetSelect.value === "vector" ? "活动矢量图层" : "当前分类结果";
        setStatus(nodes.queryStatus, "查询状态：请在地图上点击一个位置，查询 " + targetLabel, false);
      });
      bindClick("btnRectQuery", function () {
        // 矩形、圆形、多边形查询都通过 startSketchAction 先采集范围几何。
        startSketchAction("selection", "rectangle", "查询状态：请在地图上绘制矩形范围");
      });
      bindClick("btnCircleQuery", function () {
        startSketchAction("selection", "circle", "查询状态：请在地图上绘制圆形范围");
      });
      bindClick("btnPolygonQuery", function () {
        startSketchAction("selection", "polygon", "查询状态：请在地图上绘制多边形范围");
      });
      bindClick("btnAttributeQuery", runAttributeQuery);
      bindClick("btnBufferQuery", function () {
        // 缓冲区查询先采集中心点，再按输入距离生成缓冲区。
        startSketchAction("buffer", "point", "查询状态：请在地图上点击缓冲区中心点");
      });
      bindClick("btnIntersectQuery", function () {
        startSketchAction("intersect", "polygon", "查询状态：请在地图上绘制相交分析范围");
      });
      bindClick("btnClipQuery", function () {
        startSketchAction("clip", "polygon", "查询状态：请在地图上绘制裁剪范围");
      });
      bindClick("btnDistanceStats", function () {
        startSketchAction("distance", "point", "查询状态：请在地图上点击距离统计起点");
      });
      bindClick("btnHome", function () {
        // 回到初始研究区中心和缩放级别。
        mainView.goTo({ center: config.initialView.center, zoom: config.initialView.zoom }, { duration: 400 });
      });
      bindClick("btnCompare", function () {
        // 左右对比按钮在单图/双图之间切换。
        setComparisonMode(!state.comparisonMode);
      });
      bindClick("btnPrevView", goToPreviousView);
      bindClick("btnNextView", goToNextView);
      bindClick("btnZoomIn", function () {
        mainView.goTo({ zoom: mainView.zoom + 1 }, { duration: 250 });
      });
      bindClick("btnZoomOut", function () {
        mainView.goTo({ zoom: Math.max(mainView.zoom - 1, 2) }, { duration: 250 });
      });

      const exportPngButton = document.getElementById("btnExportPng");
      if (exportPngButton) {
        // 导出按钮由 renderExportPanel 动态生成，所以这里重新查询 DOM。
        exportPngButton.onclick = downloadCurrentMapPng;
      }
      const printLayoutButton = document.getElementById("btnPrintLayout");
      if (printLayoutButton) {
        printLayoutButton.onclick = printCurrentLayout;
      }

      const defenseButton = document.getElementById("btnDefense");
      if (defenseButton) {
        defenseButton.onclick = function () {
          // 演示按钮每点击一次切到下一步，最后一步后回到第一步。
          const nextIndex = (state.activePresentationStep + 1) % demo.presentationSteps.length;
          startPresentationStep(nextIndex);
        };
      }

      const loadStudentsButton = document.getElementById("btnLoadStudents");
      if (loadStudentsButton) {
        loadStudentsButton.onclick = loadStudentRows;
      }

      if (nodes.leftAlgorithm) {
        // 左右算法下拉框变化时，只刷新对比图，不影响主图当前算法。
        nodes.leftAlgorithm.onchange = refreshCompareLayers;
      }
      if (nodes.rightAlgorithm) {
        nodes.rightAlgorithm.onchange = refreshCompareLayers;
      }

      // 地图点击只在“点击查询模式”下拦截，其余时候保留地图默认浏览行为。
      mainView.on("click", function (event) {
        if (state.queryMode !== "point") {
          return;
        }
        // 点查只消费一次点击，执行后立即回到 idle。
        state.queryMode = "idle";
        runPointQuery(event);
      });
    }

    // 初始化底图下拉框选项，并选中默认底图。
    function initBasemapSelect() {
      nodes.basemapSelect.innerHTML = "";
      config.basemaps.forEach(function (entry) {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.label;
        if (entry.id === config.fallbackBasemap) {
          option.selected = true;
        }
        nodes.basemapSelect.appendChild(option);
      });
    }

    // 为每个算法服务创建 IdentifyTask，供真实栅格点查询使用。
    function createIdentifyTasks() {
      const tasks = {};
      Object.keys(config.algorithmServices || {}).forEach(function (algorithmKey) {
        const service = getAlgorithmServiceConfig(algorithmKey);
        if (service) {
          // IdentifyTask 的 url 指向 MapServer 根地址，查询时再指定 layerIds。
          tasks[algorithmKey] = new IdentifyTask({ url: service.url });
        }
      });
      return tasks;
    }

    // 初始化主链路：
    // 1. 先准备底图下拉框
    // 2. 创建主图上下文
    // 3. 渲染侧边栏与统计面板
    // 4. 等主图 ready 后，再挂载鹰眼图、绘图工具和所有交互事件
    initBasemapSelect();

    const mainContext = createMapContext("mainViewDiv", state.algorithm, true);
    mainMap = mainContext.map;
    mainView = mainContext.view;
    mainLayers = mainContext.layers;

    // 查询任务初始化：identifyTasks 用于栅格点查，queryTask 预留给本地服务查询。
    identifyTasks = createIdentifyTasks();
    queryTask = new QueryTask({ url: config.localMapServiceUrl + "/0" });

    // 先渲染不依赖 MapView ready 的面板内容。
    renderExportPanel();
    renderAssessmentLayerControls();
    renderDemLayerControls();
    renderVectorLayerOptions();
    renderAreaStats();
    renderAccuracyTable();
    updateAlgorithmTabs();
    updateModeButtons();
    updateAlgorithmInfo();
    renderPresentationSteps();
    renderLegend();
    updateServiceLayerStatus(mainLayers);
    renderServiceStatus();

    mainLayers.consensusLayer.visible = isConsensusLayerToggleEnabled();

    mainView.when(function () {
      // MapView ready 后再挂载依赖视图实例的工具和事件。
      initSketchTools();
      wireMapWidgets(mainView);
      initOverviewMap();
      watchPointerAndScale(mainView);
      bindUiEvents();
      refreshVectorLabels();
      setStatus(nodes.queryStatus, "查询状态：地图已就绪，可执行分类查询、矢量查询和空间分析", false);
      recordViewHistory();
    });
  });
}());
