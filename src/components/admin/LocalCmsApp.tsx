import React, { useEffect, useMemo, useState } from 'react';

type DocType = 'video' | 'short' | 'live' | 'event' | 'featuredBrand' | 'topic';

type LocationInfo = { venue?: string; city?: string; region?: string; country?: string };

type Doc = {
  _id: string;
  _type: DocType;
  title: string;

  // video / short / live
  youtubeId?: string;
  description?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  isShort?: boolean;
  isLive?: boolean;
  isEvent?: boolean;
  viewCount?: number;
  publishedAt?: string;
  youtubeTags?: string[];
  platform?: string;
  lastSyncedAt?: string;
  contentStatus?: 'published' | 'needs-review' | 'archived';
  manualTypeOverride?: string;
  featured?: boolean;
  franchises?: string[];
  characters?: string[];
  coverageType?: string;
  series?: string;
  editorialNotes?: string;
  topics?: string[];
  hubs?: string[];
  requiresReview?: boolean;
  manualTaxonomyOverride?: boolean;
  relatedMedia?: { title: string; mediaType: string }[];

  // event / featuredBrand
  slug?: { _type: 'slug'; current: string };
  status?: string;
  eventType?: string;
  startDate?: string;
  endDate?: string;
  location?: LocationInfo;
  organizer?: string;
  officialWebsite?: string;
  signUpLink?: string;
  trailerUrl?: string;
  logo?: any;
  heroImage?: any;
  youtubeSyncKeywords?: string[];
  brandColor?: { hex?: string };
  socialLinks?: { platform: string; url: string }[];
  metrics?: {
    snapshots: { date: string; viewCount: number }[];
    viewVelocity7d: number;
    lastComputedAt: string;
  };
  videoAssets?: { title: string; url: string }[];
  gallery?: { url: string; alt: string }[];
  sponsors?: { name: string; logo: string; url: string }[];
  pressAssets?: { label: string; url: string }[];
  videoIds?: string[];
  articleUrls?: string[];

  // topic
  isTier1Category?: boolean;
  emptyStateMessage?: string;
};

const CONTENT_TABS = [
  { id: 'factual', label: 'Factual (Read-Only)' },
  { id: 'status', label: 'Status & Curation' },
  { id: 'overrides', label: 'Systems Overrides' },
  { id: 'taxonomy', label: 'Core Taxonomy' },
  { id: 'editorial', label: 'Editorial' },
];

const TYPE_META: Record<string, { label: string; badge: string }> = {
  video: { label: 'Video', badge: 'bg-blue-500/20 text-blue-300' },
  short: { label: 'Short', badge: 'bg-purple-500/20 text-purple-300' },
  live: { label: 'Live', badge: 'bg-red-500/20 text-red-300' },
  event: { label: 'Event', badge: 'bg-amber-500/20 text-amber-300' },
  featuredBrand: { label: 'Featured', badge: 'bg-emerald-500/20 text-emerald-300' },
  topic: { label: 'Topic', badge: 'bg-indigo-500/20 text-indigo-300' },
};

// Helper for parsing sanity image references or plain strings
const getImageUrl = (image: any) => {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (image.asset && image.asset._ref) {
    const ref = image.asset._ref;
    const parts = ref.split('-');
    if (parts.length >= 4) {
      const ext = parts.pop();
      const dim = parts.pop();
      const hash = parts.slice(1).join('-');
      return `https://cdn.sanity.io/images/38nhxsib/production/${hash}-${dim}.${ext}`;
    }
  }
  return null;
};

const FILTERS = ['All', 'Videos', 'Shorts', 'Live', 'Events', 'Featured', 'Topics'] as const;
type Filter = (typeof FILTERS)[number] | 'GlobalStatus';

const FILTER_LABELS: Record<Filter, string> = {
  All: 'All Content',
  Videos: 'Videos',
  Shorts: 'Shorts',
  Live: 'Live',
  Events: 'Events',
  Featured: 'Featured Brands',
  Topics: 'Topics',
  GlobalStatus: 'Global Status',
};

// Grouped by what these actually are in our local schema - video/short/live
// are YouTube-sourced content; event/featuredBrand are hand-curated hub
// pages. Topics are taxonomy nodes.
const FILTER_GROUPS: { label: string; filters: Filter[] }[] = [
  { label: 'Content', filters: ['All', 'Videos', 'Shorts', 'Live'] },
  { label: 'Hubs & Pages', filters: ['Events', 'Featured'] },
  { label: 'Taxonomy', filters: ['Topics'] },
];

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || `untitled-${Date.now()}`
  );
}

function videoDocId(youtubeId: string): string {
  return `youtube-${youtubeId}`;
}

function makeBlankDoc(type: DocType): Doc {
  const now = new Date().toISOString();
  if (type === 'event') {
    return {
      _id: `local-${crypto.randomUUID()}`,
      _type: 'event',
      title: 'New Event',
      slug: { _type: 'slug', current: slugify(`new-event-${Date.now()}`) },
      status: 'scheduled',
      eventType: 'convention',
      startDate: '',
      endDate: '',
      location: { venue: '', city: '', region: '', country: '' },
      description: '',
      organizer: '',
      officialWebsite: '',
      signUpLink: '',
      trailerUrl: '',
      logo: '',
      heroImage: '',
      youtubeSyncKeywords: [],
      videoAssets: [],
      gallery: [],
      sponsors: [],
      pressAssets: [],
    };
  }
  if (type === 'featuredBrand') {
    return {
      _id: `local-${crypto.randomUUID()}`,
      _type: 'featuredBrand',
      title: 'New Brand',
      slug: { _type: 'slug', current: slugify(`new-brand-${Date.now()}`) },
      trailerUrl: '',
      logo: '',
      heroImage: '',
      youtubeSyncKeywords: [],
    };
  }
  if (type === 'topic') {
    return {
      _id: `topic-${crypto.randomUUID()}`,
      _type: 'topic',
      title: 'New Topic',
      slug: { _type: 'slug', current: slugify(`new-topic-${Date.now()}`) },
      isTier1Category: false,
      youtubeSyncKeywords: [],
      emptyStateMessage: '',
    };
  }
  return {
    _id: `local-pending-${crypto.randomUUID()}`,
    _type: type,
    youtubeId: '',
    title: `New ${TYPE_META[type].label}`,
    description: '',
    thumbnailUrl: '',
    durationSeconds: 0,
    isShort: type === 'short',
    isLive: type === 'live',
    isEvent: false,
    viewCount: 0,
    publishedAt: now,
    youtubeTags: [],
    platform: 'youtube',
    lastSyncedAt: now,
    contentStatus: 'needs-review',
    manualTypeOverride: type,
    featured: false,
    franchises: [],
    characters: [],
    coverageType: '',
    series: '',
    editorialNotes: '',
    topics: [],
    hubs: [],
    requiresReview: true,
    // Hand-authored, not sync-derived - lock taxonomy so a later sync run
    // can't quietly overwrite what was typed in here.
    manualTaxonomyOverride: true,
    videoIds: [],
    articleUrls: [],
  };
}

