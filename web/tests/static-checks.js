const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadBrowserGlobal(relativePath, globalName, preloads = []) {
  const code = preloads.map(read).join("\n") + "\n" + read(relativePath);
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: relativePath });
  assert(sandbox.window[globalName], `${relativePath} must expose window.${globalName}`);
  return sandbox.window[globalName];
}

function checkFiles() {
  [
    "实验8.html",
    "css/style.css",
    "scripts/build-vector-geojson.js",
    "js/service-config.js",
    "js/config.js",
    "js/app.js",
    "data/demo-data.js",
    "data/assessment-data.js",
    "data/vector/admin-boundary.geojson",
    "data/vector/roads.geojson",
    "data/vector/rivers.geojson",
    "data/vector/citrus-parcels.geojson"
  ].forEach(read);
}

function checkHtmlWiring() {
  const html = read("实验8.html");
  [
    "https://js.arcgis.com/4.18/",
    "css/style.css",
    "js/service-config.js",
    "data/assessment-data.js",
    "js/config.js",
    "data/demo-data.js",
    "js/app.js",
    "mainViewDiv",
    "leftViewDiv",
    "rightViewDiv",
    "overviewDiv",
    "printPanel",
    'id="assessmentLayerList"',
    'id="demLayerList"',
    'id="activeVectorLayerSelect"',
    'id="vectorRendererSelect"',
    'id="toggleVectorLabels"',
    'id="vectorLabelFieldSelect"',
    'id="queryTargetSelect"',
    'id="btnRectQuery"',
    'id="btnCircleQuery"',
    'id="btnPolygonQuery"',
    'id="attributeFieldSelect"',
    'id="attributeOperatorSelect"',
    'id="attributeKeyword"',
    'id="btnAttributeQuery"',
    'id="spatialTargetLayerSelect"',
    'id="bufferDistanceInput"',
    'id="btnBufferQuery"',
    'id="btnIntersectQuery"',
    'id="btnClipQuery"',
    'id="btnDistanceStats"',
    'id="btnPrevView"',
    'id="btnNextView"',
    'id="btnZoomIn"',
    'id="btnZoomOut"'
  ].forEach((needle) => assert(html.includes(needle), `实验8.html must include ${needle}`));

  assert(
    html.indexOf("js/service-config.js") < html.indexOf("js/config.js"),
    "实验8.html must load service-config.js before config.js"
  );
  assert(
    html.indexOf("data/assessment-data.js") < html.indexOf("js/config.js"),
    "实验8.html must load assessment-data.js before config.js"
  );
  assert(html.includes("显示当前分类结果"), "实验8.html must retain the result visibility toggle");
  assert(html.includes("DEM / 地形服务"), "实验8.html must label the DEM section as service-only");
  assert(html.includes("data/assessment-data.js?v=20260611-admin-districts"), "实验8.html must bust the assessment-data.js cache after updating administrative districts");
  assert(html.includes('id="opacityValue">100%<'), "实验8.html must default the opacity label to 100%");
  assert(html.includes('id="opacityRange" type="range" min="0" max="100" value="100"'), "实验8.html must default the opacity slider to 100%");
  ["btnDefense", "答辩模式", "DEM / 地形专题"].forEach((needle) => {
    assert(!html.includes(needle), `实验8.html must remove ${needle}`);
  });
}

