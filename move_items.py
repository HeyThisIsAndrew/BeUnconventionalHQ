import json
import subprocess

def run_cmd(cmd):
    return subprocess.check_output(cmd, shell=True).decode('utf-8')

# Fetch items from project 3
print("Fetching items from project 3...")
output = run_cmd("gh project item-list 3 --owner HeyThisIsAndrew --format json")
data = json.loads(output)
items = data.get('items', [])

for item in items:
    content = item.get('content', {})
    title = content.get('title')
    body = content.get('body', '')
    item_id = item.get('id')
    
    if not title:
        continue
        
    print(f"Moving '{title}'...")
    
    # Create in project 4
    # We use subprocess.run with lists to avoid shell escaping issues
    subprocess.run([
        'gh', 'project', 'item-create', '4', 
        '--owner', 'HeyThisIsAndrew',
        '--title', title,
        '--body', body
    ], check=True)
    
    # Delete from project 3
    subprocess.run([
        'gh', 'project', 'item-delete', '3',
        '--owner', 'HeyThisIsAndrew',
        '--id', item_id
    ], check=True)

print("Done!")