const inputClass =
  'block w-full rounded-md border-0 py-2 px-3 bg-[#151515] text-white text-sm ring-1 ring-inset ring-white/10 placeholder:text-gray-600 focus:ring-2 focus:outline-none focus:ring-red-500';
const textareaClass = `${inputClass} resize-y min-h-[140px] leading-relaxed`;
const labelClass = 'block text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2';
const sectionClass = 'space-y-6';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

function ImageUploadField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [uploading, setUploading] = useState(false);
  
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await fetch('/api/local-cms/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      onChange(data.url);
    } catch (err) {
      alert('Failed to upload image');
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} className={`${inputClass} flex-1`} placeholder="https://... or /uploads/..." />
        <label className={`flex-none flex items-center justify-center px-4 py-2 text-white font-bold text-xs rounded-xl transition-colors shadow-lg ${uploading ? 'bg-red-800 cursor-wait' : 'bg-red-600 hover:bg-red-500 cursor-pointer'}`}>
          {uploading ? 'Uploading...' : 'Upload'}
          <input type="file" accept="image/*" onChange={handleUpload} className="hidden" disabled={uploading} />
        </label>
      </div>
      {value && typeof value === 'string' && !value.startsWith('image-') && (
        <div className="mt-2">
          <img src={value} alt="Preview" className="h-20 object-contain rounded-md bg-black/50 border border-white/10 p-1" />
        </div>
      )}
    </Field>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="group flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3.5 cursor-pointer hover:bg-white/[0.04] transition-all duration-300 shadow-sm">
      <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">{label}</span>
      <span className="relative inline-flex h-5 w-9 flex-shrink-0 items-center">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className="absolute inset-0 rounded-full bg-white/10 peer-checked:bg-gradient-to-r peer-checked:from-red-600 peer-checked:to-rose-500 transition-all duration-300 peer-checked:shadow-[0_0_12px_rgba(220,38,38,0.5)]" />
        <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-md transition-all duration-300 peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

