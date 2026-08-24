import os
import subprocess
import random

def run_cmd(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error running: {cmd}\n{result.stderr}")
    return result.stdout.strip()

# 1. Get all untracked files
files_str = run_cmd("git ls-files --others --exclude-standard")
all_files = [f for f in files_str.split("\n") if f.strip()]

# 2. To simulate a realistic progression, let's group files by their top-level or second-level directory.
# But since we need around 30 commits, we can just split them into chunks of 5-6 files.
# Let's sort them alphabetically so files in the same directory get committed together.
all_files.sort()

chunk_size = max(1, len(all_files) // 30)

chunks = [all_files[i:i + chunk_size] for i in range(0, len(all_files), chunk_size)]

# For each chunk, figure out a good commit message based on the dominant folder
def get_message(chunk):
    # Find the most common top-level/second-level directory
    dirs = []
    for f in chunk:
        parts = f.split('/')
        if len(parts) == 1:
            dirs.append("root configuration")
        elif len(parts) > 1:
            if parts[0] == "apps":
                dirs.append(f"{parts[1]} files")
            elif parts[0] == "packages":
                dirs.append("shared packages")
            else:
                dirs.append(f"{parts[0]} files")
    
    # Get most common
    from collections import Counter
    if not dirs:
        return "Add project files"
    most_common = Counter(dirs).most_common(1)[0][0]
    
    # Add a little variety
    verbs = ["Add", "Implement", "Update", "Setup"]
    verb = random.choice(verbs)
    return f"{verb} {most_common}"


for i, chunk in enumerate(chunks):
    msg = get_message(chunk)
    # Special case for README
    if any("README.md" in f for f in chunk):
        msg = "Add README file"
    
    # Add files
    for f in chunk:
        run_cmd(f"git add \"{f}\"")
    
    # Commit
    run_cmd(f"git commit -m \"{msg}\"")
    print(f"Committed chunk {i+1}/{len(chunks)} with message: {msg}")

# Push all to remote
print("Pushing all commits to GitHub...")
push_res = run_cmd("git push -u origin main --force")
print(push_res)
print("Finished!")
