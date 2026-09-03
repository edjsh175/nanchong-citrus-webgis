(function () {
  window.Experiment8ServiceConfig = {
    serviceUrls: {
      maximumLikelihood: "https://localhost:6443/arcgis/rest/services/MyMapService/MapServer",
      randomTrees: "https://localhost:6443/arcgis/rest/services/re_rf/MapServer",
      maximumLikelihoodRemake: "https://localhost:6443/arcgis/rest/services/re_mlc/MapServer",
      svm: "https://localhost:6443/arcgis/rest/services/re_svm/MapServer"
    },
    tianditu: {
      token: "", // 部署时填写你的天地图 Token（仓库内已置空）
      subDomains: ["0", "1", "2", "3", "4", "5", "6", "7"]
    }
  };
}());
