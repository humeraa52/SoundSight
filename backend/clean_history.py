import json
import os
import shutil
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(BASE_DIR, "data", "history.json")

if not os.path.exists(PATH):
    print("No history.json found at:", PATH)
    raise SystemExit

with open(PATH, encoding="utf-8") as f:
    items = json.load(f)

print(f"Loaded {len(items)} saved items.\n")


def is_suspicious(item):
    title = (item.get("title") or "").strip().lower()
    topic = (item.get("topic") or "").strip().lower()
    return (
        item.get("contentType") in (None, "", "None", "Unknown")
        or item.get("isError")
        or title in ("no stem content detected", "not stem content")
        or topic in ("non-stem content", "academic stem concepts")
        or not title
    )


bad = [i for i in items if is_suspicious(i)]

if not bad:
    print("Nothing suspicious found. History is clean.")
    raise SystemExit

print("These items look wrong:\n")
for n, item in enumerate(bad, 1):
    print(
        f"{n}. {item.get('title') or '(no title)'} | "
        f"topic: {item.get('topic')} | "
        f"type: {item.get('contentType')}"
    )

print(
    "\nType the numbers you want to KEEP, separated by commas "
    "(or press Enter to keep none):"
)
keep_input = input("> ").strip()

keep_numbers = set()
for part in keep_input.split(","):
    part = part.strip()
    if part.isdigit():
        keep_numbers.add(int(part))

to_delete_ids = set()
for n, item in enumerate(bad, 1):
    if n not in keep_numbers:
        to_delete_ids.add(id(item))

count = len(to_delete_ids)

if count == 0:
    print("Nothing to delete.")
    raise SystemExit

if input(f"\nDelete {count} item(s)? (y/n) ").strip().lower() != "y":
    print("Cancelled. Nothing changed.")
    raise SystemExit

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
backup = f"{PATH}.{stamp}.bak"
shutil.copy(PATH, backup)

cleaned = [i for i in items if id(i) not in to_delete_ids]

with open(PATH, "w", encoding="utf-8") as f:
    json.dump(cleaned, f, indent=2, ensure_ascii=False)

print(f"\nDeleted {count} item(s). {len(cleaned)} remain.")
print("Backup saved as:", backup)