(function () {
  // service-config.js 可以在部署时覆盖默认服务地址和天地图 token。
  const serviceConfig = window.Experiment8ServiceConfig || { serviceUrls: {}, tianditu: {} };
  const serviceUrls = serviceConfig.serviceUrls || {};
  const tiandituConfig = serviceConfig.tianditu || {};
  // assessment-data.js 提供矢量图层、DEM 图层和空间分析默认参数。
  const assessmentData = window.Experiment8AssessmentData || {
    assessmentLayers: [],
    demLayers: [],
    spatialDefaults: {}
  };

  // 原版最大似然法服务单独列出来，后续既作为默认算法，也作为本地查询任务入口。
  const maximumLikelihoodService = {
    url: serviceUrls.maximumLikelihood || "https://localhost:6443/arcgis/rest/services/MyMapService/MapServer",
    title: "南充市柑橘林地最大似然法原版分类结果",
    name: "MyMapService MapServer",
    // citrusLayerId 是仅柑橘结果子图层，fullLayerId 是四分类结果子图层。
    citrusLayerId: 0,
    fullLayerId: 1,
    // full / citrus 分别对应四分类结果和仅柑橘结果的像元值映射表。
    valueClasses: {
      full: {
        "1": "柑橘",
        "2": "非柑橘",
        "3": "水体",
        "4": "水体"
      },
      citrus: {
        "1": "柑橘",
        NoData: "非柑橘/未识别为柑橘"
      }
    }
  };

  // 其余三个算法共用同一套四分类像元值语义，只是服务地址不同。
  const fourClassValueClasses = {
    full: {
      "1": "柑橘",
      "2": "水体",
      "3": "城镇",
      "4": "非柑橘"
    },
    citrus: {
      "1": "柑橘",
      NoData: "非柑橘/未识别为柑橘"
    }
  };

  // 全局配置挂到 window 上，app.js 启动时通过 window.Experiment8Config 读取。
  window.Experiment8Config = {
    // localMapServiceUrl 兼容旧的查询任务入口，当前指向原版最大似然服务。
    localMapServiceUrl: maximumLikelihoodService.url,
    mapServiceTitle: maximumLikelihoodService.title,
    mapServiceName: maximumLikelihoodService.name,
    // 四个算法服务统一按 key 管理，算法切换时用 key 找到对应 MapServer。
    algorithmServices: {
      maximumLikelihood: maximumLikelihoodService,
      maximumLikelihoodRemake: {
        url: serviceUrls.maximumLikelihoodRemake || "https://localhost:6443/arcgis/rest/services/re_mlc/MapServer",
        title: "南充市柑橘林地最大似然法重制版分类结果",
        name: "re_mlc MapServer",
        // 每个算法服务都维护两套子图层 id，供“四分类 / 仅柑橘”模式切换。
        citrusLayerId: 1,
        fullLayerId: 0,
        valueClasses: fourClassValueClasses
      },
      randomTrees: {
        url: serviceUrls.randomTrees || "https://localhost:6443/arcgis/rest/services/re_rf/MapServer",
        title: "南充市柑橘林地 Random Trees 分类结果",
        name: "re_rf MapServer",
        // 重制版、Random Trees、SVM 的子图层编号保持一致。
        citrusLayerId: 1,
        fullLayerId: 0,
        valueClasses: fourClassValueClasses
      },
      svm: {
        url: serviceUrls.svm || "https://localhost:6443/arcgis/rest/services/re_svm/MapServer",
        title: "南充市柑橘林地 SVM 分类结果",
        name: "re_svm MapServer",
        citrusLayerId: 1,
        fullLayerId: 0,
        valueClasses: fourClassValueClasses
      }
    },
    // 只拷贝 app.js 运行时需要的基础字段，详细字段仍保留在 assessment-data.js。
    assessmentLayers: assessmentData.assessmentLayers.map(function (layer) {
      return {
        id: layer.id,
        label: layer.label,
        geometryType: layer.geometryType,
        sourceLabel: layer.sourceLabel,
        sourceType: layer.sourceType,
        url: layer.url,
        visibleByDefault: layer.visibleByDefault
      };
    }),
    // DEM 图层在 app.js 中通过 serviceKey 关联 demServices。
    demLayers: assessmentData.demLayers.map(function (layer) {
      return {
        id: layer.id,
        label: layer.label,
        geometryType: layer.geometryType,
        sourceLabel: layer.sourceLabel,
        sourceType: layer.sourceType,
        serviceKey: layer.serviceKey,
        visibleByDefault: layer.visibleByDefault
      };
    }),
    // 真实 DEM 服务配置，sublayerId 指向要显示的坡度栅格子图层。
    demServices: {
      slope: {
        url: "https://localhost:6443/arcgis/rest/services/firsttest/MapServer",
        sublayerId: 0,
        title: "坡度栅格（真实 DEM 服务）"
      }
    },
    // 空间分析默认参数：缓冲距离和距离统计展示条数。
    spatialDefaults: {
      bufferDistanceMeters: assessmentData.spatialDefaults.bufferDistanceMeters || 3000,
      distanceResultLimit: assessmentData.spatialDefaults.distanceResultLimit || 5
    },
    // 天地图配置：token 为空时仍构造图层，但实际访问可能需要有效 token。
    tianditu: {
      token: tiandituConfig.token || "",
      subDomains: tiandituConfig.subDomains || ["0", "1", "2", "3", "4", "5", "6", "7"]
    },
    fallbackBasemap: "tiandituImage",
    // 非地理数据示例服务地址，失败时 app.js 会使用内置示例数据。
    studentServiceUrl: "http://localhost:5000/api/students",
    // 主图和对比图的初始视图范围。
    initialView: {
      center: [106.08, 30.8],
      zoom: 10
    },
    // 底图配置：baseLayerType 是底图，annotationLayerType 是对应注记。
    basemaps: [
      { id: "tiandituVector", label: "天地图矢量", baseLayerType: "vec_w", annotationLayerType: "cva_w" },
      { id: "tiandituImage", label: "天地图影像", baseLayerType: "img_w", annotationLayerType: "cia_w" },
      { id: "tiandituTerrain", label: "天地图地形", baseLayerType: "ter_w", annotationLayerType: "cta_w" }
    ]
  };
}());