function checkStyleCoverage() {
  const css = read("css/style.css");
  assert(css.includes(".left-panel select"), "style.css must scope form control width inside the left panel");
  assert(!css.includes("max-width: 180px"), "style.css must not cap left panel form controls at 180px");
  assert(
    css.includes(".left-panel .tool-group .button-grid") &&
      css.includes("grid-template-columns: repeat(2, minmax(0, 1fr));"),
    "style.css must use equal-width columns for left panel tool button grids"
  );
  assert(
    css.includes(".left-panel .tool-group .tool-button") && css.includes("width: 100%;"),
    "style.css must make left panel tool buttons fill their grid cells"
  );
  assert(
    css.includes(".left-panel .tool-group > select") &&
      css.includes("display: block;") &&
      css.includes("width: calc(100% - 24px);"),
    "style.css must prevent direct tool-group controls from overflowing their inset margins"
  );
  assert(css.includes(".left-panel .primary-button.full-width"), "style.css must keep scoped left panel full-width action styling");

  const printBlockStart = css.indexOf("@media print");
  assert(printBlockStart > -1, "style.css must define print-specific layout rules");
  const printBlock = css.slice(printBlockStart);
  assert(printBlock.includes("@page"), "print CSS must define page settings");
  assert(printBlock.includes("size: A4 landscape;"), "print CSS must force A4 landscape output");
  assert(printBlock.includes("margin: 8mm;"), "print CSS must use compact print margins");
  assert(
    !printBlock.includes("min-height: 100vh"),
    "print CSS must not keep the map at viewport height because it creates a second page"
  );
  assert(printBlock.includes("grid-template-columns: minmax(0, 1fr) 70mm;"), "print CSS must reserve a compact right info column");
  assert(printBlock.includes("height: calc(210mm - 16mm);"), "print CSS must cap the layout to one A4 landscape page");
  assert(printBlock.includes(".esri-ui-top-left"), "print CSS must hide ArcGIS zoom controls");
  assert(printBlock.includes(".coordinate-bar"), "print CSS must hide the coordinate bar");
  assert(printBlock.includes("#resultPanel"), "print CSS must constrain the low-priority query result panel");
  assert(css.includes("body.is-printing-layout .workspace"), "style.css must apply print layout before opening browser print preview");
  assert(
    css.includes("body.is-printing-layout .map-area") && css.includes("body.is-printing-layout .map-view"),
    "style.css must size the map container before print preview so ArcGIS can resize its canvas"
  );
}

function checkConfig() {
  const serviceConfig = loadBrowserGlobal("js/service-config.js", "Experiment8ServiceConfig");
  const assessmentData = loadBrowserGlobal("data/assessment-data.js", "Experiment8AssessmentData");
  const config = loadBrowserGlobal("js/config.js", "Experiment8Config", [
    "js/service-config.js",
    "data/assessment-data.js"
  ]);

  assert(serviceConfig.serviceUrls.maximumLikelihood.includes("MyMapService/MapServer"), "service-config must expose the maximum likelihood service URL");
  assert(serviceConfig.serviceUrls.maximumLikelihoodRemake.includes("re_mlc/MapServer"), "service-config must expose the remade maximum likelihood service URL");
  assert(serviceConfig.serviceUrls.randomTrees.includes("re_rf/MapServer"), "service-config must expose the Random Trees service URL");
  assert(serviceConfig.serviceUrls.svm.includes("re_svm/MapServer"), "service-config must expose the SVM service URL");
  assert(serviceConfig.tianditu.token === "1533dff95cfa3724f6df5257696ae8d3", "service-config must expose the Tianditu token");

  assert(config.algorithmServices.maximumLikelihood.url.includes("MyMapService/MapServer"), "config must use the maximum likelihood service");
  assert(config.algorithmServices.maximumLikelihood.fullLayerId === 1, "maximum likelihood full mode must use layer 1");
  assert(config.algorithmServices.maximumLikelihood.citrusLayerId === 0, "maximum likelihood citrus mode must use layer 0");
  assert(config.algorithmServices.maximumLikelihoodRemake.fullLayerId === 0, "remade maximum likelihood full mode must use layer 0");
  assert(config.algorithmServices.randomTrees.fullLayerId === 0, "Random Trees full mode must use layer 0");
  assert(config.algorithmServices.svm.fullLayerId === 0, "SVM full mode must use layer 0");

  assert(config.fallbackBasemap === "tiandituImage", "config must default to the Tianditu imagery basemap");
  assert(Array.isArray(config.basemaps) && config.basemaps.length === 3, "config must expose three basemap options");
  assert(Array.isArray(config.assessmentLayers) && config.assessmentLayers.length === assessmentData.assessmentLayers.length, "config must expose assessment layer metadata");
  assert(Array.isArray(config.demLayers) && config.demLayers.length === assessmentData.demLayers.length, "config must expose DEM layer metadata");
  assert(config.demServices.slope.url === "https://localhost:6443/arcgis/rest/services/firsttest/MapServer", "config must expose the real slope MapServer URL");
  assert(config.demServices.slope.sublayerId === 0, "config must expose the slope service sublayer id");
  assert(config.spatialDefaults.bufferDistanceMeters === 3000, "config must expose the default buffer distance");
}

