/* BGH LIVE Controller: the connection to the real OBS (obs-websocket 5), used by the desktop app.
 *
 * It offers the same small interface the prototype's simulated OBS had (call / on / off / emit / connect,
 * plus readCollectionFile and listCollectionScenes), so the controller's own code runs unchanged.
 * Where the real obs-websocket differs from what the controller expects, it's translated here:
 *   - GetSnapshot (one request in the prototype) is built from several real requests
 *   - GetSceneList is returned top-first, the order OBS shows
 *   - ListFolder and collection files that aren't loaded are read from disk by the desktop app (window.bgh)
 *   - audio levels arrive as multipliers per channel and are turned into dB
 *   - Stream/RecordStateChanged report only "started" and "stopped", with the start time
 *   - any failure to reach the companion plug-in is reported as PLUGIN_MISSING
 */
(function(){
  "use strict";
  const lib = window.OBSWebSocket;
  const OBSWebSocket = lib.OBSWebSocket || lib.default || lib;
  const EventSubscription = lib.EventSubscription || {All: 4095, InputVolumeMeters: 65536};

  // Events the controller listens to, passed through (some translated in adapt below)
  const EVENTS = ["CurrentProgramSceneChanged", "CurrentPreviewSceneChanged", "SceneTransitionStarted", "SceneTransitionEnded",
    "StudioModeStateChanged", "CurrentSceneTransitionChanged", "CurrentSceneCollectionChanging", "CurrentSceneCollectionChanged", "SceneItemCreated",
    "SceneCreated", "SceneRemoved", "SceneNameChanged", "SceneListChanged",
    "InputCreated", "InputRemoved", "InputNameChanged", "InputSettingsChanged", "InputMuteStateChanged",
    "InputVolumeMeters", "StreamStateChanged", "RecordStateChanged", "ExitStarted", "VendorEvent"];

  const fail = (code, message) => { const e = new Error(message || code); e.code = code; return e; };
  const toDb = mul => mul > 0 ? Math.max(-90, 20 * Math.log10(mul)) : -90;

  class ObsConnection {
    constructor(){
      this.h = {};
      this.connected = false;
      this.ws = new OBSWebSocket();
      EVENTS.forEach(name => this.ws.on(name, d => {
        const out = this.adapt(name, d || {});
        if(out) this.emit(name, out);
      }));
      // Lost connection after it was up (OBS closed or crashed, or the WebSocket server turned off)
      this.ws.on("ConnectionClosed", () => {
        if(!this.connected) return;
        this.connected = false;
        this.emit("ConnectionClosed", {});
      });
    }
    on(e, f){ (this.h[e] ||= []).push(f); }
    off(e, f){ this.h[e] = (this.h[e] || []).filter(x => x !== f); }
    emit(e, d){ (this.h[e] || []).forEach(f => { try{ f(d); }catch(err){ console.error(err); } }); }

    // Uses the address and password saved in Settings at the moment of connecting
    async connect(){
      const addr = (typeof ui !== "undefined" && ui.obsAddr) || {host:"localhost", port:"4455"};
      const pass = (typeof secret !== "undefined" && await secret.get("obsPassword")) || undefined;
      try{ await this.ws.disconnect(); }catch(e){}
      await this.ws.connect(`ws://${addr.host}:${addr.port}`, pass, {
        rpcVersion: 1,
        eventSubscriptions: EventSubscription.All | EventSubscription.InputVolumeMeters
      });
      this.connected = true;
    }
    // After the address or password changes in Settings: drop the connection, so the controller reconnects with the new ones
    async reconnect(){
      if(this.connected){ try{ await this.ws.disconnect(); }catch(e){} }
      else this.emit("ConnectionClosed", {});
    }

    adapt(name, d){
      switch(name){
        case "InputVolumeMeters":
          // inputLevelsMul: per channel [magnitude, peak, input peak] as multipliers
          return {inputs: (d.inputs || []).map(i => ({inputName: i.inputName,
            peakDb: (i.inputLevelsMul && i.inputLevelsMul.length ? i.inputLevelsMul : [[0,0,0],[0,0,0]]).slice(0, 2).map(ch => toDb(ch[1]))}))};
        case "StreamStateChanged":
        case "RecordStateChanged":
          if(d.outputState === "OBS_WEBSOCKET_OUTPUT_STARTED") return {outputActive:true, t0:Date.now()};
          if(d.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED") return {outputActive:false, t0:0};
          return null;   // starting, stopping, reconnecting, paused: the controller only shows on and off
        case "SceneCreated":
        case "SceneRemoved":
          return d.isGroup ? null : d;
        default:
          return d;
      }
    }

    async call(type, data = {}){
      if(!this.connected) throw fail("NOT_CONNECTED", "Not connected to OBS");
      switch(type){
        case "GetSnapshot": return this.snapshot();
        case "ListFolder": {
          const files = await window.bgh.listFolder(data.folder);
          if(!files) throw fail("FOLDER_NOT_FOUND", "Folder not found");
          return {files};
        }
        case "GetSceneList": {
          const r = await this.ws.call("GetSceneList");
          r.scenes = [...r.scenes].sort((a, b) => b.sceneIndex - a.sceneIndex);   // top of OBS's list first
          return r;
        }
        case "CallVendorRequest": {
          let r;
          try{ r = await this.ws.call("CallVendorRequest", data); }
          catch(e){ throw this.connected ? fail("PLUGIN_MISSING", e.message) : fail("NOT_CONNECTED", "Not connected to OBS"); }
          const rd = (r && r.responseData) || {};
          // OpenStreamStart answers "opened: false" with a reason instead of an error
          if(data.requestType === "OpenStreamStart" && rd.opened === false) throw fail(rd.code || "OBS_BUSY");
          return r;
        }
        default:
          try{ return await this.ws.call(type, data); }
          catch(e){ if(!this.connected) throw fail("NOT_CONNECTED", "Not connected to OBS"); throw e; }
      }
    }

    async snapshot(){
      const ws = this.ws;
      const [pgm, studio, coll, tr, stream, rec] = await Promise.all([
        ws.call("GetCurrentProgramScene"), ws.call("GetStudioModeEnabled"), ws.call("GetSceneCollectionList"),
        ws.call("GetCurrentSceneTransition").catch(() => ({})), ws.call("GetStreamStatus"), ws.call("GetRecordStatus")]);
      let preview = null;
      if(studio.studioModeEnabled){
        const p = await ws.call("GetCurrentPreviewScene").catch(() => null);
        preview = p ? (p.sceneName || p.currentPreviewSceneName) : null;
      }
      const out = o => ({active: !!o.outputActive, t0: o.outputActive ? Date.now() - (o.outputDuration || 0) : 0});
      return {program: pgm.sceneName || pgm.currentProgramSceneName, preview, studio: !!studio.studioModeEnabled,
        transition: tr.transitionName || "", collection: coll.currentSceneCollectionName, stream: out(stream), rec: out(rec)};
    }

    // Scene collections that aren't loaded: read from OBS's saved collection file
    async readCollectionFile(coll){ const c = await window.bgh.readCollection(coll); return c ? c.inputs : {}; }
    async listCollectionScenes(coll){ const c = await window.bgh.readCollection(coll); return c ? c.scenes : []; }
  }
  window.ObsConnection = ObsConnection;
})();
