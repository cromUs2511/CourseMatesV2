
with open('src/components/TopMusicBar.tsx', 'r') as f:
    content = f.read()

submit_func = """
  const handleCustomUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl) return;

    let videoId = '';
    try {
      const urlObj = new URL(customUrl);
      if (urlObj.hostname.includes('youtube.com')) {
        videoId = urlObj.searchParams.get('v') || '';
      } else if (urlObj.hostname.includes('youtu.be')) {
        videoId = urlObj.pathname.slice(1);
      }
    } catch {
      videoId = customUrl.trim();
    }

    if (videoId) {
      const newTrack: MusicTrack = {
        id: `custom-${Date.now()}`,
        title: 'Custom YouTube Link',
        artist: 'User Added',
        youtubeUrl: customUrl,
        youtubeVideoId: videoId,
        category: 'custom'
      };
      setTracks((prev) => [newTrack, ...prev]);
      setCurrentTrackIndex(0);
      setIsPlaying(true);
      setCustomUrl('');
      setIsMenuOpen(false);
      startAmbientTone();
    }
  };

"""

# insert before return (
content = content.replace("  return (\n    <div className=\"relative flex items-center\"", submit_func + "  return (\n    <div className=\"relative flex items-center\"")

dropdown_ui = """          <div className="px-2 py-1 border-b border-stone-200 dark:border-stone-800 font-bold uppercase tracking-wider text-[10px] text-stone-400 flex items-center justify-between">
            <span>Study Soundtracks</span>
            <span className="text-[10px] text-[#991B1B] dark:text-[#F87171]">{tracks.length} Channels</span>
          </div>
          <form onSubmit={handleCustomUrlSubmit} className="p-2 border-b border-stone-200 dark:border-stone-800">
            <input
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="Paste YouTube Link or ID..."
              className={`w-full px-2 py-1.5 text-xs rounded border transition-colors ${
                isDarkMode 
                  ? 'bg-stone-800 border-stone-700 text-stone-200 placeholder-stone-500 focus:border-[#F87171]' 
                  : 'bg-stone-100 border-stone-300 text-stone-800 placeholder-stone-400 focus:border-[#991B1B]'
              } focus:outline-none`}
            />
          </form>
"""

content = content.replace("""          <div className="px-2 py-1 border-b border-stone-200 dark:border-stone-800 font-bold uppercase tracking-wider text-[10px] text-stone-400 flex items-center justify-between">
            <span>Study Soundtracks</span>
            <span className="text-[10px] text-[#991B1B] dark:text-[#F87171]">{tracks.length} Channels</span>
          </div>""", dropdown_ui)

with open('src/components/TopMusicBar.tsx', 'w') as f:
    f.write(content)
