import { categorize } from '../data/content-source.js';
import { getUnifiedVideos, type UnifiedVideo } from './videos.ts';
import localVideos from '../data/videos.json';

export async function getVideosUnified(): Promise<UnifiedVideo[]> {
  const mockClient = {
    fetch: async () => {
      return localVideos.filter(v => v._type === "video" && v.contentStatus === "published");
    }
  };
  return await getUnifiedVideos(mockClient, { categorize }, '');
}

export async function getShortsUnified(): Promise<UnifiedVideo[]> {
  const mockClient = {
    fetch: async () => {
      return localVideos.filter(v => v._type === "short" && v.contentStatus === "published");
    }
  };
  return await getUnifiedVideos(mockClient, { categorize }, '');
}

export async function getLiveStreamsUnified(): Promise<UnifiedVideo[]> {
  const mockClient = {
    fetch: async () => {
      return localVideos.filter(v => v._type === "live" && v.contentStatus === "published");
    }
  };
  return await getUnifiedVideos(mockClient, { categorize }, '');
}
