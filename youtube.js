// Viewer count for the BGH LIVE Controller: asks the YouTube Data API v3 how many are watching the channel's livestream.
// Uses an API key (free from Google Cloud, "YouTube Data API v3" turned on). Units from the 10,000 free each day:
//   channel lookup         channels.list         1, once per channel
//   finding the stream     playlistItems.list + videos.list   2 per try, every 30 s until found
//                          search.list (only if that misses)   100, at most once every 10 minutes
//   the count              videos.list           1 every 30 s  (about 120 an hour)
"use strict";
const API = "https://www.googleapis.com/youtube/v3/";

module.exports = function createYouTube({ fetch, getSecret }){
  const channels = new Map();   // what was typed → {id, title, uploads}
  let lastSearch = 0;

  class YtError extends Error { constructor(state, message){ super(message || state); this.state = state; } }

  async function call(method, params, key){
    const url = API + method + "?" + new URLSearchParams({ ...params, key });
    let r;
    try{ r = await fetch(url, { cache: "no-store" }); }
    catch(e){ throw new YtError("offline", "Couldn't reach YouTube"); }
    let body = null; try{ body = await r.json(); }catch(e){}
    if(r.ok) return body || {};
    const err = (body && body.error) || {}, reason = ((err.errors || [])[0] || {}).reason || "";
    if(/quota/i.test(reason)) throw new YtError("quota", "Today's free YouTube allowance is used up");
    if(r.status === 400 || r.status === 403) throw new YtError("badkey", err.message || "YouTube didn't accept the API key");
    throw new YtError("offline", err.message || `YouTube answered ${r.status}`);
  }

  // Accepts a channel address, an @handle, or a channel ID (UC…)
  function parseChannel(text){
    const t = String(text || "").trim();
    const id = t.match(/(?:^|\/channel\/)(UC[\w-]{22})(?:[/?#]|$)/);
    if(id) return { id: id[1] };
    const handle = t.match(/(?:^|youtube\.com\/)(@[\w.\-·]{3,})/i);
    if(handle) return { forHandle: handle[1] };
    const user = t.match(/youtube\.com\/user\/([\w.-]+)/i);
    if(user) return { forUsername: user[1] };
    if(/^[\w.\-·]{3,}$/.test(t)) return { forHandle: "@" + t };
    return null;
  }

  async function resolveChannel(text, key){
    const k = String(text || "").trim().toLowerCase();
    if(channels.has(k)) return channels.get(k);
    const q = parseChannel(text);
    if(!q) throw new YtError("nochannel", "That doesn't look like a YouTube channel address or @handle");
    const r = await call("channels", { part: "snippet,contentDetails", ...q }, key);
    const c = (r.items || [])[0];
    if(!c) throw new YtError("nochannel", "YouTube couldn't find that channel. Check the address or @handle.");
    const info = { id: c.id, title: c.snippet && c.snippet.title || c.id, uploads: c.contentDetails && c.contentDetails.relatedPlaylists && c.contentDetails.relatedPlaylists.uploads };
    channels.set(k, info);
    return info;
  }

  const liveOf = v => v && v.snippet && v.snippet.liveBroadcastContent === "live";

  async function findLive(ch, key){
    if(ch.uploads){
      const p = await call("playlistItems", { part: "contentDetails", playlistId: ch.uploads, maxResults: "5" }, key);
      const ids = (p.items || []).map(i => i.contentDetails && i.contentDetails.videoId).filter(Boolean);
      if(ids.length){
        const v = await call("videos", { part: "snippet,liveStreamingDetails", id: ids.join(",") }, key);
        const live = (v.items || []).find(liveOf);
        if(live) return live;
      }
    }
    if(Date.now() - lastSearch < 10 * 60000) return null;
    lastSearch = Date.now();
    const s = await call("search", { part: "id", channelId: ch.id, eventType: "live", type: "video", maxResults: "1" }, key);
    const id = (((s.items || [])[0] || {}).id || {}).videoId;
    if(!id) return null;
    const v = await call("videos", { part: "snippet,liveStreamingDetails", id }, key);
    return (v.items || []).find(liveOf) || null;
  }

  async function keyOf(given){
    const key = String(given || (await getSecret("ytKey")) || "").trim();
    if(!key) throw new YtError("nokey");
    return key;
  }

  // → {count, videoId} or {state: "nokey"|"nochannel"|"nostream"|"hidden"|"badkey"|"quota"|"offline"}
  async function viewers({ key, channel, videoId } = {}){
    try{
      key = await keyOf(key);
      if(!String(channel || "").trim()) return { state: "nokey" };
      let video = null;
      if(videoId){
        const v = await call("videos", { part: "snippet,liveStreamingDetails", id: videoId }, key);
        video = (v.items || []).find(liveOf) || null;
      }
      if(!video) video = await findLive(await resolveChannel(channel, key), key);
      if(!video) return { state: "nostream", videoId: null };
      const n = video.liveStreamingDetails && video.liveStreamingDetails.concurrentViewers;
      if(n == null) return { state: "hidden", videoId: video.id };
      return { count: parseInt(n, 10) || 0, videoId: video.id };
    }catch(e){
      if(e instanceof YtError) return { state: e.state };
      return { state: "offline" };
    }
  }

  // Settings › Test: checks the key and finds the channel (2 units)
  async function test({ key, channel } = {}){
    try{
      key = await keyOf(key);
      channels.delete(String(channel || "").trim().toLowerCase());
      const ch = await resolveChannel(channel, key);
      return { ok: true, title: ch.title };
    }catch(e){
      const msg = {
        nokey: "Fill in the API key first.",
        badkey: "YouTube didn't accept the key. Check it was copied whole, and that YouTube Data API v3 is turned on for its project.",
        quota: "The key works, but today's free YouTube allowance is used up.",
        offline: "Couldn't reach YouTube. Check the internet connection."
      };
      return { ok: false, message: e instanceof YtError ? (msg[e.state] || e.message) : "Something went wrong talking to YouTube." };
    }
  }

  return { viewers, test, parseChannel };
};
