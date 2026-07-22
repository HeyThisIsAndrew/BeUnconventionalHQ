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

const TYPE_META: Record<DocType, { label: string; badge: string }> = {
  video: { label: 'Video', badge: 'bg-blue-500/15 text-blue-300' },
  short: { label: 'Short', badge: 'bg-purple-500/15 text-purple-300' },
  live: { label: 'Live', badge: 'bg-red-500/15 text-red-300' },
  event: { label: 'Event', badge: 'bg-amber-500/15 text-amber-300' },
  featuredBrand: { label: 'Featured Brand', badge: 'bg-emerald-500/15 text-emerald-300' },
  topic: { label: 'Topic', badge: 'bg-zinc-500/15 text-zinc-300' },
};

const FILTERS = ['All', 'Videos', 'Shorts', 'Live', 'Events', 'Featured', 'Topics'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABELS: Record<Filter, string> = {
  All: 'All Content',
  Videos: 'Videos',
  Shorts: 'Shorts',
  Live: 'Live',
  Events: 'Events',
  Featured: 'Featured Brands',
  Topics: 'Topics',
};

// Grouped by what these actually are in our local schema - video/short/live
// are YouTube-sourced content; event/featuredBrand are hand-curated hub
// pages. Topics are taxonomy nodes.
const FILTER_GROUPS: { label: string; filters: Filter[] }[] = [
  { label: 'Content Library', filters: ['Videos', 'Shorts', 'Live'] },
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
  };
}

const inputClass =
  'w-full bg-[#111112] text-sm text-gray-200 border border-white/10 rounded-md px-3 py-2.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] focus:outline-none focus:border-red-500/50 focus:bg-[#161618] focus:shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] transition-all placeholder:text-gray-600';