function checkDemoData() {
  const data = loadBrowserGlobal("data/demo-data.js", "Experiment8DemoData");

  assert(data.algorithmStats.maximumLikelihood.areaKm2 === 4426.82, "old maximum likelihood area must use the real reported value");
  assert(data.algorithmStats.maximumLikelihood.precision === null, "old maximum likelihood precision must remain unavailable");
  assert(data.algorithmStats.maximumLikelihoodRemake.areaKm2 === 2181.57, "remade maximum likelihood area must use the 2026-06-04 report");
  assert(data.algorithmStats.maximumLikelihoodRemake.precision === 67, "remade maximum likelihood precision must use the 2026-06-04 report");
  assert(data.algorithmStats.randomTrees.areaKm2 === 1483.50, "Random Trees area must use the 2026-06-04 report");
  assert(data.algorithmStats.randomTrees.kappa === 0.5641, "Random Trees Kappa must use the 2026-06-04 report");
  assert(data.algorithmStats.svm.areaKm2 === 3435.38, "SVM area must use the 2026-06-04 report");
  assert(data.algorithmStats.svm.kappa === 0.5078, "SVM Kappa must use the 2026-06-04 report");

  assert(data.legendItems.length === 4, "legend must include exactly four displayed classes");
  assert(data.legendItems[0].className === "柑橘" && data.legendItems[0].color === "rgb(246,197,102)", "citrus legend color must match the service");
  assert(data.legendItems[3].className === "城镇" && data.legendItems[3].color === "rgb(205,205,205)", "urban legend color must match the service");
}

function checkAssessmentData() {
  const data = loadBrowserGlobal("data/assessment-data.js", "Experiment8AssessmentData");

  const assessmentLayerIds = data.assessmentLayers.map((layer) => layer.id).sort();
  const demLayerIds = data.demLayers.map((layer) => layer.id).sort();
  assert(Array.isArray(data.assessmentLayers) && data.assessmentLayers.length === 4, "assessment data must keep only the four real vector layers");
  assert(JSON.stringify(assessmentLayerIds) === JSON.stringify(["adminBoundary", "citrusParcels", "demoRivers", "demoRoads"].sort()), "assessment data must keep admin, citrus, roads, and rivers only");
  assert(Array.isArray(data.demLayers) && data.demLayers.length === 1, "assessment data must keep only the real DEM service layer");
  assert(JSON.stringify(demLayerIds) === JSON.stringify(["slopeService"]), "assessment data must keep slopeService as the only DEM layer");
  ["demoSettlements", "demZones", "slopeZones", "slopeSuitable"].forEach((layerId) => {
    assert(!assessmentLayerIds.includes(layerId) && !demLayerIds.includes(layerId), `assessment data must remove ${layerId}`);
  });

  ["adminBoundary", "demoRoads", "demoRivers", "citrusParcels"].forEach((layerId) => {
    const layer = data.assessmentLayers.find((entry) => entry.id === layerId);
    assert(layer.sourceType === "geojson", `${layerId} must load from GeoJSON`);
    assert(typeof layer.url === "string" && layer.url.includes("data/vector/"), `${layerId} must point at a web/data/vector GeoJSON file`);
    assert(!Array.isArray(layer.features), `${layerId} must not inline feature graphics`);
  });

  const adminLayer = data.assessmentLayers.find((entry) => entry.id === "adminBoundary");
  const adminQueryLabels = adminLayer.queryFields.map((field) => field.label);
  assert(adminLayer.url.includes("admin-boundary.geojson?v=20260611-district-names"), "adminBoundary must bust the cached administrative GeoJSON");
  assert(adminQueryLabels.includes("区县名称"), "adminBoundary query fields must expose district names");
  assert(adminQueryLabels.includes("所属地市"), "adminBoundary query fields must expose the parent city");
  assert(adminLayer.rendererPresets.unique.classes["市辖区"], "adminBoundary unique renderer must style city districts");
  assert(adminLayer.rendererPresets.unique.classes["县"], "adminBoundary unique renderer must style counties");
  assert(adminLayer.rendererPresets.unique.classes["县级市"], "adminBoundary unique renderer must style county-level cities");

  const slopeService = data.demLayers.find((entry) => entry.id === "slopeService");
  assert(slopeService && slopeService.sourceType === "map-service", "assessment data must include the real slope MapServer DEM layer");
}

