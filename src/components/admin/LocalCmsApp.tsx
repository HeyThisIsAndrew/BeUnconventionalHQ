import React, { useEffect, useState } from 'react';

type VideoDoc = {
  _id: string;
  youtubeId: string;
  title: string;
  _type: 'video' | 'short' | 'live' | 'event';
  contentStatus: 'published' | 'needs-review' | 'archived';
  topics: string[];
  publishedAt: string;
  
  // Editorial & Taxonomy Extensions
  manualTypeOverride?: string;
  featured?: boolean;
  franchises?: string[];
  characters?: string[];
  coverageType?: string;
  series?: string;
  hubs?: string[];
  editorialNotes?: string;
  requiresReview?: boolean;
  manualTaxonomyOverride?: boolean;
  relatedMedia?: { title: string; mediaType: string }[];
};

const TABS = [
  { id: 'status', label: 'Status & Curation' },
  { id: 'overrides', label: 'Systems Overrides' },
  { id: 'taxonomy', label: 'Core Taxonomy' },
  { id: 'editorial', label: 'Editorial' }
];

export default function LocalCmsApp() {
  const [videos, setVideos] = useState<VideoDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  
  const [search, setSearch] = useState('');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('status');
  const [activeFilter, setActiveFilter] = useState('All');

  useEffect(() => {
    fetch('/api/local-cms/videos')
      .then((res) => res.json())
      .then((data) => {
        setVideos(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setMessage({ text: 'Failed to load videos', type: 'error' });
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/local-cms/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(videos),
      });
      if (!res.ok) throw new Error('Failed to save');
      setMessage({ text: 'Successfully saved videos.json!', type: 'success' });
    } catch (err) {
      console.error(err);
      setMessage({ text: 'Failed to save videos.json', type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const updateVideo = (index: number, field: keyof VideoDoc, value: any) => {
    const newVideos = [...videos];
    newVideos[index] = { ...newVideos[index], [field]: value };
    setVideos(newVideos);
  };

  if (loading) return <div className="text-gray-400">Loading videos.json payload...</div>;

  let filteredVideos = videos.filter(v => v.title.toLowerCase().includes(search.toLowerCase()) || v.youtubeId.includes(search));
  
  if (activeFilter !== 'All') {
    filteredVideos = filteredVideos.filter(v => {
      const type = v.manualTypeOverride || v._type;
      if (activeFilter === 'Videos') return type === 'video';
      if (activeFilter === 'Shorts') return type === 'short';
      if (activeFilter === 'Live') return type === 'live';
      if (activeFilter === 'Events') return type === 'event' || v.manualTypeOverride === 'event';
      if (activeFilter === 'Featured') return type === 'featuredBrand' || v.featured === true;
      return true;
    });
  }

  const selectedVideo = videos.find(v => v._id === selectedVideoId);
  const selectedIndex = videos.findIndex(v => v._id === selectedVideoId);

  return (
    <div className="space-y-4">
      {/* Top Header - Save bar */}
      <div className="flex justify-between items-center bg-[#111] p-4 rounded-xl border border-white/10 sticky top-28 z-10 shadow-2xl shadow-black">
        <div className="text-sm text-gray-400 flex items-center space-x-4">
          <span>Managing <span className="font-mono text-white">{videos.length}</span> entries locally</span>
        </div>
        <div className="flex items-center space-x-4">
          {message && (
            <span className={`text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {message.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving to Disk...' : 'Save to videos.json'}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start w-full">
        {/* Column 1: Desk Structure / Navigation */}
        <div className="w-full lg:w-48 flex-shrink-0 flex flex-col gap-1 bg-[#111] rounded-xl border border-white/10 p-2">
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Content</div>
          {['All', 'Videos', 'Shorts', 'Live', 'Events', 'Featured'].map(filter => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeFilter === filter
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        {/* Column 2: Master List */}
        <div className="w-full lg:w-1/3 xl:w-80 bg-[#111] rounded-xl border border-white/10 flex-shrink-0 flex flex-col lg:h-[80vh] max-h-[50vh] lg:max-h-none">
          <div className="p-3 border-b border-white/10 bg-black/20">
            <input 
              type="text" 
              placeholder="Search items..." 
              className="w-full bg-gray-900 border border-white/10 rounded-md px-3 py-2 text-white text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <ul className="divide-y divide-white/10 overflow-y-auto flex-1">
            {filteredVideos.map((vid) => (
              <li 
                key={vid._id} 
                className={`p-3 cursor-pointer hover:bg-white/[0.05] transition-colors ${selectedVideoId === vid._id ? 'bg-white/[0.05]' : ''}`}
                onClick={() => setSelectedVideoId(vid._id)}
              >
                <div className="flex items-center">
                  {vid.youtubeId ? (
                    <img src={`https://i.ytimg.com/vi/${vid.youtubeId}/mqdefault.jpg`} alt="" className="w-12 h-8 object-cover rounded bg-gray-800 flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-8 rounded bg-gray-800 flex-shrink-0 flex items-center justify-center text-[10px] text-gray-500 font-bold uppercase">{vid._type}</div>
                  )}
                  <div className="ml-3 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{vid.title}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      <span className={vid.contentStatus === 'published' ? 'text-green-400' : 'text-yellow-400'}>{vid.contentStatus}</span>
                      {' • '}{vid._type}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Column 3: Detail Editor */}
        <div className="w-full lg:flex-1 bg-[#111] rounded-xl border border-white/10 p-4 sm:p-6 lg:h-[80vh] overflow-y-auto">
          {selectedVideo && selectedIndex >= 0 ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white mb-2">{selectedVideo.title}</h2>
                <a href={`https://youtube.com/watch?v=${selectedVideo.youtubeId}`} target="_blank" rel="noreferrer" className="text-blue-400 text-sm hover:underline">View on YouTube</a>
              </div>

              {/* Tab Navigation */}
              <div className="flex space-x-1 border-b border-white/10 pb-px overflow-x-auto">
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                      activeTab === tab.id 
                        ? 'border-red-500 text-red-500' 
                        : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-white/30'
                    }`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="pt-2 min-h-[300px]">
                {activeTab === 'status' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 animate-in fade-in duration-200">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Status</label>
                      <select
                        value={selectedVideo.contentStatus}
                        onChange={(e) => updateVideo(selectedIndex, 'contentStatus', e.target.value)}
                        className="block w-full rounded-md border-0 py-1.5 pl-3 pr-8 bg-gray-900 text-white text-sm ring-1 ring-inset ring-white/10 focus:ring-2 sm:leading-6 focus:outline-none focus:ring-red-500"
                      >
                        <option value="published">Published</option>
                        <option value="needs-review">Needs Review</option>
                        <option value="archived">Archived</option>
                      </select>
                    </div>
                    <div className="flex flex-col justify-center space-y-3">
                      <div className="flex items-center space-x-2">
                        <input 
                          type="checkbox" 
                          id="featured" 
                          checked={selectedVideo.featured || false} 
                          onChange={(e) => updateVideo(selectedIndex, 'featured', e.target.checked)}
                          className="rounded bg-gray-900 border-white/10 text-red-500 focus:ring-red-500"
                        />
                        <label htmlFor="featured" className="text-sm font-medium text-white">Featured</label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input 
                          type="checkbox" 
                          id="requiresReview" 
                          checked={selectedVideo.requiresReview || false} 
                          onChange={(e) => updateVideo(selectedIndex, 'requiresReview', e.target.checked)}
                          className="rounded bg-gray-900 border-white/10 text-red-500 focus:ring-red-500"
                        />
                        <label htmlFor="requiresReview" className="text-sm font-medium text-white">Requires Review</label>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'overrides' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 animate-in fade-in duration-200">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Manual Type Override</label>
                      <select
                        value={selectedVideo.manualTypeOverride || ''}
                        onChange={(e) => updateVideo(selectedIndex, 'manualTypeOverride', e.target.value)}
                        className="block w-full rounded-md border-0 py-1.5 pl-3 pr-8 bg-gray-900 text-white text-sm ring-1 ring-inset ring-white/10 focus:ring-2 sm:leading-6 focus:outline-none focus:ring-red-500"
                      >
                        <option value="">(None - Auto Detect)</option>
                        <option value="video">Standard Video</option>
                        <option value="short">YouTube Short</option>
                        <option value="live">Live Stream VOD</option>
                        <option value="event">Event</option>
                      </select>
                    </div>
                    <div className="flex flex-col justify-center">
                      <div className="flex items-center space-x-2">
                        <input 
                          type="checkbox" 
                          id="manualTaxonomyOverride" 
                          checked={selectedVideo.manualTaxonomyOverride || false} 
                          onChange={(e) => updateVideo(selectedIndex, 'manualTaxonomyOverride', e.target.checked)}
                          className="rounded bg-gray-900 border-white/10 text-red-500 focus:ring-red-500"
                        />
                        <label htmlFor="manualTaxonomyOverride" className="text-sm font-medium text-white">Manual Taxonomy Override (Sync Lock)</label>
                      </div>
                      {!selectedVideo.manualTaxonomyOverride && (
                        <p className="text-xs text-yellow-500 mt-2">Lock required to edit Taxonomy tags.</p>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'taxonomy' && (
                  <div className={`grid grid-cols-1 sm:grid-cols-2 gap-6 animate-in fade-in duration-200 ${!selectedVideo.manualTaxonomyOverride ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div className="col-span-2">
                       <label className="block text-sm font-medium text-gray-400 mb-1">Series</label>
                       <input
                          type="text"
                          value={selectedVideo.series || ''}
                          onChange={(e) => updateVideo(selectedIndex, 'series', e.target.value)}
                          className="block w-full rounded-md border-0 py-1.5 px-3 bg-gray-900 text-white text-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:outline-none focus:ring-red-500"
                       />
                    </div>
                    <div className="col-span-2">
                       <label className="block text-sm font-medium text-gray-400 mb-1">Franchises (comma separated)</label>
                       <input
                          type="text"
                          value={selectedVideo.franchises?.join(', ') || ''}
                          onChange={(e) => updateVideo(selectedIndex, 'franchises', e.target.value.split(',').map((s: string)=>s.trim()).filter(Boolean))}
                          className="block w-full rounded-md border-0 py-1.5 px-3 bg-gray-900 text-white text-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:outline-none focus:ring-red-500"
                       />
                    </div>
                    <div className="col-span-2">
                       <label className="block text-sm font-medium text-gray-400 mb-1">Characters (comma separated)</label>
                       <input
                          type="text"
                          value={selectedVideo.characters?.join(', ') || ''}
                          onChange={(e) => updateVideo(selectedIndex, 'characters', e.target.value.split(',').map((s: string)=>s.trim()).filter(Boolean))}
                          className="block w-full rounded-md border-0 py-1.5 px-3 bg-gray-900 text-white text-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:outline-none focus:ring-red-500"
                       />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Topics (comma separated slugs)</label>
                      <input
                          type="text"
                          value={selectedVideo.topics?.join(', ') || ''}
                          onChange={(e) => updateVideo(selectedIndex, 'topics', e.target.value.split(',').map((s: string)=>s.trim()).filter(Boolean))}
                          className="block w-full rounded-md border-0 py-1.5 px-3 bg-gray-900 text-white text-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:outline-none focus:ring-red-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Hubs (comma separated slugs)</label>
                      <input
                          type="text"
                          value={selectedVideo.hubs?.join(', ') || ''}
                          onChange={(e) => updateVideo(selectedIndex, 'hubs', e.target.value.split(',').map((s: string)=>s.trim()).filter(Boolean))}
                          className="block w-full rounded-md border-0 py-1.5 px-3 bg-gray-900 text-white text-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:outline-none focus:ring-red-500"
                      />
                    </div>
                  </div>
                )}

                {activeTab === 'editorial' && (
                  <div className="grid grid-cols-1 gap-6 animate-in fade-in duration-200">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-1">Coverage Type</label>
                      <select
                        value={selectedVideo.coverageType || ''}
                        onChange={(e) => updateVideo(selectedIndex, 'coverageType', e.target.value)}
                        className="block w-full rounded-md border-0 py-1.5 pl-3 pr-8 bg-gray-900 text-white text-sm ring-1 ring-inset ring-white/10 focus:ring-2 sm:leading-6 focus:outline-none focus:ring-red-500"
                      >
                        <option value="">(None)</option>
                        <option value="review">Review</option>
                        <option value="reaction">Reaction</option>
                        <option value="trailer">Trailer</option>
                        <option value="breakdown">Breakdown</option>
                        <option value="vlog">Vlog</option>
                        <option value="interview">Interview</option>
                        <option value="news">News</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                       <label className="block text-sm font-medium text-gray-400 mb-1">Editorial Notes</label>
                       <textarea
                          rows={3}
                          value={selectedVideo.editorialNotes || ''}
                          onChange={(e) => updateVideo(selectedIndex, 'editorialNotes', e.target.value)}
                          className="block w-full rounded-md border-0 py-1.5 px-3 bg-gray-900 text-white text-sm ring-1 ring-inset ring-white/10 focus:ring-2 focus:outline-none focus:ring-red-500"
                       />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-50">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="3" y1="9" x2="21" y2="9"></line>
                <line x1="9" y1="21" x2="9" y2="9"></line>
              </svg>
              <p>Select a document from the list to edit its properties</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
