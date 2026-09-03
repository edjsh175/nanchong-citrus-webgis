const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..", "..");
const webDir = path.resolve(__dirname, "..");
const outputDir = path.join(webDir, "data", "vector");

const adminDistricts = [
  { name: "顺庆区", code: "511302", cityName: "南充市", districtType: "市辖区", importance: 100 },
  { name: "高坪区", code: "511303", cityName: "南充市", districtType: "市辖区", importance: 100 },
  { name: "嘉陵区", code: "511304", cityName: "南充市", districtType: "市辖区", importance: 100 },
  { name: "南部县", code: "511321", cityName: "南充市", districtType: "县", importance: 100 },
  { name: "营山县", code: "511322", cityName: "南充市", districtType: "县", importance: 100 },
  { name: "蓬安县", code: "511323", cityName: "南充市", districtType: "县", importance: 100 },
  { name: "仪陇县", code: "511324", cityName: "南充市", districtType: "县", importance: 100 },
  { name: "西充县", code: "511325", cityName: "南充市", districtType: "县", importance: 100 },
  { name: "阆中市", code: "511381", cityName: "南充市", districtType: "县级市", importance: 100 }
];

const sources = [
  {
    id: "admin-boundary",
    shp: path.join(rootDir, "result", "南充市.shp"),
    output: "admin-boundary.geojson",
    geometryKind: "polygon",
    fallbackProperties: function (index) {
      return adminDistricts[index] || {
        name: "南充市",
        code: "511300",
        cityName: "南充市",
        districtType: "研究区",
        importance: 100
      };
    }
  },
  {
    id: "roads",
    shp: path.join(rootDir, "考核所需数据", "南充市道路路网_511300_Shapefile_(poi86.com)", "511300.shp"),
    dbf: path.join(rootDir, "考核所需数据", "南充市道路路网_511300_Shapefile_(poi86.com)", "511300.dbf"),
    output: "roads.geojson",
    geometryKind: "polyline",
    mapProperties: function (properties) {
      return Object.assign({}, properties, {
        name: properties.name || properties.ref || properties.fclass || "未命名道路"
      });
    }
  },
  {
    id: "rivers",
    shp: path.join(rootDir, "考核所需数据", "南充市水系水路_511300_Shapefile_(poi86.com)", "511300.shp"),
    dbf: path.join(rootDir, "考核所需数据", "南充市水系水路_511300_Shapefile_(poi86.com)", "511300.dbf"),
    output: "rivers.geojson",
    geometryKind: "polyline",
    mapProperties: function (properties) {
      return Object.assign({}, properties, {
        name: properties.name || properties.fclass || "未命名水系"
      });
    }
  },
  {
    id: "citrus-parcels",
    shp: path.join(rootDir, "result", "ganjushp.shp"),
    dbf: path.join(rootDir, "result", "ganjushp.dbf"),
    output: "citrus-parcels.geojson",
    geometryKind: "polygon",
    transform: utm48nToWgs84,
    mapProperties: function (properties, index) {
      const area = Number(properties.AREA);
      return Object.assign({}, properties, {
        name: properties.CLASS_NAME || "柑橘斑块" + (index + 1),
        orchardType: properties.CLASS_NAME || "柑橘斑块",
        areaMu: Number.isFinite(area) ? Number((area / 666.6667).toFixed(2)) : null
      });
    }
  }
];

function readInt32BE(buffer, offset) {
  return buffer.readInt32BE(offset);
}

function readInt32LE(buffer, offset) {
  return buffer.readInt32LE(offset);
}

function readDoubleLE(buffer, offset) {
  return buffer.readDoubleLE(offset);
}

function decodeBytes(bytes, encoding) {
  const decoder = new TextDecoder(encoding || "gb18030", { fatal: false });
  return decoder.decode(bytes).replace(/\u0000/g, "").trim();
}

function readDbfRecords(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  const buffer = fs.readFileSync(filePath);
  const recordCount = readInt32LE(buffer, 4);
  const headerLength = buffer.readInt16LE(8);
  const recordLength = buffer.readInt16LE(10);
  const cpgPath = filePath.replace(/\.dbf$/i, ".cpg");
  const encoding = fs.existsSync(cpgPath) ? fs.readFileSync(cpgPath, "utf8").trim() || "gb18030" : "gb18030";
  const fields = [];
  let fieldOffset = 1;

  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    if (buffer[offset] === 0x0d) {
      break;
    }
    const rawName = buffer.subarray(offset, offset + 11);
    const name = decodeBytes(rawName, "ascii");
    const type = String.fromCharCode(buffer[offset + 11]);
    const length = buffer[offset + 16];
    fields.push({ name, type, length, offset: fieldOffset });
    fieldOffset += length;
  }

  const records = [];
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    if (buffer[start] === 0x2a) {
      records.push(null);
      continue;
    }

    const record = {};
    fields.forEach(function (field) {
      const raw = buffer.subarray(start + field.offset, start + field.offset + field.length);
      const text = decodeBytes(raw, encoding);
      if (field.type === "N" || field.type === "F") {
        const value = Number(text);
        record[field.name] = text === "" || !Number.isFinite(value) ? null : value;
        return;
      }
      record[field.name] = text;
    });
    records.push(record);
  }

  return records;
}

function closeRing(ring) {
  if (!ring.length) {
    return ring;
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring;
  }
  return ring.concat([[first[0], first[1]]]);
}