function checkGeoJsonData() {
  const roads = JSON.parse(read("data/vector/roads.geojson"));
  const rivers = JSON.parse(read("data/vector/rivers.geojson"));
  const admin = JSON.parse(read("data/vector/admin-boundary.geojson"));
  const citrus = JSON.parse(read("data/vector/citrus-parcels.geojson"));

  assert(roads.type === "FeatureCollection", "roads.geojson must be a FeatureCollection");
  assert(rivers.type === "FeatureCollection", "rivers.geojson must be a FeatureCollection");
  assert(admin.type === "FeatureCollection", "admin-boundary.geojson must be a FeatureCollection");
  assert(citrus.type === "FeatureCollection", "citrus-parcels.geojson must be a FeatureCollection");
  assert(roads.features.length >= 11000, "roads.geojson must preserve the real road feature count");
  assert(rivers.features.length >= 880, "rivers.geojson must preserve the real river feature count");
  assert(admin.features.length === 9, "admin-boundary.geojson must contain the nine Nanchong county-level districts");
  assert(citrus.features.length >= 500, "citrus-parcels.geojson must contain the real citrus parcel features");
  const expectedAdminCodes = {
    "顺庆区": "511302",
    "高坪区": "511303",
    "嘉陵区": "511304",
    "南部县": "511321",
    "营山县": "511322",
    "蓬安县": "511323",
    "仪陇县": "511324",
    "西充县": "511325",
    "阆中市": "511381"
  };
  const adminNameCodes = new Map(admin.features.map((feature) => [feature.properties.name, feature.properties.code]));
  assert(new Set(admin.features.map((feature) => feature.properties.name)).size === 9, "admin-boundary.geojson must not repeat the same district name");
  assert(!admin.features.every((feature) => feature.properties.name === "南充市"), "admin-boundary.geojson must not label every district as Nanchong city");
  Object.entries(expectedAdminCodes).forEach(([name, code]) => {
    assert(adminNameCodes.get(name) === code, `admin-boundary.geojson must include ${name} with code ${code}`);
  });
  admin.features.forEach((feature) => {
    assert(feature.properties.cityName === "南充市", "admin-boundary.geojson must preserve the parent city name");
    assert(["市辖区", "县", "县级市"].includes(feature.properties.districtType), "admin-boundary.geojson must classify district type");
  });
  ["name", "fclass", "code", "ref", "maxspeed", "oneway"].forEach((field) => {
    assert(Object.prototype.hasOwnProperty.call(roads.features[0].properties, field), `roads.geojson must preserve ${field}`);
  });
  ["name", "fclass", "code"].forEach((field) => {
    assert(Object.prototype.hasOwnProperty.call(rivers.features[0].properties, field), `rivers.geojson must preserve ${field}`);
  });
}

