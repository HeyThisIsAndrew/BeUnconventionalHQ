import os
import json
import tempfile
from pathlib import Path
from typing import Dict, Any

class CacheSyncSkill:
    """
    Anti-Gravity Skill: Synchronizes autonomous agent data with 
    the local Astro JSON cache files.
    """
    def __init__(self, workspace_root: str):
        self.cache_dir = Path(workspace_root) / "src" / "data" / "cache"
        self.articles_file = self.cache_dir / "articles.json"
        self.videos_file = self.cache_dir / "videos.json"

    def _atomic_write(self, target_path: Path, data: Any):
        """
        Writes data to a temporary file first, then moves it to the target.
        """
        target_path.parent.mkdir(parents=True, exist_ok=True)
        
        fd, temp_path = tempfile.mkstemp(dir=target_path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, 'w') as tmp:
                json.dump(data, tmp, indent=2)
            os.replace(temp_path, target_path)
        except Exception as e:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            raise e

    async def execute(self, processed_data: Dict[str, Any]) -> bool:
        try:
            if "articles" in processed_data:
                self._atomic_write(self.articles_file, processed_data["articles"])
            
            if "videos" in processed_data:
                self._atomic_write(self.videos_file, processed_data["videos"])
                
            return True
        except Exception as e:
            print(f"[sync] Error: {str(e)}")
            return False

def get_skill(root: str):
    return CacheSyncSkill(root)
