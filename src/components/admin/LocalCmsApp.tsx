import React, { useEffect, useMemo, useState } from 'react';

type DocType = 'video' | 'short' | 'live' | 'event' | 'featuredBrand';

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
};

const CONTENT_TABS = [
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
};

const FILTERS = ['All', 'Videos', 'Shorts', 'Live', 'Events', 'Featured'] as const;
type Filter = (typeof FILTERS)[number];

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
  'block w-full rounded-md border-0 py-2 px-3 bg-[#151515] text-white text-sm ring-1 ring-inset ring-white/10 placeholder:text-gray-600 focus:ring-2 focus:outline-none focus:ring-red-500';
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
      <div className="w-full lg:w-56 flex-shrink-0 flex flex-col gap-4 bg-[#111214] rounded-lg border border-white/10 p-3">
        <div>
          <div className="px-1 pb-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Content
          </div>
          <div className="flex flex-col gap-0.5">
            {FILTERS.map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`text-left px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeFilter === filter ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-white/10 pt-3">
          <div className="px-1 pb-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Create
          </div>
          <div className="flex flex-col gap-1">
            {(['video', 'short', 'live', 'event', 'featuredBrand'] as DocType[]).map((type) => (
              <button
                key={type}
                onClick={() => createDoc(type)}
                className="flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md text-sm font-medium text-gray-300 border border-dashed border-white/15 hover:border-red-500/50 hover:text-white hover:bg-white/5 transition-colors"
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
          <ul className="divide-y divide-white/5 overflow-y-auto flex-1">
            {filteredDocs.length === 0 && (
              <li className="p-4 text-center text-gray-600 text-sm">No documents match.</li>
            )}
            {filteredDocs.map((doc) => {
              const meta = TYPE_META[doc._type] ?? TYPE_META.video;
              return (
                <li
                  key={doc._id}
                  className={`p-2.5 cursor-pointer hover:bg-white/[0.04] transition-colors ${
                    selectedId === doc._id ? 'bg-white/[0.06]' : ''
                  }`}
                  onClick={() => setSelectedId(doc._id)}
                >
                  <div className="flex items-center">
                    {doc.youtubeId ? (
                      <img
                        src={`https://i.ytimg.com/vi/${doc.youtubeId}/mqdefault.jpg`}
                        alt=""
                        className="w-12 h-8 object-cover rounded bg-gray-800 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-8 rounded bg-gray-800 flex-shrink-0 flex items-center justify-center text-[9px] text-gray-500 font-bold uppercase text-center leading-tight px-1">
                        {meta.label}
                      </div>
                    )}
                    <div className="ml-3 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{doc.title || '(untitled)'}</p>
                      <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
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
                <button
                  onClick={() => deleteDoc(selected._id)}
                  className="flex-shrink-0 text-xs font-medium text-gray-500 hover:text-red-400 border border-white/10 hover:border-red-500/40 rounded-md px-2.5 py-1.5 transition-colors"
                >
                  Delete
                </button>
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
        {activeTab === 'status' && (
          <div className="grid grid-cols-1 @lg:grid-cols-2 gap-5">
            <Field label="Status">
              <select value={doc.contentStatus} onChange={(e) => update('contentStatus', e.target.value)} className={inputClass}>
                <option value="published">Published</option>
                <option value="needs-review">Needs Review</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <div className="flex flex-col justify-center space-y-2.5">
              <label className="flex items-center gap-2 text-sm font-medium text-white">
                <input
                  type="checkbox"
                  checked={doc.featured || false}
                  onChange={(e) => update('featured', e.target.checked)}
                  className="rounded bg-[#151515] border-white/10 text-red-500 focus:ring-red-500"
                />
                Featured
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-white">
                <input
                  type="checkbox"
                  checked={doc.requiresReview || false}
                  onChange={(e) => update('requiresReview', e.target.checked)}
                  className="rounded bg-[#151515] border-white/10 text-red-500 focus:ring-red-500"
                />
                Requires Review
              </label>
            </div>
            <Field label="Description">
              <textarea rows={3} value={doc.description || ''} onChange={(e) => update('description', e.target.value)} className={inputClass} />
            </Field>
          </div>
        )}

        {activeTab === 'overrides' && (
          <div className="grid grid-cols-1 @lg:grid-cols-2 gap-5">
            <Field label="Manual Type Override">
              <select value={doc.manualTypeOverride || ''} onChange={(e) => update('manualTypeOverride', e.target.value)} className={inputClass}>
                <option value="">(None - Auto Detect)</option>
                <option value="video">Standard Video</option>
                <option value="short">YouTube Short</option>
                <option value="live">Live Stream VOD</option>
                <option value="event">Event</option>
              </select>
            </Field>
            <div className="flex flex-col justify-center">
              <label className="flex items-center gap-2 text-sm font-medium text-white">
                <input
                  type="checkbox"
                  checked={doc.manualTaxonomyOverride || false}
                  onChange={(e) => update('manualTaxonomyOverride', e.target.checked)}
                  className="rounded bg-[#151515] border-white/10 text-red-500 focus:ring-red-500"
                />
                Manual Taxonomy Override (Sync Lock)
              </label>
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
              <textarea rows={3} value={doc.editorialNotes || ''} onChange={(e) => update('editorialNotes', e.target.value)} className={inputClass} />
            </Field>
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
          <select value={doc.status || 'scheduled'} onChange={(e) => update('status', e.target.value)} className={inputClass}>
            <option value="scheduled">Scheduled</option>
            <option value="live">Live</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
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
        <textarea rows={3} value={doc.description || ''} onChange={(e) => update('description', e.target.value)} className={inputClass} />
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