export default function LocalCmsApp() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('status');
  const [activeFilter, setActiveFilter] = useState<Filter | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/local-cms/videos')
      .then((res) => res.json())
      .then((data) => {
        setDocs(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setMessage({ text: 'Failed to load videos.json', type: 'error' });
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
        body: JSON.stringify(docs),
      });
      if (!res.ok) throw new Error('Failed to save');
      setMessage({ text: 'Saved to videos.json', type: 'success' });
    } catch (err) {
      console.error(err);
      setMessage({ text: 'Failed to save videos.json', type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const updateDoc = (id: string, field: keyof Doc, value: any) => {
    if (field === 'youtubeId' && typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        const newId = videoDocId(trimmed);
        const collision = docs.find((d) => d._id === newId && d._id !== id);
        if (collision) {
          alert(
            `"${collision.title}" already uses YouTube ID ${trimmed}. Pick a different ID, or find and edit that existing document instead - two docs can't share the same ID.`,
          );
          return;
        }
        setDocs((prev) => prev.map((d) => (d._id === id ? { ...d, youtubeId: value, _id: newId } : d)));
        setSelectedId(newId);
        return;
      }
      // Cleared to empty: regenerate _id so it doesn't keep squatting on the
      // old youtube-<id> slot (a phantom lock - another doc could never use
      // that YouTube ID again while this stale reference existed).
      const freshId = `local-pending-${crypto.randomUUID()}`;
      setDocs((prev) => prev.map((d) => (d._id === id ? { ...d, youtubeId: value, _id: freshId } : d)));
      setSelectedId(freshId);
      return;
    }
    setDocs((prev) => prev.map((d) => (d._id === id ? { ...d, [field]: value } : d)));
  };

  const updateSlug = (id: string, value: string) => {
    const doc = docs.find((d) => d._id === id);
    if (!doc) return;
    const newSlug = slugify(value);
    // Same-type collision would break static route generation (two docs
    // mapping to the same /events/<slug> or /featured/<slug> path).
    const collision = docs.find((d) => d._id !== id && d._type === doc._type && d.slug?.current === newSlug);
    if (collision) {
      alert(`"${collision.title}" already uses the slug "${newSlug}". Pick a different one - two ${TYPE_META[doc._type].label} docs can't share a route.`);
      return;
    }
    setDocs((prev) => prev.map((d) => (d._id === id ? { ...d, slug: { _type: 'slug', current: newSlug } } : d)));
  };

  const updateLocation = (id: string, field: keyof LocationInfo, value: string) => {
    setDocs((prev) =>
      prev.map((d) => (d._id === id ? { ...d, location: { ...(d.location || {}), [field]: value } } : d)),
    );
  };

  const createDoc = (type: DocType) => {
    const blank = makeBlankDoc(type);
    setDocs((prev) => [blank, ...prev]);
    setSelectedId(blank._id);
    setActiveTab('status');
    setActiveFilter(
      type === 'event'
        ? 'Events'
        : type === 'featuredBrand'
          ? 'Featured'
          : type === 'short'
            ? 'Shorts'
            : type === 'live'
              ? 'Live'
              : 'Videos',
    );
    setSearch('');
  };

  const deleteDoc = (id: string) => {
    const doc = docs.find((d) => d._id === id);
    if (!doc) return;
    if (!confirm(`Delete "${doc.title}"? This can't be undone until you Save, but it's gone from this session either way.`)) return;
    setDocs((prev) => prev.filter((d) => d._id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const filterCounts = useMemo(() => {
    let counts = { All: 0, Videos: 0, Shorts: 0, Live: 0, Events: 0, Featured: 0, Topics: 0 };
    docs.forEach((d) => {
      const type = d.manualTypeOverride || d._type;
      if (['video', 'short', 'live'].includes(type as string)) counts.All++;
      if (type === 'video') counts.Videos++;
      if (type === 'short') counts.Shorts++;
      if (type === 'live') counts.Live++;
      if (type === 'event' || d.manualTypeOverride === 'event') counts.Events++;
      if (type === 'featuredBrand' || d.featured === true) counts.Featured++;
      if (type === 'topic') counts.Topics++;
    });
    return counts;
  }, [docs]);

  const filteredDocs = useMemo(() => {
    let list = docs.filter(
      (d) => d.title?.toLowerCase().includes(search.toLowerCase()) || d.youtubeId?.includes(search),
    );
    if (activeFilter && activeFilter !== 'GlobalStatus') {
      list = list.filter((d) => {
        const type = d.manualTypeOverride || d._type;
        if (activeFilter === 'All') return ['video', 'short', 'live'].includes(type as string);
        if (activeFilter === 'Videos') return type === 'video';
        if (activeFilter === 'Shorts') return type === 'short';
        if (activeFilter === 'Live') return type === 'live';
        if (activeFilter === 'Events') return type === 'event' || d.manualTypeOverride === 'event';
        if (activeFilter === 'Featured') return type === 'featuredBrand' || d.featured === true;
        if (activeFilter === 'Topics') return type === 'topic';
        return true;
      });
    }
    if (statusFilter) {
      list = list.filter((d) => {
        if (d._type === 'topic') return false;
        const status = d.contentStatus || d.status;
        if (statusFilter === 'published') return status === 'published' || status === 'live' || status === 'completed';
        if (statusFilter === 'needs-review') return status === 'needs-review';
        return status !== 'published' && status !== 'live' && status !== 'completed' && status !== 'needs-review';
      });
    }
    return list;
  }, [docs, search, activeFilter, statusFilter]);

  const statusCounts = useMemo(() => {
    let published = 0;
    let needsReview = 0;
    let other = 0;

    docs.forEach((doc) => {
      if (doc._type === 'topic') return; // Topics are taxonomy nodes without statuses
      
      const status = doc.contentStatus || doc.status;
      if (status === 'published' || status === 'live' || status === 'completed') published++;
      else if (status === 'needs-review') needsReview++;
      else other++; // Drafts, scheduled, missing statuses
    });

    return { published, needsReview, other };
  }, [docs]);

  if (loading) {
    return <div className="text-gray-400 text-sm p-6">Loading videos.json payload…</div>;
  }

  const selected = docs.find((d) => d._id === selectedId) || null;

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1600px] mx-auto text-[13px] text-gray-200">
      {/* Save bar - own row, always full width */}
      <div className="w-full flex flex-wrap gap-4 justify-between items-center bg-black/40 backdrop-blur-2xl border border-white/10 rounded-2xl z-20 shadow-2xl" style={{ padding: '1.5rem' }}>
        <div className="flex flex-col gap-4 flex-1">
          <div className="text-xl text-white font-black tracking-widest uppercase flex items-center gap-4">
            MANAGING <span className="font-mono text-white bg-white/10 px-4 py-1.5 rounded-lg border border-white/20 text-2xl leading-none">{docs.length}</span> DOCUMENTS LOCALLY
          </div>
          <div className="flex items-stretch gap-3 text-xs font-bold uppercase tracking-widest w-full">
            {statusCounts.published > 0 && (
              <button 
                onClick={() => {
                  setStatusFilter(statusFilter === 'published' ? null : 'published');
                  setActiveFilter('GlobalStatus');
                }}
                className={`flex-1 px-4 py-2.5 rounded-lg border transition-all duration-200 text-center ${statusFilter === 'published' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 ring-2 ring-emerald-500/30' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15'}`}
              >
                {statusCounts.published} Published
              </button>
            )}
            {statusCounts.needsReview > 0 && (
              <button 
                onClick={() => {
                  setStatusFilter(statusFilter === 'needs-review' ? null : 'needs-review');
                  setActiveFilter('GlobalStatus');
                }}
                className={`flex-1 px-4 py-2.5 rounded-lg border transition-all duration-200 text-center ${statusFilter === 'needs-review' ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 ring-2 ring-amber-500/30' : 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/15'}`}
              >
                {statusCounts.needsReview} Needs Review
              </button>
            )}
            {statusCounts.other > 0 && (
              <button 
                onClick={() => {
                  setStatusFilter(statusFilter === 'other' ? null : 'other');
                  setActiveFilter('GlobalStatus');
                }}
                className={`flex-1 px-4 py-2.5 rounded-lg border transition-all duration-200 text-center ${statusFilter === 'other' ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 ring-2 ring-rose-500/30' : 'bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/15'}`}
              >
                {statusCounts.other} Drafts / Other
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-5">
          {message && (
            <span className={`text-sm font-medium animate-pulse ${message.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {message.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-shrink-0 relative group bg-gradient-to-br from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white rounded-xl text-base font-bold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(220,38,38,0.3)] hover:shadow-[0_0_25px_rgba(220,38,38,0.5)] transform hover:-translate-y-0.5"
            style={{ padding: '1rem 2rem' }}
          >
            <span className="relative z-10">{saving ? 'Saving to disk…' : 'Save to videos.json'}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3 items-start w-full">
      {/* Structure pane */}
      <div className={`${activeFilter || selectedId ? 'hidden lg:flex' : 'flex'} w-full lg:w-64 flex-shrink-0 flex-col bg-[#111214] rounded-lg border border-white/10 lg:h-[75vh] overflow-y-auto`} style={{ paddingTop: '1.5rem', paddingBottom: '1.5rem' }}>
        <div className="flex flex-col">
          {FILTER_GROUPS.map((group, index) => (
            <div key={group.label} className={index > 0 ? "mt-4" : ""} style={{ paddingBottom: '1.5rem' }}>
              <div className="px-6 pb-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                {group.label}
              </div>
              <div className="flex flex-col">
                {group.filters.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => { setActiveFilter(filter); setSelectedId(null); }}
                    className={`w-full text-left px-4 py-4 transition-all duration-200 border-l-2 border-b border-white/10 group ${
                      activeFilter === filter && !selectedId ? 'bg-white/[0.06] border-l-red-500' : 'hover:bg-white/[0.03] border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between min-h-[54px] w-full">
                      <span className={`text-sm font-black uppercase tracking-widest ${activeFilter === filter && !selectedId ? 'text-white' : 'text-gray-400 group-hover:text-white'}`}>
                        {FILTER_LABELS[filter]}
                      </span>
                      <span className="text-xs font-bold text-gray-600 bg-white/5 px-2 py-1 rounded-full">{filterCounts[filter as keyof typeof filterCounts]}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-auto" style={{ paddingTop: '1.5rem' }}>
          <div className="px-6 pb-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            Create
          </div>
          <div className="flex flex-col">
            {(['video', 'short', 'live', 'event', 'featuredBrand'] as DocType[]).map((type) => (
              <button
                key={type}
                onClick={() => createDoc(type)}
                className="group w-full text-left px-4 py-4 transition-all duration-200 border-l-2 border-l-transparent border-b border-white/10 text-gray-300 hover:bg-white/[0.03] hover:text-white"
              >
                <div className="flex items-center gap-3 min-h-[54px] w-full">
                  <div className="flex items-center justify-center w-6 h-6 rounded-md bg-white/5 text-red-400 font-bold group-hover:bg-red-500 group-hover:text-white transition-colors flex-shrink-0">+</div>
                  <span className="font-black uppercase tracking-widest text-sm text-white">New {type === 'featuredBrand' ? 'Featured' : type}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`${!activeFilter && !selectedId ? 'hidden' : 'flex'} flex-col lg:flex-row gap-3 items-start w-full lg:flex-1 min-w-0`}>
        {/* Document list pane */}
        <div className={`${!activeFilter ? 'hidden' : (selectedId ? 'hidden lg:flex' : 'flex')} w-full lg:w-80 flex-shrink-0 bg-[#111214] rounded-lg border border-white/10 flex-col lg:h-[75vh] max-h-[50vh] lg:max-h-none overflow-hidden relative`}>
          <div className="border-b border-white/10 bg-[#151515] z-10 relative flex items-center gap-3 p-3">
            <button 
              onClick={() => setActiveFilter(null)}
              className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-gray-400 hover:text-white transition-colors flex-shrink-0"
              title="Back to structure"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div className="relative flex-1">
              <svg className="absolute top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" style={{ left: '0.75rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
              <input
                type="text"
                placeholder="Search by title or ID…"
                className="w-full bg-white/5 border border-white/10 rounded-xl pr-3 py-2.5 text-white text-sm focus:ring-2 focus:ring-red-500/50 focus:bg-white/10 focus:border-red-500/50 transition-all duration-300 outline-none placeholder:text-gray-600"
                style={{ paddingLeft: '2.5rem' }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <ul className="overflow-y-auto flex-1 min-h-0 custom-scrollbar z-0 relative">
            {filteredDocs.length === 0 && (
              <li className="p-8 flex flex-col items-center justify-center text-gray-500 text-sm gap-3">
                <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
                No documents match.
              </li>
            )}
            {filteredDocs.map((doc) => {
              const meta = TYPE_META[doc._type] ?? TYPE_META.video;
              return (
                <li
                  key={doc._id}
                  className={`px-4 py-4 cursor-pointer transition-all duration-200 border-l-2 border-b border-white/10 ${
                    selectedId === doc._id ? 'bg-white/[0.06] border-l-red-500' : 'hover:bg-white/[0.03] border-l-transparent'
                  }`}
                  onClick={() => setSelectedId(doc._id)}
                >
                  <div 
                    className={`flex items-center ${meta.label === 'Topic' ? 'min-h-[54px]' : 'gap-3.5'}`}
                    style={meta.label === 'Topic' ? { paddingLeft: '1.5rem' } : undefined}
                  >
                    {meta.label !== 'Topic' && (
                      <div className="relative group flex-shrink-0">
                        {doc.youtubeId || getImageUrl(doc.heroImage) || getImageUrl(doc.logo) ? (
                          <img
                            src={doc.youtubeId ? `https://i.ytimg.com/vi/${doc.youtubeId}/mqdefault.jpg` : (getImageUrl(doc.heroImage) || getImageUrl(doc.logo) || undefined)}
                            alt=""
                            className="w-24 aspect-video object-cover rounded-md bg-gray-900 shadow-md group-hover:shadow-lg transition-shadow"
                          />
                        ) : (
                          <div className="w-24 aspect-video rounded-md bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center text-[10px] text-gray-400 font-bold uppercase text-center leading-tight shadow-inner ring-1 ring-inset ring-white/5">
                            {meta.label}
                          </div>
                        )}
                        <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-md pointer-events-none" />
                      </div>
                    )}
                    <div className="min-w-0 space-y-1.5 flex-1">
                      <p className={`text-white truncate leading-tight group-hover:text-red-100 transition-colors ${
                        meta.label === 'Topic' ? 'text-sm font-black uppercase tracking-widest' : 'text-sm font-semibold'
                      }`}>{doc.title || '(untitled)'}</p>
                      <div className="flex items-center gap-2">
                        {meta.label !== 'Topic' && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${meta.badge}`}>{meta.label}</span>
                        )}
                        {doc.contentStatus && (
                          <span className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${doc.contentStatus === 'published' ? 'text-emerald-400' : 'text-amber-400'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${doc.contentStatus === 'published' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`}></span>
                            {doc.contentStatus}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Document pane */}
        <div className={`${!selectedId ? 'hidden lg:flex' : 'flex'} flex-col @container w-full lg:flex-1 min-w-0 bg-[#111214] rounded-lg border border-white/10 lg:h-[75vh] relative`}>
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-600 p-6">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mb-3 opacity-50"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="3" y1="9" x2="21" y2="9"></line>
                <line x1="9" y1="21" x2="9" y2="9"></line>
              </svg>
              <p className="text-sm">Select a document, or create a new one from the left.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 p-4 border-b border-white/10">
                <button 
                  onClick={() => setSelectedId(null)}
                  className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-gray-400 hover:text-white transition-colors flex-shrink-0"
                  title="Back to list"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${TYPE_META[selected._type]?.badge}`}>
                      {TYPE_META[selected._type]?.label ?? selected._type}
                    </span>
                    <span className="text-[11px] text-gray-500 font-mono truncate bg-black/30 px-2 py-0.5 rounded-md">{selected._id}</span>
                  </div>
                  <h2 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 truncate tracking-tight">{selected.title}</h2>
                  {selected.youtubeId && (
                    <a
                      href={`https://youtube.com/watch?v=${selected.youtubeId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-red-400 text-xs font-semibold hover:text-red-300 mt-2 hover:underline transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                      View on YouTube
                    </a>
                  )}
                </div>
                {!(selected._type === 'topic' && ['film', 'tv', 'gaming', 'events', 'uncategorized'].includes(selected.slug?.current || '')) ? (
                  <button
                    onClick={() => deleteDoc(selected._id)}
                    className="flex-shrink-0 text-xs font-bold text-rose-500 hover:text-white border border-rose-500/30 hover:border-rose-500 hover:bg-rose-600 rounded-lg px-3 py-2 transition-all duration-300 shadow-sm hover:shadow-[0_0_15px_rgba(225,29,72,0.4)]"
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    disabled
                    title="Core taxonomy nodes cannot be deleted."
                    className="flex-shrink-0 text-xs font-bold text-gray-500 border border-white/5 bg-white/5 rounded-lg px-3 py-2 cursor-not-allowed opacity-50"
                  >
                    Delete (Locked)
                  </button>
                )}
              </div>


              <div className="flex-1 p-5 sm:p-6">
                {(selected._type === 'video' || selected._type === 'short' || selected._type === 'live') && (
                  <VideoForm doc={selected} activeTab={activeTab} setActiveTab={setActiveTab} updateDoc={updateDoc} />
                )}
                {selected._type === 'event' && (
                  <EventForm doc={selected} updateDoc={updateDoc} updateSlug={updateSlug} updateLocation={updateLocation} />
                )}
                {selected._type === 'featuredBrand' && (
                  <BrandForm doc={selected} updateDoc={updateDoc} updateSlug={updateSlug} />
                )}
                {selected._type === 'topic' && (
                  <TopicForm doc={selected} updateDoc={updateDoc} updateSlug={updateSlug} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function TagsInput({ label, value, onChange }: { label: string; value?: string[]; onChange: (v: string[]) => void }) {
  const [inputValue, setInputValue] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const newTag = inputValue.trim().replace(/,$/, '');
      if (newTag && !(value || []).includes(newTag)) {
        onChange([...(value || []), newTag]);
      }
      setInputValue('');
    } else if (e.key === 'Backspace' && inputValue === '' && (value?.length || 0) > 0) {
      e.preventDefault();
      onChange((value || []).slice(0, -1));
    }
  };

  const removeTag = (indexToRemove: number) => {
    onChange((value || []).filter((_, i) => i !== indexToRemove));
  };

  return (
    <Field label={label}>
      <div className={`${inputClass} flex flex-wrap gap-2 items-center p-2 min-h-[46px]`}>
        {(value || []).map((tag, index) => (
          <span key={index} className="flex items-center gap-1.5 bg-red-500/20 text-red-200 px-2.5 py-1 rounded-md text-xs font-medium border border-red-500/30 shadow-sm">
            {tag}
            <button 
              type="button" 
              onClick={(e) => { e.preventDefault(); removeTag(index); }}
              className="text-red-400 hover:text-white transition-colors focus:outline-none bg-black/20 rounded-full w-4 h-4 flex items-center justify-center ml-0.5"
            >
              &times;
            </button>
          </span>
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            const newTag = inputValue.trim().replace(/,$/, '');
            if (newTag && !(value || []).includes(newTag)) {
              onChange([...(value || []), newTag]);
            }
            setInputValue('');
          }}
          className="flex-1 bg-transparent outline-none min-w-[120px] text-sm text-gray-200 placeholder:text-gray-600"
          placeholder={(value || []).length === 0 ? "Type and press enter..." : ""}
        />
      </div>
    </Field>
  );
}

function RelatedMediaArray({ value, onChange }: { value?: { title: string; mediaType: string }[]; onChange: (v: { title: string; mediaType: string }[]) => void }) {
  const items = value || [];
  return (
    <Field label="Related Media">
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input type="text" value={item.title || ''} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], title: e.target.value };
              onChange(newItems);
            }} className={inputClass} placeholder="Title" />
            <select value={item.mediaType || 'article'} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], mediaType: e.target.value };
              onChange(newItems);
            }} className={inputClass}>
              <option value="article">Article</option>
              <option value="video">Video</option>
              <option value="podcast">Podcast</option>
            </select>
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="px-3 py-2 bg-red-900/30 text-red-400 rounded hover:bg-red-900/50">X</button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...items, { title: '', mediaType: 'article' }])} className="text-sm text-gray-400 hover:text-white">+ Add Media</button>
      </div>
    </Field>
  );
}

function VideoAssetsArray({ value, onChange }: { value?: { title: string; url: string }[]; onChange: (v: { title: string; url: string }[]) => void }) {
  const items = value || [];
  return (
    <Field label="Video Assets">
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input type="text" value={item.title || ''} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], title: e.target.value };
              onChange(newItems);
            }} className={`${inputClass} flex-1`} placeholder="Title" />
            <input type="text" value={item.url || ''} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], url: e.target.value };
              onChange(newItems);
            }} className={`${inputClass} flex-[2]`} placeholder="YouTube URL" />
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="px-3 py-2 bg-red-900/30 text-red-400 rounded hover:bg-red-900/50">X</button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...items, { title: '', url: '' }])} className="text-sm text-gray-400 hover:text-white border border-white/10 rounded px-3 py-1">+ Add Video Asset</button>
      </div>
    </Field>
  );
}

