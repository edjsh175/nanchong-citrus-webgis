(function () {
  const palette = {
    citrus: [246, 197, 102, 0.72],
    water: [151, 220, 242, 0.72],
    nonCitrus: [211, 255, 190, 0.58],
    urban: [205, 205, 205, 0.62],
    consensusHigh: [202, 86, 22, 0.78],
    consensusMedium: [245, 180, 46, 0.72],
    consensusLow: [248, 218, 112, 0.62]
  };

  window.Experiment8DemoData = {
    algorithmStats: {
      maximumLikelihood: {
        label: "最大似然法原版",
        shortLabel: "最大似然原版",
        areaKm2: 4426.82,
        precision: null,
        recall: null,
        kappa: null,
        note: "原版最大似然法真实服务，柑橘面积来自像元统计；精度因历史数据缺失暂无法计算。"
      },
      maximumLikelihoodRemake: {
        label: "最大似然法重制版",
        shortLabel: "最大似然重制版",
        areaKm2: 2181.57,
        precision: 67,
        recall: 67,
        kappa: 0.5612,
        note: "最大似然法重制版统计更新为 2026-06-04 的真实分类报告。"
      },
      randomTrees: {
        label: "Random Trees",
        shortLabel: "Random Trees",
        areaKm2: 1483.50,
        precision: 67,
        recall: 67,
        kappa: 0.5641,
        note: "随机森林真实服务已接入，统计更新为 2026-06-04 的真实分类报告。"
      },
      svm: {
        label: "SVM",
        shortLabel: "SVM",
        areaKm2: 3435.38,
        precision: 63,
        recall: 63,
        kappa: 0.5078,
        note: "SVM 统计更新为 2026-06-04 的真实分类报告。"
      }
    },
    accuracyRows: [
      { algorithm: "最大似然法原版", overall: "无法计算", producer: "-", user: "-", kappa: "-" },
      { algorithm: "最大似然法重制版", overall: "67.0%", producer: "67.0%", user: "68.0%", kappa: "0.5612" },
      { algorithm: "随机森林", overall: "67.0%", producer: "67.0%", user: "67.0%", kappa: "0.5641" },
      { algorithm: "SVM", overall: "63.0%", producer: "63.0%", user: "64.0%", kappa: "0.5078" }
    ],
    legendItems: [
      { className: "柑橘", color: "rgb(246,197,102)", rgba: palette.citrus },
      { className: "水体", color: "rgb(151,220,242)", rgba: palette.water },
      { className: "非柑橘", color: "rgb(211,255,190)", rgba: palette.nonCitrus },
      { className: "城镇", color: "rgb(205,205,205)", rgba: palette.urban }
    ],
    presentationSteps: [
      { title: "研究区", action: "studyArea", description: "定位南充市研究区范围，说明系统以真实分类服务为主、演示基础数据为辅。" },
      { title: "数据基础", action: "source", description: "展示底图、分类服务、基础矢量图层和 DEM 专题图层的组织结构。" },
      { title: "最大似然法原版", action: "maximumLikelihood", description: "切换到最大似然法原版真实服务。" },
      { title: "最大似然法重制版", action: "maximumLikelihoodRemake", description: "切换到最大似然法重制版真实服务。" },
      { title: "Random Trees", action: "randomTrees", description: "切换到 Random Trees 真实服务。" },
      { title: "SVM", action: "svm", description: "切换到 SVM 真实服务。" },
      { title: "方法对比", action: "compare", description: "左右对比最大似然法原版和 Random Trees 分类结果。" },
      { title: "面积与精度", action: "stats", description: "查看面积统计、精度评价和算法差异。" },
      { title: "成果输出", action: "print", description: "导出 PNG 或使用浏览器打印版式输出当前地图。" }
    ],
    demoClassificationRules: [
      {
        county: "顺庆区",
        center: [106.08, 30.82],
        classes: {
          maximumLikelihood: "柑橘",
          maximumLikelihoodRemake: "柑橘",
          randomTrees: "柑橘",
          svm: "非柑橘"
        }
      },
      {
        county: "高坪区",
        center: [106.17, 30.78],
        classes: {
          maximumLikelihood: "非柑橘",
          maximumLikelihoodRemake: "非柑橘",
          randomTrees: "柑橘",
          svm: "柑橘"
        }
      },
      {
        county: "嘉陵区",
        center: [106.02, 30.74],
        classes: {
          maximumLikelihood: "水体",
          maximumLikelihoodRemake: "水体",
          randomTrees: "非柑橘",
          svm: "非柑橘"
        }
      },
      {
        county: "南部县",
        center: [106.06, 31.35],
        classes: {
          maximumLikelihood: "柑橘",
          maximumLikelihoodRemake: "柑橘",
          randomTrees: "柑橘",
          svm: "柑橘"
        }
      }
    ],
    demoPatches: [
      {
        id: 1,
        county: "顺庆区",
        className: "柑橘",
        consensus: "三法一致",
        rings: [[[106.015, 30.85], [106.075, 30.895], [106.14, 30.862], [106.115, 30.805], [106.035, 30.795], [106.015, 30.85]]],
        algorithms: {
          maximumLikelihood: "柑橘",
          maximumLikelihoodRemake: "柑橘",
          randomTrees: "柑橘",
          svm: "柑橘"
        }
      },
      {
        id: 2,
        county: "高坪区",
        className: "柑橘",
        consensus: "两法一致",
        rings: [[[106.13, 30.79], [106.22, 30.815], [106.245, 30.74], [106.18, 30.705], [106.115, 30.735], [106.13, 30.79]]],
        algorithms: {
          maximumLikelihood: "非柑橘",
          maximumLikelihoodRemake: "非柑橘",
          randomTrees: "柑橘",
          svm: "柑橘"
        }
      },
      {
        id: 3,
        county: "嘉陵区",
        className: "水体",
        consensus: "非柑橘",
        rings: [[[105.94, 30.79], [106.005, 30.82], [106.05, 30.765], [106.005, 30.705], [105.935, 30.725], [105.94, 30.79]]],
        algorithms: {
          maximumLikelihood: "水体",
          maximumLikelihoodRemake: "水体",
          randomTrees: "非柑橘",
          svm: "非柑橘"
        }
      },
      {
        id: 4,
        county: "顺庆区",
        className: "城镇/建设用地",
        consensus: "单法识别",
        rings: [[[106.065, 30.77], [106.125, 30.785], [106.135, 30.735], [106.08, 30.705], [106.035, 30.735], [106.065, 30.77]]],
        algorithms: {
          maximumLikelihood: "城镇/建设用地",
          maximumLikelihoodRemake: "城镇/建设用地",
          randomTrees: "非柑橘",
          svm: "非柑橘"
        }
      },
      {
        id: 5,
        county: "南部县",
        className: "柑橘",
        consensus: "两法一致",
        rings: [[[105.96, 31.30], [106.06, 31.38], [106.18, 31.33], [106.15, 31.22], [106.02, 31.19], [105.96, 31.30]]],
        algorithms: {
          maximumLikelihood: "柑橘",
          maximumLikelihoodRemake: "柑橘",
          randomTrees: "柑橘",
          svm: "非柑橘"
        }
      }
    ],
    studentRows: [
      { studentId: "2023041075", name: "申浩霖", className: "地信232", course: "WebGIS开发技术", score: 60 },
      { studentId: "2023041076", name: "李明", className: "地信231", course: "数据库原理", score: 61 },
      { studentId: "2023041077", name: "王芳", className: "地信232", course: "空间分析", score: 78 },
      { studentId: "2023041078", name: "张强", className: "地信232", course: "遥感应用", score: 85 }
    ],
    palette: palette
  };
}());