function readShapeParts(buffer, offset, contentBytes, transform) {
  const shapeType = readInt32LE(buffer, offset);
  if (shapeType === 0) {
    return null;
  }

  if (shapeType === 1) {
    const point = transformPoint([readDoubleLE(buffer, offset + 4), readDoubleLE(buffer, offset + 12)], transform);
    return { shapeType, parts: [[point]] };
  }

  const numParts = readInt32LE(buffer, offset + 36);
  const numPoints = readInt32LE(buffer, offset + 40);
  const parts = [];
  const partOffsets = [];
  const partsOffset = offset + 44;
  const pointsOffset = partsOffset + numParts * 4;

  for (let partIndex = 0; partIndex < numParts; partIndex += 1) {
    partOffsets.push(readInt32LE(buffer, partsOffset + partIndex * 4));
  }
  partOffsets.push(numPoints);

  for (let partIndex = 0; partIndex < numParts; partIndex += 1) {
    const ring = [];
    for (let pointIndex = partOffsets[partIndex]; pointIndex < partOffsets[partIndex + 1]; pointIndex += 1) {
      const pointOffset = pointsOffset + pointIndex * 16;
      if (pointOffset + 16 > offset + contentBytes) {
        break;
      }
      ring.push(transformPoint([readDoubleLE(buffer, pointOffset), readDoubleLE(buffer, pointOffset + 8)], transform));
    }
    if (ring.length) {
      parts.push(ring);
    }
  }

  return { shapeType, parts };
}

function transformPoint(point, transform) {
  const transformed = transform ? transform(point[0], point[1]) : point;
  return [
    Number(transformed[0].toFixed(6)),
    Number(transformed[1].toFixed(6))
  ];
}

function shapeToGeometry(shape, geometryKind) {
  if (!shape) {
    return null;
  }
  if (geometryKind === "polyline") {
    if (shape.parts.length === 1) {
      return { type: "LineString", coordinates: shape.parts[0] };
    }
    return { type: "MultiLineString", coordinates: shape.parts };
  }

  const polygons = shape.parts.map(function (ring) {
    return [closeRing(ring)];
  });
  if (polygons.length === 1) {
    return { type: "Polygon", coordinates: polygons[0] };
  }
  return { type: "MultiPolygon", coordinates: polygons };
}

function readShapefile(source) {
  const buffer = fs.readFileSync(source.shp);
  const dbfRecords = readDbfRecords(source.dbf);
  const features = [];
  let offset = 100;

  while (offset + 8 <= buffer.length) {
    const recordNumber = readInt32BE(buffer, offset);
    const contentBytes = readInt32BE(buffer, offset + 4) * 2;
    const contentOffset = offset + 8;
    const shape = readShapeParts(buffer, contentOffset, contentBytes, source.transform);
    const geometry = shapeToGeometry(shape, source.geometryKind);
    if (geometry) {
      const rawProperties = dbfRecords[features.length] || (source.fallbackProperties ? source.fallbackProperties(features.length) : {});
      const mappedProperties = source.mapProperties ? source.mapProperties(rawProperties, features.length) : rawProperties;
      features.push({
        type: "Feature",
        id: source.id + "-" + recordNumber,
        properties: Object.assign({ sourceId: source.id }, mappedProperties),
        geometry
      });
    }
    offset += 8 + contentBytes;
  }

  return {
    type: "FeatureCollection",
    name: source.id,
    features
  };
}

function utm48nToWgs84(x, y) {
  const zone = 48;
  const a = 6378137;
  const eccSquared = 0.00669438;
  const k0 = 0.9996;
  const eccPrimeSquared = eccSquared / (1 - eccSquared);
  const e1 = (1 - Math.sqrt(1 - eccSquared)) / (1 + Math.sqrt(1 - eccSquared));
  const xAdjusted = x - 500000;
  const longOrigin = (zone - 1) * 6 - 180 + 3;
  const m = y / k0;
  const mu = m / (a * (1 - eccSquared / 4 - 3 * eccSquared * eccSquared / 64 - 5 * eccSquared * eccSquared * eccSquared / 256));
  const phi1Rad = mu
    + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
    + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu)
    + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
  const n1 = a / Math.sqrt(1 - eccSquared * Math.sin(phi1Rad) * Math.sin(phi1Rad));
  const t1 = Math.tan(phi1Rad) * Math.tan(phi1Rad);
  const c1 = eccPrimeSquared * Math.cos(phi1Rad) * Math.cos(phi1Rad);
  const r1 = a * (1 - eccSquared) / Math.pow(1 - eccSquared * Math.sin(phi1Rad) * Math.sin(phi1Rad), 1.5);
  const d = xAdjusted / (n1 * k0);
  const lat = phi1Rad - (n1 * Math.tan(phi1Rad) / r1) * (
    d * d / 2
    - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * eccPrimeSquared) * Math.pow(d, 4) / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * eccPrimeSquared - 3 * c1 * c1) * Math.pow(d, 6) / 720
  );
  const lon = (d
    - (1 + 2 * t1 + c1) * Math.pow(d, 3) / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * eccPrimeSquared + 24 * t1 * t1) * Math.pow(d, 5) / 120
  ) / Math.cos(phi1Rad);

  return [
    longOrigin + lon * 180 / Math.PI,
    lat * 180 / Math.PI
  ];
}

function buildAll() {
  fs.mkdirSync(outputDir, { recursive: true });
  sources.forEach(function (source) {
    const geojson = readShapefile(source);
    const outputPath = path.join(outputDir, source.output);
    fs.writeFileSync(outputPath, JSON.stringify(geojson));
    console.log(source.output + ": " + geojson.features.length + " features");
  });
}

buildAll();