function GalleryArray({ value, onChange }: { value?: { url: string; alt: string }[]; onChange: (v: { url: string; alt: string }[]) => void }) {
  const items = value || [];
  return (
    <Field label="Image Gallery">
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input type="text" value={item.url || ''} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], url: e.target.value };
              onChange(newItems);
            }} className={`${inputClass} flex-1`} placeholder="Image URL" />
            <input type="text" value={item.alt || ''} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], alt: e.target.value };
              onChange(newItems);
            }} className={`${inputClass} flex-1`} placeholder="Alt Text" />
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="px-3 py-2 bg-red-900/30 text-red-400 rounded hover:bg-red-900/50">X</button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...items, { url: '', alt: '' }])} className="text-sm text-gray-400 hover:text-white border border-white/10 rounded px-3 py-1">+ Add Image</button>
      </div>
    </Field>
  );
}

function SponsorsArray({ value, onChange }: { value?: { name: string; logo: string; url: string }[]; onChange: (v: { name: string; logo: string; url: string }[]) => void }) {
  const items = value || [];
  return (
    <Field label="Sponsor Logos">
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input type="text" value={item.name || ''} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], name: e.target.value };
              onChange(newItems);
            }} className={`${inputClass} flex-1`} placeholder="Name" />
            <input type="text" value={item.logo || ''} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], logo: e.target.value };
              onChange(newItems);
            }} className={`${inputClass} flex-1`} placeholder="Logo URL" />
            <input type="text" value={item.url || ''} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], url: e.target.value };
              onChange(newItems);
            }} className={`${inputClass} flex-1`} placeholder="Website URL" />
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="px-3 py-2 bg-red-900/30 text-red-400 rounded hover:bg-red-900/50">X</button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...items, { name: '', logo: '', url: '' }])} className="text-sm text-gray-400 hover:text-white border border-white/10 rounded px-3 py-1">+ Add Sponsor</button>
      </div>
    </Field>
  );
}

