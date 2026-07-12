/**
 * Read-only access to the local content caches written by
 * `scripts/fetch-feeds.mjs`. Pages import from here so rendering stays
 * decoupled from how the data is refreshed.
 */
import articlesData from './cache/articles.json';
import videosData from './cache/videos.json';

export const getArticles = () => Array.isArray(articlesData) ? articlesData : [];
export const getVideos = () => Array.isArray(videosData) ? videosData : [];
