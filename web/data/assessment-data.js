(function () {
  const assessmentLayers = [
    {
      id: "adminBoundary",
      label: "行政区划（真实基础数据）",
      geometryType: "polygon",
      sourceLabel: "真实基础数据 / result\\南充市.shp",
      sourceType: "geojson",
      url: "data/vector/admin-boundary.geojson?v=20260611-district-names",
      visibleByDefault: true,
      defaultRenderer: "single",
      queryFields: [
        { name: "name", label: "区县名称", type: "string" },
        { name: "cityName", label: "所属地市", type: "string" },
        { name: "code", label: "行政代码", type: "string" },
        { name: "districtType", label: "行政类型", type: "string" },
        { name: "importance", label: "重要度", type: "number" }
      ],
      labelFields: [
        { name: "name", label: "区县名称" },
        { name: "code", label: "行政代码" }
      ],
      rendererPresets: {
        single: {
          label: "单值渲染",
          style: {
            fillColor: [219, 232, 245, 0.1],
            outlineColor: [55, 92, 158, 0.96],
            outlineWidth: 1.4
          }
        },
        unique: {
          label: "唯一值渲染",
          field: "districtType",
          classes: {
            "市辖区": {
              label: "市辖区",
              style: {
                fillColor: [219, 232, 245, 0.16],
                outlineColor: [55, 92, 158, 0.96],
                outlineWidth: 1.5
              }
            },
            "县": {
              label: "县",
              style: {
                fillColor: [234, 241, 227, 0.14],
                outlineColor: [92, 132, 82, 0.96],
                outlineWidth: 1.35
              }
            },
            "县级市": {
              label: "县级市",
              style: {
                fillColor: [252, 233, 186, 0.18],
                outlineColor: [180, 122, 32, 0.96],
                outlineWidth: 1.45
              }
            }
          }
        },
        classBreaks: {
          label: "分级渲染",
          field: "importance",
          breaks: [
            { min: 0, max: 60, label: "一般", style: { fillColor: [234, 241, 227, 0.16], outlineColor: [120, 142, 80, 0.95], outlineWidth: 1.1 } },
            { min: 60, max: 85, label: "重点", style: { fillColor: [252, 233, 186, 0.2], outlineColor: [196, 139, 28, 0.95], outlineWidth: 1.3 } },
            { min: 85, max: 999, label: "核心", style: { fillColor: [249, 211, 188, 0.22], outlineColor: [194, 88, 32, 1], outlineWidth: 1.5 } }
          ]
        }
      }
    },
    {
      id: "citrusParcels",
      label: "柑橘斑块（真实专题数据）",
      geometryType: "polygon",
      sourceLabel: "真实专题数据 / result\\ganjushp.shp",
      sourceType: "geojson",
      url: "data/vector/citrus-parcels.geojson",
      visibleByDefault: true,
      defaultRenderer: "classBreaks",
      queryFields: [
        { name: "name", label: "斑块名称", type: "string" },
        { name: "orchardType", label: "斑块类型", type: "string" },
        { name: "areaMu", label: "面积（亩）", type: "number" },
        { name: "AREA", label: "原始面积", type: "number" }
      ],
      labelFields: [
        { name: "name", label: "斑块名称" },
        { name: "areaMu", label: "面积（亩）" }
      ],
      rendererPresets: {
        single: {
          label: "单值渲染",
          style: {
            fillColor: [246, 197, 102, 0.24],
            outlineColor: [190, 111, 24, 0.98],
            outlineWidth: 1
          }
        },
        unique: {
          label: "唯一值渲染",
          field: "orchardType",
          classes: {
            "掩膜提取2_tif [Classvalue=1]": {
              label: "柑橘斑块",
              style: { fillColor: [246, 197, 102, 0.28], outlineColor: [190, 111, 24, 1], outlineWidth: 1.1 }
            }
          }
        },
        classBreaks: {
          label: "分级渲染",
          field: "areaMu",
          breaks: [
            { min: 0, max: 1, label: "小斑块", style: { fillColor: [255, 232, 178, 0.2], outlineColor: [220, 161, 45, 1], outlineWidth: 0.8 } },
            { min: 1, max: 10, label: "中斑块", style: { fillColor: [246, 197, 102, 0.26], outlineColor: [204, 121, 27, 1], outlineWidth: 1 } },
            { min: 10, max: 999999, label: "大斑块", style: { fillColor: [225, 137, 63, 0.34], outlineColor: [158, 83, 24, 1], outlineWidth: 1.2 } }
          ]
        }
      }
    },
    {
      id: "demoRoads",
      label: "道路（真实基础数据）",
      geometryType: "polyline",
      sourceLabel: "真实基础数据 / 考核所需数据\\南充市道路路网",
      sourceType: "geojson",
      url: "data/vector/roads.geojson",
      visibleByDefault: false,
      defaultRenderer: "unique",
      queryFields: [
        { name: "name", label: "道路名称", type: "string" },
        { name: "fclass", label: "道路类型", type: "string" },
        { name: "code", label: "类型代码", type: "number" },
        { name: "ref", label: "编号", type: "string" },
        { name: "maxspeed", label: "限速", type: "number" },
        { name: "oneway", label: "单行", type: "string" }
      ],
      labelFields: [
        { name: "name", label: "道路名称" },
        { name: "ref", label: "编号" },
        { name: "fclass", label: "道路类型" }
      ],
      rendererPresets: {
        single: {
          label: "单值渲染",
          style: { lineColor: [203, 119, 42, 0.96], lineWidth: 1.6 }
        },
        unique: {
          label: "唯一值渲染",
          field: "fclass",
          classes: {
            motorway: { label: "高速", style: { lineColor: [194, 61, 37, 0.98], lineWidth: 3 } },
            trunk: { label: "干线", style: { lineColor: [222, 124, 44, 0.96], lineWidth: 2.6 } },
            primary: { label: "一级道路", style: { lineColor: [235, 157, 67, 0.96], lineWidth: 2.2 } },
            secondary: { label: "二级道路", style: { lineColor: [228, 178, 85, 0.94], lineWidth: 1.8 } },
            tertiary: { label: "三级道路", style: { lineColor: [188, 137, 82, 0.94], lineWidth: 1.5 } },
            residential: { label: "居民道路", style: { lineColor: [158, 158, 158, 0.9], lineWidth: 1.1 } },
            service: { label: "服务道路", style: { lineColor: [128, 128, 128, 0.82], lineWidth: 0.9 } }
          },
          fallbackStyle: { lineColor: [153, 126, 96, 0.86], lineWidth: 1 }
        },
        classBreaks: {
          label: "分级渲染",
          field: "maxspeed",
          breaks: [
            { min: 0, max: 1, label: "未标注限速", style: { lineColor: [150, 150, 150, 0.78], lineWidth: 0.9 } },
            { min: 1, max: 60, label: "低速", style: { lineColor: [216, 178, 93, 0.94], lineWidth: 1.4 } },
            { min: 60, max: 90, label: "中速", style: { lineColor: [228, 129, 54, 0.96], lineWidth: 2.1 } },
            { min: 90, max: 200, label: "高速", style: { lineColor: [194, 61, 37, 0.98], lineWidth: 2.8 } }
          ]
        }
      }
    },
    {
      id: "demoRivers",
      label: "水系（真实基础数据）",
      geometryType: "polyline",
      sourceLabel: "真实基础数据 / 考核所需数据\\南充市水系水路",
      sourceType: "geojson",
      url: "data/vector/rivers.geojson",
      visibleByDefault: false,
      defaultRenderer: "unique",
      queryFields: [
        { name: "name", label: "水系名称", type: "string" },
        { name: "fclass", label: "水系类型", type: "string" },
        { name: "code", label: "类型代码", type: "number" },
        { name: "width", label: "宽度", type: "number" }
      ],
      labelFields: [
        { name: "name", label: "水系名称" },
        { name: "fclass", label: "水系类型" }
      ],
      rendererPresets: {
        single: {
          label: "单值渲染",
          style: { lineColor: [77, 167, 219, 0.95], lineWidth: 1.7 }
        },
        unique: {
          label: "唯一值渲染",
          field: "fclass",
          classes: {
            river: { label: "河流", style: { lineColor: [65, 157, 216, 0.98], lineWidth: 2.4 } },
            stream: { label: "溪流", style: { lineColor: [117, 193, 232, 0.94], lineWidth: 1.5 } },
            canal: { label: "沟渠", style: { lineColor: [139, 210, 236, 0.92], lineWidth: 1.4 } },
            drain: { label: "排水线", style: { lineColor: [162, 214, 236, 0.88], lineWidth: 1.1 } }
          },
          fallbackStyle: { lineColor: [88, 174, 221, 0.9], lineWidth: 1.3 }
        },
        classBreaks: {
          label: "分级渲染",
          field: "code",
          breaks: [
            { min: 0, max: 8101, label: "一般水系", style: { lineColor: [139, 210, 236, 0.9], lineWidth: 1.2 } },
            { min: 8101, max: 8102, label: "主要水系", style: { lineColor: [65, 157, 216, 0.98], lineWidth: 2.4 } },
            { min: 8102, max: 9999, label: "其他水系", style: { lineColor: [88, 174, 221, 0.9], lineWidth: 1.5 } }
          ]
        }
      }
    }
  ];

  const demLayers = [
    {
      id: "slopeService",
      label: "坡度栅格（真实 DEM 服务）",
      geometryType: "raster",
      sourceLabel: "真实 DEM 服务 / firsttest.MapServer / slope",
      sourceType: "map-service",
      serviceKey: "slope",
      visibleByDefault: false,
      defaultRenderer: "service",
      rendererPresets: {
        service: {
          label: "服务渲染",
          style: { fillColor: [118, 164, 88, 0.5] }
        }
      }
    }
  ];

  window.Experiment8AssessmentData = {
    assessmentLayers,
    demLayers,
    spatialDefaults: {
      bufferDistanceMeters: 3000,
      distanceResultLimit: 5
    }
  };
}());