function PressAssetsArray({ value, onChange }: { value?: { label: string; url: string }[]; onChange: (v: { label: string; url: string }[]) => void }) {
  const items = value || [];
  return (
    <Field label="Press Assets">
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input type="text" value={item.label || ''} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], label: e.target.value };
              onChange(newItems);
            }} className={`${inputClass} flex-1`} placeholder="Label (e.g. One-sheet)" />
            <input type="text" value={item.url || ''} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], url: e.target.value };
              onChange(newItems);
            }} className={`${inputClass} flex-[2]`} placeholder="File URL" />
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="px-3 py-2 bg-red-900/30 text-red-400 rounded hover:bg-red-900/50">X</button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...items, { label: '', url: '' }])} className="text-sm text-gray-400 hover:text-white border border-white/10 rounded px-3 py-1">+ Add Press Asset</button>

      </div>
    </Field>
  );
}

function SocialLinksArray({ value, onChange }: { value?: { platform: string; url: string }[]; onChange: (v: { platform: string; url: string }[]) => void }) {
  const items = value || [];
  return (
    <Field label="Social Links">
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input type="text" value={item.platform || ''} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], platform: e.target.value };
              onChange(newItems);
            }} className={inputClass} placeholder="Platform" />
            <input type="text" value={item.url || ''} onChange={(e) => {
              const newItems = [...items];
              newItems[i] = { ...newItems[i], url: e.target.value };
              onChange(newItems);
            }} className={inputClass} placeholder="URL" />
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="px-3 py-2 bg-red-900/30 text-red-400 rounded hover:bg-red-900/50">X</button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...items, { platform: '', url: '' }])} className="text-sm text-gray-400 hover:text-white">+ Add Link</button>
      </div>
    </Field>
  );
}