const textareaClass = `${inputClass} resize-y min-h-[200px] leading-relaxed`;
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5';
const sectionClass = 'space-y-5';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-[#151515] px-3.5 py-3 cursor-pointer hover:border-white/25 transition-colors">
      <span className="text-sm font-medium text-white">{label}</span>
      <span className="relative inline-flex h-5 w-9 flex-shrink-0 items-center">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className="absolute inset-0 rounded-full bg-white/15 peer-checked:bg-red-600 transition-colors" />
        <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
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
  const [activeFilter, setActiveFilter] = useState<Filter>('All');

  useEffect(() => {
    fetch('/api/local-cms/videos')
      .then((res) => res.json())
      .then((data) => {
        setDocs(data);
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

  const filteredDocs = useMemo(() => {
    let list = docs.filter(
      (d) => d.title?.toLowerCase().includes(search.toLowerCase()) || d.youtubeId?.includes(search),
    );
    if (activeFilter !== 'All') {
      list = list.filter((d) => {
        const type = d.manualTypeOverride || d._type;
        if (activeFilter === 'Videos') return type === 'video';
        if (activeFilter === 'Shorts') return type === 'short';
        if (activeFilter === 'Live') return type === 'live';
        if (activeFilter === 'Events') return type === 'event' || d.manualTypeOverride === 'event';
        if (activeFilter === 'Featured') return type === 'featuredBrand' || d.featured === true;
        if (activeFilter === 'Topics') return type === 'topic';
        return true;
      });
    }
    return list;
  }, [docs, search, activeFilter]);

  if (loading) {
    return <div className="text-gray-400 text-sm p-6">Loading videos.json payload…</div>;
  }

  const selected = docs.find((d) => d._id === selectedId) || null;

  return (
    <div className="flex flex-col gap-3 w-full text-[13px]">
      {/* Save bar - own row, always full width */}
      <div className="w-full flex justify-between items-center bg-[#0c0c0d]/95 backdrop-blur px-4 py-3 border border-white/10 rounded-lg z-20">
        <div className="text-sm text-gray-400">
          Managing <span className="font-mono text-white">{docs.length}</span> documents locally
        </div>
        <div className="flex items-center gap-4">
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
            {saving ? 'Saving to disk…' : 'Save to videos.json'}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3 items-start w-full">
      {/* Structure pane */}
      <div className="w-full lg:w-56 flex-shrink-0 flex flex-col gap-6 bg-[#111214] rounded-lg border border-white/10 p-3 lg:h-[75vh] overflow-y-auto">
        <div className="flex flex-col gap-4">
          <div>
            <div className="px-1 pb-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              Content
            </div>
            <button
              onClick={() => setActiveFilter('All')}
              className={`w-full text-left px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
                activeFilter === 'All' ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              {FILTER_LABELS.All}
            </button>
          </div>

          {FILTER_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-1 pb-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                {group.label}
              </div>
              <div className="flex flex-col gap-1.5">
                {group.filters.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    className={`text-left px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
                      activeFilter === filter ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {FILTER_LABELS[filter]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="px-1 pb-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Create
          </div>
          <div className="flex flex-col gap-1.5">
            {(['video', 'short', 'live', 'event', 'featuredBrand'] as DocType[]).map((type) => (
              <button
                key={type}
                onClick={() => createDoc(type)}
                className="flex items-center gap-2 text-left px-2.5 py-2 rounded-md text-sm font-medium text-gray-300 border border-dashed border-white/15 hover:border-red-500/50 hover:text-white hover:bg-white/5 transition-colors"
              >
                <span className="text-red-400 font-bold">+</span> New {TYPE_META[type].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-3 items-start w-full lg:flex-1 min-w-0">
        {/* Document list pane */}
        <div className="w-full lg:w-80 flex-shrink-0 bg-[#111214] rounded-lg border border-white/10 flex flex-col lg:h-[75vh] max-h-[50vh] lg:max-h-none">
          <div className="p-2.5 border-b border-white/10 bg-black/20">
            <input
              type="text"
              placeholder="Search by title or YouTube ID…"
              className="w-full bg-[#151515] border border-white/10 rounded-md px-3 py-1.5 text-white text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <ul className="divide-y divide-white/[0.07] overflow-y-auto flex-1">
            {filteredDocs.length === 0 && (
              <li className="p-4 text-center text-gray-600 text-sm">No documents match.</li>
            )}
            {filteredDocs.map((doc) => {
              const meta = TYPE_META[doc._type] ?? TYPE_META.video;
              return (
                <li
                  key={doc._id}
                  className={`px-3.5 py-3.5 cursor-pointer hover:bg-white/[0.04] transition-colors ${
                    selectedId === doc._id ? 'bg-white/[0.06]' : ''
                  }`}
                  onClick={() => setSelectedId(doc._id)}
                >
                  <div className="flex items-center">
                    {doc.youtubeId ? (
                      <img
                        src={`https://i.ytimg.com/vi/${doc.youtubeId}/mqdefault.jpg`}
                        alt=""
                        className="w-14 h-9 object-cover rounded bg-gray-800 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-9 rounded bg-gray-800 flex-shrink-0 flex items-center justify-center text-[9px] text-gray-500 font-bold uppercase text-center leading-tight px-1">
                        {meta.label}
                      </div>
                    )}
                    <div className="ml-3.5 min-w-0 space-y-1">
                      <p className="text-sm font-medium text-white truncate">{doc.title || '(untitled)'}</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded ${meta.badge}`}>{meta.label}</span>
                        {doc.contentStatus && (
                          <span className={doc.contentStatus === 'published' ? 'text-green-400' : 'text-yellow-400'}>
                            {doc.contentStatus}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Document pane */}
        <div className="@container w-full lg:flex-1 min-w-0 bg-[#111214] rounded-lg border border-white/10 lg:h-[75vh] flex flex-col">
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
              <div className="flex items-start justify-between gap-3 p-4 border-b border-white/10">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${TYPE_META[selected._type]?.badge}`}>
                      {TYPE_META[selected._type]?.label ?? selected._type}
                    </span>
                    <span className="text-[11px] text-gray-600 font-mono truncate">{selected._id}</span>
                  </div>
                  <h2 className="text-lg font-bold text-white truncate">{selected.title}</h2>
                  {selected.youtubeId && (
                    <a
                      href={`https://youtube.com/watch?v=${selected.youtubeId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-400 text-xs hover:underline"
                    >
                      View on YouTube
                    </a>
                  )}
                </div>
                {!(selected._type === 'topic' && ['film', 'tv', 'gaming', 'events', 'uncategorized'].includes(selected.slug?.current || '')) ? (
                  <button
                    onClick={() => deleteDoc(selected._id)}
                    className="flex-shrink-0 text-xs font-medium text-gray-500 hover:text-red-400 border border-white/10 hover:border-red-500/40 rounded-md px-2.5 py-1.5 transition-colors"
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    disabled
                    title="Core taxonomy nodes cannot be deleted."
                    className="flex-shrink-0 text-xs font-medium text-gray-600 border border-white/5 bg-white/5 rounded-md px-2.5 py-1.5 cursor-not-allowed opacity-50"
                  >
                    Delete (Locked)
                  </button>
                )}
              </div>


              <div className="flex-1 overflow-y-auto p-4 sm:p-5">
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
  return (
    <Field label={label}>
      <input
        type="text"
        value={(value ?? []).join(', ')}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        className={inputClass}
        placeholder="comma, separated, values"
      />
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

      <div className="flex space-x-1 border-b border-white/10 pb-px overflow-x-auto">
        {CONTENT_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`px-3.5 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === tab.id ? 'border-red-500 text-red-500' : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-white/30'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pt-1 min-h-[280px]">
        {activeTab === 'factual' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 text-xs font-mono">
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
          <input type="text" value={doc.eventType || ''} onChange={(e) => update('eventType', e.target.value)} className={inputClass} placeholder="convention" />
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
        <Field label="Logo URL">
          <input type="text" value={typeof doc.logo === 'string' ? doc.logo : ''} onChange={(e) => update('logo', e.target.value)} className={inputClass} placeholder="https://…" />
          {doc.logo && typeof doc.logo !== 'string' && (
            <p className="text-xs text-gray-600 mt-1.5">Currently a Sanity asset reference - typing here replaces it with a plain URL.</p>
          )}
        </Field>
        <Field label="Hero Image URL">
          <input type="text" value={typeof doc.heroImage === 'string' ? doc.heroImage : ''} onChange={(e) => update('heroImage', e.target.value)} className={inputClass} placeholder="https://…" />
          {doc.heroImage && typeof doc.heroImage !== 'string' && (
            <p className="text-xs text-gray-600 mt-1.5">Currently a Sanity asset reference - typing here replaces it with a plain URL.</p>
          )}
        </Field>
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
        <Field label="Logo URL">
          <input type="text" value={typeof doc.logo === 'string' ? doc.logo : ''} onChange={(e) => update('logo', e.target.value)} className={inputClass} placeholder="https://…" />
          {doc.logo && typeof doc.logo !== 'string' && (
            <p className="text-xs text-gray-600 mt-1.5">Currently a Sanity asset reference - typing here replaces it with a plain URL.</p>
          )}
        </Field>
        <Field label="Hero Image URL">
          <input type="text" value={typeof doc.heroImage === 'string' ? doc.heroImage : ''} onChange={(e) => update('heroImage', e.target.value)} className={inputClass} placeholder="https://…" />
          {doc.heroImage && typeof doc.heroImage !== 'string' && (
            <p className="text-xs text-gray-600 mt-1.5">Currently a Sanity asset reference - typing here replaces it with a plain URL.</p>
          )}
        </Field>
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