function checkAppCoverage() {
  const app = read("js/app.js");
  [
    "geometryEngine",
    "webMercatorUtils",
    "createAssessmentLayers",
    "createDemLayers",
    "loadGeoJsonFeatures",
    "createRealDemServiceLayer",
    "renderAssessmentLayerControls",
    "renderDemLayerControls",
    "renderVectorLayerOptions",
    "renderQueryFieldOptions",
    "applyVectorRenderer",
    "refreshVectorLabels",
    "runVectorPointQuery",
    "runGeometrySelectionQuery",
    "runAttributeQuery",
    "runBufferAnalysis",
    "runIntersectAnalysis",
    "runClipAnalysis",
    "runDistanceStats",
    "goToPreviousView",
    "goToNextView",
    "recordViewHistory",
    "preparePrintLayout",
    "restorePrintLayout",
    "waitForPrintLayoutReady",
    "printCurrentLayout",
    "afterprint",
    "is-printing-layout",
    "btnPrintLayout",
    "window.print()"
  ].forEach((needle) => assert(app.includes(needle), `app.js must include ${needle}`));

  assert(app.includes("config.assessmentLayers"), "app.js must use assessment layer metadata");
  assert(app.includes("config.demLayers"), "app.js must use DEM layer metadata");
  assert(app.includes("window.Experiment8AssessmentData"), "app.js must use assessment data");
  assert(app.includes("runServicePointQuery"), "app.js must preserve the real raster point query");
  assert(app.includes("takeScreenshot"), "app.js must preserve PNG export");
  assert(!app.includes("new Print("), "app.js must not reintroduce the ArcGIS Print widget");

  const pointQueryStart = app.indexOf("function runPointQuery");
  const pointQueryEnd = app.indexOf("function runGeometrySelectionQuery");
  const pointQueryBlock = app.slice(pointQueryStart, pointQueryEnd);
  assert(pointQueryBlock.includes("queryTargetSelect"), "runPointQuery must branch between classification and vector query");
  assert(pointQueryBlock.includes("runVectorPointQuery"), "runPointQuery must support vector point identify");

  const selectionQueryStart = app.indexOf("function runGeometrySelectionQuery");
  const selectionQueryEnd = app.indexOf("function renderStudentTable");
  const selectionQueryBlock = app.slice(selectionQueryStart, selectionQueryEnd);
  assert(selectionQueryBlock.includes("rectangle"), "geometry selection query must support rectangle");
  assert(selectionQueryBlock.includes("circle"), "geometry selection query must support circle");
  assert(selectionQueryBlock.includes("polygon"), "geometry selection query must support polygon");
  assert(selectionQueryBlock.includes("geometryEngine"), "geometry selection query must use geometryEngine");

  assert(app.includes('startSketchAction("selection", "rectangle"'), "app.js must trigger rectangle sketch queries");
  assert(app.includes('startSketchAction("selection", "circle"'), "app.js must trigger circle sketch queries");
  assert(app.includes('startSketchAction("selection", "polygon"'), "app.js must trigger polygon sketch queries");
  assert(app.includes("viewHistory"), "app.js must track navigation history");

  const initBasemapCall = app.indexOf("initBasemapSelect();");
  const mainMapCreate = app.indexOf('createMapContext("mainViewDiv"');
  assert(initBasemapCall > -1, "app.js must initialize the basemap select options");
  assert(initBasemapCall < mainMapCreate, "app.js must initialize basemap options before creating the main map");
}

checkFiles();
checkHtmlWiring();
checkStyleCoverage();
checkConfig();
checkDemoData();
checkAssessmentData();
checkGeoJsonData();
checkAppCoverage();

console.log("Static checks passed");