function VideoForm({
  doc,
  activeTab,
  setActiveTab,
  updateDoc,
}: {
  doc: Doc;
  activeTab: string;
  setActiveTab: (t: string) => void;
  updateDoc: (id: string, field: keyof Doc, value: any) => void;
}) {
  const update = (field: keyof Doc, value: any) => updateDoc(doc._id, field, value);
  return (
    <div className={sectionClass}>
      <div className="grid grid-cols-1 @lg:grid-cols-2 gap-4">
        <Field label="Title">
          <input type="text" value={doc.title || ''} onChange={(e) => update('title', e.target.value)} className={inputClass} />
        </Field>
        <Field label="YouTube ID">
          <input
            type="text"
            value={doc.youtubeId || ''}
            onChange={(e) => update('youtubeId', e.target.value)}
            className={inputClass}
            placeholder="dQw4w9WgXcQ"
          />
          {!doc.youtubeId && (
            <p className="text-xs text-yellow-500 mt-1.5">
              Required for this doc to render anywhere on the site (thumbnail, playback, ID).
            </p>
          )}
        </Field>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-2">
        {CONTENT_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`flex-none px-4 py-2 text-sm font-bold tracking-wide rounded-lg whitespace-nowrap transition-colors ${
              activeTab === tab.id ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-white/5 text-gray-400 border border-white/5 hover:text-gray-200 hover:bg-white/10'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pt-1 min-h-[280px]">
        {activeTab === 'factual' && (
          <div className="space-y-4">
            <Field label="Content Status (Read Only)">
              <div className="text-sm font-medium bg-white/5 border border-white/10 rounded px-3 py-2 text-gray-300">
                {doc.contentStatus || 'PUBLISHED'}
              </div>
            </Field>
            {doc.metrics && (
              <div className="space-y-2 mt-4 pt-4 border-t border-white/10">
                <h4 className="text-sm font-medium text-gray-300">Video Metrics</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/5 border border-white/10 rounded p-3">
                    <div className="text-xs text-gray-400 mb-1">Velocity (7d)</div>
                    <div className="text-lg font-bold text-white">+{doc.metrics.viewVelocity7d} views</div>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded p-3">
                    <div className="text-xs text-gray-400 mb-1">Last Computed</div>
                    <div className="text-sm text-gray-200">{new Date(doc.metrics.lastComputedAt).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-xs font-mono pt-4">
              <div className="bg-white/5 p-3 rounded border border-white/5">
                <span className="text-gray-500 block mb-1">Duration:</span>
                {doc.durationSeconds ? `${Math.floor(doc.durationSeconds / 60)}m ${doc.durationSeconds % 60}s` : 'Unknown'}
              </div>
              <div className="bg-white/5 p-3 rounded border border-white/5">
                <span className="text-gray-500 block mb-1">Views:</span>
                {doc.viewCount?.toLocaleString() || 'Unknown'}
              </div>
              <div className="bg-white/5 p-3 rounded border border-white/5">
                <span className="text-gray-500 block mb-1">Published:</span>
                {doc.publishedAt ? new Date(doc.publishedAt).toLocaleString() : 'Unknown'}
              </div>
              <div className="bg-white/5 p-3 rounded border border-white/5">
                <span className="text-gray-500 block mb-1">Last Synced:</span>
                {doc.lastSyncedAt ? new Date(doc.lastSyncedAt).toLocaleString() : 'Never'}
              </div>
            </div>
            
            <div className="bg-white/5 p-3 rounded border border-white/5 text-xs font-mono">
              <span className="text-gray-500 block mb-2">Thumbnail URL:</span>
              <a href={doc.thumbnailUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline break-all">
                {doc.thumbnailUrl || 'None'}
              </a>
            </div>

            <div className="bg-white/5 p-3 rounded border border-white/5 text-xs font-mono">
              <span className="text-gray-500 block mb-2">Raw YouTube Tags:</span>
              <div className="flex flex-wrap gap-1">
                {doc.youtubeTags?.map((tag, i) => (
                  <span key={i} className="bg-black/50 px-2 py-0.5 rounded text-gray-400">{tag}</span>
                )) || 'None'}
              </div>
            </div>
            
            <p className="text-xs text-gray-500">
              Factual fields are automatically synced from YouTube and cannot be manually edited here.
            </p>
          </div>
        )}

        {activeTab === 'status' && (
          <div className="space-y-6">
            <Field label="Status">
              <select value={doc.contentStatus} onChange={(e) => update('contentStatus', e.target.value)} className={inputClass}>
                <option value="published">Published</option>
                <option value="needs-review">Needs Review</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <div className="grid grid-cols-1 @sm:grid-cols-2 gap-3">
              <Toggle label="Featured" checked={doc.featured || false} onChange={(v) => update('featured', v)} />
              <Toggle label="Requires Review" checked={doc.requiresReview || false} onChange={(v) => update('requiresReview', v)} />
            </div>
            <Field label="Description">
              <textarea value={doc.description || ''} onChange={(e) => update('description', e.target.value)} className={textareaClass} placeholder="What the video is about..." />
            </Field>
          </div>
        )}

        {activeTab === 'overrides' && (
          <div className="space-y-6">
            <Field label="Manual Type Override">
              <select value={doc.manualTypeOverride || ''} onChange={(e) => update('manualTypeOverride', e.target.value)} className={inputClass}>
                <option value="">(None - Auto Detect)</option>
                <option value="video">Standard Video</option>
                <option value="short">YouTube Short</option>
                <option value="live">Live Stream VOD</option>
                <option value="event">Event</option>
              </select>
            </Field>
            <div>
              <Toggle
                label="Manual Taxonomy Override (Sync Lock)"
                checked={doc.manualTaxonomyOverride || false}
                onChange={(v) => update('manualTaxonomyOverride', v)}
              />
              {!doc.manualTaxonomyOverride && (
                <p className="text-xs text-yellow-500 mt-2">Lock required to edit Taxonomy tags.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'taxonomy' && (
          <div className={`grid grid-cols-1 @lg:grid-cols-2 gap-5 ${!doc.manualTaxonomyOverride ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="@lg:col-span-full">
              <Field label="Series">
                <input type="text" value={doc.series || ''} onChange={(e) => update('series', e.target.value)} className={inputClass} />
              </Field>
            </div>
            <div className="@lg:col-span-full">
              <TagsInput label="Franchises" value={doc.franchises} onChange={(v) => update('franchises', v)} />
            </div>
            <div className="@lg:col-span-full">
              <TagsInput label="Characters" value={doc.characters} onChange={(v) => update('characters', v)} />
            </div>
            <TagsInput label="Topics (slugs)" value={doc.topics} onChange={(v) => update('topics', v)} />
            <TagsInput label="Hubs (slugs)" value={doc.hubs} onChange={(v) => update('hubs', v)} />
          </div>
        )}

        {activeTab === 'editorial' && (
          <div className="grid grid-cols-1 gap-5">
            <Field label="Coverage Type">
              <select value={doc.coverageType || ''} onChange={(e) => update('coverageType', e.target.value)} className={inputClass}>
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
            </Field>

            <Field label="Editorial Notes">
              <textarea value={doc.editorialNotes || ''} onChange={(e) => update('editorialNotes', e.target.value)} className={textareaClass} placeholder="Internal context..." />
            </Field>

            <RelatedMediaArray 
              value={doc.relatedMedia} 
              onChange={(v) => update('relatedMedia', v)} 
            />
            
            <TagsInput label="Legacy Video IDs" value={doc.videoIds} onChange={(v) => update('videoIds', v)} />
            <TagsInput label="Legacy Article URLs" value={doc.articleUrls} onChange={(v) => update('articleUrls', v)} />
          </div>
        )}
      </div>
    </div>
  );
}

