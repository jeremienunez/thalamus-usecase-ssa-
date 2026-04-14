// Minimal GeoJSON namespace shim — swap for @types/geojson after install.
declare namespace GeoJSON {
  type Position = number[];
  interface Point {
    type: "Point";
    coordinates: Position;
  }
  interface Polygon {
    type: "Polygon";
    coordinates: Position[][];
  }
  interface GeometryCollection {
    type: "GeometryCollection";
    geometries: Geometry[];
  }
  type Geometry =
    | Point
    | Polygon
    | GeometryCollection
    | { type: string; coordinates?: unknown };
}
