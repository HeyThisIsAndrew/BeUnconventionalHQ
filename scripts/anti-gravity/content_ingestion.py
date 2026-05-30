import httpx
import json
import re
import asyncio
from bs4 import BeautifulSoup
from typing import List, Dict, Any

class ContentIngestionSkill:
    """
    Anti-Gravity Skill: Orchestrates resilient data gathering from 
    Substack (RSS) and YouTube (RSS + Scrape Fallback).
    """
    def __init__(self):
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
        }
        self.substack_url = 'https://beunconventionalhq.substack.com/feed'
        self.yt_channel_id = 'UCXqU6781pQgYXDExLvMw2Og'
        self.yt_handle = '@BeUnconventionalHQ'

    def clean_text(self, text: str) -> str:
        if not text: return ""
        # Remove CDATA and HTML tags
        text = re.sub(r'<!\[CDATA\[[\s\S]*?\]\]>', '', text)
        soup = BeautifulSoup(text, "html.parser")
        return re.sub(r'\s+', ' ', soup.get_text()).strip()

    async def fetch_articles(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        resp = await client.get(self.substack_url)
        soup = BeautifulSoup(resp.content, "lxml-xml")
        articles = []
        
        for item in soup.find_all("item")[:20]:
            desc = self.clean_text(item.description.string if item.description else "")
            articles.append({
                "title": self.clean_text(item.title.string if item.title else ""),
                "link": item.link.string if item.link else "",
                "date": item.pubDate.string if item.pubDate else "",
                "excerpt": f"{desc[:160]}..." if len(desc) > 20 else "Read full article.",
                "image": item.find("enclosure")["url"] if item.find("enclosure") else None
            })
        return articles

    async def fetch_videos_rss(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        url = f"https://www.youtube.com/feeds/videos.xml?channel_id={self.yt_channel_id}"
        resp = await client.get(url)
        soup = BeautifulSoup(resp.content, "lxml-xml")
        return [{
            "title": self.clean_text(e.title.string),
            "link": f"https://www.youtube.com/watch?v={e.find('yt:videoId').string}",
            "thumbnail": f"https://i.ytimg.com/vi/{e.find('yt:videoId').string}/maxresdefault.jpg",
            "date": e.published.string
        } for e in soup.find_all("entry")]

    async def fetch_videos_scrape(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        # Fallback logic: Scrape ytInitialData if RSS fails
        resp = await client.get(f"https://www.youtube.com/{self.yt_handle}/videos")
        match = re.search(r'ytInitialData\s*=\s*({.+?});', resp.text)
        if not match: raise ValueError("YouTube Scrape Failed")
        
        data = json.loads(match.group(1))
        videos = []
        # Recursive walk logic simplified for blueprint
        return videos 

    async def execute(self) -> Dict[str, Any]:
        async with httpx.AsyncClient(headers=self.headers, timeout=10.0) as client:
            articles_task = self.fetch_articles(client)
            # Try RSS first, then fallback to scrape
            try:
                videos = await self.fetch_videos_rss(client)
            except Exception:
                videos = await self.fetch_videos_scrape(client)
                
            return {
                "articles": await articles_task,
                "videos": videos,
                "timestamp": asyncio.get_event_loop().time()
            }

def get_skill():
    return ContentIngestionSkill()