function EventForm({
  doc,
  updateDoc,
  updateSlug,
  updateLocation,
}: {
  doc: Doc;
  updateDoc: (id: string, field: keyof Doc, value: any) => void;
  updateSlug: (id: string, value: string) => void;
  updateLocation: (id: string, field: keyof LocationInfo, value: string) => void;
}) {
  const update = (field: keyof Doc, value: any) => updateDoc(doc._id, field, value);
  return (
    <div className={sectionClass}>
      <div className="grid grid-cols-1 @lg:grid-cols-2 gap-5">
        <Field label="Title">
          <input type="text" value={doc.title || ''} onChange={(e) => update('title', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Slug">
          <input
            type="text"
            value={doc.slug?.current || ''}
            onChange={(e) => updateSlug(doc._id, e.target.value)}
            className={`${inputClass} font-mono`}
          />
          <p className="text-xs text-gray-600 mt-1.5">/events/{doc.slug?.current || '…'}</p>
        </Field>
        <Field label="Status">
          <select value={doc.status || 'upcoming'} onChange={(e) => update('status', e.target.value)} className={inputClass}>
            <option value="upcoming">Upcoming</option>
            <option value="live">Live</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="postponed">Postponed</option>
            <option value="tbd">TBD</option>
          </select>
        </Field>
        <Field label="Event Type">
          <select value={doc.eventType || 'convention'} onChange={(e) => update('eventType', e.target.value)} className={inputClass}>
            <option value="convention">Convention</option>
            <option value="premiere">Premiere</option>
            <option value="screening">Screening</option>
            <option value="festival">Festival</option>
            <option value="expo">Expo</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Start Date">
          <input type="date" value={doc.startDate || ''} onChange={(e) => update('startDate', e.target.value)} className={inputClass} />
        </Field>
        <Field label="End Date">
          <input type="date" value={doc.endDate || ''} onChange={(e) => update('endDate', e.target.value)} className={inputClass} />
        </Field>
      </div>

      <div className="border-t border-white/10 pt-5">
        <div className={labelClass}>Location</div>
        <div className="grid grid-cols-1 @lg:grid-cols-2 gap-3">
          <input type="text" value={doc.location?.venue || ''} onChange={(e) => updateLocation(doc._id, 'venue', e.target.value)} className={inputClass} placeholder="Venue" />
          <input type="text" value={doc.location?.city || ''} onChange={(e) => updateLocation(doc._id, 'city', e.target.value)} className={inputClass} placeholder="City" />
          <input type="text" value={doc.location?.region || ''} onChange={(e) => updateLocation(doc._id, 'region', e.target.value)} className={inputClass} placeholder="Region / State" />
          <input type="text" value={doc.location?.country || ''} onChange={(e) => updateLocation(doc._id, 'country', e.target.value)} className={inputClass} placeholder="Country" />
        </div>
      </div>

      <Field label="Description">
        <textarea value={doc.description || ''} onChange={(e) => update('description', e.target.value)} className={textareaClass} placeholder="What this event/brand is about..." />
      </Field>

      <div className="grid grid-cols-1 @lg:grid-cols-2 gap-5">
        <Field label="Organizer">
          <input type="text" value={doc.organizer || ''} onChange={(e) => update('organizer', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Trailer URL">
          <input type="text" value={doc.trailerUrl || ''} onChange={(e) => update('trailerUrl', e.target.value)} className={inputClass} placeholder="https://youtu.be/…" />
        </Field>
        <Field label="Official Website">
          <input type="text" value={doc.officialWebsite || ''} onChange={(e) => update('officialWebsite', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Sign-up Link">
          <input type="text" value={doc.signUpLink || ''} onChange={(e) => update('signUpLink', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Brand Color (Hex)">
          <input type="text" value={doc.brandColor?.hex || ''} onChange={(e) => update('brandColor', { hex: e.target.value })} className={inputClass} placeholder="#FF0000" />
        </Field>
        <ImageUploadField 
          label="Logo URL" 
          value={typeof doc.logo === 'string' ? doc.logo : ''} 
          onChange={(v) => update('logo', v)} 
        />
        <ImageUploadField 
          label="Hero Image URL" 
          value={typeof doc.heroImage === 'string' ? doc.heroImage : ''} 
          onChange={(v) => update('heroImage', v)} 
        />
      </div>

      <div className="mt-5">
        <SocialLinksArray 
          value={doc.socialLinks} 
          onChange={(v) => update('socialLinks', v)} 
        />
      </div>

      <div className="mt-5">
        <TagsInput label="YouTube Sync Keywords (hub auto-tagging)" value={doc.youtubeSyncKeywords} onChange={(v) => update('youtubeSyncKeywords', v)} />
      </div>

      <div className="mt-10 pt-10 border-t border-white/10 space-y-8">
        <h3 className={labelClass}>Additional Media & Assets</h3>
        <VideoAssetsArray value={doc.videoAssets} onChange={(v) => update('videoAssets', v)} />
        <GalleryArray value={doc.gallery} onChange={(v) => update('gallery', v)} />
        <SponsorsArray value={doc.sponsors} onChange={(v) => update('sponsors', v)} />
        <PressAssetsArray value={doc.pressAssets} onChange={(v) => update('pressAssets', v)} />
      </div>
    </div>
  );
}

function BrandForm({
  doc,
  updateDoc,
  updateSlug,
}: {
  doc: Doc;
  updateDoc: (id: string, field: keyof Doc, value: any) => void;
  updateSlug: (id: string, value: string) => void;
}) {
  const update = (field: keyof Doc, value: any) => updateDoc(doc._id, field, value);
  return (
    <div className={sectionClass}>
      <div className="grid grid-cols-1 @lg:grid-cols-2 gap-5">
        <Field label="Title">
          <input type="text" value={doc.title || ''} onChange={(e) => update('title', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Slug">
          <input
            type="text"
            value={doc.slug?.current || ''}
            onChange={(e) => updateSlug(doc._id, e.target.value)}
            className={`${inputClass} font-mono`}
          />
          <p className="text-xs text-gray-600 mt-1.5">/featured/{doc.slug?.current || '…'}</p>
        </Field>
        <Field label="Trailer URL">
          <input type="text" value={doc.trailerUrl || ''} onChange={(e) => update('trailerUrl', e.target.value)} className={inputClass} placeholder="https://youtube.com/watch?v=…" />
        </Field>
        <ImageUploadField 
          label="Logo URL" 
          value={typeof doc.logo === 'string' ? doc.logo : ''} 
          onChange={(v) => update('logo', v)} 
        />
        <ImageUploadField 
          label="Hero Image URL" 
          value={typeof doc.heroImage === 'string' ? doc.heroImage : ''} 
          onChange={(v) => update('heroImage', v)} 
        />
      </div>

      <TagsInput label="YouTube Sync Keywords (hub auto-tagging)" value={doc.youtubeSyncKeywords} onChange={(v) => update('youtubeSyncKeywords', v)} />
    </div>
  );
}

function TopicForm({
  doc,
  updateDoc,
  updateSlug,
}: {
  doc: Doc;
  updateDoc: (id: string, field: keyof Doc, value: any) => void;
  updateSlug: (id: string, value: string) => void;
}) {
  const update = (field: keyof Doc, value: any) => updateDoc(doc._id, field, value);
  const isProtectedSlug = ['film', 'tv', 'gaming', 'events', 'uncategorized'].includes(doc.slug?.current || '');

  return (
    <div className={sectionClass}>
      <div className="grid grid-cols-1 @lg:grid-cols-2 gap-5">
        <Field label="Title">
          <input type="text" value={doc.title || ''} onChange={(e) => update('title', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Slug">
          <input
            type="text"
            value={doc.slug?.current || ''}
            onChange={(e) => updateSlug(doc._id, e.target.value)}
            disabled={isProtectedSlug}
            className={`${inputClass} font-mono ${isProtectedSlug ? 'opacity-50 cursor-not-allowed' : ''}`}
          />
          {isProtectedSlug && <p className="text-xs text-amber-500 mt-1.5">Core slug cannot be modified.</p>}
        </Field>
      </div>

      <div className="my-5">
        <Toggle
          label="Tier-1 Site Category"
          checked={doc.isTier1Category || false}
          onChange={(v) => update('isTier1Category', v)}
        />
        <p className="text-xs text-gray-400 mt-1.5">The top-level site categories. Videos must match at least one Tier-1 keyword.</p>
      </div>

      <TagsInput label="YouTube Sync Keywords" value={doc.youtubeSyncKeywords} onChange={(v) => update('youtubeSyncKeywords', v)} />
      
      <div className="mt-5">
        <Field label="Empty-State Message">
          <textarea value={doc.emptyStateMessage || ''} onChange={(e) => update('emptyStateMessage', e.target.value)} className={textareaClass} placeholder="First-person message shown when this category has no content yet..." />
        </Field>
      </div>
    </div>
  );
}
