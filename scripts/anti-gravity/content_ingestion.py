# ==========================================
# NORMALIZED MAPPING DICTIONARIES
# Keys: Raw tag variants | Values: Formatted Display Strings
# ==========================================

STUDIO_MAP = {
    "marvel": "Marvel", "marvel studios": "Marvel",
    "dc": "DC", "dcu": "DC", "dc comics": "DC",
    "disney": "Disney", "sony": "Sony", "a24": "A24",
    "wb": "Warner Bros", "warnerbros": "Warner Bros",
    "warner bros": "Warner Bros", "warnerbrothers": "Warner Bros"
}

PLATFORM_MAP = {
    # Gaming
    "playstation": "PlayStation", "ps5": "PlayStation", "ps4": "PlayStation", "ps3": "PlayStation",
    "xbox": "Xbox", "xboxseriesx": "Xbox", "xbsx": "Xbox",
    "nintendo": "Nintendo", "switch": "Nintendo", "gamecube": "Nintendo",
    "pc": "PC", "pcgaming": "PC",
    # Streaming
    "netflix": "Netflix",
    "apple tv": "Apple TV", "appletv": "Apple TV", "appletvplus": "Apple TV",
    "hulu": "Hulu",
    "max": "Max", "hbo max": "Max", "hbomax": "Max",
    "prime": "Prime Video", "primevideo": "Prime Video", "amazon prime": "Prime Video"
}

# ==========================================
# CATEGORY TRIGGERS
# ==========================================

GAMING_TRIGGERS = {
    "gaming", "video game", "videogame", "gameplay",
    "playstation", "xbox", "nintendo", "pc", "pcgaming"
}
EVENT_TRIGGERS = {
    "event", "premiere", "convention", "interview",
    "comiccon", "sdcc", "nycc", "d23", "wondercon"
}
TV_TRIGGERS    = {"tv", "television", "series", "shows", "streaming", "episode"}
MOVIE_TRIGGERS = {"movie", "movies", "film", "cinema", "feature", "theatrical"}

# Pre-computed union — avoids rebuilding the set on every function call.
ALL_CATEGORY_TRIGGERS = GAMING_TRIGGERS | MOVIE_TRIGGERS | TV_TRIGGERS | EVENT_TRIGGERS

def extract_matched_entities(tag_set, mapping_dict):
    """
    Uses set intersection for O(1) key lookups rather than iterating tags.
    Returns a deterministic, alphabetically sorted list of display names.
    """
    matched_keys = tag_set.intersection(mapping_dict.keys())
    normalized   = {mapping_dict[key] for key in matched_keys}
    return sorted(normalized)

def extract_rich_metadata(raw_tags, category_id=None):
    """
    Unified taxonomy engine for YouTube and Substack ingestion.
    """
    tag_set = set(tag.lower() for tag in raw_tags)

    # Cast to string — guards against int vs str mismatch across SDK versions.
    safe_category_id = str(category_id) if category_id is not None else None

    metadata = {
        "primary_category": "Uncategorized",
        "studios":  [],
        "platforms": [],
        "tags_raw":  raw_tags   # Original casing preserved for display/debugging.
    }

    # 1. TAG-FIRST ROUTING
    if   tag_set.intersection(GAMING_TRIGGERS):  metadata["primary_category"] = "Gaming"
    elif tag_set.intersection(MOVIE_TRIGGERS):   metadata["primary_category"] = "Movies"
    elif tag_set.intersection(TV_TRIGGERS):      metadata["primary_category"] = "TV"
    elif tag_set.intersection(EVENT_TRIGGERS):   metadata["primary_category"] = "Events"

    # 2. CATEGORY ID FALLBACK
    elif safe_category_id == "20": metadata["primary_category"] = "Gaming"
    elif safe_category_id == "19": metadata["primary_category"] = "Events"
    elif safe_category_id == "1":  metadata["primary_category"] = "Film & Animation"

    # 3. STUDIO EXTRACTION (No Context Gate)
    metadata["studios"] = extract_matched_entities(tag_set, STUDIO_MAP)

    # 4. PLATFORM EXTRACTION (Gated by Category Context)
    if tag_set.intersection(ALL_CATEGORY_TRIGGERS):
        metadata["platforms"] = extract_matched_entities(tag_set, PLATFORM_MAP)

    return metadata

# ==========================================
# INTEGRATION WRAPPERS
# ==========================================

def process_youtube_item(youtube_video):
    """Extracts payload and passes to unified engine."""
    snippet = youtube_video.get("snippet", {})
    return extract_rich_metadata(
        raw_tags    = snippet.get("tags", []),
        category_id = snippet.get("categoryId")
    )

import feedparser

def process_substack_feed(rss_url):
    """
    Ingests Substack RSS feed.
    
    WORKFLOW DEPENDENCY: Substack <category> nodes map from Section names/tags.
    Section names MUST contain trigger words (e.g., "Movies", "TV", "Gaming").
    Stylized section titles (e.g., "Weekly Picks") fall back to "Uncategorized".
    """
    feed    = feedparser.parse(rss_url)
    results = []

    for entry in feed.entries:
        substack_categories = [tag["term"] for tag in entry.get("tags", [])]
        results.append({
            "title":    entry.get("title", ""),
            "link":     entry.get("link",  ""),
            "metadata": extract_rich_metadata(
                raw_tags    = substack_categories,
                category_id = None
            )
        })

    return results
