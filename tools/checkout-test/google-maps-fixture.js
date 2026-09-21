// Browser contract fixture. No Google SDK, map tiles, route requests, or billing.
(() => {
  const instances = { maps: [], routes: [], lines: [], markers: [] };
  window.googleMapsFixture = instances;
  class MapView {
    constructor(element, options) {
      this.element = element; this.options = options; this.center = options.center; this.zoom = options.zoom; this.listeners = {};
      element.style.position = "relative";
      instances.maps.push(this);
    }
    addListener(name, fn) { (this.listeners[name] ||= []).push(fn); return { remove() {} }; }
    trigger(name) { this.listeners[name]?.forEach((fn) => fn()); }
    setCenter(point) { this.center = point; this.paint(); }
    getCenter() { return this.center; }
    setZoom(zoom) { this.zoom = zoom; this.trigger("zoom_changed"); this.paint(); }
    getZoom() { return this.zoom; }
    fitBounds(bounds) {
      this.center = { lat: bounds.points.reduce((s, p) => s + p.lat, 0) / bounds.points.length, lng: bounds.points.reduce((s, p) => s + p.lng, 0) / bounds.points.length };
      this.zoom = 12; this.paint();
    }
    paint() { instances.markers.forEach((marker) => marker.paint()); }
  }
  class Marker extends HTMLElement {
    constructor(options) { super(); Object.assign(this, options); instances.markers.push(this); }
    set map(map) {
      this._map = map;
      if (map) { map.element.append(this); this.paint(); }
      else this.remove();
    }
    get map() { return this._map; }
    paint() {
      if (!this.map || !this.position) return;
      const scale = 256 * 2 ** this.map.zoom / 360;
      Object.assign(this.style, { position: "absolute", left: `calc(50% + ${(this.position.lng - this.map.center.lng) * scale}px)`, top: `calc(50% - ${(this.position.lat - this.map.center.lat) * scale}px)`, transform: "translate(-50%, -50%)", zIndex: "3" });
    }
    append(...children) { super.append(...children); this.paint(); }
  }
  customElements.define("fixture-map-marker", Marker);
  class Bounds { constructor() { this.points = []; } extend(point) { this.points.push(point); return this; } }
  class Polyline {
    constructor(options) { Object.assign(this, options); instances.lines.push(this); }
    setMap(map) { this.map = map; }
  }
  const Route = { async computeRoutes(request) {
    instances.routes.push(request);
    if (instances.failRoutes) throw new Error("Fixture route unavailable");
    if (instances.holdRoutes) return new Promise((resolve) => { (instances.pendingRoutes ||= []).push({ request, resolve }); });
    return { routes: [{ path: [request.origin, { lat: (request.origin.lat + request.destination.lat) / 2, lng: request.destination.lng }, request.destination] }] };
  } };
  const maps = { Map: MapView, Polyline, LatLngBounds: Bounds, ColorScheme: { LIGHT: "LIGHT" }, event: { addListenerOnce() {} } };
  window.google = { maps: { ...maps, importLibrary: async (library) => ({ maps, marker: { AdvancedMarkerElement: Marker }, routes: { Route } })[library] } };
  const script = document.currentScript;
  const callback = new URL(script.src).searchParams.get("callback");
  if (callback && window[callback]) window[callback]();
})();
