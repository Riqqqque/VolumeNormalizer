(() => {
  const sites = [
    { id: "x", name: "X / Twitter", icon: "X", domains: ["twitter.com", "x.com"] },
    { id: "bluesky", name: "Bluesky", icon: "BS", domains: ["bsky.app"] },
    { id: "tiktok", name: "TikTok", icon: "TT", domains: ["tiktok.com"] },
    { id: "instagram", name: "Instagram", icon: "IG", domains: ["instagram.com"] },
    { id: "facebook", name: "Facebook", icon: "FB", domains: ["facebook.com"] },
    {
      id: "youtube",
      name: "YouTube",
      icon: "YT",
      domains: ["youtube.com", "youtube-nocookie.com", "youtu.be"]
    },
    { id: "twitch", name: "Twitch", icon: "TW", domains: ["twitch.tv"] },
    { id: "reddit", name: "Reddit", icon: "RD", domains: ["reddit.com"] },
    {
      id: "dailymotion",
      name: "Dailymotion",
      icon: "DM",
      domains: ["dailymotion.com"]
    },
    { id: "vimeo", name: "Vimeo", icon: "VM", domains: ["vimeo.com"] },
    { id: "streamable", name: "Streamable", icon: "ST", domains: ["streamable.com"] },
    { id: "rumble", name: "Rumble", icon: "RM", domains: ["rumble.com"] },
    { id: "kick", name: "Kick", icon: "KI", domains: ["kick.com"] },
    {
      id: "jwplayer",
      name: "JW Player",
      icon: "JW",
      domains: ["jwplayer.com", "jwplatform.com"]
    },
    { id: "brightcove", name: "Brightcove", icon: "BC", domains: ["brightcove.net"] },
    { id: "snapchat", name: "Snapchat", icon: "SC", domains: ["snapchat.com"] },
    { id: "pinterest", name: "Pinterest", icon: "PN", domains: ["pinterest.com"] },
    { id: "tumblr", name: "Tumblr", icon: "TB", domains: ["tumblr.com"] },
    { id: "linkedin", name: "LinkedIn", icon: "LI", domains: ["linkedin.com"] }
  ].map((site) => Object.freeze({ ...site, domains: Object.freeze([...site.domains]) }));

  const frozenSites = Object.freeze(sites);
  globalThis.VOLUME_NORMALIZER_SITES = frozenSites;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = frozenSites;
  }
})();
